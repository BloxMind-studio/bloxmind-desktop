-- ProceduralIKEngine.lua
-- Universal Procedural Animation Engine for R15 & R6 Rigs (IKControl + Sanity Clamp + Variance)
-- Sole general-purpose animation builder for BloxMind. All legacy per-action
-- builder modules were deleted; never reference or re-create them.
--
-- CREATOR MODE — Generative Freedom: This engine is a toolkit, NOT a static template.
-- Caller has total creative control to interpret the prompt, invent unique joint poses,
-- design timing/easing, and decide how motion looks. Every call must yield a distinct
-- animation via the variance engine (seed/intensity/speed/reach/style + dynamic 4-8
-- keyframes). Only 3 guardrails are strict (build fails otherwise):
--  1. Always face forward toward -Z (identity root + sanityClampSequence; no root flip)
--  2. Enforce proper motor hierarchy and joint safety limits (no 180° spine/wing clipping)
--  3. Execute automated test via execute_luau to verify pose before finalizing
--
-- Architecture:
--  1. Target-Based Pose Generation: keyframes derive limb angles from Relative World
--     Target Points (ReachForward, ReachMouth, StrikeTarget) — caller may also invent
--     free-form poses; variance engine adds noise/offsets for freshness.
--  2. IKControl Setup: SetupLimbIK() binds IKControl instances (EndEffector = hand/foot
--     attachments) to Target attachments offset from UpperTorso / Head for live solving.
--  3. Sanity Clamp (post-process): every baked pose CFrame is checked relative to the
--     torso facing frame; anything in the back half (localZ > 0) is forced to front
--     (localZ = -|localZ|) with lateral offsets capped, so limbs stay strictly in front.
--  Workflow: InspectRig first → generate freely with variance → sanityClamp → execute_luau verify → PublishToReplicatedStorage.

local ProceduralIKEngine = {}

-- Spring module (elastic rendering) — optional, pcall-safe for Node/test env
local Spring: any = nil
do
	local ok, mod = pcall(function()
		-- Studio: script sibling
		local s: any = nil
		pcall(function() s = (script :: any):FindFirstChild("Spring") end)
		if s then return require(s :: any) end
		-- ReplicatedStorage fallback
		local ok2, rs = pcall(function() return game:GetService("ReplicatedStorage") end)
		if ok2 and rs then
			local f = (rs :: any):FindFirstChild("Spring")
			if f then return require(f :: any) end
			local f2 = (rs :: any):FindFirstChild("ReplicatedShared")
			if f2 then
				local f3 = (f2 :: any):FindFirstChild("Spring")
				if f3 then return require(f3 :: any) end
			end
		end
		return nil
	end)
	if ok and mod then Spring = mod end
end
ProceduralIKEngine.Spring = Spring

local function rad(d: number): number
	return math.rad(d)
end

-- ==========================================
-- 1. UNIVERSAL JOINT SPACE TRANSFORM
-- ==========================================
-- Neutral joint offsets prevent unwanted 90-degree internal twists.
local function getJointC0(partName: string): CFrame
	-- All R15 / R6 limb joints operate cleanly with neutral joint space offsets
	return CFrame.new()
end

-- Converts character-space rotations (Forward = -Z) into proper Motor6D joint space.
-- The aim step already mirrors the target X per side, and the yaw sign is authored
-- so Ry*Rx steers toward the target; do NOT mirror yaw here (that steers the left
-- arm back across the body). Only Roll mirrors: CFrame.Angles(pitch, yaw, -roll).
local function createJointPose(partName: string, pitchDeg: number, yawDeg: number, rollDeg: number, pos: Vector3?): Pose
	local pose = Instance.new("Pose")
	pose.Name = partName

	local c0 = getJointC0(partName)
	local isLeft = partName:find("Left") ~= nil

	local pitch = pitchDeg or 0
	local yaw = yawDeg or 0
	local roll = rollDeg or 0
	if isLeft then
		roll = -roll
	end

	local charCF = CFrame.Angles(rad(pitch), rad(yaw), rad(roll))
	if pos then
		charCF = CFrame.new(pos) * charCF
	end

	-- Joint-space conversion: c0:Inverse() * charCF * c0
	pose.CFrame = c0:Inverse() * charCF * c0
	return pose
end

local function createSimplePose(partName: string, cframe: CFrame): Pose
	local pose = Instance.new("Pose")
	pose.Name = partName
	pose.CFrame = cframe
	return pose
end

-- ==========================================
-- 2. RELATIVE WORLD TARGET POINTS + SANITY CLAMP
-- ==========================================
-- Target offsets in torso space: -Z forward, +X character-right, +Y up.
-- ReachMouth is right-shoulder-relative (mouth sits toward center from the right
-- shoulder); left arms aim at the X-mirrored target, so author targets once.
ProceduralIKEngine.Targets = {
	ReachForward = Vector3.new(0, -0.2, -2.5),
	ReachMouth = Vector3.new(-0.9, 0.25, -0.45),
	StrikeTarget = Vector3.new(0, 0, -3.0),
	ReachOutWide = Vector3.new(1.4, -0.6, -1.4),
}

-- Deterministic Sanity Clamp for target points: anything behind the chest plane
-- (localZ > 0) is forced to front (localZ = -|localZ|) and lateral offsets are
-- capped so limbs remain strictly in front of the body.
local function clampTargetToFront(target: Vector3, maxLateral: number?): Vector3
	local m = maxLateral or 2.5
	-- Accept array-like tables from MCP/JSON boundaries ({x, y, z} or {X, Y, Z}).
	local x, y, z = target.X, target.Y, target.Z
	if x == nil and type(target) == "table" then
		local t: any = target
		x, y, z = t[1] or t.X or 0, t[2] or t.Y or 0, t[3] or t.Z or 0
	end
	if z > 0 then
		z = -math.abs(z)
	end
	if x > m then
		x = m
	elseif x < -m then
		x = -m
	end
	return Vector3.new(x, y, z)
end
ProceduralIKEngine.clampTargetToFront = clampTargetToFront

-- Convert a shoulder-relative target offset into (pitch, yaw, roll) degrees.
-- Left arms aim at the X-mirrored target. Positive pitch always swings forward
-- toward -Z. Yaw is negated so Ry*Rx steers toward the target: with the arm
-- pitched forward, positive yaw moves the hand toward -X, so a target at +X
-- (right side) needs negative yaw and vice versa.
local function aimLimbAtTarget(partName: string, target: Vector3): (number, number, number)
	local t = clampTargetToFront(target)
	local isLeft = partName:find("Left") ~= nil
	local x = isLeft and -t.X or t.X
	local fwd = math.max(0.001, -t.Z)
	local pitch = math.deg(math.atan2(fwd, -t.Y))
	if pitch < 0 then
		pitch = 0
	elseif pitch > 160 then
		pitch = 160
	end
	local yaw = -math.deg(math.atan2(x, fwd))
	if yaw > 35 then
		yaw = 35
	elseif yaw < -35 then
		yaw = -35
	end
	return pitch, yaw, 0
end
ProceduralIKEngine.aimLimbAtTarget = aimLimbAtTarget

-- ==========================================
-- 3. IKCONTROL SETUP (live solving on a character rig)
-- ==========================================
-- Programmatically binds IKControl instances to limbs. EndEffector attachments live
-- in the hands/feet; Target attachments are offset from UpperTorso (arms) or
-- HumanoidRootPart (feet) using clamped target points, so solutions track the face.
-- Returns { created = {IKControl,...}, targets = {Attachment,...}, errors = {...} }.
-- Never throws: per-limb work is pcall-guarded for clean Studio fallback.
function ProceduralIKEngine.SetupLimbIK(character: Model, opts: table?): table
	local options: table = opts or {}
	local out: table = { created = {}, targets = {}, errors = {} }

	local okChar, humanoid = pcall(function()
		return character:FindFirstChildOfClass("Humanoid")
	end)
	if not okChar or not humanoid then
		table.insert(out.errors, "SetupLimbIK: no Humanoid in " .. tostring(character and character:GetFullName()))
		return out
	end

	local torso = character:FindFirstChild("UpperTorso") or character:FindFirstChild("Torso")
	local rootPart = character:FindFirstChild("HumanoidRootPart")
	if not torso or not rootPart then
		table.insert(out.errors, "SetupLimbIK: missing torso/root part")
		return out
	end

	local limbs: table = {
		{ effectorPart = "RightHand", chainRoot = "RightUpperArm", parent = torso, target = options.ReachTarget or ProceduralIKEngine.Targets.ReachForward },
		{ effectorPart = "LeftHand", chainRoot = "LeftUpperArm", parent = torso, target = options.ReachTarget or ProceduralIKEngine.Targets.ReachForward },
		{ effectorPart = "RightFoot", chainRoot = "RightUpperLeg", parent = rootPart, target = options.StepTarget or Vector3.new(0.4, -2.6, -0.4) },
		{ effectorPart = "LeftFoot", chainRoot = "LeftUpperLeg", parent = rootPart, target = options.StepTarget or Vector3.new(-0.4, -2.6, -0.4) },
	}
	-- R6 single-part limbs use the same slots with legacy part names.
	if (humanoid :: Humanoid).RigType == Enum.HumanoidRigType.R6 then
		limbs = {
			{ effectorPart = "Right Arm", chainRoot = "Right Arm", parent = torso, target = options.ReachTarget or ProceduralIKEngine.Targets.ReachForward },
			{ effectorPart = "Left Arm", chainRoot = "Left Arm", parent = torso, target = options.ReachTarget or ProceduralIKEngine.Targets.ReachForward },
			{ effectorPart = "Right Leg", chainRoot = "Right Leg", parent = rootPart, target = options.StepTarget or Vector3.new(0.4, -2.6, -0.4) },
			{ effectorPart = "Left Leg", chainRoot = "Left Leg", parent = rootPart, target = options.StepTarget or Vector3.new(-0.4, -2.6, -0.4) },
		}
	end

	for _, limb in ipairs(limbs :: any) do
		local ok, err = pcall(function()
			local effPart = character:FindFirstChild(limb.effectorPart) :: BasePart?
			local chainPart = character:FindFirstChild(limb.chainRoot) :: BasePart?
			assert(effPart and effPart:IsA("BasePart"), "missing effector " .. tostring(limb.effectorPart))
			assert(chainPart and chainPart:IsA("BasePart"), "missing chain root " .. tostring(limb.chainRoot))

			local effAtt = effPart:FindFirstChild("BloxMind_IKEndEffector")
			if not effAtt then
				effAtt = Instance.new("Attachment")
				effAtt.Name = "BloxMind_IKEndEffector"
				effAtt.Parent = effPart
			end

			local clamped = clampTargetToFront(limb.target)
			local tgtAtt = Instance.new("Attachment")
			tgtAtt.Name = "BloxMind_IKTarget_" .. tostring(limb.effectorPart):gsub(" ", "")
			tgtAtt.Position = clamped
			tgtAtt.Parent = limb.parent

			local ik = Instance.new("IKControl")
			ik.Name = "BloxMind_IK_" .. tostring(limb.effectorPart):gsub(" ", "")
			ik.Type = Enum.IKControlType.Transform
			ik.EndEffector = effAtt :: Attachment
			ik.Target = tgtAtt :: Attachment
			ik.ChainRoot = chainPart
			ik.Priority = 10
			ik.Weight = 1
			ik.Parent = character

			table.insert(out.created, ik)
			table.insert(out.targets, tgtAtt)
		end)
		if not ok then
			table.insert(out.errors, tostring(err))
		end
	end

	return out
end

-- ==========================================
-- 3b. INSPECT FIRST (rig + Animator verification — never guess)
-- ==========================================
-- Run via execute_luau before writing or playing any animation. Confirms whether
-- the target character is R6 or R15 and verifies an Animator exists under the
-- Humanoid. Returns { rigType = "R6"|"R15"|"Unknown", hasAnimator: boolean,
-- humanoidPath?, animatorPath?, error? }. Never throws.
function ProceduralIKEngine.InspectRig(character: Model?): table
	local out: table = { rigType = "Unknown", hasAnimator = false }
	local ok, humanoid = pcall(function()
		return character and character:FindFirstChildOfClass("Humanoid") or nil
	end)
	if not ok or not humanoid then
		out.error = "InspectRig: no Humanoid found — cannot confirm rig, do not build"
		return out
	end
	out.humanoidPath = (humanoid :: Humanoid):GetFullName()
	out.rigType = ((humanoid :: Humanoid).RigType == Enum.HumanoidRigType.R6) and "R6" or "R15"
	local animator = (humanoid :: Humanoid):FindFirstChildOfClass("Animator")
	out.hasAnimator = animator ~= nil
	if animator then
		out.animatorPath = (animator :: Animator):GetFullName()
	end
	return out
end

-- ==========================================
-- 3c. ROOT-JOINT CALIBRATION (measure, never assume)
-- ==========================================
-- Reads the LIVE Root joint (LowerTorso "Root" on R15, Torso "RootJoint" on R6)
-- from the actual avatar and reports its rest orientation. Pose.CFrame drives
-- Motor6D.Transform only — C0/C1 are never modified by animation — so identity
-- Pose output already equals rest pose on default avatars. A hardcoded
-- inverse-C0 multiply would rotate the character OFF rest (a 180° error), which
-- is why this engine measures and reports instead of baking a compensation
-- constant. Returns { found, jointName, jointPath, c0YawDeg, c1YawDeg, note,
-- error? }. Never throws.
function ProceduralIKEngine.InspectRootJoint(character: Model?): table
	local out: table = { found = false }
	local ok, res = pcall(function()
		if not character then error("no character") end
		local rootPart: BasePart? = (character :: Model):FindFirstChild("HumanoidRootPart") :: any
		if not rootPart then error("no HumanoidRootPart") end
		local lower: Instance? = (character :: Model):FindFirstChild("LowerTorso")
		local torso: Instance? = (character :: Model):FindFirstChild("Torso")
		local waistPart: Instance? = lower or torso
		if not waistPart then error("no LowerTorso/Torso") end
		local joint: Instance? = nil
		for _, child in ipairs((waistPart :: Instance):GetChildren()) do
			if child:IsA("Motor6D") or child:IsA("AnimationConstraint") then
				local j: any = child
				local p0: Instance? = if j:IsA("Motor6D") then j.Part0 else nil
				local p1: Instance? = if j:IsA("Motor6D") then j.Part1 else nil
				if p0 == rootPart or p1 == rootPart or j.Name == "Root" or j.Name == "RootJoint" then
					joint = child
					break
				end
			end
		end
		if not joint then
			-- Fallback: Root joint is parented under HumanoidRootPart on some rigs.
			for _, child in ipairs((rootPart :: BasePart):GetChildren()) do
				if child:IsA("Motor6D") and (child.Name == "Root" or child.Name == "RootJoint") then
					joint = child
					break
				end
			end
		end
		if not joint then error("no Root joint found") end
		out.found = true
		out.jointName = (joint :: Instance).Name
		out.jointPath = (joint :: Instance):GetFullName()
		out.jointClass = (joint :: Instance).ClassName
		if (joint :: Instance):IsA("Motor6D") then
			local c0: CFrame = ((joint :: any).C0 :: CFrame)
			local c1: CFrame = ((joint :: any).C1 :: CFrame)
			local _, c0y, _ = c0:ToEulerAnglesYXZ()
			local _, c1y, _ = c1:ToEulerAnglesYXZ()
			out.c0YawDeg = math.deg(c0y)
			out.c1YawDeg = math.deg(c1y)
		end
		out.note = "Pose.CFrame drives Motor6D.Transform; C0/C1 untouched, identity = rest. No compensation constant baked."
		return out
	end)
	if not ok then out.error = tostring(res) end
	return out
end

-- ==========================================
-- 3d. REACH VERIFICATION (player-avatar facing test)
-- ==========================================
-- Behavioral test for the default avatar: places a point at
-- HumanoidRootPart.Position + LookVector * 4 (in front of the face) and checks
-- that the engine-aimed right arm reaches TOWARD it, not behind the back.
-- Uses the live HRP orientation, so it validates steering on the real rig.
-- character defaults to the local player's character, then workspace "Dummy".
-- Returns { ok, dot, armDirWorld, frontPoint, facing, rootJoint, error? } where
-- dot > 0.3 means reaching toward the point. Never throws.
function ProceduralIKEngine.VerifyReach(character: Model?, opts: table?): table
	local options: table = opts or {}
	local out: table = { ok = false }
	local ok, res = pcall(function()
		local char: Model? = character
		if not char then
			pcall(function()
				local players = game:GetService("Players")
				char = players.LocalPlayer and players.LocalPlayer.Character or nil
			end)
		end
		if not char then char = workspace:FindFirstChild("Dummy") :: any end
		if not char then error("no character (pass player Character or add workspace Dummy)") end
		local hrp: BasePart? = (char :: Model):FindFirstChild("HumanoidRootPart") :: any
		if not hrp then error("no HumanoidRootPart") end
		local hrpCF: CFrame = (hrp :: BasePart).CFrame
		local frontPoint: Vector3 = hrpCF.Position + hrpCF.LookVector * 4
		-- Aim the right arm exactly as BuildSequence does for a punch.
		local pitch, yaw = aimLimbAtTarget("RightUpperArm", ProceduralIKEngine.Targets.StrikeTarget)
		local armDirLocal: Vector3 = CFrame.Angles(rad(pitch), rad(yaw), 0) * Vector3.new(0, -1, 0)
		local armDirWorld: Vector3 = (hrpCF - hrpCF.Position) * armDirLocal
		-- Approximate right-shoulder world position from the live rig frame.
		local shoulderW: Vector3 = hrpCF.Position + hrpCF.UpVector * 1.5 + hrpCF.RightVector * 1.0
		local toFront: Vector3 = frontPoint - shoulderW
		if toFront.Magnitude < 0.001 then error("degenerate front point") end
		local dot: number = armDirWorld:Dot(toFront.Unit)
		out.dot = dot
		out.armDirWorld = { x = armDirWorld.X, y = armDirWorld.Y, z = armDirWorld.Z }
		out.frontPoint = { x = frontPoint.X, y = frontPoint.Y, z = frontPoint.Z }
		out.facing = hrpCF.LookVector
		out.pitch, out.yaw = pitch, yaw
		out.rootJoint = ProceduralIKEngine.InspectRootJoint(char)
		out.ok = dot > (tonumber(options.minDot) or 0.3)
		if not out.ok then
			out.error = "arm reaches away from the face-front point (dot <= threshold) — check yaw steering"
		end
		return out
	end)
	if not ok then out.error = tostring(res) end
	return out
end

-- ==========================================
-- 4. SANITY CLAMP POST-PROCESS (back-half guard)
-- ==========================================
-- Iterates every generated pose CFrame. Each nested sub-pose CFrame is expressed in
-- its parent part's frame; a positional localZ > 0 sits in the back half relative to
-- facing direction, so force localZ = -|localZ| and cap lateral offsets. Rotations
-- pass through untouched (their directions were already derived from clamped targets).
-- Returns the number of clamped poses for Studio verification output.
local function sanityClampSequence(seq: KeyframeSequence, maxLateral: number?): number
	local m = maxLateral or 2.5
	local clamped = 0
	local function clampCF(cf: CFrame): CFrame
		local p = cf.Position
		local x, y, z = p.X, p.Y, p.Z
		local hit = false
		if z > 0 then
			z = -math.abs(z)
			hit = true
		end
		if x > m then
			x = m
			hit = true
		elseif x < -m then
			x = -m
			hit = true
		end
		if not hit then
			return cf
		end
		return CFrame.new(x, y, z) * (cf - cf.Position)
	end
	local function walk(inst: Instance)
		for _, child in ipairs(inst:GetChildren()) do
			if child:IsA("Pose") then
				local fixed = clampCF((child :: Pose).CFrame)
				if fixed ~= (child :: Pose).CFrame then
					(child :: Pose).CFrame = fixed
					clamped += 1
				end
			end
			walk(child)
		end
	end
	walk(seq)
	pcall(function()
		(seq :: Instance):SetAttribute("SanityClamped", clamped)
	end)
	return clamped
end
ProceduralIKEngine.sanityClampSequence = sanityClampSequence

-- ==========================================
-- 5. UNIVERSAL KEYFRAME BUILDER (dual rig, target-driven)
--    Note on rig:"both" (default): each Keyframe nests BOTH R15 and R6 trees
--    via AddSubPose. The live rig plays its matching tree (off-rig poses are
--    ignored), so a single KeyframeSequence is already dual-rig compatible.
--    With rig:"r15"/"r6" the other tree is pruned per keyframe (see end of
--    addKeyframeToSequence), so strict per-rig AnimationIds need only one
--    BuildSequence call each — no post-processing by the caller.
-- ==========================================
local function addKeyframeToSequence(seq: KeyframeSequence, timeStamp: number, r15Data: table, r6Data: table)
	local kf = Instance.new("Keyframe")
	kf.Time = timeStamp
	kf.Parent = seq

	-- Root Pose (HumanoidRootPart, forward = -Z): identity = rest pose, no flip.
	-- Pose.CFrame drives Motor6D.Transform only; C0/C1 are never touched, so the
	-- default avatar's RootJoint offset is preserved automatically on every rig.
	local rootPose = createSimplePose("HumanoidRootPart", r15Data.root or CFrame.new())
	kf:AddPose(rootPose)

	-- ------------------------------------------
	-- R15 HIERARCHY (Keyframes nest BOTH rigs; the live rig plays its matching tree)
	-- ------------------------------------------
	local lowerTorso = createSimplePose("LowerTorso", r15Data.lower or CFrame.new())
	rootPose:AddSubPose(lowerTorso)

	local upperTorso = createSimplePose("UpperTorso", r15Data.upper or CFrame.new())
	lowerTorso:AddSubPose(upperTorso)

	local head = createSimplePose("Head", r15Data.head or CFrame.new())
	upperTorso:AddSubPose(head)

	-- Arms (target-derived pitch/yaw via aimLimbAtTarget at the call site)
	local lUpperArm = createJointPose("LeftUpperArm", r15Data.lUpperPitch or 0, r15Data.lUpperYaw or 0, r15Data.lUpperRoll or 0)
	upperTorso:AddSubPose(lUpperArm)
	local lLowerArm = createJointPose("LeftLowerArm", r15Data.lLowerPitch or 0, 0, 0)
	lUpperArm:AddSubPose(lLowerArm)
	local lHand = createJointPose("LeftHand", r15Data.lHandPitch or 0, 0, 0)
	lLowerArm:AddSubPose(lHand)

	local rUpperArm = createJointPose("RightUpperArm", r15Data.rUpperPitch or 0, r15Data.rUpperYaw or 0, r15Data.rUpperRoll or 0)
	upperTorso:AddSubPose(rUpperArm)
	local rLowerArm = createJointPose("RightLowerArm", r15Data.rLowerPitch or 0, 0, 0)
	rUpperArm:AddSubPose(rLowerArm)
	local rHand = createJointPose("RightHand", r15Data.rHandPitch or 0, 0, r15Data.rHandRoll or 0)
	rLowerArm:AddSubPose(rHand)

	-- Legs
	local lUpperLeg = createSimplePose("LeftUpperLeg", r15Data.lLeg or CFrame.new())
	lowerTorso:AddSubPose(lUpperLeg)
	-- Knee flexion (degrees, 0 = extended, negative = flexed per skill limits
	-- 0..-120, single-axis, no twist). Defaults 0 = previous stiff behavior.
	local lLowerLeg = createJointPose("LeftLowerLeg", r15Data.lKneePitch or 0, 0, 0)
	lUpperLeg:AddSubPose(lLowerLeg)
	local lFoot = createSimplePose("LeftFoot", CFrame.new())
	lLowerLeg:AddSubPose(lFoot)

	local rUpperLeg = createSimplePose("RightUpperLeg", r15Data.rLeg or CFrame.new())
	lowerTorso:AddSubPose(rUpperLeg)
	local rLowerLeg = createJointPose("RightLowerLeg", r15Data.rKneePitch or 0, 0, 0)
	rUpperLeg:AddSubPose(rLowerLeg)
	local rFoot = createSimplePose("RightFoot", CFrame.new())
	rLowerLeg:AddSubPose(rFoot)

	-- ------------------------------------------
	-- R6 HIERARCHY
	-- ------------------------------------------
	local torso = createSimplePose("Torso", r6Data.torso or CFrame.new())
	rootPose:AddSubPose(torso)

	local r6Head = createSimplePose("Head", r6Data.head or CFrame.new())
	torso:AddSubPose(r6Head)

	local r6LArm = createJointPose("Left Arm", r6Data.lArmPitch or 0, r6Data.lArmYaw or 0, r6Data.lArmRoll or 0)
	torso:AddSubPose(r6LArm)
	local r6RArm = createJointPose("Right Arm", r6Data.rArmPitch or 0, r6Data.rArmYaw or 0, r6Data.rArmRoll or 0)
	torso:AddSubPose(r6RArm)

	local r6LLeg = createSimplePose("Left Leg", r6Data.lLeg or CFrame.new())
	torso:AddSubPose(r6LLeg)
	local r6RLeg = createSimplePose("Right Leg", r6Data.rLeg or CFrame.new())
	torso:AddSubPose(r6RLeg)

	-- NO root flip: engine targets are already -Z forward (Roblox convention).
	-- The root CFrame is identity in rest pose; limb rotations are computed for -Z forward.
	-- A 180° flip would rotate the root to face +Z (backward), making the entire animation backward.
	-- Children inherit the root's orientation via nesting, so limbs stay consistent with root facing.

	-- Per-rig pruning: rig comes from the parent sequence's RigType attribute
	-- (stamped by BuildSequence; defaults to "both"). Pruning here — rather
	-- than threading a parameter through every call site — keeps all builders
	-- uniform. Destroy() on a just-created Pose is cheap and leaves no trace.
	local pruneRig: string = "both"
	pcall(function()
		pruneRig = normalizeRig((seq :: Instance):GetAttribute("RigType"))
	end)
	if pruneRig == "r15" then
		local torso = rootPose:FindFirstChild("Torso")
		if torso then torso:Destroy() end
	elseif pruneRig == "r6" then
		local lowerTorso = rootPose:FindFirstChild("LowerTorso")
		if lowerTorso then lowerTorso:Destroy() end
	end

	-- Explicit-style easing: stamp interpolation character on every pose of
	-- this keyframe. Reads the parent sequence attributes (set by
	-- BuildSequence only for explicit styles); otherwise poses keep engine
	-- defaults. Poses are Instance-nested via AddPose/AddSubPose, so
	-- GetDescendants reaches the whole tree. All pcall-guarded.
	local wantEasing = false
	local easingStyle: string = ""
	local easingDir: string = ""
	pcall(function()
		wantEasing = (seq :: Instance):GetAttribute("StyleExplicit") == true
		easingStyle = tostring((seq :: Instance):GetAttribute("PoseEasingStyle") or "")
		easingDir = tostring((seq :: Instance):GetAttribute("PoseEasingDirection") or "")
	end)
	if wantEasing and easingStyle ~= "" then
		for _, d in ipairs(kf:GetDescendants()) do
			if d:IsA("Pose") then
				pcall(function()
					(d :: Pose).EasingStyle = (Enum.PoseEasingStyle :: any)[easingStyle] or Enum.PoseEasingStyle.Linear
				end)
				pcall(function()
					(d :: Pose).EasingDirection = (Enum.PoseEasingDirection :: any)[easingDir] or Enum.PoseEasingDirection.InOut
				end)
			end
		end
	end

	return kf
end

-- Verification helper for execute_luau: spawn/check facing
-- Use via execute_luau: local ok = ProceduralIKEngine.VerifyFacing(workspace:FindFirstChild("Dummy"))
-- Asserts root/chest LookVector points toward -Z world (face forward, not back/wings).
-- There is no flip step: identity root already faces -Z by Roblox convention.
function ProceduralIKEngine.VerifyFacing(character: Model?): table
	local out: table = { ok = false, facing = nil, lookVector = nil, error = nil }
	local ok, res = pcall(function()
		local char: Model? = character or workspace:FindFirstChild("Dummy") :: any
		if not char then
			-- spawn a quick dummy for verification if none exists
			local players = game:GetService("Players")
			local desc = Instance.new("HumanoidDescription")
			local dummy = players:CreateHumanoidModelFromDescription(desc, Enum.HumanoidRigType.R15)
			dummy.Name = "Dummy_VerifyFacing"
			dummy.Parent = workspace
			char = dummy
		end
		local hrp: BasePart? = (char :: Model):FindFirstChild("HumanoidRootPart") :: any
		if not hrp then error("No HumanoidRootPart") end
		-- Sample world LookVector (chest faces -Z when correct in Roblox convention)
		local lv: Vector3 = (hrp :: BasePart).CFrame.LookVector
		out.lookVector = { x = lv.X, y = lv.Y, z = lv.Z }
		-- In Roblox, face forward is -Z world (default character orientation).
		-- No flip needed — engine targets are already -Z forward.
		local isForward = lv.Z < -0.5 -- face points -Z = correct
		out.facing = isForward and "forward (-Z face)" or "backward (+Z back)"
		out.ok = isForward
		if not isForward then out.error = "Facing is backward (+Z) — check if a spurious 180° root flip was applied" end
		return out
	end)
	if not ok then out.error = tostring(res) end
	return out
end

-- Ambient loop actions rest at Idle; attacks, interactions, and anything
-- unrecognized default to Action (play over everything).
local LOOP_ACTIONS: {[string]: boolean} = {
	dance = true, emote = true, groove = true, shuffle = true,
	locomotion = true, idle = true, sway = true, breathe = true,
}

-- Resolve Priority + Loop from action intent. Explicit actionConfig.priority
-- ("Action", "Movement", "Idle", ...) and actionConfig.loop always win; otherwise
-- attacks and interactions default to Action + no loop, loop-type actions to Idle + loop.
local function resolveTrackSettings(actionType: string, cfg: table): (any, boolean)
	local act = string.lower(tostring(actionType or "idle"))
	if cfg.priority ~= nil then
		local ok, prio = pcall(function()
			return (Enum.AnimationPriority :: any)[tostring(cfg.priority)]
		end)
		if ok and prio ~= nil then
			return prio, cfg.loop == true
		end
	end
	if LOOP_ACTIONS[act] then
		return Enum.AnimationPriority.Idle, cfg.loop == nil and true or cfg.loop == true
	end
	return Enum.AnimationPriority.Action, cfg.loop == true
end
ProceduralIKEngine.resolveTrackSettings = resolveTrackSettings

-- Phase markers (optional — Keyframe:AddMarker does not exist in all builds).
-- Best-effort string form only, always pcall-guarded. There is NO `Marker`
-- class in the Roblox API (Instance.new("Marker") throws unknown-class), so
-- no instance fallback is attempted — that dead branch taught agents the
-- wrong API. Never throws; returns false if markers unsupported so callers
-- can safely ignore.
local function markPhase(seq: KeyframeSequence, time: number, name: string): boolean
	for _, kf in ipairs(seq:GetChildren()) do
		if kf:IsA("Keyframe") and math.abs((kf :: Keyframe).Time - time) < 0.001 then
			-- Returns true ONLY if a marker was actually applied: a bare pcall
			-- success would also cover "AddMarker missing, early return".
			local applied = false
			pcall(function()
				local kfInst: any = kf :: any
				if typeof(kfInst.AddMarker) ~= "function" then return end
				if pcall(function() kfInst:AddMarker(name) end) then
					applied = true
				end
			end)
			return applied
		end
	end
	return false
end
ProceduralIKEngine.markPhase = markPhase

-- ==========================================
-- 5b. DURATION + BEATS HELPERS (thread UI -> engine)
-- ==========================================
local function parseDuration(cfg: table): number?
	local v: any = cfg.duration or cfg.durationSec or cfg.time or cfg.length
	if v == nil then return nil end
	if type(v) == "number" then
		return math.clamp(tonumber(v) or 1.0, 0.2, 5.0)
	end
	if type(v) == "string" then
		local s = tostring(v):gsub("%s+", "")
		-- handle "1500ms"
		local ms = s:match("([%d%.]+)ms")
		if ms then
			local n = tonumber(ms)
			if n then return math.clamp(n / 1000, 0.2, 5.0) end
		end
		local num = tonumber(s:match("([%d%.]+)"))
		if num then
			-- "1.5s" or "1.5" both just numeric seconds
			return math.clamp(num, 0.2, 5.0)
		end
	end
	return nil
end
ProceduralIKEngine.parseDuration = parseDuration

local function normalizeActionType(raw: any): string
	local s = string.lower(tostring(raw or "idle")):gsub("^%s+", ""):gsub("%s+$", "")
	if s:find("combat") or s:find("punch") or s:find("kick") or s:find("strike") then return "combat" end
	if s:find("hit") and s:find("reaction") then return "hit reaction" end
	if s:find("hit reaction") or s:find("flinch") or s:find("stagger") or s:find("knockback") then return "hit reaction" end
	if s:find("dance") or s:find("groove") or s:find("shuffle") then return "dance" end
	if s:find("locomotion") then return "dance" end
	if s:find("emote") then return "emote" end
	if s:find("eat") or s:find("drink") or s:find("bite") or s:find("sip") then return "eat" end
	return s
end
ProceduralIKEngine.normalizeActionType = normalizeActionType

local function sanitizeMarkerName(raw: string): string
	local s = tostring(raw):gsub("^%s+", ""):gsub("%s+$", "")
	if #s == 0 then return "Beat" end
	-- keep alphanum only for marker name, capitalize first
	s = s:gsub("[^%w%s%-_]", "")
	s = s:gsub("%s+", "_")
	if #s == 0 then return "Beat" end
	-- Roblox markers prefer simple names; limit length
	if #s > 24 then s = s:sub(1, 24) end
	return s
end

local function beatToMarker(beat: string): string
	local b = string.lower(tostring(beat or ""))
	if b:find("chain") then return "ChainWindow" end
	if b:find("wind") or b:find("anticip") then return "Anticipation" end
	if b:find("impact") or b:find("strike") or b:find("hit") then return "Impact" end
	if b:find("punch") or b:find("kick") then return "Impact" end
	if b:find("peak") or b:find("apex") then return "Peak" end
	if b:find("recover") or b:find("return") or b:find("reset") then return "Recovery" end
	if b:find("flinch") then return "Flinch" end
	if b:find("stagger") then return "Stagger" end
	if b:find("knockback") or b:find("knock") then return "Knockback" end
	if b:find("chew") then return "Chew" end
	if b:find("sip") or b:find("bite") then return "Peak" end
	return sanitizeMarkerName(beat)
end
ProceduralIKEngine.beatToMarker = beatToMarker

-- Rig selector: "r15" | "r6" | "both" (default). Anything else falls back to
-- "both" so a malformed request still yields a playable dual sequence.
local function normalizeRig(raw: any): string
	local s = string.lower(tostring(raw or "both"))
	if s == "r15" or s == "r6" then return s end
	return "both"
end
ProceduralIKEngine.normalizeRig = normalizeRig

local function normalizeBeats(cfg: table): {string}
	local raw: any = cfg.beats or cfg.keyBeats or cfg.beatList or cfg.beatsStr or cfg.key_beats
	local out: {string} = {}
	local function pushStr(s: string)
		for part in string.gmatch(s, "[^,|;]+") do
			local t = part:gsub("^%s+", ""):gsub("%s+$", "")
			if #t > 0 then table.insert(out, t) end
		end
	end
	if type(raw) == "table" then
		for _, v in ipairs(raw :: any) do
			if type(v) == "string" then pushStr(v)
			elseif type(v) == "number" then table.insert(out, tostring(v))
			end
		end
	elseif type(raw) == "string" then
		pushStr(raw)
	end
	-- also accept cfg.beat as single string
	if #out == 0 and type(cfg.beat) == "string" and #tostring(cfg.beat):gsub("%s+", "") > 0 then
		pushStr(tostring(cfg.beat))
	end
	return out
end
ProceduralIKEngine.normalizeBeats = normalizeBeats

-- ==========================================
-- 5c. PROCEDURAL VARIANCE ENGINE
--     Every BuildSequence call yields distinct CFrames via seeded noise.
--     Covers: joint-angle jitter, trajectory arc offsets, timing jitter,
--     dynamic keyframe densities (4–8), intensity/speed/reach/style modifiers.
-- ==========================================
local function hashString(s: string): number
	local h = 5381
	for i = 1, #s do
		h = (h * 33 + string.byte(s, i)) % 2147483647
	end
	return h
end

local function makeRNG(seed: number): any
	-- Roblox Random.new is available in Studio; fallback to LCG if not
	local ok, rnd = pcall(function() return Random.new(seed) end)
	if ok and rnd then return rnd end
	-- LCG fallback (deterministic)
	local state = seed % 2147483647
	if state <= 0 then state += 1 end
	return {
		NextNumber = function(self: any, a: number?, b: number?): number
			state = (state * 16807) % 2147483647
			local v = state / 2147483647
			if a ~= nil and b ~= nil then return a + v * (b - a) end
			if a ~= nil then return v * a end
			return v
		end,
		NextInteger = function(self: any, a: number, b: number): number
			state = (state * 16807) % 2147483647
			local v = state / 2147483647
			return math.floor(a + v * (b - a + 1))
		end,
	}
end

local function getSeed(cfg: table): number
	if cfg.seed ~= nil then
		local n = tonumber(cfg.seed)
		if n then return math.floor(n) % 2147483647 end
		return hashString(tostring(cfg.seed))
	end
	-- Derive from name + beat signature + time jitter for per-call freshness
	local sig = tostring(cfg.name or "") .. "|" .. tostring(cfg.actionType or cfg.kind or "") .. "|" .. tostring(cfg.beats or cfg.keyBeats or "")
	-- Mix in high-resolution time + math.random for true freshness
	local t = 0
	pcall(function() t = tick() * 1000 end)
	if t == 0 then pcall(function() t = os.clock() * 1000 end) end
	local r = 0
	pcall(function() r = math.random(0, 2147483647) end)
	return (hashString(sig) + math.floor(t) + r) % 2147483647
end

local function clamp01(v: number, lo: number, hi: number): number
	if v < lo then return lo elseif v > hi then return hi else return v end
end

local function parseStyleIntensity(cfg: table, rng: any): (number, number, number, string, boolean)
	local intensity = tonumber(cfg.intensity) or tonumber(cfg.intensityLevel) or tonumber(cfg.power) or 1.0
	intensity = clamp01(intensity, 0.3, 2.2)
	local speed = tonumber(cfg.speed) or tonumber(cfg.timeScale) or 1.0
	speed = clamp01(speed, 0.4, 2.5)
	local reach = tonumber(cfg.reach) or tonumber(cfg.reachScale) or tonumber(cfg.extension) or 1.0
	reach = clamp01(reach, 0.5, 1.6)
	local style = string.lower(tostring(cfg.style or cfg.motionStyle or ""))
	-- Whether the caller explicitly chose a style (only explicit styles drive
	-- easing; the auto label below is stamped for variance tracking only, so
	-- default output is byte-identical with or without it).
	local styleExplicit = style ~= ""
	-- Tiny per-call style jitter if no explicit style
	if style == "" then
		local roll = rng:NextNumber()
		if roll < 0.25 then style = "snappy" elseif roll < 0.5 then style = "fluid" elseif roll < 0.75 then style = "heavy" else style = "bouncy" end
	end
	return intensity, speed, reach, style, styleExplicit
end

-- Explicit style -> pose easing (PoseEasingStyle members ONLY — Quad/Back do
-- not exist there). Applied per keyframe in addKeyframeToSequence when the
-- caller chose the style; default output is untouched.
local function styleToEasing(style: string): (string, string)
	local s = string.lower(tostring(style or ""))
	if s == "snappy" then return "Cubic", "Out"
	elseif s == "fluid" then return "Cubic", "InOut"
	elseif s == "heavy" then return "Cubic", "In"
	elseif s == "bouncy" or s == "elastic" then return "Elastic", "Out"
	elseif s == "bounce" then return "Bounce", "Out"
	end
	return "Linear", "InOut"
end
ProceduralIKEngine.styleToEasing = styleToEasing

local function varyTarget(base: Vector3, rng: any, intensity: number, reach: number): Vector3
	-- Controlled procedural noise: ±0.18 studs lateral/vertical, reach-scaled depth
	local jx = rng:NextNumber(-0.14, 0.14) * intensity
	local jy = rng:NextNumber(-0.10, 0.10) * intensity
	local jz = rng:NextNumber(-0.12, 0.12) * intensity
	local v = Vector3.new(base.X * reach + jx, base.Y + jy, base.Z * reach + jz)
	return clampTargetToFront(v)
end

local function jitterAngle(pitch: number, yaw: number, roll: number, rng: any, intensity: number): (number, number, number)
	-- ±1.2°–2.5° procedural offset scaled by intensity; keeps within clamp bounds
	local jp = rng:NextNumber(-1.6, 1.6) * intensity
	local jy = rng:NextNumber(-1.4, 1.4) * intensity
	local jr = rng:NextNumber(-0.9, 0.9) * intensity
	return pitch + jp, yaw + jy, roll + jr
end

local function jitterTime(t: number, dur: number, rng: any, isFirst: boolean, isLast: boolean): number
	if isFirst or isLast then return t end
	local j = rng:NextNumber(-0.04, 0.04) * dur
	local nt = t + j
	if nt < 0.02 then nt = 0.02 end
	if nt > dur - 0.02 then nt = dur - 0.02 end
	return nt
end

local function dynamicKeyframeCount(dur: number, complexity: number, rng: any): number
	-- 4–8 based on duration (longer→more) + complexity (beats count) + noise
	local base = 4 + math.floor(dur * 0.9) + math.floor(complexity * 0.4)
	local withNoise = base + rng:NextInteger(-1, 1)
	return math.clamp(withNoise, 4, 8)
end

ProceduralIKEngine.hashString = hashString
ProceduralIKEngine.makeRNG = makeRNG
ProceduralIKEngine.getSeed = getSeed
-- Variance toolkit promised by the agent prompt (custom hierarchies call
-- these directly): pure functions, no side effects.
ProceduralIKEngine.varyTarget = varyTarget
ProceduralIKEngine.jitterAngle = jitterAngle
ProceduralIKEngine.jitterTime = jitterTime
ProceduralIKEngine.dynamicKeyframeCount = dynamicKeyframeCount

-- ==========================================
-- 5d. SPRING PHYSICS HOOK (elastic, fluid, alive)
--  AI stays pure: generates raw targets; Spring renders them physically.
--  Damper = bounciness (0.45 bouncy, 0.68 balanced, 1.0 critically damped)
--  Speed = frequency Hz (10 sluggish, 14 balanced, 22 snappy)
--  Supports Number/Vector3/CFrame (position+Euler).
-- ==========================================
function ProceduralIKEngine.CreateSpring(initial: any, config: table?): any
	if Spring then
		local ok, s = pcall(function() return Spring.new(initial, config) end)
		if ok and s then return s end
	end
	-- Fallback: minimal passthrough if Spring missing (tests/Node)
	return {
		Target = initial, Position = initial, Velocity = if typeof(initial) == "Vector3" then Vector3.new() else 0,
		SetTarget = function(self: any, t: any) self.Target = t end,
		Impulse = function() end,
		Update = function(self: any) return self.Target end,
		SetParams = function() end,
	}
end

function ProceduralIKEngine.ApplySpringImpulse(spring: any, impulse: any)
	if not spring then return end
	pcall(function() spring:Impulse(impulse) end)
end

function ProceduralIKEngine.SmoothWithSpring(fromVal: any, toVal: any, springConfig: table?, dt: number?): any
	local s = ProceduralIKEngine.CreateSpring(fromVal, springConfig)
	s:SetTarget(toVal)
	return s:Update(dt or 0.016)
end

-- Runtime helper: create per-joint springs for a character and drive them each frame
-- Usage: local springs = ProceduralIKEngine.CreateJointSprings(character, {Damper=0.62, Speed=16})
--        game:GetService("RunService").Heartbeat:Connect(function(dt) ProceduralIKEngine.UpdateJointSprings(springs, dt) end)
function ProceduralIKEngine.CreateJointSprings(character: Model, config: table?): table
	local out: any = { springs = {}, config = config or { Damper = 0.62, Speed = 16 } }
	if not character then return out end
	pcall(function()
		for _, d in ipairs(character:GetDescendants()) do
			if d:IsA("Motor6D") or d:IsA("AnimationConstraint") then
				local name: string = (d :: any).Name
				-- initial is current Transform (Motor6D) or identity
				local init: any = CFrame.new()
				pcall(function() init = (d :: any).Transform or (d :: any).C0 or CFrame.new() end)
				out.springs[name] = ProceduralIKEngine.CreateSpring(init, out.config)
			end
		end
	end)
	return out
end

function ProceduralIKEngine.UpdateJointSprings(state: table, dt: number)
	if not state or not state.springs then return end
	for _, spring in pairs(state.springs :: any) do
		pcall(function() spring:Update(dt) end)
	end
end

-- Apply subtle impulse on impact/landing for overshoot bounce
function ProceduralIKEngine.ImpulseOnImpact(springs: table, impulseScale: number?)
	local scale = impulseScale or 1.0
	if not springs then return end
	pcall(function()
		for _, s in pairs(springs :: any) do
			-- Vector3 impulse along -Z (forward) with slight lateral variance
			local imp = Vector3.new((math.random()-0.5)*0.3*scale, (math.random()-0.5)*0.2*scale, -0.6*scale)
			ProceduralIKEngine.ApplySpringImpulse(s, imp)
		end
	end)
end

-- ==========================================
-- 6. PUBLIC API & ACTION TRACK GENERATOR
-- ==========================================
-- All primary-limb angles below are derived from Relative World Target Points via
-- aimLimbAtTarget (never hardcoded joint angles): ReachMouth for eat/drink,
-- StrikeTarget for combat, ReachForward/ReachOutWide for dance/emote/locomotion.
function ProceduralIKEngine.BuildSequence(actionConfig: table?): KeyframeSequence
	local cfg: table = actionConfig or {}
	local seq = Instance.new("KeyframeSequence")
	seq.Name = cfg.name or cfg.actionType or cfg.kind or "ProceduralTrack"

	local rawType = cfg.actionType or cfg.kind or cfg.type or "idle"
	local actionType = normalizeActionType(rawType)
	local priority, loop = resolveTrackSettings(actionType, cfg)
	seq.Priority = priority
	seq.Loop = loop
	-- Rig target for per-keyframe pruning in addKeyframeToSequence ("both"
	-- keeps the dual R15+R6 trees; "r15"/"r6" keep only that rig's tree).
	local rig = normalizeRig(cfg.rig or cfg.rigType)
	pcall(function() (seq :: Instance):SetAttribute("RigType", rig) end)

	local durationOpt = parseDuration(cfg)
	local beats = normalizeBeats(cfg)
	local hasBeats = #beats > 0
	local T = ProceduralIKEngine.Targets

	-- Procedural Variance: seed, intensity/speed/reach/style, per-call freshness
	local seed = getSeed(cfg)
	local rng: any = makeRNG(seed)
	local intensity, speed, reach, style, styleExplicit = parseStyleIntensity(cfg, rng)
	-- Explicit styles drive pose easing (styleToEasing); auto labels are
	-- stamped for tracking only and leave easing untouched.
	if styleExplicit then
		local poseEasing, poseEasingDir = styleToEasing(style)
		pcall(function()
			;(seq :: Instance):SetAttribute("StyleExplicit", true)
			;(seq :: Instance):SetAttribute("PoseEasingStyle", poseEasing)
			;(seq :: Instance):SetAttribute("PoseEasingDirection", poseEasingDir)
		end)
	end
	-- speed alters effective duration; reach scales targets
	if durationOpt then durationOpt = math.clamp(durationOpt / speed, 0.2, 5.0) end

	-- helper to compute time for beat index (evenly spaced across duration)
	local function beatTime(idx: number, total: number, dur: number): number
		if total <= 1 then return 0 end
		return (idx - 1) / (total - 1) * dur
	end

	-- If beats drive the timeline, generate from beats directly.
	if hasBeats then
		local dur = durationOpt
		if not dur then
			if actionType == "eat" then dur = 1.6
			elseif actionType == "combat" then dur = math.clamp(0.4 + #beats * 0.25, 0.5, 4.0)
			elseif actionType == "hit reaction" then dur = math.clamp(0.3 + #beats * 0.2, 0.3, 2.0)
			elseif actionType == "dance" then dur = 1.0
			else dur = 1.0 end
		end
		dur = math.clamp(dur, 0.2, 5.0)

		if actionType == "combat" then
			-- Combat combo: beats map to anticipation/impact/recovery/chain windows.
			for i, beat in ipairs(beats) do
				local _bt = beatTime(i, #beats, dur)
				local t = jitterTime(_bt, dur, rng, i==1, i==#beats)
				local bLow = string.lower(beat)
				local isImpact = bLow:find("impact") or bLow:find("strike") or bLow:find("hit") or bLow:find("punch") or bLow:find("kick")
				local isWind = bLow:find("wind") or bLow:find("anticip")
				local isRecover = bLow:find("recover") or bLow:find("return") or bLow:find("reset")
				local r15: any = {}
				local r6: any = {}
				if isWind then
					r15 = { rUpperPitch = 15, rLowerPitch = 90, upper = CFrame.Angles(0, rad(18), 0), lower = CFrame.Angles(0, rad(8), 0) }
					r6 = { rArmPitch = 10 }
				elseif isImpact then
					local useLeft = (i % 2 == 0)
					local sp, sy = aimLimbAtTarget("RightUpperArm", varyTarget(T.StrikeTarget, rng, intensity, reach))
					sp, sy = jitterAngle(sp, sy, 0, rng, intensity)
					-- alternate hands for combo feel; compute left via mirrored pitch/yaw already handled
					if useLeft then
						-- left strike: aim left at StrikeTarget mirrored
						local lp, ly = aimLimbAtTarget("LeftUpperArm", varyTarget(T.StrikeTarget, rng, intensity, reach))
						lp, ly = jitterAngle(lp, ly, 0, rng, intensity)
						-- front-knee brace on the striking side (negative = flexion)
						r15 = { lUpperPitch = lp, lUpperYaw = ly, lLowerPitch = 15, lKneePitch = -12, rKneePitch = -6, upper = CFrame.Angles(0, rad(-12), 0), lower = CFrame.Angles(0, rad(-6), 0) }
						r6 = { lArmPitch = lp, lArmYaw = ly }
					else
						r15 = { rUpperPitch = sp, rUpperYaw = sy, rLowerPitch = 15, rKneePitch = -12, lKneePitch = -6, upper = CFrame.Angles(0, rad(-15), 0), lower = CFrame.Angles(0, rad(-8), 0) }
						r6 = { rArmPitch = sp, rArmYaw = sy }
					end
				elseif isRecover then
					r15 = {}
					r6 = {}
				else
					-- generic chain / transition -> slight forward lean
					local sp, sy = aimLimbAtTarget("RightUpperArm", varyTarget(T.StrikeTarget, rng, intensity, reach))
					sp, sy = jitterAngle(sp, sy, 0, rng, intensity)
					r15 = { rUpperPitch = sp * 0.5, rLowerPitch = 30, upper = CFrame.Angles(0, rad(-6), 0) }
					r6 = { rArmPitch = sp * 0.5 }
				end
				addKeyframeToSequence(seq, t, r15, r6)
			end
			for i, beat in ipairs(beats) do
				markPhase(seq, beatTime(i, #beats, dur), beatToMarker(beat))
				-- add ChainWindow on impact beats for combo chaining
				local bLow = string.lower(beat)
				if bLow:find("impact") or bLow:find("strike") or bLow:find("hit") or bLow:find("chain") then
					markPhase(seq, beatTime(i, #beats, dur), "ChainWindow")
				end
			end
		elseif actionType == "hit reaction" then
			for i, beat in ipairs(beats) do
				local _bt = beatTime(i, #beats, dur)
				local t = jitterTime(_bt, dur, rng, i==1, i==#beats)
				local bLow = string.lower(beat)
				local r15: any = {}
				local r6: any = {}
				if bLow:find("flinch") then
					r15 = { upper = CFrame.Angles(rad(14), 0, rad(6)), head = CFrame.Angles(rad(10), rad(8), 0) }
					r6 = { torso = CFrame.Angles(rad(10), 0, 0), head = CFrame.Angles(rad(10), 0, 0) }
				elseif bLow:find("stagger") then
					r15 = { upper = CFrame.Angles(rad(8), rad(12), rad(-8)), lower = CFrame.Angles(0, rad(-10), 0), rUpperPitch = 20, lUpperPitch = 15 }
					r6 = { torso = CFrame.Angles(rad(8), rad(12), 0) }
				elseif bLow:find("knockback") or bLow:find("knock") then
					-- deep crouch brace on both knees (negative = flexion)
					r15 = { upper = CFrame.Angles(rad(-10), rad(18), rad(12)), lower = CFrame.Angles(0, rad(-14), 0), head = CFrame.Angles(rad(-8), 0, 0), lKneePitch = -20, rKneePitch = -20 }
					r6 = { torso = CFrame.Angles(rad(-10), rad(12), 0) }
				elseif bLow:find("recover") then
					r15 = {}
					r6 = {}
				else
					r15 = { upper = CFrame.Angles(rad(6), 0, 0) }
					r6 = {}
				end
				addKeyframeToSequence(seq, t, r15, r6)
			end
			for i, beat in ipairs(beats) do
				markPhase(seq, beatTime(i, #beats, dur), beatToMarker(beat))
			end
		elseif actionType == "eat" then
			for i, beat in ipairs(beats) do
				local _bt = beatTime(i, #beats, dur)
				local t = jitterTime(_bt, dur, rng, i==1, i==#beats)
				local bLow = string.lower(beat)
				local mp, my = aimLimbAtTarget("RightUpperArm", varyTarget(T.ReachMouth, rng, intensity, reach))
				mp, my = jitterAngle(mp, my, 0, rng, intensity)
				local r15: any = {}
				local r6: any = {}
				if bLow:find("anticip") or bLow:find("reach") or bLow:find("wind") then
					r15 = { lUpperPitch = 5, lLowerPitch = 10 }
					r6 = { lArmPitch = 5 }
				elseif bLow:find("mouth") or bLow:find("bite") or bLow:find("sip") or bLow:find("peak") then
					r15 = { rUpperPitch = mp, rUpperYaw = my, rLowerPitch = 125, head = CFrame.Angles(rad(12), 0, 0) }
					r6 = { rArmPitch = mp, rArmYaw = my }
				elseif bLow:find("chew") or bLow:find("hold") then
					r15 = { rUpperPitch = mp, rUpperYaw = my, rLowerPitch = 115, head = CFrame.Angles(rad(6), 0, 0) }
					r6 = { rArmPitch = mp, rArmYaw = my }
				elseif bLow:find("lower") or bLow:find("recover") or bLow:find("return") then
					r15 = { rUpperPitch = 40, rLowerPitch = 60 }
					r6 = { rArmPitch = 40 }
				else
					r15 = { rUpperPitch = mp * 0.6, rUpperYaw = my * 0.6, rLowerPitch = 80 }
					r6 = { rArmPitch = mp * 0.6 }
				end
				addKeyframeToSequence(seq, t, r15, r6)
			end
			for i, beat in ipairs(beats) do
				markPhase(seq, beatTime(i, #beats, dur), beatToMarker(beat))
			end
		else
			-- dance / emote / custom: distribute between forward and wide with torso sway
			-- For seamless loops, last beat mirrors first pose so loop has no pop.
			local firstR15: any = nil
			local firstR6: any = nil
			for i, beat in ipairs(beats) do
				local _bt = beatTime(i, #beats, dur)
				local t = jitterTime(_bt, dur, rng, i==1, i==#beats)
				local isPeak = (i % 2 == 0)
				local fp, fy = aimLimbAtTarget("RightUpperArm", T.ReachForward)
				-- Left arm gets its OWN aim (mirrored X inside): reusing the
				-- right-arm yaw steers it across the torso. See combat branch.
				local lwP, lwY = aimLimbAtTarget("LeftUpperArm", T.ReachOutWide)
				local r15: any
				local r6: any
				if isPeak then
					-- soft knees on the bounce peak (negative = flexion)
					r15 = { lUpperPitch = lwP, lUpperYaw = lwY, rUpperPitch = fp, rUpperYaw = fy, lKneePitch = -8, rKneePitch = -8, upper = CFrame.Angles(0, rad(10), 0), lower = CFrame.Angles(0, rad(-5), 0) }
					r6 = { lArmPitch = lwP, lArmYaw = lwY, rArmPitch = fp, rArmYaw = fy, torso = CFrame.Angles(0, rad(8), 0) }
				else
					r15 = { lUpperPitch = 10, rUpperPitch = 10, upper = CFrame.Angles(0, rad(-6), 0) }
					r6 = { lArmPitch = 10, rArmPitch = 10 }
				end
				if i == 1 then
					firstR15 = r15
					firstR6 = r6
				elseif loop and i == #beats then
					-- seamless loop: last frame equals first frame
					r15 = firstR15
					r6 = firstR6
				end
				addKeyframeToSequence(seq, t, r15, r6)
			end
			for i, beat in ipairs(beats) do
				markPhase(seq, beatTime(i, #beats, dur), beatToMarker(beat))
			end
		end
	else
		-- No beats: dynamic keyframe densities (4-8) with procedural variance
		local effDur = durationOpt or 1.0
		effDur = math.clamp(effDur, 0.2, 5.0)
		local function scaled(base: number, ref: number): number
			local factor = effDur / ref
			local j = rng:NextNumber(-0.06, 0.06) * factor
			return math.clamp(base * factor + j, 0, effDur)
		end
		local function dynCount(refCount: number): number
			return dynamicKeyframeCount(effDur, refCount, rng)
		end
		if actionType == "eat" then
			local cnt = dynCount(5)
			for k = 1, cnt do
				local alpha = (k-1) / math.max(1, cnt-1)
				local t = scaled(alpha * 1.6, 1.6)
				local mp, my = aimLimbAtTarget("RightUpperArm", varyTarget(T.ReachMouth, rng, intensity, reach))
				mp, my = jitterAngle(mp, my, 0, rng, intensity)
				local r15: any, r6: any
				if alpha < 0.22 then r15 = { lUpperPitch = 5 + rng:NextNumber(-1,1)*intensity, lLowerPitch = 10 + rng:NextNumber(-1,1)*intensity }; r6 = { lArmPitch = 5 }
				elseif alpha < 0.45 then r15 = { rUpperPitch = mp, rUpperYaw = my, rLowerPitch = 95 + rng:NextNumber(-4,4)*intensity }; r6 = { rArmPitch = mp, rArmYaw = my }
				elseif alpha < 0.70 then r15 = { rUpperPitch = mp, rUpperYaw = my, rLowerPitch = 125 + rng:NextNumber(-5,5)*intensity, head = CFrame.Angles(rad(12 + rng:NextNumber(-2,2)), 0, 0) }; r6 = { rArmPitch = mp, rArmYaw = my }
				elseif alpha < 0.88 then r15 = { rUpperPitch = 40 + rng:NextNumber(-3,3)*intensity, rLowerPitch = 60 + rng:NextNumber(-4,4)*intensity }; r6 = { rArmPitch = 40 }
				else r15 = {}; r6 = {} end
				addKeyframeToSequence(seq, t, r15, r6)
			end
			markPhase(seq, scaled(0.0, 1.6), "Anticipation")
			markPhase(seq, scaled(0.7, 1.6), "Peak")
			markPhase(seq, scaled(1.2, 1.6), "Recovery")
		elseif actionType == "combat" then
			local cnt = dynCount(3)
			for k = 1, cnt do
				local alpha = (k-1)/math.max(1,cnt-1)
				local t = scaled(alpha*0.5, 0.5)
				if k == 1 or k == cnt then addKeyframeToSequence(seq, t, {}, {})
				else
					local sp, sy = aimLimbAtTarget("RightUpperArm", varyTarget(T.StrikeTarget, rng, intensity, reach))
					sp, sy = jitterAngle(sp, sy, 0, rng, intensity)
					local isLeft = (k % 2 == 0)
					if isLeft then
						local lp, ly = aimLimbAtTarget("LeftUpperArm", varyTarget(T.StrikeTarget, rng, intensity, reach))
						lp, ly = jitterAngle(lp, ly, 0, rng, intensity)
						addKeyframeToSequence(seq, t, { lUpperPitch = lp, lUpperYaw = ly, lLowerPitch = 15 + rng:NextNumber(-3,3), upper = CFrame.Angles(0, rad(-12 + rng:NextNumber(-4,4)), 0) }, { lArmPitch = lp, lArmYaw = ly })
					else
						addKeyframeToSequence(seq, t, { rUpperPitch = sp, rUpperYaw = sy, rLowerPitch = 15 + rng:NextNumber(-3,3), upper = CFrame.Angles(0, rad(-15 + rng:NextNumber(-4,4)), 0) }, { rArmPitch = sp, rArmYaw = sy })
					end
				end
			end
			markPhase(seq, scaled(0.0, 0.5), "Anticipation")
			markPhase(seq, scaled(0.22, 0.5), "Impact")
			markPhase(seq, scaled(0.5, 0.5), "Recovery")
			markPhase(seq, scaled(0.22, 0.5), "ChainWindow")
		elseif actionType == "hit reaction" then
			local cnt = dynCount(4)
			for k=1,cnt do
				local alpha=(k-1)/math.max(1,cnt-1)
				local t=scaled(alpha*0.6,0.6)
				local jx = rng:NextNumber(-2,2)*intensity
				if alpha<0.25 then addKeyframeToSequence(seq, t, { upper = CFrame.Angles(rad(14+jx), 0, rad(6)), head = CFrame.Angles(rad(10), rad(8+jx), 0) }, { torso = CFrame.Angles(rad(10+jx),0,0) })
				elseif alpha<0.55 then addKeyframeToSequence(seq, t, { upper = CFrame.Angles(rad(8), rad(12+jx), rad(-8)), lower = CFrame.Angles(0, rad(-10), 0) }, { torso = CFrame.Angles(rad(8), rad(12+jx),0) })
				else addKeyframeToSequence(seq, t, {}, {}) end
			end
			markPhase(seq, scaled(0.0, 0.6), "Anticipation")
			markPhase(seq, scaled(0.12, 0.6), "Flinch")
			markPhase(seq, scaled(0.3, 0.6), "Stagger")
			markPhase(seq, scaled(0.6, 0.6), "Recovery")
		elseif actionType == "dance" or actionType == "emote" then
			local cnt = dynCount(3)
			for k=1,cnt do
				local alpha=(k-1)/math.max(1,cnt-1)
				local t=scaled(alpha*1.0,1.0)
				local fp, fy = aimLimbAtTarget("RightUpperArm", varyTarget(T.ReachForward, rng, intensity, reach))
				fp, fy = jitterAngle(fp, fy, 0, rng, intensity)
				-- Left arm aimed separately (mirrored X inside): the right-arm
				-- solution steers a left arm across the body.
				local lwP, lwY = aimLimbAtTarget("LeftUpperArm", varyTarget(T.ReachOutWide, rng, intensity, reach))
				lwP, lwY = jitterAngle(lwP, lwY, 0, rng, intensity)
				if k==1 or (loop and k==cnt) then addKeyframeToSequence(seq, t, { lUpperPitch = 10, rUpperPitch = 10 }, { lArmPitch = 10, rArmPitch = 10 })
				elseif k%2==0 then addKeyframeToSequence(seq, t, { lUpperPitch = lwP, lUpperYaw = lwY, rUpperPitch = fp, rUpperYaw = fy, upper = CFrame.Angles(0, rad(10+rng:NextNumber(-4,4)), 0) }, { lArmPitch = lwP, lArmYaw = lwY, rArmPitch = fp, rArmYaw = fy })
				else addKeyframeToSequence(seq, t, { lUpperPitch = 10, rUpperPitch = 10 }, { lArmPitch = 10, rArmPitch = 10 }) end
			end
			markPhase(seq, scaled(0.0, 1.0), "Anticipation")
			markPhase(seq, scaled(0.5, 1.0), "Peak")
			markPhase(seq, scaled(1.0, 1.0), "Recovery")
		else
			local cnt = dynCount(3)
			for k=1,cnt do
				local alpha=(k-1)/math.max(1,cnt-1)
				local t=scaled(alpha*1.0,1.0)
				local fp, fy = aimLimbAtTarget("RightUpperArm", varyTarget(T.ReachForward, rng, intensity, reach))
				fp, fy = jitterAngle(fp, fy, 0, rng, intensity)
				-- Left arm aimed separately (mirrored X inside): the right-arm
				-- solution steers a left arm across the body.
				local lwP, lwY = aimLimbAtTarget("LeftUpperArm", varyTarget(T.ReachOutWide, rng, intensity, reach))
				lwP, lwY = jitterAngle(lwP, lwY, 0, rng, intensity)
				if k%2==0 then addKeyframeToSequence(seq, t, { lUpperPitch = lwP, lUpperYaw = lwY, rUpperPitch = fp, rUpperYaw = fy, lKneePitch = -8, rKneePitch = -8, upper = CFrame.Angles(0, rad(10+rng:NextNumber(-5,5)), 0) }, { lArmPitch = lwP, lArmYaw = lwY, rArmPitch = fp, rArmYaw = fy })
				else addKeyframeToSequence(seq, t, { lUpperPitch = 10, rUpperPitch = 10 }, { lArmPitch = 10, rArmPitch = 10 }) end
			end
			markPhase(seq, scaled(0.0, 1.0), "Anticipation")
			markPhase(seq, scaled(0.5, 1.0), "Peak")
			markPhase(seq, scaled(1.0, 1.0), "Recovery")
		end
	end

	-- Deterministic Sanity Clamp before returning: no pose may rest in the back half.
	sanityClampSequence(seq)
	-- Spring physics hook: tag sequence for runtime elastic rendering + impulse on impacts
	local springDamper = tonumber(cfg.damper or cfg.Damper or cfg.bounciness) or (0.60 + (2.0 - intensity) * 0.06)
	local springSpeed = tonumber(cfg.springSpeed or cfg.SpringSpeed) or (14 + intensity * 2.5)
	springDamper = math.clamp(springDamper, 0.35, 1.2)
	springSpeed = math.clamp(springSpeed, 8, 28)
	pcall(function()
		local dur = parseDuration(cfg) or (hasBeats and durationOpt or nil)
		if dur then (seq :: Instance):SetAttribute("DurationSec", dur) end
		if hasBeats then (seq :: Instance):SetAttribute("BeatCount", #beats) end
		;(seq :: Instance):SetAttribute("Seed", seed)
		;(seq :: Instance):SetAttribute("Intensity", intensity)
		;(seq :: Instance):SetAttribute("Speed", speed)
		;(seq :: Instance):SetAttribute("Reach", reach)
		;(seq :: Instance):SetAttribute("Style", style)
		;(seq :: Instance):SetAttribute("KeyframeCount", #seq:GetChildren())
		;(seq :: Instance):SetAttribute("HasSpringPhysics", true)
		;(seq :: Instance):SetAttribute("SpringDamper", springDamper)
		;(seq :: Instance):SetAttribute("SpringSpeed", springSpeed)
		-- actionType tags for impulse logic
		;(seq :: Instance):SetAttribute("ActionType", actionType)
	end)
	-- NOTE: there is intentionally no baked-overshoot flag. Overshoot comes
	-- from live Spring rendering (CreateJointSprings + Heartbeat Update +
	-- ImpulseOnImpact); the baked keyframes stay clean so sequences also play
	-- correctly with no runtime present.
	return seq
end

-- Backward compatibility aliases
ProceduralIKEngine.Build = ProceduralIKEngine.BuildSequence

-- ==========================================
-- 7. CLEAN INTEGRATION (ReplicatedStorage asset)
-- ==========================================
-- Registers the built sequence and publishes a clean Animation asset to
-- ReplicatedStorage for gameplay to load via Animator:LoadAnimation().
-- Returns the created Animation instance.
function ProceduralIKEngine.PublishToReplicatedStorage(seq: KeyframeSequence, name: string?): Animation
	local ksp = game:GetService("KeyframeSequenceProvider")
	local id: string = ksp:RegisterKeyframeSequence(seq)
	local anim = Instance.new("Animation")
	anim.Name = name or (seq.Name .. "_Asset")
	anim.AnimationId = id
	-- Prefer ReplicatedShared/Animations per skill contract; fallback to ReplicatedStorage root.
	local rs = game:GetService("ReplicatedStorage")
	local folder = rs:FindFirstChild("ReplicatedShared")
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "ReplicatedShared"
		folder.Parent = rs
	end
	local animFolder = folder:FindFirstChild("Animations")
	if not animFolder then
		animFolder = Instance.new("Folder")
		animFolder.Name = "Animations"
		animFolder.Parent = folder
	end
	anim.Parent = animFolder
	return anim
end

return ProceduralIKEngine

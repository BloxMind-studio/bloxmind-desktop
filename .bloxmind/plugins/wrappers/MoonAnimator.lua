-- MoonAnimator Wrapper — Studio plugin hook for BloxMind's ProceduralIKEngine
-- Sole animation builder is ProceduralIKEngine (IKControl + Sanity Clamp).
-- This wrapper delegates all track building to the engine and only owns:
-- Studio registration, rig introspection (dual Motor6D/AnimationConstraint),
-- IKControl live binding, and graceful fallback when the engine is absent.

local bridge = _G.BloxMindPluginBridge
if not bridge then warn("[MoonAnimator] Bridge missing — fallback only"); return end

-- Sole engine: ProceduralIKEngine (IKControl + Sanity Clamp)
local ProceduralIKEngine
do
	local ok, mod = pcall(function() return require(script.Parent:WaitForChild("ProceduralIKEngine")) end)
	if ok and mod then ProceduralIKEngine = mod
	elseif _G.ProceduralIKEngine then ProceduralIKEngine = _G.ProceduralIKEngine
	else ProceduralIKEngine = nil end
end
_G.ProceduralIKEngine = ProceduralIKEngine or _G.ProceduralIKEngine

local function getMoonApi(): any?
	local candidates: {any} = {
		rawget(_G, "MoonAnimator"),
		rawget(_G, "Moon"),
		rawget(getgenv and getgenv() or _G, "MoonAnimatorAPI"),
	}
	for _, c in ipairs(candidates) do if c ~= nil then return c end end
	return nil
end

-- R15 hierarchy (Part names)
local R15_HIERARCHY: any = {
	HumanoidRootPart = {
		LowerTorso = {
			UpperTorso = {
				Head = {},
				LeftUpperArm = { LeftLowerArm = { LeftHand = {} } },
				RightUpperArm = { RightLowerArm = { RightHand = {} } },
			},
			LeftUpperLeg = { LeftLowerLeg = { LeftFoot = {} } },
			RightUpperLeg = { RightLowerLeg = { RightFoot = {} } },
		},
	},
}

-- R6 hierarchy (Part names — note spaces in limb names)
local R6_HIERARCHY: any = {
	HumanoidRootPart = {
		Torso = {
			Head = {},
			["Left Arm"] = {},
			["Right Arm"] = {},
			["Left Leg"] = {},
			["Right Leg"] = {},
		},
	},
}

-- Joint name -> Part name mapping for backward compatibility (if input uses joint names, convert)
local JOINT_TO_PART: {[string]: string} = {
	Root = "LowerTorso",
	Waist = "UpperTorso",
	Neck = "Head",
	LeftShoulder = "LeftUpperArm",
	RightShoulder = "RightUpperArm",
	LeftElbow = "LeftLowerArm",
	RightElbow = "RightLowerArm",
	LeftWrist = "LeftHand",
	RightWrist = "RightHand",
	LeftHip = "LeftUpperLeg",
	RightHip = "RightUpperLeg",
	LeftKnee = "LeftLowerLeg",
	RightKnee = "RightLowerLeg",
	LeftAnkle = "LeftFoot",
	RightAnkle = "RightFoot",
	RootJoint = "Torso",
	["Left Shoulder"] = "Left Arm",
	["Right Shoulder"] = "Right Arm",
	["Left Hip"] = "Left Leg",
	["Right Hip"] = "Right Leg",
}

local function toPartName(name: string): string
	if JOINT_TO_PART[name] then return JOINT_TO_PART[name] end
	return name
end

-- ---------------------------------------------------------------------------
-- Compact IK-target fallback (used ONLY when ProceduralIKEngine is absent).
-- Same architecture as the engine: Relative World Target Points + Sanity Clamp,
-- neutral joint space, left yaw/roll mirror. No C0 tables, no legacy math.
-- ---------------------------------------------------------------------------
local IKTargets = {
	ReachForward = Vector3.new(0, -0.2, -2.5),
	ReachMouth = Vector3.new(-0.9, 0.25, -0.45),
	StrikeTarget = Vector3.new(0, 0, -3.0),
	ReachOutWide = Vector3.new(1.4, -0.6, -1.4),
}

local function ikClampTarget(target: Vector3, maxLateral: number?): Vector3
	local m = maxLateral or 2.5
	local x, y, z = target.X, target.Y, target.Z
	if z > 0 then z = -math.abs(z) end
	if x > m then x = m elseif x < -m then x = -m end
	return Vector3.new(x, y, z)
end

local function ikAim(partName: string, target: Vector3): (number, number, number)
	local t = ikClampTarget(target)
	local isLeft = partName:find("Left") ~= nil
	local x = isLeft and -t.X or t.X
	local fwd = math.max(0.001, -t.Z)
	local pitch = math.deg(math.atan2(fwd, -t.Y))
	if pitch < 0 then pitch = 0 elseif pitch > 160 then pitch = 160 end
	-- Negated so Ry*Rx steers toward the target (+X needs negative yaw).
	local yaw = -math.deg(math.atan2(x, fwd))
	if yaw > 35 then yaw = 35 elseif yaw < -35 then yaw = -35 end
	return pitch, yaw, 0
end

local function ikJointPose(partName: string, pitchDeg: number, yawDeg: number, rollDeg: number): Pose
	local pose = Instance.new("Pose")
	pose.Name = partName
	local yaw, roll = yawDeg or 0, rollDeg or 0
	if partName:find("Left") then roll = -roll end
	pose.CFrame = CFrame.Angles(math.rad(pitchDeg or 0), math.rad(yaw), math.rad(roll))
	return pose
end

local function easingFor(actionType: string): (string, string)
	local act = string.lower(actionType)
	if string.find(act, "punch") or string.find(act, "hit") or string.find(act, "kick") then
		-- Elastic/Out is the closest existing PoseEasingStyle to a snappy
		-- overshoot strike (Quad/Back do not exist on PoseEasingStyle).
		return "Elastic", "Out"
	elseif string.find(act, "dance") or string.find(act, "emote") or string.find(act, "groove") then
		return "Cubic", "InOut"
	else
		return "Cubic", "InOut"
	end
end

local function ikApplyEasing(poseInst: Pose, eStyle: string?, eDir: string?)
	pcall(function() poseInst.EasingStyle = (Enum.PoseEasingStyle :: any)[eStyle or "Linear"] or Enum.PoseEasingStyle.Linear end)
	pcall(function() poseInst.EasingDirection = (Enum.PoseEasingDirection :: any)[eDir or "InOut"] or Enum.PoseEasingDirection.InOut end)
end

local function ikBuildHierarchy(kfInst: Keyframe, rigType: string, posesMap: any, eStyle: string?, eDir: string?)
	local isR6 = rigType:lower() == "r6"
	local hierarchy: any = if isR6 then R6_HIERARCHY else R15_HIERARCHY
	local partAngles: {[string]: any} = {}
	if posesMap then
		for k, v in pairs(posesMap :: any) do
			partAngles[toPartName(tostring(k))] = v
		end
	end
	local function makePose(pn: string, angles: any): Pose
		local pose = Instance.new("Pose")
		pose.Name = pn
		if typeof(angles) == "CFrame" then
			pose.CFrame = angles :: CFrame
		elseif typeof(angles) == "table" then
			local a: any = angles
			pose.CFrame = ikJointPose(pn, tonumber(a[1]) or 0, tonumber(a[2]) or 0, tonumber(a[3]) or 0).CFrame
		elseif typeof(angles) == "Vector3" then
			local v: Vector3 = angles :: Vector3
			pose.CFrame = ikJointPose(pn, v.X, v.Y, v.Z).CFrame
		else
			pose.CFrame = CFrame.new()
		end
		pose.Weight = 1
		ikApplyEasing(pose, eStyle, eDir)
		return pose
	end
	local function buildSubtree(parentPose: Pose, children: any)
		for childPart, subChildren in pairs(children :: any) do
			local pn = tostring(childPart)
			local pose = makePose(pn, partAngles[pn])
			parentPose:AddSubPose(pose)
			if subChildren and next(subChildren) ~= nil then
				buildSubtree(pose, subChildren)
			end
		end
	end
	-- NO root flip: engine targets are already -Z forward (Roblox convention).
	local rootPose = makePose("HumanoidRootPart", partAngles["HumanoidRootPart"])
	kfInst:AddPose(rootPose)
	local rootChildren: any = hierarchy.HumanoidRootPart
	if rootChildren then
		buildSubtree(rootPose, rootChildren)
	end
end

-- Target-driven track builder (fallback identical in spirit to the engine).
-- When beats/duration are provided, delegates timing to the engine-equivalent logic.
local function ikBuildTrack(actionType: string, duration: number?, rigType: string?, beats: {string}?): {{time: number, poses: {[string]: any}, easingStyle: string?, easingDir: string?}}
	local act = string.lower(tostring(actionType or "dance"))
	local isHitReaction = string.find(act, "hit reaction") or string.find(act, "flinch") or string.find(act, "stagger") or string.find(act, "knockback")
	local dur = math.clamp(tonumber(duration) or 1.0, 0.2, 5.0)
	local isR6 = string.lower(tostring(rigType or "R15")) == "r6"
	local eStyle, eDir = easingFor(act)
	local out: {{time: number, poses: {[string]: any}, easingStyle: string?, easingDir: string?}} = {}
	local function armPoses(target: Vector3, elbow: number): {[string]: any}
		local rp, ry = ikAim("RightUpperArm", target)
		if isR6 then
			return { ["Right Arm"] = Vector3.new(rp, ry, 0) }
		end
		return { RightUpperArm = Vector3.new(rp, ry, 0), RightLowerArm = Vector3.new(elbow, 0, 0) }
	end
	-- beats-aware path when engine absent but beats supplied
	if beats and #beats > 0 then
		local function beatTime(i: number, n: number): number
			if n <= 1 then return 0 end
			return (i - 1) / (n - 1) * dur
		end
		if isHitReaction then
			for i, beat in ipairs(beats) do
				local b = string.lower(beat)
				local t = beatTime(i, #beats)
				if b:find("flinch") then
					table.insert(out, { time = t, poses = if isR6 then { Head = Vector3.new(10, 8, 0) } else { Head = Vector3.new(10, 8, 0) }, easingStyle = eStyle, easingDir = eDir })
				elseif b:find("stagger") then
					table.insert(out, { time = t, poses = armPoses(IKTargets.ReachForward, 30), easingStyle = eStyle, easingDir = eDir })
				elseif b:find("knock") then
					table.insert(out, { time = t, poses = {}, easingStyle = eStyle, easingDir = eDir })
				else
					table.insert(out, { time = t, poses = {}, easingStyle = eStyle, easingDir = eDir })
				end
			end
		elseif string.find(act, "combat") or string.find(act, "punch") then
			for i, beat in ipairs(beats) do
				local b = string.lower(beat)
				local t = beatTime(i, #beats)
				if b:find("wind") or b:find("anticip") then
					table.insert(out, { time = t, poses = {}, easingStyle = eStyle, easingDir = eDir })
				elseif b:find("impact") or b:find("strike") or b:find("hit") then
					table.insert(out, { time = t, poses = armPoses(IKTargets.StrikeTarget, 15), easingStyle = "Elastic", easingDir = "Out" })
				else
					table.insert(out, { time = t, poses = {}, easingStyle = eStyle, easingDir = eDir })
				end
			end
		else
			for i, beat in ipairs(beats) do
				local t = beatTime(i, #beats)
				local isPeak = (i % 2 == 0)
				table.insert(out, { time = t, poses = if isPeak then armPoses(IKTargets.ReachOutWide, 20) else {}, easingStyle = eStyle, easingDir = eDir })
			end
		end
		table.sort(out, function(a, b) return a.time < b.time end)
		return out
	end
	if isHitReaction then
		table.insert(out, { time = 0, poses = {}, easingStyle = eStyle, easingDir = eDir })
		table.insert(out, { time = dur * 0.2, poses = if isR6 then { Head = Vector3.new(10, 8, 0) } else { Head = Vector3.new(10, 8, 0) }, easingStyle = eStyle, easingDir = eDir })
		table.insert(out, { time = dur * 0.5, poses = armPoses(IKTargets.ReachForward, 30), easingStyle = eStyle, easingDir = eDir })
		table.insert(out, { time = dur, poses = {}, easingStyle = eStyle, easingDir = eDir })
	elseif string.find(act, "eat") or string.find(act, "drink") or string.find(act, "sip") or string.find(act, "bite") then
		table.insert(out, { time = 0, poses = if isR6 then { ["Right Arm"] = Vector3.new(0, 0, 0) } else { RightUpperArm = Vector3.new(0, 0, 0) }, easingStyle = eStyle, easingDir = eDir })
		table.insert(out, { time = dur * 0.35, poses = armPoses(IKTargets.ReachMouth, 95), easingStyle = eStyle, easingDir = eDir })
		table.insert(out, { time = dur * 0.65, poses = armPoses(IKTargets.ReachMouth, 125), easingStyle = eStyle, easingDir = eDir })
		table.insert(out, { time = dur, poses = if isR6 then { ["Right Arm"] = Vector3.new(0, 0, 0) } else { RightUpperArm = Vector3.new(0, 0, 0) }, easingStyle = eStyle, easingDir = eDir })
	elseif string.find(act, "punch") or string.find(act, "hit") or string.find(act, "kick") or string.find(act, "combat") or string.find(act, "strike") then
		table.insert(out, { time = 0, poses = {}, easingStyle = eStyle, easingDir = eDir })
		table.insert(out, { time = dur * 0.4, poses = armPoses(IKTargets.StrikeTarget, 15), easingStyle = "Elastic", easingDir = "Out" })
		table.insert(out, { time = dur, poses = {}, easingStyle = eStyle, easingDir = eDir })
	else
		table.insert(out, { time = 0, poses = {}, easingStyle = eStyle, easingDir = eDir })
		table.insert(out, { time = dur * 0.5, poses = armPoses(IKTargets.ReachOutWide, 20), easingStyle = eStyle, easingDir = eDir })
		table.insert(out, { time = dur, poses = {}, easingStyle = eStyle, easingDir = eDir })
	end
	table.sort(out, function(a, b) return a.time < b.time end)
	return out
end

-- Sanity clamp for locally built sequences (mirrors engine post-pass).
local function ikSanityClamp(seq: KeyframeSequence, maxLateral: number?): number
	local m = maxLateral or 2.5
	local n = 0
	local function walk(inst: Instance)
		for _, child in ipairs(inst:GetChildren()) do
			if child:IsA("Pose") then
				local cf: CFrame = (child :: Pose).CFrame
				local p = cf.Position
				if p.Z > 0 or p.X > m or p.X < -m then
					local x, z = p.X, p.Z
					if z > 0 then z = -math.abs(z) end
					if x > m then x = m elseif x < -m then x = -m end
					;(child :: Pose).CFrame = CFrame.new(x, p.Y, z) * (cf - cf.Position)
					n += 1
				end
			end
			walk(child)
		end
	end
	walk(seq)
	return n
end

local function resolveCharacter(charPath: string): Model?
	if charPath ~= "" then
		local cur: Instance? = game
		for seg in string.gmatch(charPath:gsub("^game%.", ""), "[^.]+") do if not cur then break end; cur = cur:FindFirstChild(seg) end
		if cur and cur:IsA("Model") then return cur :: Model end
	end
	return workspace:FindFirstChild("Rig") :: Model?
end

local function fallbackSequence(args: any): any
	-- Preferred: delegate to the sole engine (IKControl + Sanity Clamp).
	if ProceduralIKEngine and ProceduralIKEngine.BuildSequence then
		local ok, seq = pcall(function()
			local cfg: any = {}
			for k, v in pairs(args) do cfg[k] = v end
			cfg.actionType = args.actionType or args.action or args.name or "dance"
			return ProceduralIKEngine.BuildSequence(cfg)
		end)
		if ok and seq and typeof(seq) == "Instance" and seq:IsA("KeyframeSequence") then
			return { ok = true, fallback = true, sequence = seq:GetFullName(), keyframes = #seq:GetChildren(), priority = "Action", rigType = args.rigType or "R15", via = "ProceduralIKEngine.BuildSequence" }
		elseif ok and seq and type(seq) == "table" and seq.ok then
			return seq
		end
	end
	-- Engine absent: compact IK-target fallback (no legacy math).
	local name: string = tostring(args.name or "Anim_" .. tostring(math.random(1000, 9999)))
	local rigType: string = tostring(args.rigType or "auto"):lower()
	if rigType == "auto" then rigType = "r15" end
	local loop: boolean = args.loop == true
	local actionType: string = tostring(args.actionType or args.action or args.name or "dance")
	local duration: number = tonumber(args.duration) or 1.0
	local keyframes: any
	-- Normalize beats from args (supports beats as string or array, like engine)
	local beatsNorm: {string}? = nil
	do
		local raw = args.beats or args.keyBeats
		if type(raw) == "table" and #raw > 0 then
			beatsNorm = {}
			for _, v in ipairs(raw :: any) do if type(v) == "string" and v:gsub("%s+", "") ~= "" then table.insert(beatsNorm, v) end end
		elseif type(raw) == "string" and raw:gsub("%s+", "") ~= "" then
			beatsNorm = {}
			for part in string.gmatch(raw, "[^,|;]+") do local t = part:gsub("^%s+", ""):gsub("%s+$", ""); if #t > 0 then table.insert(beatsNorm, t) end end
		end
	end
	if args.keyframes and type(args.keyframes) == "table" and #args.keyframes > 0 and not args.actionType and not args.action then
		keyframes = args.keyframes
	else
		-- Parse duration string (e.g. "1.5s") like engine parseDuration
		local durVal: number? = tonumber(args.duration)
		if type(args.duration) == "string" then
			local s = tostring(args.duration):gsub("%s+", "")
			local ms = s:match("([%d%.]+)ms")
			if ms then local n = tonumber(ms); if n then durVal = n/1000 end
			else local n = tonumber(s:match("([%d%.]+)")); if n then durVal = n end end
		end
		keyframes = ikBuildTrack(actionType, durVal or duration, rigType, beatsNorm)
	end
	local parentPath: string = tostring(args.parent or "ReplicatedStorage.Animations")

	local seq = Instance.new("KeyframeSequence")
	seq.Name = name
	seq.Loop = loop
	seq.Priority = Enum.AnimationPriority.Action

	if loop and #keyframes >= 2 then
		local first = keyframes[1]
		local last = keyframes[#keyframes]
		if first and last and first.poses and last.poses then
			for partName, angles in pairs(first.poses :: any) do
				local pName = toPartName(tostring(partName))
				if (last.poses :: any)[pName] == nil and (last.poses :: any)[tostring(partName)] == nil then
					(last.poses :: any)[pName] = angles
				end
			end
		end
	end

	for _, kf in ipairs(keyframes :: any) do
		local kfInst = Instance.new("Keyframe")
		kfInst.Time = tonumber(kf.time) or 0
		ikBuildHierarchy(kfInst, rigType, kf.poses or {}, kf.easingStyle, kf.easingDir)
		kfInst.Parent = seq
	end
	ikSanityClamp(seq)

	local parent: Instance = game:GetService("ReplicatedStorage")
	local segs = {}
	for seg in string.gmatch(parentPath:gsub("^game%.", ""), "[^.]+") do table.insert(segs, seg) end
	local cur: Instance = game
	for _, seg in ipairs(segs) do
		if seg == "ReplicatedStorage" then cur = game:GetService("ReplicatedStorage")
		elseif seg == "ReplicatedShared" then cur = game:GetService("ReplicatedStorage")
		else
			local nxt = cur:FindFirstChild(seg)
			if not nxt then nxt = Instance.new("Folder"); nxt.Name = seg; nxt.Parent = cur end
			cur = nxt
		end
	end
	seq.Parent = cur

	return { ok = true, fallback = true, sequence = seq:GetFullName(), keyframes = #keyframes, priority = "Action", rigType = rigType, loop = loop, hierarchy = "nested-AddSubPose", via = "MoonAnimator-IK-fallback" }
end

local function fallbackRig(args: any): any
	local rigType: string = tostring(args.rigType or "R15")
	local char = resolveCharacter(tostring(args.characterPath or ""))
	if not char then return { ok = false, fallback = true, error = "Character not found", hint = "Provide workspace rig path or load via loadcharacter" } end
	local humanoid: Humanoid? = char:FindFirstChildOfClass("Humanoid")
	if not humanoid then return { ok = false, fallback = true, error = "No Humanoid in " .. char:GetFullName() } end
	local animator = humanoid:FindFirstChild("Animator")
	if not animator then animator = Instance.new("Animator"); animator.Parent = humanoid end
	local joints: {{Name: string, Type: string, Part0: string?, Part1: string?}} = {}
	for _, desc in ipairs(char:GetDescendants()) do
		if desc:IsA("Motor6D") or desc:IsA("AnimationConstraint") then
			local j: any = desc
			table.insert(joints, {
				Name = j.Name,
				Type = j.ClassName,
				Part0 = j:IsA("Motor6D") and (j.Part0 and j.Part0.Name or nil) or (j.Attachment0 and j.Attachment0.Name or nil),
				Part1 = j:IsA("Motor6D") and (j.Part1 and j.Part1.Name or nil) or (j.Attachment1 and j.Attachment1.Name or nil),
			})
		end
	end
	for _, part in ipairs(char:GetDescendants()) do
		if part:IsA("BasePart") then
			local ok, jointsList = pcall(function() return (part :: BasePart):GetJoints() end)
			if ok and typeof(jointsList) == "table" then
				for _, joint in ipairs(jointsList :: any) do
					if typeof(joint) == "Instance" and (joint:IsA("Motor6D") or joint:IsA("AnimationConstraint")) then
						local already = false
						for _, ej in ipairs(joints) do if ej.Name == joint.Name and ej.Type == joint.ClassName then already = true; break end end
						if not already then
							table.insert(joints, { Name = joint.Name, Type = joint.ClassName })
						end
					end
				end
			end
		end
	end
	return { ok = true, fallback = true, character = char:GetFullName(), rigType = rigType, joints = joints, animator = animator:GetFullName(), jointTraversal = "Motor6D+AnimationConstraint", hierarchy = "nested" }
end

local function fallbackIKSetup(args: any): any
	-- Live IKControl binding via the engine when present, else a compact local bind.
	if ProceduralIKEngine and ProceduralIKEngine.SetupLimbIK then
		local char = resolveCharacter(tostring(args.characterPath or ""))
		if not char then return { ok = false, fallback = true, error = "Character not found", hint = "Provide characterPath to a rig Model" } end
		local ok, res = pcall(function()
			return ProceduralIKEngine.SetupLimbIK(char, { ReachTarget = args.target, StepTarget = args.stepTarget })
		end)
		if ok then
			(res :: any).via = "ProceduralIKEngine.SetupLimbIK"
			return res
		end
		return { ok = false, fallback = true, error = tostring(res) }
	end
	return { ok = false, fallback = true, error = "ProceduralIKEngine missing", hint = "Install ProceduralIKEngine.lua alongside this wrapper" }
end

bridge.registerHandler("moonanimator", "Character animation via ProceduralIKEngine (IKControl + Sanity Clamp)", "MoonAnimator not installed — building via ProceduralIKEngine IK targets with Sanity Clamp.", function(args: any)
	local api = getMoonApi()
	if api == nil then return fallbackSequence(args) end
	local ok, res = pcall(function() if typeof(api) == "table" and (api :: any).sequence then return (api :: any).sequence(args) else return fallbackSequence(args) end end)
	if not ok then warn("[MoonAnimator] plugin failed: " .. tostring(res) .. " — IK fallback"); return fallbackSequence(args) end
	return res
end)
bridge.registerHandler("moonanimator:sequence", "Build sequence via ProceduralIKEngine", "IK-target fallback", function(args: any) return fallbackSequence(args) end)
bridge.registerHandler("moonanimator:rig", "Ensure joints (Motor6D+AnimationConstraint) & Animator", "Fallback dual traversal", function(args: any) return fallbackRig(args) end)
bridge.registerHandler("moonanimator:iksetup", "Bind IKControl limbs to face-tracked targets", "Engine live bind", function(args: any) return fallbackIKSetup(args) end)
bridge.registerHandler("moon", "Alias moonanimator", "Fallback", function(args: any) return fallbackSequence(args) end)

print("[MoonAnimator] wrapper registered (ProceduralIKEngine: IKControl + Sanity Clamp)")

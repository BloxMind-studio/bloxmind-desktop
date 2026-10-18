--!nocheck
-- Studio R15 rig snapshot for the animate-roblox-characters automated transfer.
--
-- Run this through the Roblox Studio MCP inside the place that contains the
-- premade R15 character. Return value is a JSON string consumed by
-- authentic_rig.import_studio_snapshot(snapshot_path).
--
-- Selection rules:
--   1. If game.Selection contains exactly one Model with a PrimaryPart, use it.
--   2. Otherwise auto-detect a Workspace model whose parts include at least 10
--      R15 body part names and that uses Motor6D joints.
--   3. Ambiguity or missing targets return an error object instead.
--
-- Scope: Motor6D rigs built from Part or MeshPart body parts (the stock
-- premade Studio R15 uses MeshParts). MeshPart ids are captured so the Blender
-- importer can inspect FileMesh data (including skinning) per body part; the
-- generated transfer OBJ still approximates geometry with Size boxes.
-- Rigs containing welds, AnimationConstraints, or accessories are rejected so
-- the caller can fall back to the Creator Store plugin's interactive transfer.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")

local R15_REQUIRED = {
	"Head",
	"UpperTorso",
	"LowerTorso",
	"LeftUpperArm",
	"LeftLowerArm",
	"LeftHand",
	"RightUpperArm",
	"RightLowerArm",
	"RightHand",
	"LeftUpperLeg",
	"LeftLowerLeg",
	"LeftFoot",
	"RightUpperLeg",
	"RightLowerLeg",
	"RightFoot",
}
local R15_NAME_SET = {}
for _, name in ipairs(R15_REQUIRED) do
	R15_NAME_SET[name] = true
end

local function encode(payload)
	return HttpService:JSONEncode(payload)
end

local function fail(message, extra)
	local payload = { ok = false, errors = { message } }
	if extra then
		for key, value in pairs(extra) do
			payload[key] = value
		end
	end
	return encode(payload)
end

local function cfComponents(cf)
	local components = { cf:GetComponents() }
	return components
end

local function sizeComponents(size)
	return { size.X, size.Y, size.Z }
end

local function readMeshId(part)
	local okContent, content = pcall(function()
		return part.MeshContent
	end)
	if okContent and content ~= nil then
		if type(content) == "string" then
			if content ~= "" then
				return content
			end
		else
			local okUri, uri = pcall(function()
				return content.Uri
			end)
			if okUri and type(uri) == "string" and uri ~= "" then
				return uri
			end
		end
	end
	local okId, id = pcall(function()
		return part.MeshId
	end)
	if okId and type(id) == "string" and id ~= "" then
		return id
	end
	return nil
end

local function buildPartRecord(part, warnings)
	local isMeshPart = part:IsA("MeshPart")
	if not isMeshPart and not part:IsA("Part") then
		error(string.format("part '%s' of class %s is not supported by the automated transfer.", part:GetFullName(), part.ClassName))
	end
	local record = {
		name = part.Name,
		className = part.ClassName,
		size = sizeComponents(part.Size),
		cframe = cfComponents(part.CFrame),
	}
	if isMeshPart then
		local meshId = readMeshId(part)
		if meshId then
			record.meshId = meshId
		else
			table.insert(
				warnings,
				string.format("part '%s' is a MeshPart without a readable MeshId; transferred geometry uses its Size box.", part.Name)
			)
		end
	elseif part:FindFirstChildWhichIsA("SpecialMesh", true) then
		table.insert(
			warnings,
			string.format("part '%s' has a SpecialMesh; transferred geometry uses its Part size box.", part.Name)
		)
	end
	return record
end

local function countR15Parts(model)
	local seen = {}
	local count = 0
	for _, desc in ipairs(model:GetDescendants()) do
		if desc:IsA("BasePart") and R15_NAME_SET[desc.Name] and not seen[desc.Name] then
			seen[desc.Name] = true
			count += 1
		end
	end
	return count, seen
end

local function findCandidates()
	local candidates = {}
	for _, child in ipairs(workspace:GetChildren()) do
		if child:IsA("Model") and child.PrimaryPart then
			local r15Count, seen = countR15Parts(child)
			if r15Count >= 10 then
				table.insert(candidates, { model = child, r15Count = r15Count, seen = seen })
			end
		end
	end
	return candidates
end

local function pickTarget()
	local selected = Selection:Get()
	local selectedModels = {}
	for _, item in ipairs(selected) do
		if item:IsA("Model") and item.PrimaryPart then
			table.insert(selectedModels, item)
		end
	end
	if #selectedModels == 1 then
		return selectedModels[1], "selection"
	end
	if #selectedModels > 1 then
		local names = {}
		for _, model in ipairs(selectedModels) do
			table.insert(names, model:GetFullName())
		end
		return nil, nil, fail("Multiple models are selected; select exactly one.", { candidates = names })
	end

	local candidates = findCandidates()
	if #candidates == 0 then
		return nil, nil,
			fail("No premade R15 model found. Select the character in Studio or place a rig builder R15 in Workspace.")
	end
	if #candidates == 1 then
		return candidates[1].model, "auto-detect"
	end

	local preferred = {}
	for _, candidate in ipairs(candidates) do
		local name = candidate.model.Name
		if name == "R15StarterRig" or name == "StarterCharacter" then
			table.insert(preferred, candidate)
		end
	end
	if #preferred == 1 then
		return preferred[1].model, "auto-detect-preferred-name"
	end

	local names = {}
	for _, candidate in ipairs(candidates) do
		table.insert(names, candidate.model:GetFullName())
	end
	return nil, nil, fail("Multiple R15 candidates found; select the intended model.", { candidates = names })
end

local function collectJoints(model)
	local joints = {}
	for _, desc in ipairs(model:GetDescendants()) do
		if desc:IsA("Motor6D") then
			table.insert(joints, desc)
		elseif desc:IsA("Weld") or desc:IsA("WeldConstraint") or desc:IsA("AnimationConstraint") then
			return nil, string.format(
				"%s joint '%s' is not supported by the automated transfer; use the Creator Store plugin transfer instead.",
				desc.ClassName,
				desc:GetFullName()
			)
		end
	end
	return joints, nil
end

local function buildTree(model)
	local joints, jointError = collectJoints(model)
	if jointError then
		return nil, jointError
	end

	local warnings = {}
	local jointsByPart0 = {}
	for _, joint in ipairs(joints) do
		local part0 = joint.Part0
		local part1 = joint.Part1
		if part0 and part1 and part0:IsDescendantOf(model) and part1:IsDescendantOf(model) then
			jointsByPart0[part0] = jointsByPart0[part0] or {}
			table.insert(jointsByPart0[part0], joint)
		end
	end

	local root = model.PrimaryPart
	local visited = {}

	local function partEntry(part)
		return buildPartRecord(part, warnings)
	end

	local function walk(part)
		if visited[part] then
			return nil
		end
		local node = partEntry(part)
		visited[part] = true
		node.children = {}
		for _, joint in ipairs(jointsByPart0[part] or {}) do
			local other = nil
			local parentIsPart0 = true
			if joint.Part0 == part then
				other = joint.Part1
			elseif joint.Part1 == part then
				other = joint.Part0
				parentIsPart0 = false
			end
			if other and other:IsDescendantOf(model) then
				local childNode = walk(other)
				if childNode then
					childNode.joint = {
						class = joint.ClassName,
						c0 = cfComponents(joint.C0),
						c1 = cfComponents(joint.C1),
						parentIsPart0 = parentIsPart0,
						name = joint.Name,
					}
					table.insert(node.children, childNode)
				end
			end
		end
		return node
	end

	local ok, tree = pcall(walk, root)
	if not ok then
		return nil, tostring(tree)
	end

	local unvisited = {}
	for _, desc in ipairs(model:GetDescendants()) do
		if desc:IsA("BasePart") and desc:IsDescendantOf(model) and not visited[desc] then
			table.insert(unvisited, desc:GetFullName())
		end
	end
	if #unvisited > 0 then
		return nil, "Model contains parts that are not connected to the Motor6D hierarchy: " .. table.concat(unvisited, ", ")
	end

	local r15Count = 0
	for _, desc in ipairs(model:GetDescendants()) do
		if desc:IsA("BasePart") and R15_NAME_SET[desc.Name] then
			r15Count += 1
		end
	end
	if r15Count < 10 then
		return nil, string.format("Model exposes only %d of the required R15 part names.", r15Count)
	end

	return { tree = tree, warnings = warnings, joints = joints }, nil
end

local target, detection, selectionError = pickTarget()
if selectionError then
	return selectionError
end

local built, treeError = buildTree(target)
if treeError then
	return fail(treeError, { model = target:GetFullName() })
end

local partEntries = {}
local meshPartCount = 0
for _, desc in ipairs(target:GetDescendants()) do
	if desc:IsA("BasePart") then
		local entry = buildPartRecord(desc, {})
		if entry.className == "MeshPart" then
			meshPartCount += 1
		end
		table.insert(partEntries, entry)
	end
end

if meshPartCount > 0 then
	table.insert(
		built.warnings,
		string.format(
			"%d MeshPart body part(s) transfer with approximate Size-box geometry; the Blender importer can still rebuild FileMesh skinning.",
			meshPartCount
		)
	)
end

return encode({
	ok = true,
	schema = "animate-roblox-characters/studio-r15-snapshot@1",
	rigName = target.Name,
	detection = detection,
	partCount = #partEntries,
	jointCount = #built.joints,
	parts = partEntries,
	root = built.tree,
	warnings = built.warnings,
})

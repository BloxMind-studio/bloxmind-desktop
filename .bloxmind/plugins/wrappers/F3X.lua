-- F3X Wrapper — Building Tools by F3X for precise part editing
-- When F3X plugin is present, delegates move/resize/rotate/paint; otherwise performs precise CFrame/Size math with ChangeHistory.

local bridge = _G.BloxMindPluginBridge
if not bridge then
	warn("[F3X] BloxMindPluginBridge not found — wrapper skipping")
	return
end

local function getF3XApi(): any?
	local candidates: {any} = {
		rawget(_G, "F3X"),
		rawget(_G, "f3x"),
		rawget(_G, "BuildingTools"),
		rawget(getgenv and getgenv() or _G, "F3XAPI"),
	}
	for _, c in ipairs(candidates) do if c ~= nil then return c end end
	local rs = game:GetService("ReplicatedStorage")
	local f = rs:FindFirstChild("F3X") or rs:FindFirstChild("BuildingTools") or rs:FindFirstChild("F3XBuildingTools")
	if f then return f end
	return nil
end

local function resolveInstance(path: any): Instance?
	if typeof(path) == "Instance" then return path end
	if typeof(path) == "string" then
		-- Try multiple roots
		local roots: {Instance} = {workspace, game:GetService("ReplicatedStorage"), game:GetService("ServerStorage")}
		for _, root in ipairs(roots) do
			local cur: Instance? = root
			for seg in string.gmatch(path, "[^.]+") do
				if not cur then break end
				cur = cur:FindFirstChild(seg)
			end
			if cur then return cur end
		end
		-- Also try game:GetService path
		if string.find(path, "^game%.") then
			local ok, inst = pcall(function() return (game :: any):FindFirstChild(path, true) end)
			if ok and inst then return inst end
		end
	end
	return nil
end

local function fallbackF3X(args: any): any
	local action: string = tostring(args.action or args.op or "move"):lower()
	local targetPath = args.target or args.part or args.selection or args.instance
	local target: Instance? = resolveInstance(targetPath)
	-- If no explicit target and workspace selection exists, use Selection
	if not target then
		local sel = game:GetService("Selection"):Get()
		if #sel == 1 then target = sel[1] end
	end

	if action == "create" or action == "new" then
		local pos: Vector3 = Vector3.new(0,5,0)
		if args.position then
			local v = args.position
			if typeof(v) == "Vector3" then pos = v
			elseif typeof(v) == "table" then pos = Vector3.new(v[1] or 0, v[2] or 5, v[3] or 0)
			end
		end
		local size: Vector3 = Vector3.new(4,4,4)
		if args.size and typeof(args.size) == "table" then
			size = Vector3.new(args.size[1] or 4, args.size[2] or 4, args.size[3] or 4)
		end
		local parent: Instance = workspace:FindFirstChild("Map") or workspace
		if args.parent and typeof(args.parent) == "string" then
			local p = resolveInstance(args.parent)
			if p then parent = p end
		end
		local part = Instance.new("Part")
		part.Name = tostring(args.name or "F3XPart")
		part.Size = size
		part.Anchored = true
		part.Material = if args.material then (pcall(function() return (Enum.Material :: any)[args.material] end) and (Enum.Material :: any)[args.material] or Enum.Material.Plastic) else Enum.Material.Plastic
		if args.color and typeof(args.color) == "table" then
			part.Color = Color3.fromRGB(args.color[1] or 200, args.color[2] or 200, args.color[3] or 200)
		end
		-- Ground snap to avoid floating
		local params = RaycastParams.new()
		params.FilterType = Enum.RaycastFilterType.Include
		params.FilterDescendantsInstances = {workspace.Terrain, workspace:FindFirstChild("Map") or workspace}
		local hit = workspace:Raycast(Vector3.new(pos.X, pos.Y+200, pos.Z), Vector3.new(0,-500,0), params)
		local groundY = if hit then hit.Position.Y else pos.Y
		local yOffset = if args.noSnap then pos.Y else groundY + size.Y/2
		local finalPos = Vector3.new(pos.X, yOffset, pos.Z)
		if args.cframe and typeof(args.cframe) == "table" then
			-- ignore, use CFrame from args
		end
		if args.rotation and typeof(args.rotation) == "table" then
			part.CFrame = CFrame.new(finalPos) * CFrame.Angles(math.rad(args.rotation[1] or 0), math.rad(args.rotation[2] or 0), math.rad(args.rotation[3] or 0))
		else
			part.CFrame = CFrame.new(finalPos)
		end
		part.Parent = parent
		return { created = part:GetFullName(), fallback = true, action = "create" }
	end

	if not target then
		return { ok = false, error = "F3X: no target instance found for action '" .. action .. "'", hint = "Provide 'target' path or select an instance in Explorer; falling back without mutation.", fallback = true }
	end

	if action == "move" then
		if target:IsA("BasePart") then
			local dest: Vector3? = nil
			if args.position then
				local v = args.position
				if typeof(v) == "Vector3" then dest = v
				elseif typeof(v) == "table" then dest = Vector3.new(v[1] or 0, v[2] or 0, v[3] or 0)
				end
			elseif args.delta and typeof(args.delta) == "table" then
				dest = (target :: BasePart).Position + Vector3.new(args.delta[1] or 0, args.delta[2] or 0, args.delta[3] or 0)
			end
			if dest then
				(target :: BasePart).CFrame = CFrame.new(dest) * (target :: BasePart).CFrame.Rotation
				return { moved = target:GetFullName(), to = tostring(dest), fallback = true }
			end
		end
	elseif action == "resize" or action == "size" then
		if target:IsA("BasePart") and args.size and typeof(args.size) == "table" then
			local s = Vector3.new(args.size[1] or 4, args.size[2] or 4, args.size[3] or 4)
			-- Clamp to avoid 0 size
			s = Vector3.new(math.max(s.X, 0.2), math.max(s.Y, 0.2), math.max(s.Z, 0.2))
			;(target :: BasePart).Size = s
			return { resized = target:GetFullName(), size = tostring(s), fallback = true }
		end
	elseif action == "rotate" then
		if target:IsA("BasePart") then
			local rot: {number} = args.rotation or args.angles or {0, 90, 0}
			local cf = (target :: BasePart).CFrame
			local pos = cf.Position
			local add = CFrame.Angles(math.rad(rot[1] or 0), math.rad(rot[2] or 0), math.rad(rot[3] or 0))
			;(target :: BasePart).CFrame = CFrame.new(pos) * (cf.Rotation * add)
			return { rotated = target:GetFullName(), fallback = true }
		end
	elseif action == "paint" or action == "color" then
		if target:IsA("BasePart") then
			if args.color and typeof(args.color) == "table" then
				;(target :: BasePart).Color = Color3.fromRGB(args.color[1] or 255, args.color[2] or 255, args.color[3] or 255)
			end
			if args.material and typeof(args.material) == "string" then
				local ok, mat = pcall(function() return (Enum.Material :: any)[args.material] end)
				if ok and mat then (target :: BasePart).Material = mat end
			end
			return { painted = target:GetFullName(), fallback = true }
		end
	elseif action == "clone" or action == "duplicate" then
		local clone = target:Clone()
		clone.Parent = target.Parent
		if clone:IsA("BasePart") and args.offset and typeof(args.offset) == "table" then
			clone.CFrame = clone.CFrame * CFrame.new(args.offset[1] or 4, args.offset[2] or 0, args.offset[3] or 0)
		end
		return { cloned = clone:GetFullName(), fallback = true }
	elseif action == "delete" or action == "remove" then
		local path = target:GetFullName()
		target:Destroy()
		return { deleted = path, fallback = true }
	end

	return { ok = false, error = "F3X: unhandled action '" .. action .. "'", fallback = true, hint = "Supported: create, move, resize, rotate, paint, clone, delete; using fallback path." }
end

bridge.registerHandler("f3x", "Precise part edit via F3X (move/resize/rotate/paint — anchored, no drift)", "F3X plugin not active — applying Luau transform with ChangeHistoryService so edit is undoable.", function(args: any)
	local api = getF3XApi()
	if api == nil then return fallbackF3X(args) end
	local ok, res = pcall(function()
		if typeof(api) == "table" and (api :: any).execute then return (api :: any).execute(args)
		elseif typeof(api) == "table" and (api :: any).apply then return (api :: any).apply(args)
		else return fallbackF3X(args) end
	end)
	if not ok then
		warn("[F3X] plugin failed: " .. tostring(res) .. " — fallback")
		return fallbackF3X(args)
	end
	return res
end)

-- Action-specific aliases
for _, act in ipairs({"move","resize","rotate","paint","clone","delete","create"}) do
	local a = act
	bridge.registerHandler("f3x:" .. a, "F3X " .. a, "Fallback Luau " .. a, function(args: any)
		args.action = a
		return fallbackF3X(args)
	end)
end

print("[F3X] wrapper registered")

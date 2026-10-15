-- BrushTool Wrapper — vegetation & scatter via BloxMind bridge
-- Uses ChangeHistoryService waypoint via bridge helper.
-- Fallback: generate parts via Luau when BrushTool plugin not installed.

local bridge = _G.BloxMindPluginBridge
if not bridge then
	warn("[BrushTool] BloxMindPluginBridge not found — wrapper skipping registration, Luau fallback will be used")
	return
end

local function getBrushToolApi(): any?
	-- Try common BrushTool installations:
	--  - Plugin object with API exposed via _G.BrushTool or ReplicatedStorage brush folder
	--  - Studio plugin "Brushtool" (XAXA) often exposes via plugin:GetMouse() hooks — no public API, so we detect via presence test
	local candidates: {any} = {
		rawget(_G, "BrushTool"),
		rawget(_G, "Brushtool"),
		rawget(getgenv and getgenv() or _G, "BrushToolAPI"),
	}
	for _, c in ipairs(candidates) do
		if c ~= nil then return c end
	end
	-- Also check ReplicatedStorage for a BrushTool folder/model injected by plugin
	local rs = game:GetService("ReplicatedStorage")
	local f = rs:FindFirstChild("BrushTool") or rs:FindFirstChild("Brushtool")
	if f then return f end
	return nil
end

-- Luau fallback scatter: anchored parts with random rotation
local function fallbackScatter(args: any): any
	local center = args.center or args.position or Vector3.new(0, 0, 0)
	if typeof(center) == "table" then
		center = Vector3.new(center[1] or center.X or 0, center[2] or center.Y or 0, center[3] or center.Z or 0)
	end
	local count = math.clamp(tonumber(args.count) or 20, 1, 500)
	local radius = tonumber(args.radius) or 40
	local templateNames: {string} = args.templates or args.models or {"Tree", "Bush"}
	local parentPath = args.parent or "workspace"
	local parent: Instance = workspace
	if typeof(parentPath) == "string" and parentPath ~= "workspace" then
		local ok, inst = pcall(function() return game:GetService("ReplicatedStorage"):FindFirstChild(parentPath) end)
		if ok and inst then parent = inst end
	end

	local folder = Instance.new("Folder")
	folder.Name = "BrushScatter_" .. tostring(math.random(1000, 9999))
	folder.Parent = parent

	local created: {Instance} = {}
	for i = 1, count do
		local angle = math.random() * math.pi * 2
		local r = math.random() * radius
		local pos = Vector3.new(center.X + math.cos(angle) * r, center.Y, center.Z + math.sin(angle) * r)
		-- Raycast to ground so no floating parts
		local params = RaycastParams.new()
		params.FilterType = Enum.RaycastFilterType.Include
		params.FilterDescendantsInstances = {workspace.Terrain, workspace:FindFirstChild("Map") or workspace}
		local origin = Vector3.new(pos.X, pos.Y + 200, pos.Z)
		local hit = workspace:Raycast(origin, Vector3.new(0, -500, 0), params)
		local groundY = if hit then hit.Position.Y else pos.Y
		local templateName = templateNames[math.random(1, #templateNames)]
		local part: Instance
		-- Try clone from ReplicatedStorage template, else primitive
		local template = game:GetService("ReplicatedStorage"):FindFirstChild(templateName, true)
		if template and template:IsA("Model") then
			part = (template :: Model):Clone()
			;(part :: Model):PivotTo(CFrame.new(pos.X, groundY + 2, pos.Z) * CFrame.Angles(0, math.random()*math.pi*2, 0))
			part.Parent = folder
		elseif template and template:IsA("BasePart") then
			part = (template :: BasePart):Clone()
			;(part :: BasePart).CFrame = CFrame.new(pos.X, groundY + ((part :: BasePart).Size.Y/2), pos.Z) * CFrame.Angles(0, math.random()*math.pi*2, 0)
			part.Parent = folder
		else
			local p = Instance.new("Part")
			p.Name = templateName .. "_" .. tostring(i)
			p.Size = Vector3.new(2, math.random(6,12), 2)
			p.Material = Enum.Material.Wood
			p.Color = Color3.fromRGB(101, 67, 33)
			p.Anchored = true
			p.CFrame = CFrame.new(pos.X, groundY + p.Size.Y/2, pos.Z)
			p.Parent = folder
			-- simple leaf sphere
			local leaf = Instance.new("Part")
			leaf.Shape = Enum.PartType.Ball
			leaf.Size = Vector3.new(math.random(4,7), math.random(4,7), math.random(4,7))
			leaf.Material = Enum.Material.Grass
			leaf.Color = Color3.fromRGB(85, 170, 85)
			leaf.Anchored = true
			leaf.CFrame = CFrame.new(pos.X, groundY + p.Size.Y + 2, pos.Z) * CFrame.Angles(math.random()*0.5, math.random()*0.5, math.random()*0.5)
			leaf.Parent = folder
			part = p
			table.insert(created, leaf)
		end
		table.insert(created, part)
	end
	return { scattered = #created, folder = folder:GetFullName(), fallback = true, count = count, radius = radius }
end

-- Primary handler: brushtool:paint / brushtool:scatter
bridge.registerHandler("brushtool", "Scatter vegetation with BrushTool (avoids floating, respects terrain)", "BrushTool not active — falling back to Luau scatter that raycasts to Terrain and uses ChangeHistoryService.", function(args: any)
	local api = getBrushToolApi()
	if api == nil then
		-- Graceful fallback: still creates vegetation, but via Luau
		return fallbackScatter(args)
	end
	-- If real BrushTool API exists, delegate
	local ok, res = pcall(function()
		if typeof(api) == "table" and (api :: any).paint then
			return (api :: any).paint(args)
		elseif typeof(api) == "Instance" and api:IsA("Folder") then
			-- treat as template container — do scatter using its children
			args.templates = args.templates or {}
			for _, child in ipairs(api:GetChildren()) do table.insert(args.templates, child.Name) end
			return fallbackScatter(args)
		else
			return fallbackScatter(args)
		end
	end)
	if not ok then
		warn("[BrushTool] plugin call failed, using fallback: " .. tostring(res))
		return fallbackScatter(args)
	end
	return res
end)

-- Also register action-specific handler for MCP {plugin:"brushtool", action:"paint"}
bridge.registerHandler("brushtool:paint", "Paint/scatter via BrushTool", "BrushTool plugin not found; used Luau scatter fallback.", function(args: any)
	local api = getBrushToolApi()
	if api == nil then return fallbackScatter(args) end
	return bridge.handlers["brushtool"](args)
end)

bridge.registerHandler("brushtool:scatter", "Scatter with density/radius", "Fallback Luau scatter", function(args: any)
	return fallbackScatter(args)
end)

print("[BrushTool] wrapper registered")

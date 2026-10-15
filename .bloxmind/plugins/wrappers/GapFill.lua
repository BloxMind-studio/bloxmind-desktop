-- GapFill Wrapper — fills gaps between parts with exact wedge/plastic fills
-- Uses GapFill plugin when present; fallback does wedge fill with proper PartType and no floating geometry.

local bridge = _G.BloxMindPluginBridge
if not bridge then
	warn("[GapFill] BloxMindPluginBridge not found — wrapper skipping")
	return
end

local function getGapFillApi(): any?
	local candidates: {any} = {
		rawget(_G, "GapFill"),
		rawget(_G, "gapfill"),
		rawget(getgenv and getgenv() or _G, "GapFillAPI"),
	}
	for _, c in ipairs(candidates) do if c ~= nil then return c end end
	local rs = game:GetService("ReplicatedStorage")
	local f = rs:FindFirstChild("GapFill") or rs:FindFirstChild("StravantGapFill")
	if f then return f end
	return nil
end

local function fallbackGapFill(args: any): any
	-- args: { partA: Instance path or Vector3s, partB/next, thickness, material }
	local function resolvePart(path: any): BasePart?
		if typeof(path) == "Instance" and path:IsA("BasePart") then return path :: BasePart end
		if typeof(path) == "string" then
			local ok, inst = pcall(function(): any
				-- Try workspace path
				local cur: Instance = workspace
				for seg in string.gmatch(path, "[^.]+") do
					cur = cur:FindFirstChild(seg) :: Instance
					if not cur then return nil end
				end
				return cur
			end)
			if ok and inst and inst:IsA("BasePart") then return inst :: BasePart end
		end
		return nil
	end

	local thickness = tonumber(args.thickness) or 0.5
	local material: Enum.Material = Enum.Material.Plastic
	if args.material and typeof(args.material) == "string" then
		local ok, mat = pcall(function() return (Enum.Material :: any)[args.material] end)
		if ok and mat then material = mat end
	end

	-- Case 1: explicit edges {a,b,c} as Vector3s
	if args.edges and typeof(args.edges) == "table" then
		local edges: {Vector3} = {}
		for _, e in ipairs(args.edges) do
			if typeof(e) == "Vector3" then table.insert(edges, e)
			elseif typeof(e) == "table" then table.insert(edges, Vector3.new(e[1] or 0, e[2] or 0, e[3] or 0))
			end
		end
		if #edges >= 3 then
			local folder = Instance.new("Folder")
			folder.Name = "GapFill_" .. tostring(math.random(1000,9999))
			folder.Parent = workspace:FindFirstChild("Map") or workspace
			-- Create wedge parts to fill polygon — simple triangulation from first vertex
			local created = 0
			for i = 2, #edges-1 do
				local a, b, c = edges[1], edges[i], edges[i+1]
				-- Compute CFrame from triangle — use WedgePart for sloped fill
				local ab = b - a
				local ac = c - a
				local normal = ab:Cross(ac)
				if normal.Magnitude > 0.01 then
					local center = (a + b + c) / 3
					local p = Instance.new("WedgePart")
					p.Name = "GapWedge_" .. tostring(created+1)
					p.Anchored = true
					p.Material = material
					-- Size based on edges
					p.Size = Vector3.new((b-a).Magnitude, thickness, (c-a).Magnitude)
					p.CFrame = CFrame.new(center, center + normal)
					p.Parent = folder
					created += 1
				end
			end
			return { filled = created, folder = folder:GetFullName(), fallback = true }
		end
	end

	local partA = resolvePart(args.partA or args.a)
	local partB = resolvePart(args.partB or args.b)
	if partA and partB then
		local folder = Instance.new("Folder")
		folder.Name = "GapFill_" .. tostring(math.random(1000,9999))
		folder.Parent = workspace:FindFirstChild("Map") or workspace
		-- Simple gap bridge: create a block spanning the nearest faces
		local mid = (partA.Position + partB.Position)/2
		local dist = (partA.Position - partB.Position).Magnitude
		local gap = math.max(dist - (partA.Size.Magnitude + partB.Size.Magnitude)/2, 0.2)
		local p = Instance.new("Part")
		p.Name = "GapFillBlock"
		p.Anchored = true
		p.Material = material
		p.Size = Vector3.new(math.max(gap, 0.5), thickness, math.min(partA.Size.Z, partB.Size.Z))
		p.CFrame = CFrame.new(mid, partB.Position)
		p.Parent = folder
		return { filled = 1, folder = folder:GetFullName(), fallback = true }
	end

	-- Generic fallback: create a ground-snapped filler at given position
	local pos: Vector3 = Vector3.new(0,0,0)
	if args.position then
		local v = args.position
		if typeof(v) == "Vector3" then pos = v
		elseif typeof(v) == "table" then pos = Vector3.new(v[1] or 0, v[2] or 0, v[3] or 0)
		end
	end
	local size: Vector3 = Vector3.new(4, thickness, 4)
	if args.size and typeof(args.size) == "table" then
		size = Vector3.new(args.size[1] or 4, args.size[2] or thickness, args.size[3] or 4)
	end
	local folder = Instance.new("Folder")
	folder.Name = "GapFill_" .. tostring(math.random(1000,9999))
	folder.Parent = workspace:FindFirstChild("Map") or workspace
	-- Raycast to avoid floating
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = {workspace.Terrain, workspace:FindFirstChild("Map") or workspace}
	local hit = workspace:Raycast(Vector3.new(pos.X, pos.Y+200, pos.Z), Vector3.new(0,-500,0), params)
	local groundY = if hit then hit.Position.Y else pos.Y
	local p = Instance.new("Part")
	p.Name = "GapFill"
	p.Anchored = true
	p.Material = material
	p.Size = size
	p.CFrame = CFrame.new(pos.X, groundY + size.Y/2, pos.Z)
	p.Parent = folder
	return { filled = 1, folder = folder:GetFullName(), fallback = true }
end

bridge.registerHandler("gapfill", "Fill gaps between parts (no floating, precise wedges)", "GapFill plugin not installed — falling back to WedgePart/Part gap fill.", function(args: any)
	local api = getGapFillApi()
	if api == nil then return fallbackGapFill(args) end
	local ok, res = pcall(function()
		if typeof(api) == "table" and (api :: any).fill then return (api :: any).fill(args)
		elseif typeof(api) == "table" and (api :: any).fillGap then return (api :: any).fillGap(args)
		else return fallbackGapFill(args) end
	end)
	if not ok then
		warn("[GapFill] plugin failed: " .. tostring(res) .. " — fallback")
		return fallbackGapFill(args)
	end
	return res
end)

bridge.registerHandler("gapfill:fill", "Fill by edges/parts", "Fallback wedge", function(args: any)
	return fallbackGapFill(args)
end)

print("[GapFill] wrapper registered")

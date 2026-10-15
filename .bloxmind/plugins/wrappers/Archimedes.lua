-- Archimedes Wrapper — smooth roads, curves & arcs
-- When Archimedes plugin is present, delegates to its API for accurate circular/arc roads.
-- Falls back to precise CFrame interpolation to avoid manual part math misalignment.

local bridge = _G.BloxMindPluginBridge
if not bridge then
	warn("[Archimedes] BloxMindPluginBridge not found — wrapper skipping, Luau fallback will handle curves")
	return
end

local function getArchimedesApi(): any?
	local candidates: {any} = {
		rawget(_G, "Archimedes"),
		rawget(_G, "archimedes"),
		rawget(getgenv and getgenv() or _G, "ArchimedesAPI"),
	}
	for _, c in ipairs(candidates) do if c ~= nil then return c end end
	-- Check plugin toolbar presence hint (no API)
	local rs = game:GetService("ReplicatedStorage")
	local f = rs:FindFirstChild("Archimedes") or rs:FindFirstChild("ArchimedesGraph")
	if f then return f end
	return nil
end

local function fallbackArcRoad(args: any): any
	local startPos = args.start or args.p0 or Vector3.new(0,0,0)
	local endPos = args["end"] or args.p1 or Vector3.new(100,0,0)
	local segments = math.clamp(tonumber(args.segments) or 16, 3, 64)
	local width = tonumber(args.width) or 12
	local thickness = tonumber(args.thickness) or 1
	local material: Enum.Material = Enum.Material.Asphalt
	if args.material and typeof(args.material) == "string" then
		local ok, mat = pcall(function() return (Enum.Material :: any)[args.material] end)
		if ok and mat then material = mat end
	end
	local color: Color3? = nil
	if args.color and typeof(args.color) == "table" then
		color = Color3.fromRGB(args.color[1] or 50, args.color[2] or 50, args.color[3] or 50)
	end
	local curveHeight = tonumber(args.curveHeight) or tonumber(args.arcHeight) or 0
	-- Support arc via center+radius+angle or bezier via control point
	local center = args.center
	local radius = tonumber(args.radius)
	local angleDeg = tonumber(args.angleDeg) or tonumber(args.angle) or 90

	local function toVec(v: any): Vector3
		if typeof(v) == "Vector3" then return v end
		if typeof(v) == "table" then return Vector3.new(v[1] or v.X or 0, v[2] or v.Y or 0, v[3] or v.Z or 0) end
		return Vector3.new(0,0,0)
	end
	startPos = toVec(startPos)
	endPos = toVec(endPos)

	local folder = Instance.new("Folder")
	folder.Name = "ArchimedesRoad_" .. tostring(math.random(1000,9999))
	folder.Parent = workspace:FindFirstChild("Map") or workspace

	local points: {Vector3} = {}
	if center and radius then
		center = toVec(center)
		local startAngle = math.atan2(startPos.Z - center.Z, startPos.X - center.X)
		local angleRad = math.rad(angleDeg)
		for i = 0, segments do
			local t = i / segments
			local a = startAngle + t * angleRad
			local h = math.sin(math.pi * t) * curveHeight
			table.insert(points, Vector3.new(center.X + math.cos(a)*radius, math.max(startPos.Y, endPos.Y) + h, center.Z + math.sin(a)*radius))
		end
	elseif args.control then
		local ctrl = toVec(args.control)
		for i = 0, segments do
			local t = i / segments
			local inv = 1 - t
			local x = inv*inv*startPos.X + 2*inv*t*ctrl.X + t*t*endPos.X
			local y = inv*inv*startPos.Y + 2*inv*t*ctrl.Y + t*t*endPos.Y + math.sin(math.pi*t)*curveHeight
			local z = inv*inv*startPos.Z + 2*inv*t*ctrl.Z + t*t*endPos.Z
			table.insert(points, Vector3.new(x, y, z))
		end
	else
		-- Simple lerp
		for i = 0, segments do
			local t = i / segments
			local h = math.sin(math.pi * t) * curveHeight
			table.insert(points, Vector3.new(startPos.X + (endPos.X-startPos.X)*t, startPos.Y + (endPos.Y-startPos.Y)*t + h, startPos.Z + (endPos.Z-startPos.Z)*t))
		end
	end

	-- Place road segments between points
	local prev: Vector3? = nil
	local created = 0
	for _, pt in ipairs(points) do
		if prev then
			local mid = (prev + pt) / 2
			local dir = pt - prev
			local len = dir.Magnitude
			if len > 0.1 then
				local part = Instance.new("Part")
				part.Name = "RoadSeg_" .. tostring(created+1)
				part.Anchored = true
				part.CanCollide = true
				part.Material = material
				part.Size = Vector3.new(width, thickness, len + 0.1)
				if color then part.Color = color end
				-- Align to direction on XZ plane
				local look = CFrame.new(mid, pt)
				part.CFrame = look * CFrame.Angles(0, math.pi/2, 0) -- rotate so length aligns with Z
				part.Parent = folder
				created += 1
			end
		end
		prev = pt
	end

	return { segments = created, folder = folder:GetFullName(), fallback = true, width = width, material = tostring(material) }
end

bridge.registerHandler("archimedes", "Smooth roads/curves via Archimedes (replaces manual part math)", "Archimedes not active — falling back to CFrame-interpolated road with correct alignment.", function(args: any)
	local api = getArchimedesApi()
	if api == nil then return fallbackArcRoad(args) end
	local ok, res = pcall(function()
		if typeof(api) == "table" and (api :: any).createArc then
			return (api :: any).createArc(args)
		elseif typeof(api) == "table" and (api :: any).draw then
			return (api :: any).draw(args)
		else
			return fallbackArcRoad(args)
		end
	end)
	if not ok then
		warn("[Archimedes] plugin call failed: " .. tostring(res) .. " — using fallback")
		return fallbackArcRoad(args)
	end
	return res
end)

bridge.registerHandler("archimedes:arc", "Arc road by center/radius/angle", "Fallback interpolated arc", function(args: any)
	return fallbackArcRoad(args)
end)

bridge.registerHandler("archimedes:road", "Road by start/end/control", "Fallback interpolated road", function(args: any)
	return fallbackArcRoad(args)
end)

bridge.registerHandler("archimedes:curve", "Bezier curve road", "Fallback bezier", function(args: any)
	return fallbackArcRoad(args)
end)

print("[Archimedes] wrapper registered")

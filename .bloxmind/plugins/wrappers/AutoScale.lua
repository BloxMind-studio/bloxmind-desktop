-- AutoScale Wrapper — UI Offset→Scale conversion with AspectRatio & Size constraints
-- Falls back to Luau that converts Size/Position programmatically when plugin missing

local bridge = _G.BloxMindPluginBridge
if not bridge then
	warn("[AutoScale] BloxMindPluginBridge not found — wrapper skipping, Luau fallback will be used")
	return
end

local function getAutoScaleApi(): any?
	local candidates: {any} = {
		rawget(_G, "AutoScale"),
		rawget(_G, "AutoScaleLite"),
		rawget(getgenv and getgenv() or _G, "AutoScaleAPI"),
	}
	for _, c in ipairs(candidates) do if c ~= nil then return c end end
	local rs = game:GetService("ReplicatedStorage")
	local f = rs:FindFirstChild("AutoScale") or rs:FindFirstChild("AutoScaleLite")
	if f then return f end
	return nil
end

local function fallbackAutoScale(args: any): any
	local targetPath: string = tostring(args.target or args.gui or "StarterGui")
	local addAspect: boolean = if args.addAspectRatio == nil then true else (args.addAspectRatio == true)
	local useTextScaled: boolean = if args.textScaled == nil then true else (args.textScaled == true)
	local refW: number = 1920
	local refH: number = 1080
	if args.referenceResolution and typeof(args.referenceResolution) == "table" then
		local rr: any = args.referenceResolution
		refW = tonumber(rr[1]) or 1920
		refH = tonumber(rr[2]) or 1080
	end

	local function resolveInstance(path: string): Instance?
		if path:find("^game%.") then
			local ok, inst = pcall(function() return (game :: any):FindFirstChild(path, true) end)
			if ok then return inst end
		end
		-- Try multiple roots
		local roots: {Instance} = {game:GetService("StarterGui"), game:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts") and game:GetService("StarterGui") or game:GetService("StarterGui"), workspace, game:GetService("ReplicatedStorage")}
		-- Simple path traversal from game
		local cur: Instance? = game
		for seg in string.gmatch(path:gsub("^game%.",""), "[^.]+") do
			if not cur then break end
			cur = cur:FindFirstChild(seg)
		end
		if cur then return cur end
		-- Fallback: search recursively
		local ok, found = pcall(function() return game:GetService("StarterGui"):FindFirstChild(path:match("[^.]+$") or path, true) end)
		if ok and found then return found end
		return cur
	end

	local target: Instance? = resolveInstance(targetPath)
	-- If not found, try StarterGui direct
	if not target then
		local name = targetPath:match("[^.]+$")
		if name then target = game:GetService("StarterGui"):FindFirstChild(name, true) end
	end
	if not target then
		return { ok = false, fallback = true, error = "AutoScale target not found: " .. targetPath, hint = "Provide valid ScreenGui/Frame path e.g. StarterGui.ShopGui", converted = 0 }
	end

	local converted = 0
	local constraintsAdded = 0

	local function processGui(gui: Instance)
		if gui:IsA("GuiObject") then
			local go = gui :: GuiObject
			local parentAbsX = 1920
			local parentAbsY = 1080
			if gui.Parent and gui.Parent:IsA("GuiObject") then
				local p = gui.Parent :: GuiObject
				-- Use AbsoluteSize if available, else reference
				if p.AbsoluteSize.X > 0 then
					parentAbsX = p.AbsoluteSize.X
					parentAbsY = p.AbsoluteSize.Y
				end
			elseif gui.Parent and gui.Parent:IsA("ScreenGui") then
				parentAbsX = refW
				parentAbsY = refH
			end
			-- Convert Offset → Scale: Scale = Offset / parentAbs
			local sz = go.Size
			local pos = go.Position
			local newSize: UDim2
			local newPos: UDim2
			if sz.X.Offset ~= 0 or sz.Y.Offset ~= 0 then
				local sx = sz.X.Offset / math.max(parentAbsX, 1)
				local sy = sz.Y.Offset / math.max(parentAbsY, 1)
				-- Preserve existing Scale component + converted offset
				newSize = UDim2.new(sz.X.Scale + sx, 0, sz.Y.Scale + sy, 0)
				go.Size = newSize
			end
			if pos.X.Offset ~= 0 or pos.Y.Offset ~= 0 then
				local px = pos.X.Offset / math.max(parentAbsX, 1)
				local py = pos.Y.Offset / math.max(parentAbsY, 1)
				newPos = UDim2.new(pos.X.Scale + px, 0, pos.Y.Scale + py, 0)
				go.Position = newPos
			end
			if addAspect and not go:FindFirstChild("UIAspectRatioConstraint") then
				local ar = Instance.new("UIAspectRatioConstraint")
				ar.DominantAxis = Enum.DominantAxis.Height
				ar.AspectType = Enum.AspectType.FitWithinMaxSize
				-- Use current aspect if possible
				if go.AbsoluteSize.X > 0 and go.AbsoluteSize.Y > 0 then
					ar.AspectRatio = go.AbsoluteSize.X / math.max(go.AbsoluteSize.Y, 1)
				end
				ar.Parent = go
				constraintsAdded += 1
			end
			if useTextScaled and (go:IsA("TextLabel") or go:IsA("TextButton") or go:IsA("TextBox")) then
				local t = go :: TextLabel
				t.TextScaled = true
				if not go:FindFirstChild("UITextSizeConstraint") then
					local tc = Instance.new("UITextSizeConstraint")
					tc.MinTextSize = 8
					tc.MaxTextSize = 48
					tc.Parent = go
					constraintsAdded += 1
				end
			end
			converted += 1
		end
		for _, child in ipairs(gui:GetChildren()) do processGui(child) end
	end

	-- Handle ScreenGui as root (iterate its children) or single GuiObject
	if target:IsA("ScreenGui") then
		for _, child in ipairs(target:GetChildren()) do processGui(child) end
	else
		processGui(target)
	end

	return { ok = true, fallback = true, converted = converted, constraintsAdded = constraintsAdded, target = target:GetFullName(), note = "Luau fallback converted Offset→Scale; AutoScale plugin not detected" }
end

bridge.registerHandler("autoscale", "Convert Offset→Scale + constraints for responsive UI", "AutoScale plugin not installed — falling back to Luau Scale conversion (computed from AbsoluteSize / reference 1920x1080).", function(args: any)
	local api = getAutoScaleApi()
	if api == nil then return fallbackAutoScale(args) end
	local ok, res = pcall(function()
		if typeof(api) == "table" and (api :: any).convert then return (api :: any).convert(args)
		elseif typeof(api) == "table" and (api :: any).scale then return (api :: any).scale(args)
		else return fallbackAutoScale(args)
		end
	end)
	if not ok then warn("[AutoScale] plugin failed: " .. tostring(res) .. " — fallback"); return fallbackAutoScale(args) end
	return res
end)

bridge.registerHandler("autoscale:convert", "Offset→Scale conversion", "Fallback Luau", function(args: any) return fallbackAutoScale(args) end)
bridge.registerHandler("autoscale:scale", "Alias convert", "Fallback", function(args: any) return fallbackAutoScale(args) end)

print("[AutoScale] wrapper registered")

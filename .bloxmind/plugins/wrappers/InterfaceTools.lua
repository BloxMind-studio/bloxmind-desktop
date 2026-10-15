-- InterfaceTools Wrapper — instant styled components (corners, gradients, strokes, icons)
-- Fallback Luau creates UICorner/UIPadding/UIStroke/UIGradient programmatically

local bridge = _G.BloxMindPluginBridge
if not bridge then warn("[InterfaceTools] Bridge missing — fallback will be used"); return end

local function getInterfaceToolsApi(): any?
	local candidates: {any} = {
		rawget(_G, "InterfaceTools"),
		rawget(_G, "InterfaceTool"),
		rawget(getgenv and getgenv() or _G, "InterfaceToolsAPI"),
	}
	for _, c in ipairs(candidates) do if c ~= nil then return c end end
	return nil
end

local function resolveGui(path: string): GuiObject?
	local cur: Instance? = game
	for seg in string.gmatch(path:gsub("^game%.",""), "[^.]+") do
		if not cur then break end
		cur = cur:FindFirstChild(seg)
	end
	if cur and cur:IsA("GuiObject") then return cur :: GuiObject end
	local name = path:match("[^.]+$")
	if name then
		local f = game:GetService("StarterGui"):FindFirstChild(name, true)
		if f and f:IsA("GuiObject") then return f :: GuiObject end
	end
	return nil
end

local function fallbackStyle(args: any): any
	local targetPath: string = tostring(args.target or args.gui or "")
	if targetPath == "" then return { ok=false, fallback=true, error="Missing target", hint="Provide GuiObject path e.g. StarterGui.ShopGui.Frame" } end
	local target = resolveGui(targetPath)
	if not target then return { ok=false, fallback=true, error="Target not found: "..targetPath } end
	local theme: string = tostring(args.theme or "dark")
	local radius: number = tonumber(args.cornerRadius) or 8
	local addStroke: boolean = if args.addStroke == nil then true else args.addStroke == true
	local addShadow: boolean = args.addShadow == true
	local useGradient: boolean = args.gradient == true

	local palette: {[string]: Color3} = {
		dark = Color3.fromRGB(32,33,36),
		light = Color3.fromRGB(245,245,245),
		neon = Color3.fromRGB(0, 255, 170),
		glass = Color3.fromRGB(40,40,50),
	}
	local bg = palette[theme] or palette.dark

	local function styleOne(go: GuiObject)
		go.BackgroundColor3 = bg
		if theme == "glass" then go.BackgroundTransparency = 0.2 end
		if not go:FindFirstChild("UICorner") then
			local c = Instance.new("UICorner")
			c.CornerRadius = UDim.new(0, radius)
			c.Parent = go
		end
		if not go:FindFirstChild("UIPadding") then
			local p = Instance.new("UIPadding")
			p.PaddingTop = UDim.new(0, 8)
			p.PaddingBottom = UDim.new(0, 8)
			p.PaddingLeft = UDim.new(0, 8)
			p.PaddingRight = UDim.new(0, 8)
			p.Parent = go
		end
		if addStroke and not go:FindFirstChild("UIStroke") then
			local s = Instance.new("UIStroke")
			s.Thickness = 1
			s.Transparency = 0.5
			s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
			s.Color = Color3.fromRGB(255,255,255)
			s.Parent = go
		end
		if useGradient and not go:FindFirstChild("UIGradient") then
			local g = Instance.new("UIGradient")
			g.Color = ColorSequence.new({ColorSequenceKeypoint.new(0, bg), ColorSequenceKeypoint.new(1, Color3.fromRGB(80, 80, 90))})
			g.Rotation = 90
			g.Parent = go
		end
		if addShadow and not go:FindFirstChild("UIShadow") then
			-- UIShadow may not exist in all versions; fallback to soft stroke shadow via extra Frame
			-- We just note shadow requested; real shadow via plugin would be richer
		end
	end

	-- If target is container ScreenGui, style all descendants recursively
	if target:IsA("ScreenGui") then
		local count = 0
		for _, desc in ipairs(target:GetDescendants()) do if desc:IsA("GuiObject") then styleOne(desc :: GuiObject); count+=1 end end
		return { ok=true, fallback=true, styled=count, target=target:GetFullName(), theme=theme }
	else
		styleOne(target)
		return { ok=true, fallback=true, styled=1, target=target:GetFullName(), theme=theme }
	end
end

local function fallbackIcon(args: any): any
	local parentPath: string = tostring(args.parent or "")
	local iconId: string = tostring(args.iconId or "")
	if parentPath == "" or iconId == "" then return { ok=false, fallback=true, error="Missing parent/iconId" } end
	local parent = resolveGui(parentPath)
	if not parent then return { ok=false, fallback=true, error="Parent not found: "..parentPath } end
	local icon = Instance.new("ImageLabel")
	icon.Name = "Icon_" .. iconId:sub(-6)
	icon.Image = if iconId:find("rbxasset") then iconId else "rbxassetid://"..iconId
	icon.ScaleType = Enum.ScaleType.Fit
	icon.BackgroundTransparency = 1
	local sz: any = args.size
	if typeof(sz) == "table" then
		local a: any = sz
		icon.Size = UDim2.fromOffset(tonumber(a[1]) or 32, tonumber(a[2]) or 32)
	else
		icon.Size = UDim2.fromOffset(32, 32)
	end
	icon.Parent = parent
	return { ok=true, fallback=true, icon=icon:GetFullName(), parent=parent:GetFullName() }
end

local function fallbackButton(args: any): any
	local parentPath: string = tostring(args.parent or "")
	local text: string = tostring(args.text or "Button")
	if parentPath == "" then return { ok=false, fallback=true, error="Missing parent" } end
	local parent = resolveGui(parentPath)
	if not parent then
		-- Try StarterGui root parent
		parent = game:GetService("StarterGui"):FindFirstChild(parentPath:match("[^.]+$") or parentPath) :: GuiObject?
		if not parent then return { ok=false, fallback=true, error="Parent not found: "..parentPath } end
	end
	local btn = Instance.new("TextButton")
	btn.Name = text:gsub("%s+","_") .. "Button"
	btn.Text = text
	btn.TextScaled = true
	btn.Font = Enum.Font.GothamBold
	btn.Size = if args.size and typeof(args.size)=="table" then (function() local a:any=args.size; return UDim2.fromOffset(tonumber(a[1])or 120, tonumber(a[2])or 40) end)() else UDim2.fromOffset(160, 44)
	btn.BackgroundColor3 = Color3.fromRGB(0,170,255)
	btn.TextColor3 = Color3.fromRGB(255,255,255)
	btn.Parent = parent
	-- Style it
	fallbackStyle({ target = btn:GetFullName(), theme = tostring(args.theme or "dark"), cornerRadius = 8, addStroke = true })
	if not btn:FindFirstChild("UITextSizeConstraint") then
		local tc = Instance.new("UITextSizeConstraint")
		tc.MinTextSize = 10
		tc.MaxTextSize = 24
		tc.Parent = btn
	end
	return { ok=true, fallback=true, button=btn:GetFullName(), parent=parent:GetFullName() }
end

bridge.registerHandler("interfacetools", "Styled UI components (instant polish)", "InterfaceTools not installed — falling back to Luau UICorner/UIPadding/UIStroke.", function(args: any)
	local api = getInterfaceToolsApi()
	if api == nil then return fallbackStyle(args) end
	local ok, res = pcall(function()
		if typeof(api)=="table" and (api :: any).style then return (api :: any).style(args) else return fallbackStyle(args) end
	end)
	if not ok then warn("[InterfaceTools] plugin failed: "..tostring(res).." — fallback"); return fallbackStyle(args) end
	return res
end)

bridge.registerHandler("interfacetools:style", "Style GuiObject", "Fallback UICorner", function(args:any) return fallbackStyle(args) end)
bridge.registerHandler("interfacetools:icon", "Insert icon", "Fallback ImageLabel", function(args:any) return fallbackIcon(args) end)
bridge.registerHandler("interfacetools:button", "Create styled button", "Fallback TextButton", function(args:any) return fallbackButton(args) end)
-- Aliases for shorthand names used by LLM
bridge.registerHandler("icon", "Icon helper (alias)", "Fallback", function(args:any) return fallbackIcon(args) end)

print("[InterfaceTools] wrapper registered")

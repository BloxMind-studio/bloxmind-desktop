-- LoadCharacter Wrapper — load/configure avatar rigs R6/R15 with Animator integrity
-- Fallback creates Humanoid rig via Players service when plugin missing

local bridge = _G.BloxMindPluginBridge
if not bridge then warn("[LoadCharacter] Bridge missing"); return end

local function getLoadCharApi(): any?
	local c: {any} = { rawget(_G, "LoadCharacter"), rawget(_G, "LoadChar"), rawget(getgenv and getgenv() or _G, "LoadCharacterAPI") }
	for _, v in ipairs(c) do if v~=nil then return v end end
	return nil
end

local function fallbackLoad(args: any): any
	local rigType: string = tostring(args.rigType or "R15")
	local assetId: number? = tonumber(args.assetId)
	local descriptionId: number? = tonumber(args.descriptionId)
	local cframeArr: any = args.cframe or args.position
	local parentPath: string = tostring(args.parent or "workspace")
	local parent: Instance = workspace
	if parentPath ~= "workspace" then
		local cur: Instance? = game
		for seg in string.gmatch(parentPath:gsub("^game%.",""), "[^.]+") do if not cur then break end; cur = cur:FindFirstChild(seg) end
		if cur then parent = cur end
	end
	local cf: CFrame = CFrame.new(0,5,0)
	if typeof(cframeArr)=="table" then
		local a:any=cframeArr
		cf = CFrame.new(tonumber(a[1]) or 0, tonumber(a[2]) or 5, tonumber(a[3]) or 0)
	end

	local model: Model? = nil
	local attempt: string = ""
	-- Try HumanoidDescription path
	if descriptionId then
		local ok, res = pcall(function()
			local humDesc = game:GetService("Players"):GetHumanoidDescriptionFromUserId(descriptionId)
			humDesc = humDesc or Instance.new("HumanoidDescription")
			return game:GetService("Players"):CreateHumanoidModelFromDescription(humDesc, Enum.HumanoidRigType[rigType] or Enum.HumanoidRigType.R15)
		end)
		if ok and typeof(res)=="Instance" and (res :: Instance):IsA("Model") then model = res :: Model; attempt="CreateHumanoidModelFromDescription" else
			-- Fallback simple dummy
			attempt = "description failed: "..tostring(res)
		end
	end
	if not model and assetId then
		local ok, res = pcall(function() return game:GetService("InsertService"):LoadAsset(assetId) end)
		if ok and typeof(res)=="Instance" then
			local m = (res :: Instance):FindFirstChildOfClass("Model") or (res :: Instance)
			if m and m:IsA("Model") then model = m :: Model; attempt="InsertService:LoadAsset" end
		end
	end
	if not model then
		-- Create dummy R15/R6
		local ok, res = pcall(function()
			local desc = Instance.new("HumanoidDescription")
			-- Keep defaults
			return game:GetService("Players"):CreateHumanoidModelFromDescription(desc, Enum.HumanoidRigType[rigType] or Enum.HumanoidRigType.R15)
		end)
		if ok and typeof(res)=="Instance" and (res :: Instance):IsA("Model") then model=res :: Model; attempt="dummy R15" else attempt="create failed" end
	end
	if not model then return { ok=false, fallback=true, error="Failed to create rig: "..attempt } end

	model:PivotTo(cf)
	-- Ensure Humanoid rigType
	local hum: Humanoid? = model:FindFirstChildOfClass("Humanoid")
	if hum then
		pcall(function() hum.RigType = (Enum.HumanoidRigType :: any)[rigType] or Enum.HumanoidRigType.R15 end)
		if not hum:FindFirstChild("Animator") then local a=Instance.new("Animator"); a.Parent=hum end
		-- Ensure PrimaryPart
		if not model.PrimaryPart then
			local hrp = model:FindFirstChild("HumanoidRootPart")
			if hrp then model.PrimaryPart = hrp :: BasePart end
		end
	end
	model.Parent = parent
	return { ok=true, fallback=true, rig=model:GetFullName(), rigType=rigType, attempt=attempt, cframe=tostring(cf), parent=parent:GetFullName() }
end

local function fallbackSetup(args:any): any
	local charPath: string = tostring(args.characterPath or "")
	local rigType: string = tostring(args.rigType or "R15")
	local char: Model? = nil
	if charPath ~= "" then
		local cur:Instance?=game
		for seg in string.gmatch(charPath:gsub("^game%.",""), "[^.]+") do if not cur then break end; cur=cur:FindFirstChild(seg) end
		if cur and cur:IsA("Model") then char=cur :: Model end
	end
	if not char then char = workspace:FindFirstChild("Rig") :: Model? end
	if not char then return { ok=false, fallback=true, error="Character not found: "..charPath } end
	local hum: Humanoid? = char:FindFirstChildOfClass("Humanoid")
	if not hum then return { ok=false, fallback=true, error="No Humanoid in "..char:GetFullName() } end
	if not hum:FindFirstChild("Animator") then local a=Instance.new("Animator"); a.Parent=hum end
	local joints:{{Name:string, Type:string}}={}
	for _,d in ipairs(char:GetDescendants()) do if d:IsA("Motor6D") or d:IsA("AnimationConstraint") then table.insert(joints, {Name=d.Name, Type=d.ClassName}) end end
	-- Also via part:GetJoints() dual check
	for _, part in ipairs(char:GetDescendants()) do if part:IsA("BasePart") then local ok,list=pcall(function() return (part :: BasePart):GetJoints() end); if ok and typeof(list)=="table" then for _,j in ipairs(list :: any) do if typeof(j)=="Instance" and (j:IsA("Motor6D") or j:IsA("AnimationConstraint")) then local found=false; for _,ej in ipairs(joints) do if ej.Name==j.Name and ej.Type==j.ClassName then found=true; break end end; if not found then table.insert(joints,{Name=j.Name, Type=j.ClassName}) end end end end end end
	return { ok=true, fallback=true, character=char:GetFullName(), rigType=rigType, joints=joints, traversal="Motor6D+AnimationConstraint" }
end

bridge.registerHandler("loadcharacter", "Load avatar rig R6/R15", "LoadCharacter plugin not installed — falling back to Players:CreateHumanoidModelFromDescription.", function(args:any)
	local api=getLoadCharApi()
	if api==nil then return fallbackLoad(args) end
	local ok,res=pcall(function() if typeof(api)=="table" and (api :: any).load then return (api :: any).load(args) else return fallbackLoad(args) end end)
	if not ok then warn("[LoadCharacter] plugin failed: "..tostring(res).." — fallback"); return fallbackLoad(args) end
	return res
end)
bridge.registerHandler("loadcharacter:load", "Load rig", "Fallback create", function(args:any) return fallbackLoad(args) end)
bridge.registerHandler("loadcharacter:setup", "Ensure Animator/Motor6D", "Fallback setup", function(args:any) return fallbackSetup(args) end)
bridge.registerHandler("loadchar", "Alias", "Fallback", function(args:any) return fallbackLoad(args) end)

print("[LoadCharacter] wrapper registered")

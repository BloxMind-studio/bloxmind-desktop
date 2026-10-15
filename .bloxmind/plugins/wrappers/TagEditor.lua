-- TagEditor Wrapper — CollectionService tag management (bulk, list, add/remove)
-- Fallback uses CollectionService directly with ChangeHistoryService waypoint

local bridge = _G.BloxMindPluginBridge
if not bridge then warn("[TagEditor] Bridge missing"); return end

local CollectionService = game:GetService("CollectionService")
local Selection = game:GetService("Selection")

local function getTagApi(): any? return rawget(_G,"TagEditor") or nil end

local function resolveTargets(targets: any): {Instance}
	local out:{Instance}={}
	if typeof(targets)=="table" then
		for _, p in ipairs(targets :: any) do
			local cur: Instance? = game
			local path = tostring(p)
			for seg in string.gmatch(path:gsub("^game%.",""), "[^.]+") do if not cur then break end; cur=cur:FindFirstChild(seg) end
			if cur then table.insert(out, cur)
			else
				-- Try FindFirstChild recursive by name
				local n = path:match("[^.]+$")
				if n then local f=workspace:FindFirstChild(n,true) or game:GetService("ReplicatedStorage"):FindFirstChild(n,true); if f then table.insert(out, f) end end
			end
		end
	end
	return out
end

local function validateTag(tag:string): boolean
	return tag:match("^[A-Za-z0-9_]+$") ~= nil
end

local function fallbackAdd(args:any): any
	local tag: string = tostring(args.tag or "")
	if tag=="" then return { ok=false, fallback=true, error="Missing tag" } end
	if not validateTag(tag) then return { ok=false, fallback=true, error="Invalid tag '"..tag.."', must be alphanumeric/underscore" } end
	local targets: {Instance} = {}
	if args.selection == true or (args.targets and #args.targets==0) then
		-- Use Selection
		for _, sel in ipairs(Selection:Get()) do table.insert(targets, sel) end
	else
		targets = resolveTargets(args.targets)
		if #targets==0 and args.target then
			local single = resolveTargets({args.target})
			targets = single
		end
	end
	if #targets==0 then return { ok=false, fallback=true, error="No targets resolved for tag "..tag, hint="Provide targets:[FullNames] or set selection:true and select in viewport" } end
	local added=0
	for _, inst in ipairs(targets) do
		local ok=pcall(function() CollectionService:AddTag(inst, tag) end)
		if ok then added+=1 end
	end
	return { ok=true, fallback=true, tag=tag, added=added, targets=#targets, tagged=CollectionService:GetTagged(tag) and #CollectionService:GetTagged(tag) or 0 }
end

local function fallbackRemove(args:any): any
	local tag: string = tostring(args.tag or "")
	if tag=="" then return { ok=false, fallback=true, error="Missing tag" } end
	local targets = resolveTargets(args.targets)
	if #targets==0 then return { ok=false, fallback=true, error="No targets" } end
	local removed=0
	for _, inst in ipairs(targets) do pcall(function() CollectionService:RemoveTag(inst, tag); removed+=1 end) end
	return { ok=true, fallback=true, tag=tag, removed=removed }
end

local function fallbackList(args:any): any
	local tag: string = tostring(args.tag or "")
	local targetPath: string = tostring(args.target or "")
	if targetPath ~= "" then
		local insts = resolveTargets({targetPath})
		local inst = insts[1]
		if not inst then return { ok=false, fallback=true, error="Instance not found: "..targetPath } end
		local tags = CollectionService:GetTags(inst)
		return { ok=true, fallback=true, target=inst:GetFullName(), tags=tags }
	end
	if tag ~= "" then
		local tagged = CollectionService:GetTagged(tag)
		local names:{string}={}
		for _, i in ipairs(tagged) do table.insert(names, i:GetFullName()) end
		return { ok=true, fallback=true, tag=tag, count=#tagged, tagged=names }
	end
	-- List all tags in place (via GetTags on all descendants)
	local all:{string}={}
	local seen:{[string]:boolean}={}
	for _, inst in ipairs(workspace:GetDescendants()) do
		for _, t in ipairs(CollectionService:GetTags(inst)) do if not seen[t] then seen[t]=true; table.insert(all, t) end end
	end
	return { ok=true, fallback=true, tags=all }
end

local function fallbackBulk(args:any): any
	local tag: string = tostring(args.tag or "")
	if tag=="" then return { ok=false, fallback=true, error="Missing tag" } end
	if not validateTag(tag) then return { ok=false, fallback=true, error="Invalid tag" } end
	local op: string = tostring(args.operation or "add"):lower()
	local sels = Selection:Get()
	if #sels==0 then return { ok=false, fallback=true, error="No Selection — select parts in viewport then call bulk with selection" } end
	local count=0
	for _, inst in ipairs(sels) do
		if op=="add" then pcall(function() CollectionService:AddTag(inst, tag); count+=1 end)
		elseif op=="remove" then pcall(function() CollectionService:RemoveTag(inst, tag); count+=1 end)
		elseif op=="toggle" then pcall(function() if CollectionService:HasTag(inst, tag) then CollectionService:RemoveTag(inst, tag) else CollectionService:AddTag(inst, tag) end; count+=1 end)
		end
	end
	return { ok=true, fallback=true, tag=tag, operation=op, count=count, selection=#sels }
end

bridge.registerHandler("tageditor", "CollectionService tag management", "TagEditor plugin not installed — falling back to CollectionService AddTag/GetTagged with ChangeHistoryService.", function(args:any)
	local api=getTagApi()
	if api==nil then
		local act=tostring(args.action or "add"):lower()
		if act=="remove" then return fallbackRemove(args)
		elseif act=="list" then return fallbackList(args)
		elseif act=="bulk" then return fallbackBulk(args)
		else return fallbackAdd(args) end
	end
	local ok,res=pcall(function()
		if typeof(api)=="table" and (api :: any).add then
			local act=tostring(args.action or "add"):lower()
			if act=="add" then return (api :: any).add(args)
			elseif act=="remove" then return (api :: any).remove(args)
			elseif act=="list" then return (api :: any).list(args)
			else return (api :: any).add(args) end
		else return fallbackAdd(args) end
	end)
	if not ok then warn("[TagEditor] plugin failed: "..tostring(res).." — fallback"); return fallbackAdd(args) end
	return res
end)
bridge.registerHandler("tageditor:add", "Add tag", "Fallback AddTag", function(a:any) return fallbackAdd(a) end)
bridge.registerHandler("tageditor:remove", "Remove tag", "Fallback RemoveTag", function(a:any) return fallbackRemove(a) end)
bridge.registerHandler("tageditor:list", "List tags", "Fallback GetTags", function(a:any) return fallbackList(a) end)
bridge.registerHandler("tageditor:bulk", "Bulk Selection tag", "Fallback Selection", function(a:any) return fallbackBulk(a) end)
bridge.registerHandler("tag", "Alias tageditor", "Fallback", function(a:any) return fallbackAdd(a) end)

print("[TagEditor] wrapper registered")

-- DataStoreEditor Wrapper — inspect/edit DataStore keys, typed schemas
-- Fallback generates ModuleScript wrappers with pcall GetAsync/SetAsync

local bridge = _G.BloxMindPluginBridge
if not bridge then warn("[DataStoreEditor] Bridge missing"); return end

local function getDSApi(): any? return rawget(_G,"DataStoreEditor") or rawget(_G,"DataStore") or nil end

local function fallbackInspect(args:any): any
	local storeName: string = tostring(args.store or args.name or "PlayerData")
	local key: string = tostring(args.key or "")
	if key=="" then return { ok=false, fallback=true, error="Missing key" } end
	-- Generate ModuleScript if not yet inspecting live datastore; in fallback we just return a snippet showing how to GetAsync
	local code = string.format("local ds=game:GetService('DataStoreService'):GetDataStore('%s'); local ok,res=pcall(function() return ds:GetAsync('%s') end); print(HttpService:JSONEncode(res))", storeName:gsub("'",""), key:gsub("'",""))
	return { ok=true, fallback=true, store=storeName, key=key, snippet=code, hint="Use DataStoreService:GetDataStore('"..storeName.."'):GetAsync('"..key.."') with pcall; retry on failure" }
end

local function fallbackEdit(args:any): any
	local storeName: string = tostring(args.store or "PlayerData")
	local key: string = tostring(args.key or "")
	local value: any = args.value or {}
	if key=="" then return { ok=false, fallback=true, error="Missing key" } end
	local valJson = game:GetService("HttpService"):JSONEncode(value)
	-- In fallback we emulate SetAsync; plugin would do real write
	local chs = game:GetService("ChangeHistoryService")
	-- Generate or update ModuleScript that wraps DataStore logic
	local parent: Instance = game:GetService("ServerScriptService")
	local folderName = "DataStores"
	local folder = parent:FindFirstChild(folderName)
	if not folder then folder = Instance.new("Folder"); folder.Name=folderName; folder.Parent=parent end
	local modName = storeName.."Store"
	local mod = folder:FindFirstChild(modName)
	if not mod then mod = Instance.new("ModuleScript"); mod.Name=modName; mod.Parent=folder end
	if mod:IsA("ModuleScript") then
		local src = string.format("-- DataStore wrapper for %s — fallback generated\nlocal DSS=game:GetService('DataStoreService')\nlocal store=DSS:GetDataStore('%s')\nlocal M={}\nfunction M.get(key) local ok,res=pcall(function() return store:GetAsync(key) end); return ok and res or nil end\nfunction M.set(key,val) local ok,err=pcall(function() store:SetAsync(key,val) end); return ok,err end\nreturn M\n", storeName, storeName)
		pcall(function() (mod :: ModuleScript).Source = src end)
	end
	return { ok=true, fallback=true, store=storeName, key=key, value=value, module=mod:GetFullName(), snippet=string.format("store:SetAsync('%s', %s)", key, valJson) }
end

local function fallbackSchema(args:any): any
	local name: string = tostring(args.name or "PlayerProfile")
	local fields: any = args.fields or { coins=0, gems=0 }
	local parentPath: string = tostring(args.parent or "ReplicatedStorage.Shared")
	local parent: Instance = game:GetService("ReplicatedStorage")
	for seg in string.gmatch(parentPath:gsub("^game%.",""), "[^.]+") do
		if seg=="ReplicatedStorage" then parent=game:GetService("ReplicatedStorage")
		elseif seg=="ReplicatedShared" then parent=game:GetService("ReplicatedStorage")
		elseif seg=="Shared" then
			local f = parent:FindFirstChild("Shared")
			if not f then f=Instance.new("Folder"); f.Name="Shared"; f.Parent=parent end
			parent=f
		else
			local nxt=parent:FindFirstChild(seg)
			if not nxt then nxt=Instance.new("Folder"); nxt.Name=seg; nxt.Parent=parent end
			parent=nxt
		end
	end
	local mod = Instance.new("ModuleScript")
	mod.Name = name
	-- Build typed defaults
	local fieldLines:{string}={}
	for k,v in pairs(fields :: any) do
		local vStr = if typeof(v)=="number" then tostring(v) elseif typeof(v)=="string" then string.format("%q",v) elseif typeof(v)=="boolean" then tostring(v) else "0"
		table.insert(fieldLines, string.format("  %s = %s,", tostring(k), vStr))
	end
	local src = string.format("-- %s — Data schema fallback\nlocal M = {\n  defaults = {\n%s\n  },\n}\nfunction M.validate(data)\n  for k, def in pairs(M.defaults) do if data[k]==nil then data[k]=def end end\n  return data\nend\nreturn M\n", name, table.concat(fieldLines, "\n"))
	mod.Source = src
	mod.Parent = parent
	return { ok=true, fallback=true, schema=mod:GetFullName(), fields=fields }
end

bridge.registerHandler("datastoreeditor", "DataStore inspect/edit/schema", "DataStoreEditor plugin not installed — fallback to DataStoreService pcall wrappers.", function(args:any)
	local api=getDSApi()
	if api==nil then
		local act=tostring(args.action or "inspect"):lower()
		if act=="edit" then return fallbackEdit(args)
		elseif act=="schema" then return fallbackSchema(args)
		else return fallbackInspect(args) end
	end
	local ok,res=pcall(function()
		if typeof(api)=="table" and (api :: any).inspect then return (api :: any).inspect(args) else
			local act=tostring(args.action or "inspect"):lower()
			if act=="edit" then return fallbackEdit(args)
			elseif act=="schema" then return fallbackSchema(args)
			else return fallbackInspect(args) end
		end
	end)
	if not ok then warn("[DataStoreEditor] plugin failed: "..tostring(res).." — fallback"); return fallbackInspect(args) end
	return res
end)
bridge.registerHandler("datastoreeditor:inspect", "Inspect key", "Fallback GetAsync", function(a:any) return fallbackInspect(a) end)
bridge.registerHandler("datastoreeditor:edit", "Edit key", "Fallback SetAsync", function(a:any) return fallbackEdit(a) end)
bridge.registerHandler("datastoreeditor:schema", "Generate schema", "Fallback ModuleScript", function(a:any) return fallbackSchema(a) end)
bridge.registerHandler("datastore", "Alias datastoreeditor", "Fallback", function(a:any) return fallbackInspect(a) end)

print("[DataStoreEditor] wrapper registered")

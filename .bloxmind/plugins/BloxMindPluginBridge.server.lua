-- BloxMind Studio Bridge Plugin
-- Runs in Studio's privileged plugin context. Listens for MCP calls from
-- BloxMind via a BindableFunction / HttpService bridge and executes plugin
-- actions through ChangeHistoryService so every change is undo/redo aware.
-- Falls back gracefully when a target plugin is not installed.

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")

-- Plugin entry: this script is expected to run as a Plugin Script (server context inside Studio)
-- `plugin` global is available in Studio plugin environment.
local pluginInstance: Plugin? = (getgenv and rawget(getgenv(), "plugin")) or ( _G and rawget(_G, "plugin")) or nil
-- For typechecker fallback, treat `plugin` global directly
if pluginInstance == nil and plugin ~= nil then
	pluginInstance = plugin :: any
end

local BRIDGE_NAME = "BloxMindPluginBridge"
local WAYPOINT_BASE = "BloxMind:"

-- Registry of available handlers (filled by wrappers below)
local handlers: {[string]: (args: any) -> any} = {}
local handlerMeta: {[string]: {description: string, fallback: string}} = {}

local function tryBeginRecording(name: string)
	-- ChangeHistoryService: SetWaypoint + TryBeginRecording pattern
	local ok, err = pcall(function()
		ChangeHistoryService:TryBeginRecording(WAYPOINT_BASE .. name)
	end)
	if not ok then
		warn("[BloxMindBridge] TryBeginRecording failed: " .. tostring(err))
	end
end

local function finishRecording(name: string)
	local ok, err = pcall(function()
		ChangeHistoryService:FinishRecording(WAYPOINT_BASE .. name)
	end)
	if not ok then
		warn("[BloxMindBridge] FinishRecording failed: " .. tostring(err))
		pcall(function()
			ChangeHistoryService:SetWaypoint(WAYPOINT_BASE .. name .. ":fallback")
		end)
	end
	-- Always ensure a waypoint exists for undo
	pcall(function()
		ChangeHistoryService:SetWaypoint(WAYPOINT_BASE .. name)
	end)
end

local function withHistory<T>(name: string, fn: () -> T): (boolean, T | string)
	tryBeginRecording(name)
	local success, result = pcall(fn)
	if success then
		finishRecording(name)
	else
		-- Cancel recording but still set waypoint for error trace
		pcall(function() ChangeHistoryService:FinishRecording(WAYPOINT_BASE .. name .. ":error") end)
		warn("[BloxMindBridge] handler " .. name .. " failed: " .. tostring(result))
	end
	return success, result
end

-- Public: register a plugin wrapper
local function registerHandler(name: string, description: string, fallbackHint: string, fn: (args: any) -> any)
	handlers[name:lower()] = fn
	handlerMeta[name:lower()] = { description = description, fallback = fallbackHint }
end

-- ---------------------------------------------------------------------------
-- MCP Bridge Interface
-- Two transport options:
--  1) BindableFunction (in-process MCP) — fastest, preferred inside Studio MCP server
--  2) HttpService poll (fallback) — plugin polls localhost broker if enabled
-- ---------------------------------------------------------------------------

local bridgeFolder: Folder? = nil
local callFunction: BindableFunction? = nil
local responseEvent: BindableEvent? = nil

local function ensureBridgeObjects(): ()
	if bridgeFolder and bridgeFolder.Parent then return end
	local existing = game:GetService("ReplicatedStorage"):FindFirstChild(BRIDGE_NAME)
	if existing and existing:IsA("Folder") then
		bridgeFolder = existing :: Folder
	else
		bridgeFolder = Instance.new("Folder")
		bridgeFolder.Name = BRIDGE_NAME
		bridgeFolder.Parent = game:GetService("ReplicatedStorage")
	end

	local fn = bridgeFolder:FindFirstChild("InvokePlugin")
	if fn and fn:IsA("BindableFunction") then
		callFunction = fn :: BindableFunction
	else
		callFunction = Instance.new("BindableFunction")
		callFunction.Name = "InvokePlugin"
		callFunction.Parent = bridgeFolder
	end

	local ev = bridgeFolder:FindFirstChild("PluginResponse")
	if ev and ev:IsA("BindableEvent") then
		responseEvent = ev :: BindableEvent
	else
		responseEvent = Instance.new("BindableEvent")
		responseEvent.Name = "PluginResponse"
		responseEvent.Parent = bridgeFolder
	end
end

-- Core invoke — called by MCP tool `use_roblox_plugin`
-- payload: { plugin: string, action: string, args: table }
local function invokePlugin(payload: any): any
	local pluginName = ""
	local action = ""
	local args: any = {}
	if typeof(payload) == "table" then
		pluginName = tostring((payload :: any).plugin or (payload :: any).pluginName or (payload :: any).tool or "")
		action = tostring((payload :: any).action or "")
		args = (payload :: any).args or (payload :: any).params or (payload :: any).arguments or {}
	end
	if pluginName == "" then
		return { ok = false, fallback = true, error = "Missing 'plugin' field", hint = "Use one of: brushtool, archimedes, gapfill, f3x" }
	end
	local key = pluginName:lower()
	-- Support keys like "brushtool" and actions like "paint" -> composite lookup "brushtool:paint"
	local composite = key .. (if action ~= "" then ":" .. action:lower() else "")
	local handler = handlers[composite] or handlers[key]
	if handler == nil then
		local meta = handlerMeta[key]
		local hint = if meta then meta.fallback else "Plugin '" .. pluginName .. "' not installed or not active; falling back to Luau generation."
		return {
			ok = false,
			fallback = true,
			error = "Plugin '" .. pluginName .. "' not available. Handler missing for '" .. composite .. "'",
			hint = hint,
			available = (function()
				local list: {string} = {}
				for k in pairs(handlers) do table.insert(list, k) end
				return list
			end)(),
		}
	end

	local waypointName = pluginName .. (if action ~= "" then "." .. action else "")
	local success, result = withHistory(waypointName, function()
		return handler(args)
	end)

	if success then
		return { ok = true, fallback = false, plugin = pluginName, action = action, result = result }
	else
		local meta = handlerMeta[key]
		return {
			ok = false,
			fallback = true,
			error = tostring(result),
			hint = if meta then meta.fallback else "Handler threw; use Luau fallback generation.",
			plugin = pluginName,
			action = action,
		}
	end
end

-- Bind the BindableFunction for Studio MCP server to call directly
local function bindFunction()
	ensureBridgeObjects()
	if callFunction then
		callFunction.OnInvoke = function(payload: any)
			-- Decode JSON string payloads from MCP
			if typeof(payload) == "string" then
				local ok, decoded = pcall(HttpService.JSONDecode, HttpService, payload)
				if ok then payload = decoded end
			end
			local res = invokePlugin(payload)
			return HttpService:JSONEncode(res)
		end
	end
end

-- Attempt bind, retry if Studio loads late
pcall(bindFunction)
task.delay(1, function() pcall(bindFunction) end)

-- Expose for wrappers
_G.BloxMindPluginBridge = {
	registerHandler = registerHandler,
	invokePlugin = invokePlugin,
	withHistory = withHistory,
	tryBeginRecording = tryBeginRecording,
	finishRecording = finishRecording,
	handlers = handlers,
	handlerMeta = handlerMeta,
}

print("[BloxMindPluginBridge] initialized with " .. tostring(bridgeFolder and bridgeFolder:GetFullName() or "pending") .. " handlers=" .. HttpService:JSONEncode((function()
	local keys: {string} = {}
	for k in pairs(handlers) do table.insert(keys, k) end
	return keys
end)()))

return _G.BloxMindPluginBridge

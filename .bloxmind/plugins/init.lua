-- BloxMind Plugins Init — loads bridge + all wrappers in order
-- Studio should require this single entry point as a Plugin script.

local bridge = require(script.Parent:WaitForChild("BloxMindPluginBridge"))

-- Load wrappers (each self-registers onto _G.BloxMindPluginBridge)
local wrappersFolder = script.Parent:FindFirstChild("wrappers")
if wrappersFolder then
	for _, mod in ipairs(wrappersFolder:GetChildren()) do
		if mod:IsA("ModuleScript") or mod:IsA("Script") then
			local ok, err = pcall(require, mod)
			if not ok then
				warn("[BloxMindPlugins] failed to load wrapper " .. mod.Name .. ": " .. tostring(err))
				-- Also try executing as script chunk if require fails (for .lua Script wrappers)
				pcall(function() loadstring(mod.Source or "")() end)
			end
		end
	end
end

-- Also load any .lua files that were imported as Script types via loadstring fallback
-- (wrappers are plain Script files, not ModuleScripts, so require may fail — we handle that)

print("[BloxMindPlugins] all wrappers loaded, handlers:", game:GetService("HttpService"):JSONEncode((function()
	local keys = {}
	for k in pairs((_G.BloxMindPluginBridge or {}).handlers or {}) do table.insert(keys, k) end
	return keys
end)()))
return bridge

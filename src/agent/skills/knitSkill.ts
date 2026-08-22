/**
 * Structural prompt context for the Knit client/server framework
 * (github.com/Sleitnick/Knit). Packed by electron/agentSkills.ts into
 * `.opencode/skills/roblox-knit/SKILL.md` so the agent loads it on demand.
 */
export const KNIT_SKILL: { readonly relativePath: string; readonly content: string } = {
  relativePath: ".opencode/skills/roblox-knit/SKILL.md",
  content: `---
name: roblox-knit
description: Build Roblox systems with the Knit framework (Sleitnick) — standard Service and Controller structure, Client-server remotes, shared modules, and Wally integration. Use for any request that names Knit, services, controllers, or a client-server framework for gameplay systems.
license: MIT
---

# Knit Framework (Client/Server Architecture)

Knit splits a Roblox system into **Services** (authoritative server logic) and
**Controllers** (client-side input, UI, and presentation). The server is the
source of truth; the client never owns gameplay state. For any system built on
Knit, generate this standard structure and keep the two realms cleanly
separated.

## Wally wiring (do this whenever the system relies on a package)

1. Add the dependency to \`wally.toml\`:

\`\`\`toml
[dependencies]
Knit = "sleitnick/knit@2.0.0"
\`\`\`

2. Ensure \`default.project.json\` mounts the installed package folder at
   \`ReplicatedStorage/Packages\` so server and client can \`require\` Knit:

\`\`\`json
{
  "ReplicatedStorage": {
    "$path": "src/ReplicatedStorage",
    "Packages": { "$path": "Packages" }
  }
}
\`\`\`

3. If wally.toml or the Packages mount does not already exist, create or update
   them as part of the change — never leave the system referencing a package
   that is not declared.

## Standard project layout (Rojo pathing)

- Shared modules (types, config, datamodels) → \`src/\` → ReplicatedStorage
- Service modules → \`server/ServerScriptService/Services/\` → ServerScriptService
- Bootstrapper script (server) → \`server/ServerScriptService/\` → ServerScriptService
- Controller modules → \`client/StarterPlayerScripts/Controllers/\` → StarterPlayerScripts
- Bootstrapper script (client) → \`client/StarterPlayerScripts/\` → StarterPlayerScripts

## Server bootstrapper (Script)

Require every service module BEFORE \`Knit.Start()\`; Knit does not auto-scan
ServerScriptService:

\`\`\`lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Knit = require(ReplicatedStorage.Packages.Knit)

require(script.Parent.Services.InventoryService)
require(script.Parent.Services.EconomyService)

Knit.Start()
\`\`\`

## Standard Service structure (ModuleScript)

\`\`\`lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Knit = require(ReplicatedStorage.Packages.Knit)

local InventoryService = Knit.CreateService({
	Name = "InventoryService",
	Client = {
		GetInventory = Knit.CreateRemote("GetInventory"),
		InventoryChanged = Knit.CreateRemote("InventoryChanged", "BindableEvent"),
	},
})

function InventoryService:KnitStart()
	-- Authoritative setup: load data, register events, start loops.
end

-- Handles the client call InventoryService.Client.GetInventory:Request()
function InventoryService:Client_GetInventory(player)
	return self:GetInventoryFor(player)
end

-- Server → client push: InventoryService.Client.InventoryChanged:Fire(player, data)

return InventoryService
\`\`\`

Rules:
- In its minimal form a service is created as \`Knit.CreateService({ Name = "MyService", Client = {} })\`;
  grow the \`Client\` table with remotes as the API expands.
- \`Name\` matches the module name (\`InventoryService\`) and ends in \`Service\`.
- Expose client-callable endpoints under \`Client\` via \`Knit.CreateRemote\`
  (default \`"BindableFunction"\` for request/response; pass
  \`"BindableEvent"\` for one-way events). The matching server handler is a
  method prefixed \`Client_\`.
- Keep all authoritative state and DataStore access inside the service.

## Standard Controller structure (ModuleScript)

\`\`\`lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Knit = require(ReplicatedStorage.Packages.Knit)

local InventoryController = Knit.CreateController({ Name = "InventoryController" })
local InventoryService = Knit.GetService("InventoryService")

function InventoryController:KnitInit()
	-- Bind to service events before the game is fully interactive.
	InventoryService.Client.InventoryChanged:Connect(function(player, data)
		-- Update UI only for this player.
	end)
end

function InventoryController:KnitStart()
	-- Start UI flows, subscribe to input, fire first requests.
end

return InventoryController
\`\`\`

Rules:
- Controllers live under StarterPlayerScripts; Knit auto-discovers them on the
  client when \`Knit.Start()\` runs, so the client bootstrapper is just:

\`\`\`lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Knit = require(ReplicatedStorage.Packages.Knit)
Knit.Start()
\`\`\`

- Controllers only render, read input, and call service remotes. They never
  hold source-of-truth state, never touch DataStores, and never mutate state
  another controller owns.

## Separation of concerns checklist

- [ ] Server owns every authoritative value; client code only requests/presents
- [ ] \`Client_\` handlers validate the request (ownership, rate limits) before acting
- [ ] Shared types/constants live in a shared module required by both realms
- [ ] No controller writes to DataStores or the workspace directly
- [ ] \`Knit.Start()\` runs once per realm, after all services are required

## Verification

- Check \`wally.toml\` declares Knit and \`default.project.json\` mounts Packages
  at ReplicatedStorage; install any missing package before claiming success.
- Confirm the server bootstrapper requires every service before \`Knit.Start()\`.
- Exercise one \`Client_\` round trip (request → server → fire event) and confirm
  the controller receives it in the client realm.
`,
};

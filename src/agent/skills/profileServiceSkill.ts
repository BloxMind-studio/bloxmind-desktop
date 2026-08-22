/**
 * Structural prompt context for ProfileService (github.com/madstudioroblox/
 * ProfileService), the Roblox DataStore protection wrapper. Packed by
 * electron/agentSkills.ts into `.opencode/skills/roblox-profile-service/
 * SKILL.md` so the agent loads it on demand.
 */
export const PROFILE_SERVICE_SKILL: {
  readonly relativePath: string;
  readonly content: string;
} = {
  relativePath: ".opencode/skills/roblox-profile-service/SKILL.md",
  content: `---
name: roblox-profile-service
description: Persist player data safely with ProfileService (madstudioroblox) — session-locked profile stores, auto-saving, template reconciliation, and loss-proof loaders. Use for any save system, DataStore persistence, leaderboard stats, inventory, coins, or settings request.
license: MIT
---

# ProfileService (DataStore Protection)

ProfileService wraps Roblox DataStores so saves survive session-locking
conflicts and template changes. When a system needs persistent player data,
generate a data manager module that uses **session locking**, **auto-saving**,
and **fallback default profiles** to prevent data loss. Never touch DataStores
directly.

## Wally wiring (do this whenever the system relies on a package)

1. Add the dependency to \`wally.toml\`:

\`\`\`toml
[dependencies]
ProfileService = "madstudioroblox/profile-service@3.0.0"
\`\`\`

2. Ensure \`default.project.json\` mounts the installed package folder at
   \`ReplicatedStorage/Packages\` so scripts can \`require\` ProfileService:

\`\`\`json
{
  "ReplicatedStorage": {
    "$path": "src/ReplicatedStorage",
    "Packages": { "$path": "Packages" }
  }
}
\`\`\`

3. If wally.toml or the Packages mount does not already exist, create or update
   them as part of the change — never leave a save system referencing a package
   that is not declared.

## Data manager module (ModuleScript, server realm)

\`\`\`lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local ProfileService = require(ReplicatedStorage.Packages.ProfileService)

-- Fallback default profile: every key a player save needs, with safe defaults.
-- Missing keys are rebuilt from this template, preventing data loss when the
-- schema grows.
local ProfileTemplate = {
	Coins = 0,
	Inventory = {},
	Settings = { SoundVolume = 1 },
}

local DataStoreName = "PlayerData"
local profileStore = ProfileService.GetProfileStore(DataStoreName, ProfileTemplate)

local profiles = {} -- player -> Profile

local function loadProfile(player)
	local profile = profileStore:LoadProfileAsync(player.UserId)
	if not profile then
		-- Session-locked elsewhere (another server, or too many sessions):
		-- retry shortly instead of failing the player silently.
		task.delay(1, function()
			if player.Parent then loadProfile(player) end
		end)
		return
	end

	profile:AddUserId(player.UserId) -- extra session lock while playing
	profile:Reconcile() -- merge ProfileTemplate defaults into profile.Data

	profile:ListenToRelease(function()
		-- The store released this profile (save completed / claimed elsewhere).
		-- Stop using it immediately and clean up.
		profiles[player] = nil
		if player.Parent then
			player:Kick("Your data was moved to another server. Please rejoin.")
		end
	end)

	profiles[player] = profile
	-- Give the player their data (a copy is safer than handing out profile.Data).
	player:SetAttribute("DataReady", true)
end

Players.PlayerAdded:Connect(loadProfile)
Players.PlayerRemoving:Connect(function(player)
	local profile = profiles[player]
	if profile then
		profile:Release() -- auto-saves then releases; never lose this call
		profiles[player] = nil
	end
end)
\`\`\`

## Non-negotiable rules

- **Session locking**: \`LoadProfileAsync\` itself enforces one active profile
  per user across servers. Treat a \`nil\` profile as "locked elsewhere" — queue
  a retry (bounded), never fabricate a second profile for the same user.
  \`profile:AddUserId(player.UserId)\` adds a second lock key while active;
  always pair it with \`profile:RemoveUserId(player.UserId)\` before release.
- **Auto-saving**: ProfileService persists \`profile.Data\` automatically. Do
  NOT hand-roll periodic \`UpdateAsync\` writes. Mutate \`profile.Data\` freely,
  then let the store save — and always call \`profile:Release()\` when the player
  leaves so the final save is guaranteed.
- **Fallback defaults**: every system reads through \`profile.Data\`; call
  \`profile:Reconcile()\` right after load so schema additions fall back to
  \`ProfileTemplate\` defaults instead of producing \`nil\` lookups.
- **Release handling**: always register \`profile:ListenToRelease\`. A release can
  fire at any time (auto-save handoff, store conflict, server shutdown). After
  release, the profile is unusable — drop references immediately.
- **Read/write discipline**: mutate only \`profile.Data\`; never \`require\` a
  DataStore service or call DataStore methods directly. Validate values on
  write (numbers are finite, tables are the right shape) so a corrupt save from
  a bad build cannot take down the load path.

## Verification

- Check \`wally.toml\` declares ProfileService and \`default.project.json\`
  mounts Packages at ReplicatedStorage before calling the system done.
- Trace the player lifecycle: load on \`PlayerAdded\` (with retry on nil),
  \`Reconcile\` + lock on load, \`Release\` on \`PlayerRemoving\`, release listener
  registered once.
- Confirm every read of player data goes through \`profile.Data\` and no code
  touches the DataStore service directly.
`,
};

---
name: roblox-game-development
description: Use when writing, reviewing, or fixing Roblox gameplay code - Luau scripts and ModuleScripts, server/client architecture, RemoteEvents and RemoteFunctions, DataStores, inventory, currency, combat, and performance or exploit-safety problems. Not for dressing maps and worlds (use roblox-world-boundaries) or character animation (use animate-roblox-characters).
---

# Roblox Game Development

## Scope

Covers gameplay code and the systems behind it. Hand off when the request is about:

| Request | Use instead |
| --- | --- |
| Maps, levels, terrain, backdrops, world edges | `roblox-world-boundaries` |
| Rigs, keyframes, R15/R6 animation | `animate-roblox-characters` |

Inspect the existing code and hierarchy before writing anything. Match the project's module layout, naming, and Luau style instead of importing a new architecture.

## Non-negotiables

1. **The server is authoritative.** The client sends intent, never outcomes. Prices, damage, currency, and inventory changes are computed and validated on the server.
2. **Never trust a client argument.** Validate type, range, ownership, existence, and cooldown before using it.
3. **Every DataStore call is wrapped in `pcall`.** They are network calls and they will fail.
4. **`DataStoreService` is server-only.** Calling it from a `LocalScript` errors.
5. **Report failures.** `warn` with context. Do not swallow an error and continue silently.

## Data and persistence

Prefer native `DataStoreService`. `DataStore2` (Berezaa) is deprecated; migrate to native rather than adding it to a new project.

### Set vs Update

| | `SetAsync` | `UpdateAsync` |
| --- | --- | --- |
| Multi-server safety | can lose concurrent writes | reads current value first, safe |
| Cost | 1 write | 1 read + 1 write |
| Use for | throwaway data | currency, items, progression |

Use `UpdateAsync` for anything where losing a write matters. Its callback **cannot yield** - no `task.wait()`, no other DataStore calls inside it.

```lua
local DataStoreService = game:GetService("DataStoreService")

local store = DataStoreService:GetDataStore("PlayerData_v1")

local function addCoins(userId: number, amount: number): number?
	local ok, result = pcall(function()
		return store:UpdateAsync(tostring(userId), function(current: { coins: number }?)
			local data = current or { coins = 0 }
			data.coins += amount
			return data
		end)
	end)

	if not ok then
		warn(`addCoins failed for {userId}: {result}`)
		return nil
	end

	return result.coins
end
```

### Limits, caching, and metadata

- Requests are rate-limited per experience, not per server. Exceeding the limits throttles you, so retry with backoff and jitter instead of assuming success.
- Cache the player's data in a session table and write on autosave and on leave, not on every change.
- `GetAsync` can return a cached, slightly stale value. Do not build correctness on a read immediately after a write.
- Leaderboards use `GetOrderedDataStore` with `GetSortedAsync`, not a regular store.
- If you pass metadata to `SetAsync`, `UpdateAsync`, or `IncrementAsync`, you must always supply it. Omitting it later drops the stored value.
- Enable **Experience Settings > Security > Enable Studio Access to API Services** to test persistence in Studio, and never leave it on for a live experience.
- **Data Stores Manager** in Studio inspects, edits, and deletes entries without publishing. Use it to reproduce a bad save.

## Networking

- One `RemoteEvent` per action, named for the action. Do not route everything through a single "Event".
- Use `RemoteFunction` only when the client genuinely needs a return value. It blocks the client and is easy to abuse; prefer a server-pushed `RemoteEvent` for state.
- Rate-limit per player on the server, and drop rather than queue when a client spams.
- Send the minimum state the client needs. The client is untrusted input, not a database mirror.

```lua
-- ServerScriptService/ShopService.server.lua
-- Assumes ShopCatalog, Wallet, and Inventory modules on the server.
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local purchase = ReplicatedStorage.Remotes.PurchaseItem
local lastRequest: { [Player]: number } = {}

purchase.OnServerEvent:Connect(function(player: Player, itemId: unknown, quantity: unknown)
	if typeof(itemId) ~= "string" or typeof(quantity) ~= "number" then
		return
	end
	if quantity ~= math.floor(quantity) or quantity < 1 or quantity > 99 then
		return
	end

	local now = os.clock()
	if now - (lastRequest[player] or 0) < 0.25 then
		return
	end
	lastRequest[player] = now

	-- Resolve the price on the server. Never accept a client-sent price.
	local price = ShopCatalog.priceOf(itemId)
	if not price then
		return
	end

	if not Wallet.trySpend(player, price * quantity) then
		return
	end

	Inventory.grant(player, itemId, quantity)
end)
```

## Performance

- Profile before optimizing, using the MicroProfiler and the Script Performance view. Guesswork usually optimizes the wrong thing.
- Pool projectiles, effects, and hitboxes: reparent into a pool and reset the CFrame instead of `Instance.new`/`Destroy` in a loop.
- With `Workspace.StreamingEnabled`, keep gameplay-critical instances near the player and mark persistent models `ModelStreamingMode.Persistent`.
- Disconnect every `RBXScriptConnection` created for a character or temporary object. Leaked connections are the usual cause of a session that degrades over an hour.
- Prefer `task.wait` and `RunService` events over tight `while true do end` polling loops.

## Luau

- Annotate public function signatures and module exports. Let inference handle locals.
- The New Type Solver is the default for `nonstrict` and `nocheck`. Most code compiles unchanged; add explicit annotations where inference now complains.
- Prefer `--!strict` in new modules and `--!nonstrict` when retrofitting an existing one.
- Use `typeof(x)` for Roblox types and `type(x)` for Luau primitives.

## Bundled assets

Reusable implementations and references ship with this skill. Read them before writing a replacement.

| File | Use |
| --- | --- |
| [scripts/DataManager.lua](scripts/DataManager.lua) | Player data with autosave and retry |
| [scripts/RemoteManager.lua](scripts/RemoteManager.lua) | Networking with validation and rate limits |
| [scripts/GameManager.lua](scripts/GameManager.lua) | Round and state lifecycle |
| [scripts/UIManager.lua](scripts/UIManager.lua) | Responsive UI construction |
| [scripts/SoundManager.lua](scripts/SoundManager.lua) | 3D audio |
| [resources/quick_reference.md](resources/quick_reference.md) | API snippets |
| [resources/performance_optimization.md](resources/performance_optimization.md) | Optimization techniques |
| [resources/debugging_guide.md](resources/debugging_guide.md) | Diagnosing runtime problems |
| [resources/game_templates.md](resources/game_templates.md) | Starting genres |
| [resources/asset_library.md](resources/asset_library.md) | Sounds, models, textures |
| [templates/technical_specification.md](templates/technical_specification.md) | Architecture document |
| [templates/testing_plan.md](templates/testing_plan.md) | Test matrix |
| [templates/README.md](templates/README.md) | Index of every document template |
| [resources/README.md](resources/README.md) | Index of every guide and game template |

Authoritative API detail lives in the [Roblox documentation](https://create.roblox.com/docs). The Studio MCP `http_get` tool fetches it, so check current limits and signatures there instead of relying on memory.

## Verify before reporting complete

1. Every remote that changes state validates on the server.
2. Every DataStore call is wrapped in `pcall`, and failures are visible in the output.
3. Currency and inventory changes use `UpdateAsync`.
4. No `LocalScript` touches `DataStoreService`.
5. Nothing leaks: connections disconnected, instances pooled or destroyed.
6. Multiplayer features are tested with two players, including one leaving mid-action.
7. The feature runs in Studio with API access on, and again with it off, before shipping.

## Common mistakes

- Trusting the client's price, damage, or quantity.
- `SetAsync` for currency, silently wiping concurrent writes.
- Yielding inside an `UpdateAsync` callback.
- Writing to a DataStore on every value change instead of autosaving.
- Ignoring `pcall`'s boolean and treating a failed write as success.
- Passing metadata sometimes and omitting it later, which erases the value.
- Using one catch-all RemoteEvent for every action.
- Leaving Studio API access enabled in a live experience.
- Optimizing without profiling first.

Version: 2.1
Last Updated: November 2026

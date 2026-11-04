---
name: roblox-world-boundaries
description: Use whenever creating, generating, extending, or dressing a Roblox map, level, world, arena, obby, lobby, or open play space. Ensures the map has a themed sky/sky dome, a distant backdrop or matte painting, and a sealed perimeter with out-of-bounds handling so the world never ends in visible empty space.
---

# Roblox World Boundaries

## The rule

A map is not finished when the playable area works. It is finished when the world
looks like it continues past the playable area, and the player cannot leave it by
accident or on purpose.

Before placing the first gameplay part, decide:

1. **Playable bounds** - the area players may occupy, including vertical limits.
2. **The horizon story** - what the player sees beyond those bounds: mountains,
   ocean, skyline, cave walls, clouds, space.
3. **Out-of-bounds behavior** - what happens when a player crosses the edge.

Never ship a map whose ground stops at a straight edge, whose camera can see raw
void, or whose edge is only an invisible wall with nothing behind it.

Applies to new maps, map extensions, and "dress this level" requests. Tiny test
rigs and single-part demos are exempt.

## Build order

1. Set the playable bounds and write them down as constants.
2. Build the ground/terrain so it extends **past** those bounds.
3. Add the distant backdrop bands (near, mid, far).
4. Add sky, atmosphere, and fog so the farthest band blends into the horizon.
5. Seal the perimeter with visible barriers plus invisible collision.
6. Add server-side out-of-bounds handling.
7. Verify from inside the map before reporting it complete.

## Layer 1 - Sky and atmosphere

- Keep exactly **one** `Sky` in `Lighting`; delete duplicates.
- A sky dome must be visible from every playable angle. Do not leave the default
  sky if the map has its own time of day or art direction.
- Pick one sun control: `Lighting.ClockTime` **or** `Sky.SunAngles`/`MoonAngles`.
  Do not fight between them.
- Shadows, key light, and sky must agree on sun direction, or the map reads as fake.
- `Atmosphere` supersedes legacy `FogStart`/`FogEnd`; use it to blend the backdrop
  into the horizon instead of ending the world with a hard line.

```lua
local Lighting = game:GetService("Lighting")

local sky = Lighting:FindFirstChildOfClass("Sky") or Instance.new("Sky")
sky.Name = "Sky"
sky.SkyboxUp = "rbxassetid://0"
sky.SkyboxDn = "rbxassetid://0"
sky.SkyboxLf = "rbxassetid://0"
sky.SkyboxRt = "rbxassetid://0"
sky.SkyboxFt = "rbxassetid://0"
sky.SkyboxBk = "rbxassetid://0"
sky.CelestialBodiesShown = true
sky.StarCount = 3000
sky.Parent = Lighting

local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere") or Instance.new("Atmosphere")
atmosphere.Density = 0.35
atmosphere.Offset = 0.1
atmosphere.Color = Color3.fromRGB(199, 199, 199)
atmosphere.Decay = Color3.fromRGB(106, 112, 125)
atmosphere.Glare = 0.2
atmosphere.Haze = 1.5
atmosphere.Parent = Lighting
```

Replace the `0` asset IDs with real skybox assets, or build the sky from a dome
mesh with inward-facing textures. A dark night map still needs stars, a moon, and
lit landmarks on the horizon so the edge is not a black wall.

## Layer 2 - Backdrop / matte painting

The backdrop is what the player sees beyond the boundary. Build it in bands:

| Band | Distance from playable edge | Detail |
| --- | --- | --- |
| Near | 1.2x playable radius | Readable silhouettes: cliffs, rooftops, tree line |
| Mid | 2-3x | Blockier masses, less color contrast |
| Far | 5x+ | Flat haze shapes that merge into the sky |

Rules:

- Give every backdrop part `Anchored = true`, `CanCollide = false`,
  `CanTouch = false`, `CanQuery = false`, `CastShadow = false`.
- Desaturate and lighten each band toward the horizon; let atmosphere/fog do the
  final blend so there is no visible cut-off.
- Overlap panels at corners. A gap between two backdrop planes is a hole in the world.
- For a matte-painting wall, use a curved mesh or several angled planes. One flat
  plane facing the player reads as a poster.
- Keep the backdrop out of gameplay range: it must not collide, block raycasts, or
  receive shadows.
- With `Workspace.StreamingEnabled`, set each backdrop model to
  `ModelStreamingMode.Persistent` so the horizon never pops out of existence.
- Never place the backdrop so close that the camera clips through it during normal
  play, and never so far that fog hides it entirely.

## Layer 3 - Ground and terrain edges

- The walkable surface must continue under and behind the boundary. Extend terrain
  or geometry at least one backdrop band past the playable edge.
- Replace straight baseplate edges with terrain rims, cliffs, shorelines, walls, or
  dense geometry. A visible flat cut is the most common "empty space" failure.
- A default `Baseplate` is a floor, not a world. If a template starts with one,
  treat its edge as temporary and build the real boundary before finishing.
- For islands, add a seabed and distant islands; the water plane must not end in air.
- For indoor maps, close the ceiling and all sightlines. An enclosed room needs no
  skybox, but it still needs a sealed perimeter.
- Set `Workspace.FallenPartsDestroyHeight` sensibly so dropped props disappear
  instead of accumulating below the map.

## Layer 4 - Perimeter and out-of-bounds

Use two layers, always:

1. **Visible boundary** - cliff, wall, fence, water, dense trees, energy field.
   The player should understand where the edge is before touching it.
2. **Invisible collision** - sealed walls just outside the visible boundary, so
   exploits and physics glitches cannot leak the player out.

Invisible walls must be sealed at corners and extend below the floor and above
max jump/glide height.

```lua
-- ServerScriptService/WorldBoundaries.server.lua
local Workspace = game:GetService("Workspace")

local BOUNDS = {
	minX = -240,
	maxX = 240,
	minZ = -240,
	maxZ = 240,
	floorY = -60,
	topY = 220,
}

local function boundaryFolder(): Folder
	local folder = Workspace:FindFirstChild("WorldBoundaries")
	if folder then
		return folder
	end
	folder = Instance.new("Folder")
	folder.Name = "WorldBoundaries"
	folder.Parent = Workspace
	return folder
end

local function wall(parent: Folder, name: string, size: Vector3, cframe: CFrame)
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = true
	part.CanTouch = false
	part.CanQuery = false
	part.CastShadow = false
	part.Transparency = 1
	part.Size = size
	part.CFrame = cframe
	part.Parent = parent
end

local function sealRectangle(bounds: typeof(BOUNDS))
	local folder = boundaryFolder()
	local thickness = 4
	local height = bounds.topY - bounds.floorY
	local midY = (bounds.topY + bounds.floorY) / 2
	local width = bounds.maxX - bounds.minX
	local depth = bounds.maxZ - bounds.minZ

	wall(folder, "Boundary_North", Vector3.new(width + thickness * 2, height, thickness),
		CFrame.new((bounds.minX + bounds.maxX) / 2, midY, bounds.minZ - thickness / 2))
	wall(folder, "Boundary_South", Vector3.new(width + thickness * 2, height, thickness),
		CFrame.new((bounds.minX + bounds.maxX) / 2, midY, bounds.maxZ + thickness / 2))
	wall(folder, "Boundary_West", Vector3.new(thickness, height, depth),
		CFrame.new(bounds.minX - thickness / 2, midY, (bounds.minZ + bounds.maxZ) / 2))
	wall(folder, "Boundary_East", Vector3.new(thickness, height, depth),
		CFrame.new(bounds.maxX + thickness / 2, midY, (bounds.minZ + bounds.maxZ) / 2))
end

sealRectangle(BOUNDS)
```

Collision alone is not enough: a client can bypass walls. Add a server-side
position check and return the player to a safe point.

```lua
-- ServerScriptService/OutOfBounds.server.lua
local Players = game:GetService("Players")

local BOUNDS = {
	minX = -240,
	maxX = 240,
	minZ = -240,
	maxZ = 240,
	floorY = -60,
	topY = 220,
}
local RETURN_CFRAME = CFrame.new(0, 12, 0)

local function inside(position: Vector3): boolean
	return position.X >= BOUNDS.minX
		and position.X <= BOUNDS.maxX
		and position.Z >= BOUNDS.minZ
		and position.Z <= BOUNDS.maxZ
		and position.Y >= BOUNDS.floorY
		and position.Y <= BOUNDS.topY
end

local function watch(player: Player, character: Model)
	local root = character:WaitForChild("HumanoidRootPart") :: BasePart
	task.spawn(function()
		while character.Parent do
			task.wait(0.25)
			if not inside(root.Position) then
				character:PivotTo(RETURN_CFRAME)
				root.AssemblyLinearVelocity = Vector3.zero
			end
		end
	end)
end

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(function(character)
		watch(player, character)
	end)
end)
```

Better UX than a silent teleport: fade the screen, show "Returning to the map",
then respawn at the last checkpoint. Kill instantly only for falls into a void.

- Add a kill plane below the map for parts and characters that escape.
- Cover vertical escape too: ceilings for indoor maps, height limits for flying.
- Do not put invisible walls across doors, ladders, spawns, or intended shortcuts.
- Do not rely on invisible walls alone; the visible boundary is what sells the world.

## Theme recipes

- **Island / ocean:** seabed, water plane, 2 rings of distant islands, haze, reef
  rocks at the shoreline, swim-out boundary with a current that pushes back.
- **Forest:** dense tree wall, rising terrain rim, layered ridge silhouettes, mist.
- **City:** building canyon, skyline band, distant towers in haze, road that bends
  out of sight instead of ending.
- **Cave / interior:** sealed rock shell, ceiling, darkness beyond the lit area,
  collapse rubble blocking exits rather than an invisible wall.
- **Obby / arena:** visible energy wall or stands, sky dome, kill plane, checkpoint
  return, no open edge at any platform.
- **Space / sky:** planet horizon, star field, distant station silhouettes, hard
  height limit with an energy ceiling.

## Verify before reporting complete

1. Stand at spawn, each map corner, and each elevated vantage. Look outward, up,
   and down. No void, no flat cut, no gap between backdrop panels.
2. Walk into every boundary. You must be stopped before reaching the visual edge,
   with no corner gaps.
3. Jump, glide, or fly to the maximum allowed height. The sky/ceiling must still hold.
4. Fall off every edge. You must be returned or killed cleanly, never left falling.
5. Test with `StreamingEnabled` on: the backdrop and boundary must stay loaded.
6. Check that the boundary does not block a legitimate path, door, or spawn.
7. Confirm sun direction, shadows, fog, and backdrop agree. A mismatched horizon is
   as obvious as an empty one.

## Common mistakes

- Baseplate edge visible at the horizon.
- Backdrop present on one side only, or panels with gaps at corners.
- Invisible wall with no visible reason for it.
- Boundary walls that stop below jump height or leave a gap at the floor.
- Relying on client-side checks for out-of-bounds.
- Backdrop parts that collide, cast shadows, or block raycasts.
- Fog so thick the backdrop is invisible, or so thin the panel edges show.
- Sky and lighting from different times of day.
- A night map whose horizon is pure black with no landmarks.

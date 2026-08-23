import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { KNIT_SKILL } from "../src/agent/skills/knitSkill";
import { PROFILE_SERVICE_SKILL } from "../src/agent/skills/profileServiceSkill";

/**
 * OpenCode-native agent skills shipped with the app. Each entry becomes a
 * `.opencode/skills/<name>/SKILL.md` file in the OpenCode workspace so the
 * agent discovers them natively and loads them on demand via its skill tool.
 * Files are rewritten on every launch, so skill upgrades ship automatically.
 *
 * Frontmatter contract (enforced by OpenCode): `name` and `description` are
 * required; `name` must be lowercase alphanumeric with single hyphens and
 * match the containing directory name; `description` is 1-1024 characters.
 */

const ANIMATION_AUTHORING_SKILL = `---
name: roblox-animation
description: Pro Roblox character animation authoring for R15 and R6 rigs — build combat combos, hit reactions, eating/drinking, and dance loops as KeyframeSequences with anticipation, arcs, follow-through, and clean timing. Use for any animation, emote, move, or action request.
license: MIT
---

# Roblox Animation Authoring (Pro)

Author animations programmatically as KeyframeSequences. Never reference other
creators' rbxassetid animation IDs — they fail ownership checks. Build the
KeyframeSequence in Luau, register it with KeyframeSequenceProvider at runtime,
and play the returned ID. This works without uploading assets.

## Authoring pipeline

1. Create a ModuleScript under ReplicatedStorage (e.g.
   \`ReplicatedShared/Animations/<SetName>.lua\`) exporting plain data tables:
   one entry per animation with \`{ name, loop, keyframes = { { time, poses } } }\`.
2. Each \`poses\` entry maps a Motor6D name to a CFrame rotation (radians) plus
   optional weight/easing. Keep data separate from construction code so the
   client and server can both rebuild and register the same sequences.
3. Provide one shared builder ModuleScript that turns the data into a real
   KeyframeSequence instance (KeyframeSequence > Keyframe > Pose hierarchy),
   then \`KeyframeSequenceProvider:RegisterKeyframeSequence(seq)\` returns the
   session-local AnimationId. Registration is per-session: register wherever
   playback happens (client for character playback).
4. Verify in Studio: load the animation on the active rig and watch it, then
   iterate timing — do not report success without a playback check.

## R15 motor map (pose names must match Motor6D names)

- Root: \`Root\` (HumanoidRootFrame → LowerTorso) — root motion only if intended
- Spine: \`Waist\` (LowerTorso → UpperTorso), \`Neck\` (UpperTorso → Head)
- Arms: \`LeftShoulder\`/\`RightShoulder\`, \`LeftElbow\`/\`RightElbow\`,
  \`LeftWrist\`/\`RightWrist\`
- Legs: \`LeftHip\`/\`RightHip\`, \`LeftKnee\`/\`RightKnee\`,
  \`LeftAnkle\`/\`RightAnkle\`

## R6 motor map

- Root: \`RootJoint\` (HumanoidRootFrame → Torso) — also carries spine lean
- Head: \`Neck\` (Torso → Head)
- Arms: \`Left Shoulder\`, \`Right Shoulder\` (Torso → LeftArm/RightArm) —
  note the spaces in the joint names; each drives the whole arm since R6 has
  no elbow or wrist motors
- Legs: \`Left Hip\`, \`Right Hip\` (Torso → LeftLeg/RightLeg) — each drives
  the whole leg; no knee or ankle motors exist

R6 crafting rules: with only six animatable joints, express arm bends by
composing larger \`Shoulder\` rotations with torso counter-rotation, and lean
harder on \`RootJoint\` tilt and hip swings for weight. KeyframeSequence pose
names for R6 must use the exact spaced names above (string keys in data
tables).

## Rig detection and dual-rig authoring

Detect once per character, never assume:

\`\`\`lua
local humanoid = character:WaitForChild("Humanoid")
local isR15 = humanoid.RigType == Enum.HumanoidRigType.R15
\`\`\`

Author animation data rig-agnostically when both rigs matter: key poses by
semantic roles (torsoLean, headPitch, leftArm, rightArm, leftLeg, rightLeg),
then expand per rig — R15 splits arm intent across shoulder/elbow/wrist, R6
folds it into the single shoulder joint. Register each expanded sequence
separately and pick the matching AnimationId at playback by rig type; an R15
sequence on an R6 rig leaves joints silently still and vice versa.

Rotations are \`CFrame.Angles(x, y, z)\` in radians relative to the joint's rest
pose. Start every animation from the neutral pose, move one joint group at a
time when authoring, and verify each joint's sign convention in Studio before
stacking complexity.

## Pro animation principles (apply all)

- **Anticipation**: a wind-up before every strike, jump, or throw (~0.15-0.3s);
  bigger action, bigger wind-up.
- **Arcs**: limbs travel on curved paths — rotate shoulder and elbow together
  with offset timing instead of snapping single joints.
- **Follow-through and overlap**: extremities (hands, head) lag the torso by
  one keyframe and settle after the main action stops.
- **Slow-in/slow-out**: use \`EasingStyle\` (Quad/Cubic/Back) and per-pose
  \`Weight\`; hold impact poses for exactly one keyframe.
- **Weight shift**: pelvis leads every movement (\`Waist\` + hips on R15,
  \`RootJoint\` + hips on R6); feet stay planted unless the move travels.
- **Timing contrast**: fast hits (0.05-0.1s) against slow recoveries
  (0.2-0.4s) read as powerful.

## Recipes

### Fighting combos
- Structure each swing as wind-up → strike (impact frame) → recovery.
- Ship each combo hit as its own animation; chain them with marker events
  (\`Keyframe:AddMarker("ChainWindow")\`) and \`AnimationTrack:GetMarkerReachedSignal\`.
- Add a brief hit-stop (pause ~0.06s or AdjustSpeed(0) then resume) on impact.
- Keep arm recoil and torso counter-rotation in the recovery frames.
- Priority \`Action\` or higher so combat overrides idle/movement.
- R6: with no wrist/elbow joints, sell snap through fast \`Shoulder\` velocity
  plus \`RootJoint\` yaw twist; exaggerate anticipation ~20% to compensate.

### Hit reactions
- Separate light flinch (head + torso only, ~0.3s) from heavy stagger (root
  sway + step, ~0.6s); make both non-looping, priority \`Action4\`.
- Offset the neck and head one keyframe behind the torso for whiplash feel.

### Eating / drinking
- Idle hold pose with the tool arm raised toward the chest, priority \`Action\`.
- Bite/sip cycle: hand arcs to the mouth (anticipation arc, then snap), head
  tips forward ~0.1 rad, hold 1-2 chew keyframes with subtle jaw-less head bob,
  then lower with follow-through. Loop the chew 2-3 times before finishing.
- Align the equipped Tool with its \`Grip\` CFrame; verify the handle visually
  touches the hand before reporting done.
- R6: raise the whole arm via \`Left Shoulder\`/\`Right Shoulder\` and meet it
  with a \`Neck\` tilt; check the grip reach on the blocky arm proportions.

### Dances
- Loop (\`Loop = true\`) and make first/last keyframes identical.
- Quantize keyframe times to the beat: \`time = beatIndex * (60 / bpm)\`.
- Core pattern per 4-beat bar: weight shift left → right via hips, arms
  counter-swing, head bobs on beats 2 and 4, knees soft on every beat.
- Keep root translation zero so characters dance in place.
- R6: no knee motors, so express the bounce through alternating \`Hip\`
  rotation with slight counter-lean on \`RootJoint\` (rotation only, keep
  translation zero) and full-arm swings on the shoulders.

## Quality checklist (run before reporting)

- [ ] Registered sequence returns a valid ID and plays on the target rig
- [ ] Rig type matches the character (R15 sequence on R15, R6 on R6); if
      dual-rig was requested, both variants play correctly
- [ ] No floating feet, no limbs clipping the torso
- [ ] Anticipation + impact + recovery present in every attack
- [ ] Loops are seamless (no pop at wrap)
- [ ] Priorities set so the move wins against idle/movement
`;

const ANIMATION_RUNTIME_SKILL = `---
name: roblox-animation-runtime
description: Roblox animation runtime playback on R15 and R6 rigs — AnimationTrack priorities, blending, fade times, speed control, rig-aware track selection, marker-driven combo chaining, and tool grip alignment. Use when wiring animations into gameplay scripts.
license: MIT
---

# Roblox Animation Runtime Playback

## Loading and playing

\`\`\`lua
local humanoid = character:WaitForChild("Humanoid")
local animator = humanoid:WaitForChild("Animator")
local animation = Instance.new("Animation")
animation.AnimationId = registeredAssetId -- from KeyframeSequenceProvider
local track = animator:LoadAnimation(animation)
track.Priority = Enum.AnimationPriority.Action
track.Looped = false
track:Play(0.1) -- fadeTime seconds; use 0 only for instant snaps
\`\`\`

Prefer \`Animator:LoadAnimation\` over the deprecated
\`Humanoid:LoadAnimation\`. Cache tracks per animation; never load the same
animation repeatedly mid-combo.

## Priorities (higher overrides lower)

\`Idle < Movement < Action < Action2 < Action3 < Action4 < Core\`

- Idle holds, emote bases: \`Idle\`/\`Movement\`
- Attacks, eating, dances: \`Action\`
- Hit reactions and cancels: \`Action4\` so they interrupt attacks

## Blending and feel

- Fade combat swings in at 0.05-0.1s and out at 0.1-0.15s.
- \`track:AdjustSpeed(n)\` for hit-stop (0) and slow-mo finishers.
- \`track:Stop(fadeTime)\` — always pass a fade to avoid pops.
- Layer an idle breathing track under action tracks for liveliness.

## Combo chaining

\`\`\`lua
track:GetMarkerReachedSignal("ChainWindow"):Connect(function()
    chainReady = true
end)
track.Stopped:Connect(function() chainReady = false end)
\`\`\`

Queue the next swing only while \`chainReady\` is true; cancel the chain if the
player moves or gets hit. Drive inputs through a small state machine, not
ad-hoc \`Play()\` calls scattered across scripts.

## Eating tool alignment

When a Tool is equipped, its \`Grip\` CFrame positions it in the hand. For
mouth-targeted actions, either re-weld the handle toward the head during the
bite keyframes or author the arm pose so the existing grip reaches the mouth —
never move the character to the tool.

## Rig-aware playback

Pick the animation variant that matches the character's rig before loading:

\`\`\`lua
local humanoid = character:WaitForChild("Humanoid")
local ids = humanoid.RigType == Enum.HumanoidRigType.R15 and set.r15 or set.r6
local track = animator:LoadAnimation(makeAnimation(ids["punch1"]))
\`\`\`

Respawn can change rig type (avatar updates), so resolve rig type on every
character spawn, never cache it across respawns.

## Debugging rigs and animations (do this before retrying anything)

- NEVER guess engine methods. There is no \`Humanoid:GetRigInfo()\` or similar
  reflection helper — calling invented methods throws at runtime and burns
  turns in retry loops. Inspect what actually exists instead:
  \`GetDescendants\`, \`FindFirstChild\`, \`IsA\`, then print the result via
  \`game:GetService("HttpService"):JSONEncode(...)\`.
- Enumerate the real joint structure before authoring or debugging a rig:

\`\`\`lua
local joints = {}
for _, descendant in ipairs(character:GetDescendants()) do
    if descendant:IsA("Motor6D") then
        table.insert(joints, {
            Name = descendant.Name,
            Part0 = descendant.Part0 and descendant.Part0.Name,
            Part1 = descendant.Part1 and descendant.Part1.Name,
        })
    end
end
print(game:GetService("HttpService"):JSONEncode(joints))
\`\`\`

- \`Pose.Name\` must match the **Motor6D name** (\`RightShoulder\`), never the
  child part name (\`RightUpperArm\`). A pose bound to the wrong name applies
  to no joint and the whole track plays as if empty.
- Load and play tracks through \`humanoid:WaitForChild("Animator")\`; playing
  directly on Humanoid — or mutating Pose instances while a track is active —
  silently fails to update joint transforms.
- Verify joint state statically, never through live input. Do not brute-force
  simulated keyboard input (\`user_keyboard_input\`) to catch sub-second states
  such as hit-stop — pause the track (\`AdjustSpeed(0)\`), then read or set the
  joint's \`Motor6D.Transform\` directly:

\`\`\`lua
local rightShoulder = character:FindFirstChild("RightShoulder", true)
if rightShoulder and rightShoulder:IsA("Motor6D") then
    print("Current Transform CFrame:", rightShoulder.Transform)
    rightShoulder.Transform = CFrame.Angles(math.rad(90), 0, 0) -- static pose check
end
\`\`\`

- If two identical attempts give different results, re-enumerate the rig
  first — respawn and avatar updates can change joint names and rig type.

## Gotchas

- Animation IDs from \`KeyframeSequenceProvider:RegisterKeyframeSequence\` are
  session-local; re-register after respawn/reload and on each machine that
  plays the animation.
- Animations must target the same rig type as the character (R15 vs R6) or
  joints silently stay still — R6 joint names also contain spaces
  (\`Left Shoulder\`), so typos fail silently too.
- Stop all custom tracks before ragdoll/death states or poses fight the
  physics.
`;

const MAP_PLANNING_SKILL = `---
name: roblox-map-planning
description: Structured Roblox map and level planning — turn a map request into a zoned build plan with theme pillars, landmarks, player flow, scale numbers, pacing, and a phased budget before any building starts. Use for map, world, level, base, arena, obby, or environment requests.
license: MIT
---

# Roblox Map Planning (Pro)

Never start building immediately. Produce a written plan first, then build
phase by phase. A good whole map comes from zoning, flow, and budgets — not
from placing parts one by one.

## Planning workflow (follow in order)

1. **Brief** — confirm: game mode (obby, showcase, combat arena, tycoon,
   roleplay hub), player count, target traversal time, and one-sentence theme.
   If the user gave none, choose sensible defaults and state them.
2. **Concept** — pick 2-3 theme pillars (e.g. "overgrown ruins", "neon
   dusk"), a palette of 3-5 materials/colors, and 2-3 landmarks that will
   read from anywhere in the map.
3. **Zoning** — divide the footprint into 4-8 named zones (spawn, intro
   vista, main loop, high ground, secret/optional). Sketch each zone as one
   colored blockout Part with its name; this becomes the build skeleton.
4. **Flow** — define the primary route (the critical path every player takes)
   and secondary routes. Hub-and-spoke for exploration, ring loop for racing/
   obby, mirrored halves for PvP. Keep one clear "way to go" visible from any
   decision point.
5. **Scale check** — validate zone sizes against movement numbers (below).
6. **Pacing** — alternate tight and open spaces; place a point of interest
   every 30-50 studs; give rest spots after challenges; never two difficulty
   spikes in a row.
7. **Write the plan document** (below) and present it before building.

## Scale reference (walk speed 16 studs/s, jump ~7 studs up / 12 forward)

- Corridors/paths: 8-12 studs wide; doors 4-5 wide, 8 high
- Jump gaps: ≤12 studs horizontal, ≤5 studs up without aid
- Rooms: 40x40 studs minimum for group encounters
- Landmark visibility: 200-400 studs sightline from the main route
- Whole-map footprint: small arena 200x200, standard map 500x500, showcase
  up to 1000x1000 — match to traversal time from the brief

## Plan document format (present exactly this structure)

\`\`\`
# <Map Name> — Build Plan
Theme: <pillars> | Palette: <materials/colors> | Mode: <game mode>
Zones: <list with size in studs, purpose, key landmarks>
Flow: <primary route zone-by-zone, secondary routes>
Phases: 1 blockout, 2 structure, 3 terrain, 4 props/detail, 5 lighting,
6 gameplay hooks, 7 polish
Budgets: part count, unique materials, light instances
\`\`\`

## Pro design principles

- Landmarks ("weenies") orient players — every zone should see or contain one.
- Readable silhouettes: a zone's skyline should identify it from far away.
- Color-code zones subtly; never more than 3 saturated materials per zone.
- Verticality in thirds: ground, mid (roofs/ledges), high (vantage).
- Avoid mazes: no dead ends without a reward; dead ends must read as optional.
- Spawn always faces the map's hero view.

## Checklist before approving the plan

- [ ] Every zone has a purpose and a way in/out
- [ ] Primary route completable without ability assumptions
- [ ] Scale numbers checked against the reference
- [ ] Budgets stated (parts, lights, materials)
- [ ] Landmarks visible from the main route
`;

const MAP_BUILDING_SKILL = `---
name: roblox-map-building
description: Roblox map building execution — phased blockout to polish pipeline, terrain scripting, modular kits, lighting and atmosphere setup, gameplay hooks, and performance budgets. Use after the map plan exists to build the map in Studio.
license: MIT
---

# Roblox Map Building (Pro)

Build in strict phases; finish and verify each phase before the next. Never
detail a zone that is not blocked out, and never light a map that is not
structured. Coordinate every placement through a JSON blueprint so the map
stays consistent, grid-aligned, and easy to revise.

## Blueprint contract (emit first, build from it)

Before placing parts in a phase, emit the phase's construct map as JSON and
build strictly from it:

\`\`\`json
{
  "grid_size": 4,
  "map_bounds": { "x": 200, "z": 200 },
  "lighting": {
    "technology": "Future",
    "time_of_day": "00:00:00",
    "atmosphere_density": 0.45,
    "fog_color": "#120024"
  },
  "structures": [
    { "type": "Wall_Basic", "position": [0, 0, 0], "rotation": 0 },
    { "type": "Door_Frame", "position": [16, 0, 20], "rotation": 90 },
    { "type": "Street_Lamp", "position": [10, 0, 15], "rotation": 0 }
  ],
  "props": [
    { "type": "Tree_Pine", "position": [40, 0, 60], "rotation": 45 }
  ]
}
\`\`\`

- \`grid_size\` is the snap unit for all x/z positions (2 or 4 studs). Every
  coordinate must be a multiple of it — this prevents Z-fighting overlaps and
  gaps between adjacent modules.
- Key by \`type\` from the modular kit (below) and place via exact CFrame
  using \`position\`/\`rotation\`; never hand-placed drifting dimensions.
- Keep this blueprint in the session context so later phases (lighting,
  props, gameplay hooks) can reference exact coordinates.

## Studio execution & Luau API rules (read first)

These rules prevent the most common build failures. Follow them on every
\`execute_luau\` call.

- **Always resolve a live Studio target first.** Call \`list_roblox_studios\`
  and use one of the returned \`studio_id\` values. Studio instances disconnect
  when the place closes or reloads — if you get a "studio_id is not connected"
  error, call \`list_roblox_studios\` again and retry with a fresh id. Never
  reuse an id you cached earlier in the session.
- **Constructors take the right types.**
  - \`Vector3.new(x, y, z)\` — exactly three numbers.
  - \`CFrame.new(...)\` — use explicit components or a Vector3/position; never
    pass a single number where a Vector3 is expected.
  - \`Region3.new(minCorner: Vector3, maxCorner: Vector3)\` — two Vector3
    corners, not six numbers.
  - \`Enum.Material.X\` for terrain/part materials — never a bare number.
- **Write valid, initialized Luau.** Declare and initialize every variable
  before you use it; referencing a \`nil\` value in arithmetic raises
  "attempt to perform arithmetic on nil". Keep each script syntactically valid
  (matching \`end\`/\`do\`/brackets) or \`execute_luau\` returns
  "Failed to parse command code". Prefer small, verified snippets over one huge
  script.
- **Verify unfamiliar engine APIs live.** When unsure whether a property or
  method exists, test it in the Studio Command Bar / Output before running a
  large build script — do not guess and accept the 404. If a skill such as
  \`roblox-map-building\` is not found by the loader, fall back to these
  embedded instructions rather than stopping.

## Phase 1 — Blockout

- Create \`Workspace.Map.Blockout\` with one Anchored Part per zone from the
  plan, colored per zone, named exactly as planned.
- Snap every block to the grid (\`grid_size\` 2 or 4). Walk the primary route
  mentally part-by-part: fix scale and flow problems now, while changes are
  cheap.

## Phase 2 — Structure

- Hierarchy: \`Workspace.Map.Zones.<ZoneName>\` with \`Structures\`, \`Props\`,
  \`Terrain\` folders per zone; move finished work out of Blockout zone by zone.
- Every static Part: \`Anchored = true\`. Never rely on welds for static maps.
- Build one modular kit per repeating element (wall, fence, pillar, roof):
  keep the master in \`ServerStorage.MapKit\`, clone it for repetition — never
  hand-place copies with drifting dimensions.
- **Stud proportions (authoritative):** walls 12-16 studs tall; doors and
  corridors 8-10 studs wide and 10-12 tall so R6/R15 avatars move freely;
  floor slabs 1-2 studs thick. Scale every kit part to these before cloning.
- Prefer building structurally via the Studio MCP integration when available
  over editing raw geometry. For committed static CSG, pre-bake unions in
  Studio so they ship as ready-made \`PartOperation\`/\`MeshPart\` parts.
- **Runtime CSG / solid modeling:** scripted boolean operations use
  \`game:GetService("GeometryService")\` — there is **no \`SolidModeling\`
  service**. Its methods return an array of parts (not a single part, unlike
  the deprecated \`BasePart:UnionAsync\`):
  - \`GeometryService:UnionAsync(targetPart, partsToUnion)\` — combine shapes
  - \`GeometryService:SubtractAsync(targetPart, partsToSubtract)\` — carve out
  - \`GeometryService:IntersectAsync(targetPart, partsToIntersect)\` — overlap
  - \`GeometryService:SweepPartAsync(...)\` /
    \`GeometryService:FragmentAsync(...)\` — advanced carving
  Keep runtime CSG small and deliberate — it is expensive at runtime; prefer
  pre-baked geometry for large or repeated unions.
- When unsure an engine API exists, verify it live in the Studio Command Bar
  or Output instead of guessing and hitting a 404.
- Decorative thin geometry: \`CanCollide = false\` where players should pass
  through (grass, banners, small props).

## Phase 3 — Terrain

- Sculpt with the \`Workspace.Terrain\` API using these **exact, current**
  signatures. The old \`resolution\` argument on \`FillBlock\` was removed,
  while \`FillRegion\` still requires \`resolution = 4\` — confusing the two is
  the #1 terrain failure:
  - \`Terrain:FillBlock(cframe: CFrame, size: Vector3, material: Enum.Material)\`
    — **3 arguments, no resolution**.
  - \`Terrain:FillRegion(region: Region3, 4, material: Enum.Material)\` — the
    middle argument is the voxel resolution and **must be exactly 4**.
  - \`Terrain:FillBall(center: Vector3, radius: number, material: Enum.Material)\`
  - \`Terrain:FillCylinder(cframe: CFrame, height: number, radius: number, material: Enum.Material)\`
  - Pass the material as an \`Enum.Material\` value (e.g. \`Enum.Material.Grass\`),
    **never a bare number** — a number lands in the material slot and raises
    "Unable to cast double to Material".
  - Build \`region\` as \`Region3.new(Vector3.new(x1,y1,z1), Vector3.new(x2,y2,z2))\`
    (two Vector3 corners) and align it to the voxel grid with
    \`region:ExpandToGrid(4)\`. Do **not** pass six numbers to \`Region3.new\`
    (that raises "invalid argument #1 to 'new' (Vector3 expected, got number)").
  - Voxels are 4 studs — keep terrain features multiples of that.
- One dominant terrain material per biome (Grassfield, Rock, Sand, Snow);
  blend with at most one transition material.
- End each terrain edit by setting \`Material\` then re-verify boundaries
  against the blueprint's \`map_bounds\`.

## Phase 4 — Props and detail (asset palette)

- Keep a curated props library folder (\`Workspace.Map.Assets\` or
  \`ServerStorage\`) with reusable models (Tree_Pine, Rock, Crate, Lamp).
  Clone from it instead of pulling unrelated assets from the Toolbox.
- Detail in passes: large anchors first (rocks, carts), then scatter (crates,
  barrels), then micro (grass tufts, lamps). Stop when the budget says so.
- MeshParts for organic shapes; plain Parts for anything box-like.

## Phase 5 — Lighting and atmosphere

- Set \`Lighting.Technology = Enum.Technology.Future\` for real-time shadows
  and physically based lighting; then \`Lighting.TimeOfDay\` for the mood from
  the plan (dawn 06:30, dusk 17:30, night 00:00).
- Add one \`Atmosphere\` (Density 0.3-0.6, tune Glare/Haze and the fog color
  from the blueprint), one \`Sky\`, and 2-3 effects: \`BloomEffect\`,
  \`ColorCorrectionEffect\`, and \`SunRays\` for exterior hero moments.
- **Sun & rays (verified members):** \`Sky\` has **no** \`SunRayColor\`
  property — customize the sun via \`Sky.SunAngularSize\`, \`Sky.SunTextureId\`,
  or the skybox faces. Add a \`SunRaysEffect\` under \`Lighting\` and drive it
  with \`SunRaysIntensity\`, \`SunRaysSize\`, \`SunRaysSpread\` — there is
  **no** \`Color\` property on \`SunRaysEffect\` (tint via Lighting/Atmosphere
  instead).
- Accent lights: \`PointLight\`/\`SpotLight\` only at landmarks and gameplay
  points to direct the player visually; keep total light instances under ~30.
  Prefer emissive materials (MaterialVariant neon + slight brightness) over
  extra lights.

## Phase 6 — Gameplay hooks

- \`SpawnLocation\` per entry zone, \`Neutral = true\`, facing the hero view.
- Obby: \`Workspace.Map.Checkpoints\` folder with pads named by ascending
  number. Kill bricks: invisible Part + \`Touched\` script setting
  \`Humanoid.Health = 0\`.
- Name every gameplay instance deterministically so scripts can find it.

## Phase 7 — Polish and verify

- Walk the full primary route once: no invisible walls, no stuck spots, no
  gap jumps beyond plan scale.
- Performance budget: ≤1500 Parts for standard maps, ≤40 lights, reuse
  materials. Over budget? Merge micro-props into MeshParts or delete scatter.
- Check StreamingEnabled-friendly layout: zones self-contained so chunks load
  cleanly.
- Group finished work into clearly named Models/Folders (e.g.
  \`Workspace.Map.Interactive\`, \`Workspace.Map.Architecture\`) for clean
  streaming and scripts.

## Report format

After each phase, report briefly: what was built, part/light counts, and one
known limitation. After phase 7, report the full summary against the blueprint
and the plan.
`;

export interface AgentSkillFile {
  /** Path relative to the OpenCode workspace, e.g. .opencode/skills/x/SKILL.md */
  relativePath: string;
  content: string;
}

export const AGENT_SKILLS: readonly AgentSkillFile[] = [
  {
    relativePath: ".opencode/skills/roblox-animation/SKILL.md",
    content: ANIMATION_AUTHORING_SKILL,
  },
  {
    relativePath: ".opencode/skills/roblox-animation-runtime/SKILL.md",
    content: ANIMATION_RUNTIME_SKILL,
  },
  {
    relativePath: ".opencode/skills/roblox-map-planning/SKILL.md",
    content: MAP_PLANNING_SKILL,
  },
  {
    relativePath: ".opencode/skills/roblox-map-building/SKILL.md",
    content: MAP_BUILDING_SKILL,
  },
  {
    relativePath: KNIT_SKILL.relativePath,
    content: KNIT_SKILL.content,
  },
  {
    relativePath: PROFILE_SERVICE_SKILL.relativePath,
    content: PROFILE_SERVICE_SKILL.content,
  },
];

/**
 * Managed AGENTS.md conventions block. OpenCode always loads the workspace
 * AGENTS.md, so this is the home for the always-on efficiency and quality
 * discipline; domain expertise lives in the on-demand skills instead.
 * The block is bracketed by markers so it can be refreshed on relaunch
 * without destroying user-authored content around it.
 */
const AGENTS_MD_MARKER_BEGIN = "<!-- bloxmind-managed:begin -->";
const AGENTS_MD_MARKER_END = "<!-- bloxmind-managed:end -->";

const AGENTS_MD_BLOCK = `${AGENTS_MD_MARKER_BEGIN}
## BloxMind workspace conventions (managed)

### Efficiency
- Read each file at most once per task; batch all edits to a file into one pass.
- Prefer one focused Studio MCP verification over repeated polling.
- Reuse an earlier game-tree snapshot from this session instead of re-listing.
- Report briefly: what changed, how it was verified, one known limitation.
- Stay time-aware: note the elapsed time in your reasoning, and don't
  overthink. Hard cap: 2 minutes per subtask — if you're still deciding after
  that, commit to the most reasonable option and move immediately. Never loop
  on "verify again" or re-planning the same step.

### Luau quality
- Type-annotate exported functions, use descriptive camelCase names, and guard
  nil at API boundaries with clear error messages.
- Follow default.project.json pathing: client/ → StarterPlayerScripts,
  server/ → ServerScriptService, shared code in src/ → ReplicatedStorage.
- Prefer current APIs (Animator:LoadAnimation, not Humanoid:LoadAnimation).

### Studio habits
- Confirm an instance exists before modifying it; never create duplicates.
- Anchor static map parts; keep gameplay surfaces collidable.
- After editing Rojo-synced files, wait briefly before asserting they are
  live in Studio.
- Never guess that a Roblox method exists (e.g. Humanoid:GetRigInfo() does
  not exist); inspect with FindFirstChild/GetDescendants or verify in the
  Studio Command Bar before calling it.
- Never verify transient states (hit-stop, single-frame impacts) via simulated
  keyboard input — freeze playback and inspect Motor6D.Transform or the
  KeyframeSequence data statically instead.

### Skills
- BloxMind playbooks live in .opencode/skills/: Roblox animation authoring and
  playback (roblox-animation, roblox-animation-runtime), map planning and
  building (roblox-map-planning, roblox-map-building), and client-server
  frameworks (roblox-knit, roblox-profile-service). Load the matching playbook
  before starting that kind of task. For any system built on a Roblox package,
  keep wally.toml and the default.project.json Packages mount in sync with the
  code you generate.
- The Roblox Studio MCP also exposes assistant skills — use them alongside the
  playbooks: rbx-docs-search to verify an uncertain Roblox API before coding
  it, rbx-scene-analysis to understand an existing place before modifying it,
  rbx-unit-test to validate gameplay scripts you wrote, rbx-perf-profiling
  after large map builds or heavy rigs, rbx-device-simulator-lua for
  mobile/device constraints, and rbx-create-skill to capture a reusable
  workflow. Prefer the targeted playbook first, then reach for these.
${AGENTS_MD_MARKER_END}`;

/**
 * Ensure the workspace AGENTS.md carries the managed conventions block.
 * Creates the file when missing, refreshes an existing managed block in
 * place, and appends the block when a user-authored AGENTS.md lacks it —
 * user content outside the markers is never touched.
 */
export async function writeAgentsMarkdown(workspace: string): Promise<void> {
  const target = join(workspace, "AGENTS.md");
  let existing: string | null;
  try {
    existing = await readFile(target, "utf8");
  } catch {
    existing = null;
  }

  if (existing === null) {
    await writeFile(target, `# BloxMind Project\n\n${AGENTS_MD_BLOCK}\n`, "utf8");
    return;
  }

  const begin = existing.indexOf(AGENTS_MD_MARKER_BEGIN);
  const end = existing.indexOf(AGENTS_MD_MARKER_END);
  if (begin !== -1 && end > begin) {
    const refreshed =
      existing.slice(0, begin) +
      AGENTS_MD_BLOCK +
      existing.slice(end + AGENTS_MD_MARKER_END.length);
    await writeFile(target, refreshed, "utf8");
    return;
  }

  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(target, `${existing}${separator}${AGENTS_MD_BLOCK}\n`, "utf8");
}

/**
 * Skill folder names left behind by removed app generations (the Apps/Game/
 * Agent studios). These are the ONLY folders pruning ever deletes — everything
 * else on disk (user-added skills, MCP-provided skills) is preserved so the
 * agent keeps benefiting from every skill available to it.
 */
const STALE_SKILL_DIRECTORIES = new Set([
  "app-canvas-animation",
  "app-data-api",
  "app-web-blueprint",
  "roblox-game",
  "roblox-scripting",
  "roblox-toolbox",
]);

/**
 * Sync one skills root: prune only the known-stale folders, then write the
 * managed pack. Used for both the project workspace and the global config
 * skills directory.
 */
async function syncSkillsRoot(skillsRoot: string): Promise<void> {
  await mkdir(skillsRoot, { recursive: true });
  const existingEntries: Dirent[] = await readdir(skillsRoot, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of existingEntries) {
    if (!entry.isDirectory() || !STALE_SKILL_DIRECTORIES.has(entry.name)) continue;
    await rm(join(skillsRoot, entry.name), { recursive: true, force: true }).catch(() => undefined);
  }

  for (const skill of AGENT_SKILLS) {
    // relativePath is ".opencode/skills/<name>/SKILL.md" — the last two
    // segments are the skill folder + file regardless of which root we sync.
    const target = join(skillsRoot, ...skill.relativePath.split("/").slice(-2));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, skill.content, "utf8");
  }
}

/**
 * Write the managed skill pack into the OpenCode workspace and, when the
 * global config skills directory is provided, into that directory too.
 *
 * Two roots, because OpenCode loads skills from two places:
 * - Project: `<workspace>/.opencode/skills` — only scanned when the workspace
 *   is anchored to a git worktree.
 * - Global: `$XDG_CONFIG_HOME/opencode/skills` — always scanned.
 *
 * Managed files are always overwritten so upgrades ship on relaunch. Pruning
 * deletes ONLY the known-stale folders from removed app generations; anything
 * else on disk (user-added skills) is preserved.
 */
export async function writeAgentSkills(
  workspace: string,
  globalSkillsDirectory?: string,
): Promise<void> {
  await syncSkillsRoot(join(workspace, ".opencode", "skills"));
  if (globalSkillsDirectory) await syncSkillsRoot(globalSkillsDirectory);
  await writeAgentsMarkdown(workspace);
}

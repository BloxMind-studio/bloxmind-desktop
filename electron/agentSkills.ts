import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { KNIT_SKILL } from "../src/agent/skills/knitSkill";
import { MCP_SETUP_SKILL } from "../src/agent/skills/mcpSetupSkill";
import { PROFILE_SERVICE_SKILL } from "../src/agent/skills/profileServiceSkill";
import { ROBLOX_SCRIPT_SKILL } from "../src/agent/skills/robloxScriptSkill";
import { ROBLOX_UI_SKILL } from "../src/agent/skills/robloxUiSkill";

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

## Mandatory Implementation Rules (STRICT — do not skip)

These three rules are mandatory for every animation you generate — violation is a build failure.

1. **Auto-Set Animation Priority to Action (MANDATORY):**
   - Always set \`seq.Priority = Enum.AnimationPriority.Action\` immediately after creating the \`KeyframeSequence\`, before adding any \`Keyframe\`/\`Pose\` children. This ensures the custom animation overrides default \`Idle\`/\`Walking\` tracks. Never leave Priority at default (\`Core\`) or \`Idle\`.
   - Example:
     \`\`\`lua
     local seq = Instance.new("KeyframeSequence")
     seq.Name = "MyAction"
     seq.Priority = Enum.AnimationPriority.Action
     seq.Loop = false
     \`\`\`

2. **Generate Standard Studio Preview Script (MANDATORY — without this the animation appears "not working"):**
   - Automatically inject a client-side test script as a \`LocalScript\` in \`StarterPlayer.StarterPlayerScripts\` (path \`src/client\` → \`StarterPlayerScripts\` via Rojo) that loads the \`KeyframeSequence\` via \`KeyframeSequenceProvider:RegisterKeyframeSequence()\` and plays it on the local character for instant Studio preview. The script **must** explicitly use \`Humanoid:WaitForChild("Animator"):LoadAnimation()\` and \`track:Play()\` — do not use deprecated \`Humanoid:LoadAnimation\`. It must handle both initial spawn AND respawn, ensure \`Animator\` exists, and set \`Priority\` on BOTH seq and track.
   - **Why animations appear broken:** Most "not working" reports are: Priority left at \`Core\`/\`Idle\` (idle overrides it), preview LocalScript never created or placed in \`ServerScriptService\` (server cannot play character animations), \`seq\` variable undefined in preview (forgot to \`require\` builder), or \`Pose.Name\` mismatched rig (R6 \`Right Shoulder\` vs R15 \`RightShoulder\`) — this preview script fixes all four.
   - Template to inject (update \`ReplicatedShared/Animations/MyActionBuilder\` path to your actual builder ModuleScript):
     \`\`\`lua
     -- LocalScript in StarterPlayerScripts — auto-generated preview for R6/R15 (handles respawn)
     local Players = game:GetService("Players")
     local ReplicatedStorage = game:GetService("ReplicatedStorage")
     local player = Players.LocalPlayer
     local ksp = game:GetService("KeyframeSequenceProvider")

     -- 1. Require the builder you just created (MUST return a KeyframeSequence)
     local Builder = require(ReplicatedStorage:WaitForChild("ReplicatedShared"):WaitForChild("Animations"):WaitForChild("MyActionBuilder"))
     local seq = Builder.Build() -- Build() must return Instance.new("KeyframeSequence") with Priority already set
     seq.Priority = Enum.AnimationPriority.Action -- double-ensure override
     seq.Loop = seq.Loop -- keep as authored

     local function playOnCharacter(character)
         local humanoid = character:WaitForChild("Humanoid")
         -- Animator is auto-created by Roblox, but may not exist instantly after spawn
         local animator = humanoid:FindFirstChild("Animator") or humanoid:WaitForChild("Animator", 5)
         if not animator then
             animator = Instance.new("Animator")
             animator.Parent = humanoid
         end
         -- Debug: print rig so you know which Pose set is active
         print("[Preview] RigType:", humanoid.RigType, "isR15:", humanoid.RigType == Enum.HumanoidRigType.R15)
         local ok, animId = pcall(function() return ksp:RegisterKeyframeSequence(seq) end)
         if not ok or not animId then
             warn("[Preview] RegisterKeyframeSequence failed:", animId)
             return
         end
         local anim = Instance.new("Animation")
         anim.AnimationId = animId
         local track = animator:LoadAnimation(anim)
         track.Priority = Enum.AnimationPriority.Action
         track.Looped = seq.Loop
         track:Play()
         print("[Preview] Playing", animId, "Priority:", track.Priority)
     end

     if player.Character then
         task.defer(playOnCharacter, player.Character)
     end
     player.CharacterAdded:Connect(playOnCharacter)
      \`\`\`
   - **Placement check:** The \`LocalScript\` MUST be under \`StarterPlayer.StarterPlayerScripts\` (Rojo: \`src/client/*.client.lua\` → \`StarterPlayerScripts\`). If you placed it in \`ServerScriptService\` or \`ReplicatedStorage\`, it will never run on the client and the animation will appear broken.
   - Verify: Play in Studio (F5), check Output for \`[Preview] Playing\` and that the character visibly plays the custom animation on top of idle. If not, check Output for \`RegisterKeyframeSequence failed\` and dump joints via the Debugging snippet below.

3. **Rig Target Awareness — R6 / R15 Check (MANDATORY):**
   - Before authoring poses, confirm the target rig: \`humanoid.RigType == Enum.HumanoidRigType.R6\` vs \`R15\`. Bone/Pose node naming **must** explicitly match that rig:
     - **R6:** Use \`Torso\`, \`Left Shoulder\` / \`Right Shoulder\`, \`Left Hip\` / \`Right Hip\`, \`Neck\` (Torso→Head), \`RootJoint\` (HumanoidRootPart→Torso). Example: \`Pose.Name = "Right Shoulder"\` for R6 right arm.
     - **R15:** Use \`UpperTorso\`, \`LowerTorso\`, \`RightShoulder\` / \`LeftShoulder\`, \`Right Hip\` / \`Left Hip\` with exact casing (\`UpperTorso\`, \`RightShoulder\`), \`Neck\`, \`Waist\`, \`Root\`. Example: \`Pose.Name = "RightShoulder"\` for R15 right arm.
   - Never mix: a Pose named \`"Right Shoulder"\` (with space) on an R15 rig does nothing, and \`"RightShoulder"\` (no space) on R6 does nothing. Tip: see the practical *How to animate an R6 character in Roblox Studio* video for joint setup — replicate its joint naming before exporting.

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

- [ ] \`KeyframeSequence.Priority == Enum.AnimationPriority.Action\` (overrides idle/walking)
- [ ] Preview \`LocalScript\` exists in \`StarterPlayerScripts\` and runs \`KeyframeSequenceProvider:RegisterKeyframeSequence()\` → \`Humanoid:WaitForChild("Animator"):LoadAnimation()\` → \`track:Play()\` (verified in Play mode)
- [ ] Bone/Pose names match target rig explicitly (R6: \`Torso\`, \`Right Shoulder\` with space; R15: \`UpperTorso\`, \`RightShoulder\` no space) — see R6 video for joint setup
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
  "map_bounds": { "x": 500, "z": 500 },
  "lighting": {
    "lighting_mode": "runtime (shape via Lighting clock/brightness - see Phase 5)",
    "time_of_day": "00:00:00",
    "atmosphere_density": 0.45,
    "fog_color": "#120024"
  },
  "zones": {
    "RoadZones": [{ "center": [0, 0], "width": 16, "axis": "X", "length": 500 }],
    "SidewalkZones": [{ "center": [0, 10], "width": 4, "axis": "X" }],
    "GreenZones": [{ "bounds": { "xMin": -240, "xMax": -20, "zMin": -240, "zMax": -20 }, "material": "Grass" }],
    "BuildingPlots": [{ "center": [40, 40], "size": [30, 30], "clearance": 8 }]
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
- \`zones\` is **mandatory for cities**: Define explicit coordinate zones **before** any placement — \`RoadZones\` (center + width + axis), \`SidewalkZones\` (offset from road edge), \`GreenZones\` (bounds + material Grass/Dirt/Sand for yards/parks/nature strips), \`BuildingPlots\` (center + size + clearance). All placements MUST reference these zones — never random scatter.
- Key by \`type\` from the modular kit (below) and place via exact CFrame
  using \`position\`/\`rotation\`; never hand-placed drifting dimensions.
- Keep this blueprint in the session context so later phases (lighting,
  props, gameplay hooks) can reference exact coordinates.

## Studio execution & Luau API rules (read first)

These rules prevent the most common build failures. Follow them on every
\`execute_luau\` call.

- **Never create \`Instance.new("DirectionalLight")\`** — the class does not exist. Use \`PointLight\`, \`SpotLight\`, \`SurfaceLight\`; directional sunlight comes from \`Lighting\` (see Phase 5).
- **Never read or write \`Lighting.Technology\` at runtime** — not scriptable; throws a security capability error.
- **Service names are exact** — \`game:GetService("Teams")\`, never "TeamService".
- **Do not invent Enums** — no \`Enum.NormalId.NegativeZ\`; valid faces are \`Enum.NormalId.Front\`/\`Back\`/\`Top\`/\`Bottom\`/\`Left\`/\`Right\`.
- **CFrames are CFrame values** — assign \`part.CFrame = CFrame.new(...)\`; never a bare number or single \`Vector3\`.
- **Region3int16** has no direct \`.X\`; read coordinates via \`region.Min.X\` and \`region.Max.X\`.
- **Defensive indexing always** — \`:FindFirstChild()\` before property access; nil-check nested reads (\`if obj and obj.Props then\`).
- Before each \`execute_luau\` call, self-scan the snippet for forbidden tokens (\`DirectionalLight\`, \`TeamService\`, \`NegativeZ\`, \`.Technology\`) and remove them first.
- **NEVER pass nil values into \`Vector3.new()\` or assign nil to a \`.Size\` property.** Always validate x/y/z as non-nil numbers or provide explicit fallbacks (e.g. \`Vector3.new(x or 4, y or 1, z or 2)\`).
- **NEVER pass \`Instance\` objects directly to \`table.concat()\`.** Extract \`.Name\` or other string properties first before concatenating.
- **\`Wedge\` is a Shape (\`part.Shape = Enum.PartType.Wedge\`), NOT a Material.** Valid rock materials are \`Enum.Material.Rock\`, \`Enum.Material.Basalt\`, \`Enum.Material.Slate\`, \`Enum.Material.Pebble\`.
- **NEVER call \`workspace.Terrain:Destroy()\`.** To reset terrain, use \`workspace.Terrain:Clear()\`. For \`FillBlock\`/\`FillRegion\`, ensure every axis >= 1 to avoid 'Extents cannot be empty'.
- **\`SunRaysEffect\` ONLY accepts \`Intensity\` (0-1) and \`Spread\` (0-1).** NEVER set \`.Size\` or \`.SunRaysSize\` ' invalid members.'.
- **ALWAYS verify existence before \`:GetChildren()\`/\`:ClearAllChildren()\`.** \`local folder = workspace:FindFirstChild('MyFolder'); if folder then folder:ClearAllChildren() end\`.
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

### 🏗️ MANDATORY WORKSPACE HIERARCHY & EXECUTION SEQUENCING

To ensure deterministic map architecture and prevent missing folder runtime errors, you MUST adhere to these execution sequence constraints:

1. **Hierarchy First (Pass 0 is Non-Negotiable):**
   - NEVER skip folder hierarchy creation to "minimize tool calls." Creating structured workspace folders is a mandatory prerequisite, NOT an optional optimization.
   - All target root and child folders (\`Map\`, \`Zones\`, \`Kit\`, \`Structures\`, \`Lighting\`, etc.) MUST exist before placing any models, terrain, or CSG operations.

2. **Defensive Folder Creation Pattern:**
   - Every script that references a folder MUST use defensive initialization. NEVER assume a folder exists.
   - Use this standard helper pattern in generated Luau scripts:
     \`\`\`lua
     local function getOrCreateFolder(parent, name)
         local folder = parent:FindFirstChild(name)
         if not folder then
             folder = Instance.new("Folder")
             folder.Name = name
             folder.Parent = parent
         end
         return folder
     end
     \`\`\`

3. **No Lazy Merging:**
   - Separate structural workspace scaffolding from detailed geometry building if combining them risks skipping hierarchy setup.

### 🏙️ CITY GENERATION STANDARDS (Realistic City Mode) — STRICT

Every city must look complete, varied, and lived-in — never a tiny green patch on a dark baseplate, never a flat gray sheet. Violating any sub-rule is a build failure.

1. **Full Ground Coverage First — Mandatory Roblox Smooth Terrain (Phase 0.5 — non-negotiable, QUALITY OVER SPEED):**
   - We care about quality, visual polish, and accuracy, NOT speed. Do NOT rush to generate quick flat Part blocks to finish fast — take all extra steps to build a high-fidelity terrain.
   - Before any road or building, create a single continuous **Smooth Terrain** base that spans the *entire* \`map_bounds\` (e.g. 500×500 or 1000×1000). You **MUST** use \`workspace.Terrain:FillBlock()\` or \`workspace.Terrain:FillRegion()\` with realistic materials (\`Enum.Material.Grass\`, \`Dirt\`, \`Sand\`, \`Asphalt\`) — **NEVER** create flat primitive \`Part\` blocks for the main ground cover (that looks like a flat green sheet of paper and is forbidden). Always add \`workspace.Terrain.Decoration = true\` in the setup script so Roblox renders realistic 3D grass blades on Grass terrain (\`terrain.Decoration = true\` is verified, not \`TerrainDecoration\`). This is Pass 0.5 — no roads/props until the Smooth Terrain foundation exists and is verified. See Terrain Variety rule for layering.

2. **Terrain Variety & Color — NO PLAIN GRAY BASE (MANDATORY):**
   - The city ground must NOT be a solid gray sheet. After the base foundation, layer materials by function: **Asphalt ONLY for roads** (road surface), **Concrete for sidewalks/curbs** (raised 1.5 studs, 3–4 wide, Stone grey), and **mix Grass / Dirt / Sand / LeafyGrass** into zones for yards, parks, medians, and nature strips. Example zoning: downtown blocks → Asphalt roads + Concrete sidewalks, residential yards → Grass/LeafyGrass, park → Grass + Sand paths, industrial → Concrete + Dirt. Verify in Explorer that at least 3 distinct ground materials exist; if the whole city is one gray Part, you have failed.

3. **Realistic Roads & Infrastructure:**
   - Roads are NOT flat gray Parts with decals. Each road segment must include: a central asphalt road Part (Material Asphalt or Concrete, 12–20 studs wide) + *raised concrete sidewalks* on **both** sides (1.5 studs higher, 3–4 studs wide, Material Concrete, Color Stone grey) + continuous curb. At every 30–40 studs along *every* street, place a street light post: \`Instance.new("Model")\` with pole Part (Metal, anchored) + \`PointLight\` or \`SpotLight\` (Brightness 2, Shadows true, Range 30) + optional \`SurfaceLight\` for cone — verified with \`.Enabled = true\`. Lights must be anchored, spaced regularly, and wired to survive Streaming. Prefer toolbox-imported lamp models when available (see Mesh rule).

4. **MANDATORY Toolbox Search & Building Packs — Search First, No Floating Cubes (QUALITY OVER SPEED):**
   - Do NOT rush to generate quick basic Part primitives to finish fast — visual excellence and real Toolbox/Terrain usage are the primary metrics. Take all extra steps to build high-fidelity.
   - **Before generating ANY city script**, you MUST call the Studio MCP toolbox/search tool for core assets using these **exact, quality-tested keywords** (toolbox results are keyword-sensitive — generic terms return park lanterns and boxy primitives):
      - **Street Lighting (CRITICAL — do NOT use park lanterns):** \`Modern Street Light Pole\` or \`Highway Light\` or \`Tall Street Lamp\` — never \`small lamp\` / \`park lantern\`. Small lanterns are 4-stud park lights that look absurd on highways.
        \`\`\`lua
        -- MANDATORY first step for city lighting — wait for results before building
        local streetLamps = callTool("search_toolbox", { query = "Modern Street Light Pole", limit = 5 })
        if not streetLamps or #streetLamps == 0 then streetLamps = callTool("search_toolbox", { query = "Tall Street Lamp", limit = 5 }) end
        if not streetLamps or #streetLamps == 0 then streetLamps = callTool("search_toolbox", { query = "Highway Light", limit = 5 }) end
        -- or: game:GetService("InsertService"):LoadAsset(assetId)
        \`\`\`
      - **Buildings (CRITICAL — no floating cubes / no separated box stacks):** \`Building Pack\` or \`City Skyscraper Model\` or \`Modular Building Mesh\` — MANDATORY for any skyscraper/high-rise. **Stop creating floating, separated box stacks** for skyscrapers (stacked Parts with gaps, floating in air). Import **full completed building Models** and snap their bases **directly to the ground** using \`GetBoundingBox()\` + \`PivotTo()\` on ground Y (see Ground Snap rule). Never leave buildings floating.
      - **Roads:** \`Road System\` or \`Asphalt Road Pack\` or \`Road Intersection Mesh\` — import modular road meshes for main avenues to avoid hollow/gray square cutouts at intersections. Align Parts seamlessly with raised concrete sidewalks (see Roads rule).
      - **Trees/Props:** \`realistic tree\` / \`Tree Pack\` — prefer MeshPart trees over primitive spheres.
   - If search returns a usable model/MeshPart/SpecialMesh (has MeshId/TextureId or is a Model containing MeshParts), **import and clone it** — do NOT rebuild the same shape from primitive gray Parts. Only when search yields zero suitable results may you fall back to manual Part construction, and even then use \`MeshPart\`/ \`SpecialMesh\` patterns below. Log which assets were imported vs. fallback-built in your phase report. Quality and accuracy matter more than speed.

5. **Visual Quality — No Blocky Cities:**
   - Always prefer \`MeshPart\` and \`SpecialMesh\` (FileMesh) for trees, props, lamps, building facades to avoid blocky placeholders. For procedural fallback trees, use the multi-species pattern from this skill; for buildings, use at least 1 MeshPart per facade (window frames, cornices) or a SpecialMesh scale. Set \`MeshPart.CollisionFidelity = Enum.CollisionFidelity.Box\` where needed and keep \`Anchored = true\`.

6. **Precision Alignment & Grid Spacing — No Clipping or Sinking (MANDATORY, ZERO TOLERANCE):**
   - **Zero Floating or Underground Models — Ground Snap (required for EVERY Model/MeshPart/tree/building):** Calculate exact ground Y using \`workspace:Raycast()\` and bounding box heights (\`GetBoundingBox()\`) so every asset sits **flush** on the terrain surface — never floating in mid-air, never buried underground.
      \`\`\`lua
      local function placeModelAt(model: Model, targetPos: Vector3)
          local _, size = model:GetBoundingBox()
          local halfY = size.Y / 2
          local params = RaycastParams.new()
          params.FilterType = Enum.RaycastFilterType.Include
          params.FilterDescendantsInstances = {workspace.Terrain, workspace:FindFirstChild("Map")}
          local origin = Vector3.new(targetPos.X, 250, targetPos.Z)
          local result = workspace:Raycast(origin, Vector3.new(0, -500, 0), params)
          local groundY = result and result.Position.Y or targetPos.Y
          model:PivotTo(CFrame.new(targetPos.X, groundY + halfY, targetPos.Z))
      end
      \`\`\`
   - Apply this to street lamps, trees, building facades, and cars. For single Parts, use \`part.Size.Y/2\` offset similarly. Verify after placement by checking \`model:GetBoundingBox()\` bottom Y ≈ groundY.
   - **Smooth Road Intersections & Modular Roads:** If a toolbox \`Road System\` / \`Asphalt Road Pack\` / \`Road Intersection Mesh\` was imported, use its intersection mesh for every 4-way crossing. If generating roads manually, extend the asphalt Parts seamlessly through the intersection so it is fully filled with Asphalt — never leave a 4×4 empty/gray square cutout, never overlap curb borders over the intersection. Verify in Explorer that the intersection Part (or mesh) is centered, anchored, and at the same Y as the road (sidewalk curbs stop at the intersection edge, they do not cut across it).
   - **Neat Vegetation — Grid Alignment (No Random Placement):** Trees must never block roads or spawn randomly on sidewalks. Align trees **neatly inside dedicated grass zones** (\`Grass\`/\`LeafyGrass\`/\`Dirt\` parcels, parks, nature strips) or lined up along nature strips with **fixed grid spacing (every 18–24 studs)** — never random scatter, never on Asphalt/Concrete. Props (benches, hydrants) follow the same zone rule. Check the blueprint grid before placing: if a tree's grid cell is Asphalt/Concrete, skip it and move to the next green cell.
   - **Grid spacing & Clipping Prevention:** Enforce minimum clearances on the blueprint grid: buildings ≥8 studs from road edge, trees ≥6 studs from buildings/walls, no two models overlapping their bounding boxes. Validate spacing before placement; if a placement would clip, shift to the next free grid cell. This prevents walls clipping roads and trees sinking into pavement. Take your time to verify — do not rush this step.

### 📐 SPATIAL GRID & EXPLICIT ROAD OFFSETS (No Random Spacing) — STRICT

Trees & buildings spawning inside roads is a build failure. You must use a mathematical grid, not random scatter.

1. **Define Blueprint Zones First:** Before placing anything, emit \`zones\` in the blueprint with explicit coordinate zones: \`RoadZones\` (center line + width + axis), \`SidewalkZones\` (derived from RoadZones + half-width + half-sidewalk-width), \`GreenZones\` (Grass/Dirt/Sand bounds for yards, parks, nature strips), and \`BuildingPlots\` (center + footprint size + clearance). Every later placement MUST reference a zone — never pick a random X/Z without a zone check (\`if zone.contains(pos) then place\`).

2. **Calculate Positions Relative to Roads (Mandatory Formula):** Place buildings and trees using mathematical offsets based on the road center and width — never absolute random numbers. For a road centered at \`Center_X\` with width \`W\`, a building plot center **MUST** be placed at:
   \`\`\`lua
   local buildingX = Center_X + (W / 2) + (BuildingWidth / 2) + Clearance -- Clearance ≥8 studs
   local buildingZ = Center_Z + (W / 2) + (BuildingDepth / 2) + Clearance
   -- Example: Road center 0, W=16, Building 30 wide, Clearance 8 → buildingX = 0 + 8 + 15 + 8 = 31
   \`\`\`
   Validate: if \`buildingX\` falls inside \`RoadZones\` or \`SidewalkZones\`, reject and recalculate. Log the formula used in your phase report.

3. **Tree Spacing — GreenZones Only:** Trees **MUST** only spawn inside \`GreenZones\` or nature strips offset **at least 2 studs away from the outer edge of the sidewalk**. Compute sidewalk outer edge as \`SidewalkCenter ± (SidewalkWidth/2)\`, then tree position = \`outerEdge + 2 + (TreeCanopyRadius)\`. Never place a tree on Asphalt/Concrete, never on SidewalkZones, never with distance <2 from sidewalk. Fixed spacing 18–24 studs along the strip, not random.

### 🚦 SMART INTERSECTION NODE HANDLING (No Curb Blocking) — STRICT

Curb walls blocking intersections (continuous sidewalks straight through a crossing, creating a closed square wall) is a build failure.

1. **Intersection Clear Zones:** Calculate **all** road crossing coordinates \`Intersection_X, Intersection_Z\` from \`RoadZones\` intersections (X-axis road × Z-axis road). For each crossing, define a clear boundary box:
   \`\`\`lua
   local clearW = Width_Road1 + (Sidewalk_Width * 2) + 2 -- +2 studs buffer
   local clearH = Width_Road2 + (Sidewalk_Width * 2) + 2
   local clearZone = Region3.new(
       Vector3.new(Intersection_X - clearW/2, -1, Intersection_Z - clearH/2),
       Vector3.new(Intersection_X + clearW/2,  5, Intersection_Z + clearH/2)
   )
   \`\`\`
   No building/tree may be placed inside this box, and no curb may remain inside it.

2. **Segmented Sidewalks (MANDATORY):** Break sidewalks into **separate segments that stop at the edge of an intersection clear zone and resume on the other side**. **NEVER** draw a single continuous sidewalk Part through a crossing. Implement as 4 segments per intersection (north/south/east/west), each ending at \`Intersection_X ± clearW/2\` or \`Intersection_Z ± clearH/2\`. Verify in Explorer that the intersection center contains ONLY Asphalt/Road mesh, no Concrete curb wall.

3. **CSG Subtraction / Toolbox Packs (Preferred):** If you built roads/sidewalks as continuous Parts and they overlap the clear zone, apply \`game:GetService("GeometryService"):SubtractAsync(sidewalkPart, {intersectionVolumePart})\` to cut out the overlap (returns an array — use \`result[1]\`), or **prioritize** toolbox assets \`Crossroad Intersection\` / \`Road Intersection Pack\` / \`Intersection Road Mesh\` which already have correct gaps. Log which method was used (toolbox vs CSG) in your report.

### 🏔️ ORGANIC PROCEDURAL TERRAIN RULES

To ensure realistic landscapes with smooth hills, valleys, and natural elevations:

1. **No Blocky/Spherical Terrain Primitives:**
   - NEVER create individual \`Part\` instances (cubes or spheres) with \`Grass\`, \`Ground\`, or \`Rock\` materials to fake hills or rocks.
   - All open landscapes, hills, and natural environments MUST use native \`workspace.Terrain\`.

2. **Perlin Noise Heightmap Standard:**
   - When generating natural landscapes, the generated Luau script MUST utilize \`math.noise\` to calculate smooth, continuous heightmaps.
   - Standard implementation pattern:
     \`\`\`lua
     local terrain = workspace.Terrain
     local gridSize = 4
     local mapSize = 120
     local frequency = 0.02
     local amplitude = 20

     for x = -mapSize, mapSize, gridSize do
         for z = -mapSize, mapSize, gridSize do
             local height = math.noise(x * frequency, 0, z * frequency) * amplitude
             local position = Vector3.new(x, height / 2, z)
             local size = Vector3.new(gridSize, math.max(height + 12, 4), gridSize)

             -- Base organic grass terrain
             terrain:FillBlock(CFrame.new(position), size, Enum.Material.Grass)

             -- Automatic rock material for high peaks
             if height > 12 then
                 terrain:FillBlock(CFrame.new(x, height, z), Vector3.new(gridSize, 4, gridSize), Enum.Material.Rock)
             end
         end
     end
     \`\`\`

3. **Material Blending:**
   - Automatically transition materials based on elevation (e.g., Grass for lower ground/hills, Rock for peaks, Sand near water).

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

### 🧱 ANTI-CLIPPING & PRECISE SPATIAL POSITIONING

- **No Internal Props:** Lights, lanterns, and decorations MUST NOT be embedded inside structural pillars or walls. Use bounding offsets: \`wall.CFrame * CFrame.new(0, 0, wall.Size.Z/2 + prop.Size.Z/2)\`.
- **Bridge Alignment:** Wooden planks for bridges must be sequentially offset along the Z/X axis without overlapping geometry or misaligned heights.

### 🌲 ADVANCED PROCEDURAL TREE GENERATION (Multi-Species)

When generating trees, the Agent MUST NOT build basic stacked sphere leaves. Implement distinct tree variations:

- **Oak Tree (Standard):** Irregular overlapping leaf blocks rotated with random \`CFrame.Angles\`.
- **Sakura Tree (Cherry Blossom):** Pink/Magenta leaves (\`Color3.fromRGB(255, 183, 197)\`), spreading canopy branches.
- **Pine / Nordic Tree (Coniferous):** Cone-shaped layered canopy tapering upwards.
- **Tree Generation Pattern:**
  \`\`\`lua
  local function createTree(treeType, position)
      local trunk = Instance.new("Part")
      trunk.Size = Vector3.new(1.5, 10, 1.5)
      trunk.CFrame = CFrame.new(position + Vector3.new(0, 5, 0))
      trunk.Material = Enum.Material.Wood
      trunk.Color = Color3.fromRGB(101, 67, 33)
      trunk.Anchored = true
      trunk.Parent = workspace

      -- Canopy logic based on treeType (Sakura / Oak / Pine) with randomized angle variations
      -- ...
  end
  \`\`\`

### 🪨 NATURAL IRREGULAR BOULDERS (No Perfect Spheres)

NEVER generate rocks using pure \`Part\` with \`Shape = Sphere\`.

Construct rocks by combining multiple offset wedge/block parts rotated at random angles (\`math.rad(math.random(0, 360))\`) and varying scales (\`Vector3.new(...)\`), grouped into a \`Model\` or combined via CSG \`UnionAsync\`.

### 🧹 DEBRIS & DECORATION GROUND SNAP

Any branches, rocks, or small environmental props MUST drop precisely to the terrain surface using Raycasting or exact Y-height math so they don't float inside or above grass blades.

## Phase 5 — Lighting and atmosphere

- NEVER read or write \`Lighting.Technology\` at runtime — not scriptable, throws a security capability error. Shape the mood and real-time shadows with \`Lighting.ClockTime\`, \`Lighting.TimeOfDay\`, \`Lighting.Brightness\`, and \`Lighting.GeographicLatitude\` across the plan (dawn 06:30, dusk 17:30, night 00:00).
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
  {
    relativePath: MCP_SETUP_SKILL.relativePath,
    content: MCP_SETUP_SKILL.content,
  },
  {
    relativePath: ROBLOX_SCRIPT_SKILL.relativePath,
    content: ROBLOX_SCRIPT_SKILL.content,
  },
  {
    relativePath: ROBLOX_UI_SKILL.relativePath,
    content: ROBLOX_UI_SKILL.content,
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
- The Roblox Studio MCP also exposes assistant skills - use them alongside the
  playbooks: rbx-docs-search to verify an uncertain Roblox API before coding
  it, rbx-scene-analysis to understand an existing place before modifying it,
  rbx-unit-test to validate gameplay scripts you wrote, rbx-perf-profiling
  after large map builds or heavy rigs, rbx-device-simulator-lua for
  mobile/device constraints, and rbx-create-skill to capture a reusable
  workflow. Prefer the targeted playbook first, then reach for these.
- BloxMind also ships interactive slash commands as skills: /mcp-setup
  (connect Studio to the MCP server - Rojo plugin status, port, handshake),
  /roblox-script (clean, type-safe Luau for src/client|server|shared), and
  /roblox-ui (Roblox UI/UX guidance). When the user runs one of these, or asks
  how to connect/configure/troubleshoot the Studio MCP (e.g. How do I setup
  MCP?, or Studio won't connect), load the matching command skill and return
  its step-by-step guide.

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

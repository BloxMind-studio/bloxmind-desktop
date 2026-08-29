/**
 * UI authoring rules for the /roblox-ui slash command.
 * Packed by electron/agentSkills.ts into `.opencode/skills/roblox-ui/SKILL.md`.
 */
export const ROBLOX_UI_SKILL: { readonly relativePath: string; readonly content: string } = {
  relativePath: ".opencode/skills/roblox-ui/SKILL.md",
  content: `---
name: roblox-ui
description: Build Roblox user interfaces — ScreenGui hierarchies, responsive scaling with UIScale and anchor points, safe areas, and component structure in src/client. Use for any HUD, menu, button, list, or interface request.
license: MIT
---

# Roblox UI Authoring (ScreenGui Architecture)

## Where UI lives

- All UI code and builders go under \`src/client\` (synced into
  **StarterPlayerScripts** via Rojo). UI instances are constructed in code or
  cloned from a template in ReplicatedStorage — never hand-placed by the agent.
- Each screen/component is its own module with a \`mount\`/\`destroy\` lifecycle
  so screens can be opened and closed without leaking connections.

## Layout & scaling rules

- Every element is positioned with **AnchorPoint + UDim2.Scale** and constrained
  by \`UIListLayout\` / \`UIGridLayout\` — never fixed pixel offsets.
- Put one \`UIOffset\`-driven **UIScale** (or \`UISizeConstraint\`) at the root of
  each **ScreenGui** and drive it from the viewport size so the whole screen
  scales cleanly across devices.
- Respect the top inset (roblox-topbar) and mobile safe areas; keep interactive
  hit targets at least 44px-equivalent.

## Component rules

- Use ZIndex deliberately; group with CanvasGroup when fading composites.
- Tween with \`TweenService\`; never poll per-frame for UI state.
- Handle input once — a single \`Activated\` connection per button, disconnected
  on destroy. Ignore \`InputBegan\` duplicates on mobile.

## Component layer (optional frameworks)

- If the project already uses **Fusion** or **Roact** (check Packages /
  wally.toml), build components in that framework and follow its idioms —
  do not mix raw instance code and framework components on the same screen.
- Otherwise write plain instance code with typed props and a shared theme
  module (colors, fonts, padding) under \`src/shared\`.

## Quality bar

- After building, verify via Rojo sync and a Studio playtest: open the screen
  at desktop and mobile aspect ratios before declaring done.
`,
};

/**
 * Luau scripting architecture rules for the /roblox-script slash command.
 * Packed by electron/agentSkills.ts into `.opencode/skills/roblox-script/SKILL.md`.
 */
export const ROBLOX_SCRIPT_SKILL: { readonly relativePath: string; readonly content: string } = {
  relativePath: ".opencode/skills/roblox-script/SKILL.md",
  content: `---
name: roblox-script
description: Write production Roblox Luau gameplay code — server/client/shared structure, type-safe Luau, remote design, and Rojo file layout. Use for any scripting request: gameplay systems, data, combat, remotes, or module architecture.
license: MIT
---

# Roblox Scripting (Luau Architecture Rules)

## Where code lives (Rojo layout)

- \`src/server\` → **ServerScriptService** — authoritative gameplay logic only.
- \`src/client\` → **StarterPlayerScripts** (or \`StarterPlayer/StarterPlayerScripts\`)
  — input, presentation, and effects that never own game state.
- \`src/shared\` → **ReplicatedStorage** — shared modules, types, and config
  both realms import.
- The server is the source of truth. The client only predicts and renders;
  every state-changing decision is validated server-side.

## Language rules

- Write **Type-safe Luau**: use \`--!strict\`, explicit types on exported
  functions, and typed table shapes. Avoid \`any\`.
- Prefer modules over globals; one responsibility per ModuleScript.
- No while-true busy loops — use events, connections, and task schedulers
  (\`task.wait\`, \`task.spawn\`, \`task.defer\`). Always disconnect connections
  on teardown (\`connection:Disconnect()\` or a Maid/Cleanup pattern).

## Client–server boundaries

- Remotes carry typed payloads; validate every argument on the server
  (type, range, ownership, rate limit) before acting on it.
- Never trust the client: no security, economy, or progression logic there.
- Batch frequent updates; do not fire a RemoteEvent per frame.

## Quality bar

- Smallest coherent change; match the style of existing code in the project.
- Handle failure paths: missing instances (\`FindFirstChild\` + nil checks),
  humanoids that may be dead, and parts that may be destroyed mid-frame.
- After writing, run the relevant Studio check (Rojo sync + playtest or a
  targeted unit test) before declaring the task done.
`,
};

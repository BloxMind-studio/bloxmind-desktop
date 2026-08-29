/**
 * Studio MCP connection playbook for the /mcp-setup slash command.
 * Packed by electron/agentSkills.ts into `.opencode/skills/mcp-setup/SKILL.md`.
 */
export const MCP_SETUP_SKILL: { readonly relativePath: string; readonly content: string } = {
  relativePath: ".opencode/skills/mcp-setup/SKILL.md",
  content: `---
name: mcp-setup
description: Connect BloxMind to Roblox Studio via the Studio MCP server and Rojo — enable Studio as MCP server, verify the connection, fix ports, and troubleshoot. Use whenever the user runs /mcp-setup, asks how do I setup MCP, or reports a Studio connection problem.
license: MIT
---

# /mcp-setup — Studio MCP Connection Playbook

Follow this guide end-to-end when the user wants to connect, re-connect, or
troubleshoot the Roblox Studio MCP integration. The integration is the
roblox-studio MCP tool family exposed by the Studio plugin.

## 1. Enable Studio as MCP server in Roblox Studio

1. Open Roblox Studio and load the user's place file.
2. Go to the **Plugins** tab and click **Manage MCP Servers** (the plugin ships
   inside the bundled \`Rojo.rbxm\`).
3. Toggle **Enable Studio as MCP server**. Studio listens on a local HTTP
   port — note the port shown in the plugin window; it changes per session.
4. Confirm the status light turns green before proceeding. If it stays red,
   restart Studio and retry — a stale MCP server from a previous Studio
   process is the most common failure.

## 2. Verify the connection

1. BloxMind automatically spawns a broker that proxies to the Studio MCP port.
2. Ask the agent to run a cheap read-only check (for example an
   \`rbx-scene-analysis\` pass over \`workspace\`) — if it returns, the pipeline
   BloxMind → broker → Studio MCP is healthy.
3. If the check times out, the port is almost always wrong: the Studio MCP
   server re-opens a new port each launch. Re-open **Manage MCP Servers**,
   read the current port, and let BloxMind reconnect.

## 3. Rojo live sync (script changes)

- The agent writes Luau into \`src/server\`, \`src/client\`, and \`src/shared\`
  and syncs it into Studio through a Rojo serve session rooted at the isolated
  workspace \`~/BloxMind/sessions/{sessionId}/\`.
- Never edit scripts directly inside Studio's DataModel while Rojo is serving —
  the filesystem is the source of truth and Studio-side edits get overwritten.

## 4. Troubleshooting checklist

- **The Assistant cannot reach Studio** — Studio closed or the MCP plugin was
  disabled; re-enable Studio as MCP server.
- **Port mismatch / connection refused** — Studio restarted and changed ports;
  re-read the port from Manage MCP Servers.
- **Rojo sync errors** — check that \`default.project.json\` still exists in the
  session workspace and that no other process holds the serve port.
- **Nothing syncs but no error** — confirm the place contains the Rojo Model
  required by the project file and that the plugin reports a green status.
`,
};

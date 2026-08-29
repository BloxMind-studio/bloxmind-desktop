/**
 * Shared helpers for identifying app-shipped BloxMind agent skills.
 *
 * OpenCode bundles embedded default skills (and users can add their own), but
 * only the skill pack shipped by electron/agentSkills.ts may surface as slash
 * commands in the chat "/" picker (see src/hooks/useCommands.ts).
 */
const BLOXMIND_SKILL_NAMES: ReadonlySet<string> = new Set([
  "mcp-setup",
  "roblox-animation",
  "roblox-animation-runtime",
  "roblox-knit",
  "roblox-map-building",
  "roblox-map-planning",
  "roblox-profile-service",
  "roblox-script",
  "roblox-ui",
]);

/** True when the skill/command name belongs to the app-managed BloxMind pack. */
export function isBloxmindSkill(name: string): boolean {
  return BLOXMIND_SKILL_NAMES.has(name);
}

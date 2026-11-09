/**
 * The environment the engine process gets, built from a whitelist.
 *
 * The engine runs as the user, so passing the shell environment verbatim would
 * leak user-global OpenCode settings and secrets into engine sessions. Only
 * the variables a Node/native process genuinely needs are kept; every other
 * `OPENCODE_*` the user exports is dropped. The engine config location is
 * redirected with the XDG paths the caller sets, and OpenCode's automatic
 * discovery of user-global content is disabled separately.
 */

/** Case-insensitive keys worth keeping on every platform. */
const ALWAYS_KEEP: readonly string[] = [
  // Windows essentials the native binary and system DLLs need.
  "systemroot",
  "windir",
  "comspec",
  "systemdrive",
  "programfiles",
  "programfiles(x86)",
  "programw6432",
  "programdata",
  "numprocessors",
  "processor_architecture",
  "processor_level",
  // Temp locations; the engine writes scratch data.
  "temp",
  "tmp",
  "tmpdir",
  // Path; may be overridden by the caller with the shell-derived PATH.
  "path",
  // Home; some native libs look it up directly.
  "home",
  "userprofile",
  "appdata",
  "localappdata",
  // Locale/UTF-8 so engine output is decodable.
  "lang",
  "lc_all",
  "lc_ctype",
] as const;

export interface EngineEnvOverrides {
  /** XDG dirs pinned at the engine's config directory. */
  readonly xdgCache: string;
  readonly xdgConfig: string;
  readonly xdgData: string;
  readonly xdgState: string;
  /** Engine credentials; set by us, never taken from the user. */
  readonly serverPassword: string;
  readonly serverUsername: string;
  // PATH from the user's shell, when resolved; wins over the inherited one.
  readonly shellPath?: string | null;
}

export function buildEngineEnv(
  processEnv: NodeJS.ProcessEnv,
  overrides: EngineEnvOverrides,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (typeof value !== "string") continue;
    if (!ALWAYS_KEEP.includes(key.toLowerCase())) continue;
    env[key] = value;
  }

  // XDG pins are what actually stop user-global config discovery; they must
  // always be the engine's, never inherited.
  env.XDG_CACHE_HOME = overrides.xdgCache;
  env.XDG_CONFIG_HOME = overrides.xdgConfig;
  env.XDG_DATA_HOME = overrides.xdgData;
  env.XDG_STATE_HOME = overrides.xdgState;

  env.OPENCODE_SERVER_PASSWORD = overrides.serverPassword;
  env.OPENCODE_SERVER_USERNAME = overrides.serverUsername;
  // BloxMind's engine runs as the user, so the user's own OpenCode setup would
  // otherwise leak into engine sessions: their instructions, config, commands and
  // agents. Engine-global AGENTS.md (the one at the engine's config dir) still
  // loads, and that's the file Settings → AI Engine edits.
  env.OPENCODE_DISABLE_PROJECT_CONFIG = "1";
  // Verified (anomalyco/opencode docs/CHANGELOG): disables Claude-compat
  // support (`.claude` instructions/skills/commands) so `~/.claude` / project
  // `.claude` content does not leak into engine sessions (0.14 isolation gap).
  env.OPENCODE_DISABLE_CLAUDE_CODE = "1";
  // NOTE: `~/.agents` global skill discovery isolation has no verified dedicated
  // OC2 v2.2.6 disable env var found; do not guess. BloxMind runs with isolated
  // XDG dirs and OPENCODE_DISABLE_PROJECT_CONFIG to limit project/global leakage.

  if (overrides.shellPath) env.PATH = overrides.shellPath;

  return env;
}

import { APP_CONFIG_VERSION } from "../types/desktop";

export interface StoredConfigMigration {
  /** The stored object with every applicable rewrite applied. */
  readonly config: Record<string, unknown>;
  /** True when the caller should persist `config` so the migration runs once. */
  readonly changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Rewrites a stored configuration that predates the current `configVersion`.
 *
 * Gating on the stored version matters because the legacy Max Tokens rewrite is
 * only safe once: old builds persisted a non-functional default of 4096, but a
 * user on a current build may deliberately choose 4096. Without the marker
 * every load reset that choice back to "model's own limit".
 */
export function migrateStoredConfig(stored: unknown): StoredConfigMigration {
  // No stored object (missing file, JSON null/array): the caller falls back to
  // defaults, and nothing should be written over whatever is there.
  if (!isRecord(stored)) return { config: {}, changed: false };

  const config = { ...stored };
  const version = typeof config.configVersion === "number" ? config.configVersion : 0;
  if (version >= APP_CONFIG_VERSION) return { config, changed: false };

  // Old builds persisted the (then non-functional) Max Tokens default of 4096.
  // Map it to the new "model's own limit" sentinel so upgrading never silently
  // caps replies.
  if (config.maxTokens === 4_096) config.maxTokens = 0;
  config.configVersion = APP_CONFIG_VERSION;
  return { config, changed: true };
}

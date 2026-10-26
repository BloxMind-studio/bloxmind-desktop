import { describe, expect, it } from "vitest";

import { migrateStoredConfig } from "@/lib/configMigration";
import { APP_CONFIG_VERSION } from "@/types/desktop";

describe("migrateStoredConfig", () => {
  it("marks a config from before the version marker and rewrites the legacy Max Tokens default", () => {
    const result = migrateStoredConfig({ maxTokens: 4_096, theme: "dark" });

    expect(result.changed).toBe(true);
    expect(result.config.maxTokens).toBe(0);
    expect(result.config.configVersion).toBe(APP_CONFIG_VERSION);
    // Unrelated preferences are preserved.
    expect(result.config.theme).toBe("dark");
  });

  it("keeps a non-legacy Max Tokens value while adding the marker", () => {
    const result = migrateStoredConfig({ maxTokens: 8_192 });

    expect(result.changed).toBe(true);
    expect(result.config.maxTokens).toBe(8_192);
    expect(result.config.configVersion).toBe(APP_CONFIG_VERSION);
  });

  it("leaves a current config alone, including a deliberate 4096 cap", () => {
    const result = migrateStoredConfig({
      configVersion: APP_CONFIG_VERSION,
      maxTokens: 4_096,
    });

    expect(result.changed).toBe(false);
    expect(result.config.maxTokens).toBe(4_096);
  });

  it("does not downgrade a config written by a newer build", () => {
    const result = migrateStoredConfig({
      configVersion: APP_CONFIG_VERSION + 1,
      maxTokens: 4_096,
    });

    expect(result.changed).toBe(false);
    expect(result.config.configVersion).toBe(APP_CONFIG_VERSION + 1);
    expect(result.config.maxTokens).toBe(4_096);
  });

  it("treats a non-object store as absent without rewriting it", () => {
    expect(migrateStoredConfig(null)).toEqual({ config: {}, changed: false });
    expect(migrateStoredConfig("nope")).toEqual({ config: {}, changed: false });
    expect(migrateStoredConfig([1, 2])).toEqual({ config: {}, changed: false });
  });
});

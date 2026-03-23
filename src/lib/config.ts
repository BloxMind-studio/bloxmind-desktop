import { LazyStore } from "@tauri-apps/plugin-store";

export interface AppConfig {
  lastModel: string | null;
  hiddenModels: string[];
}

const store = new LazyStore("bloxbot-store.json");
const CONFIG_KEY = "config";
const DEFAULT_CONFIG: AppConfig = { lastModel: null, hiddenModels: [] };

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await store.get<AppConfig>(CONFIG_KEY);
    if (raw) return raw;
  } catch {
    // Corrupted data, start fresh
  }
  return DEFAULT_CONFIG;
}

export async function patchConfig(patch: Partial<AppConfig>): Promise<void> {
  const current = await loadConfig();
  await store.set(CONFIG_KEY, { ...current, ...patch });
}

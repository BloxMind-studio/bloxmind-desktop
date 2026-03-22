export interface AppConfig {
  lastModel: string | null;
  hiddenModels: string[];
}

const STORAGE_KEY = "bloxbot:config";

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Corrupted data, start fresh
  }
  return { lastModel: null, hiddenModels: [] };
}

export function patchConfig(patch: Partial<AppConfig>): void {
  const current = loadConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
}

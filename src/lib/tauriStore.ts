import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_KEY = "session-ids";
const SESSION_MODELS_KEY = "session-models";
export const tauriStore = new LazyStore("bloxbot-store.json");

export async function loadOwnSessionIds(): Promise<Set<string>> {
  try {
    const raw = await tauriStore.get<string[]>(STORE_KEY);
    if (raw) return new Set(raw);
  } catch {
    // Corrupted data, start fresh
  }
  return new Set();
}

export async function persistOwnSessionIds(ids: Set<string>): Promise<void> {
  await tauriStore.set(STORE_KEY, [...ids]);
}

export async function loadSessionModels(): Promise<Record<string, string>> {
  try {
    const raw = await tauriStore.get<Record<string, string>>(SESSION_MODELS_KEY);
    if (raw) return raw;
  } catch {
    // Corrupted data, start fresh
  }
  return {};
}

export async function persistSessionModels(models: Record<string, string>): Promise<void> {
  await tauriStore.set(SESSION_MODELS_KEY, models);
}

export { SESSION_MODELS_KEY };

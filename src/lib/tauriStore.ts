const SESSION_MODELS_KEY = "bloxbot:session-models";

export function loadSessionModels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SESSION_MODELS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Corrupted data, start fresh
  }
  return {};
}

export function persistSessionModels(models: Record<string, string>): void {
  localStorage.setItem(SESSION_MODELS_KEY, JSON.stringify(models));
}

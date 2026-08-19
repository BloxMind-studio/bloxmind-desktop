import type { AppChatMessage, AppGeneratedFile, SavedApp } from "./types";

const APPS_KEY = "BloxMind-apps-studio-apps";

/** Approximate serialized byte size of a saved-app list (for quota warnings). */
export function estimateStorageBytes(apps: readonly SavedApp[]): number {
  try {
    const json = JSON.stringify(apps);
    return typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(json).length
      : json.length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Warn before this approximate size is reached (browser quota is ~5 MB). */
const STORAGE_WARN_BYTES = 4 * 1024 * 1024;

export interface SavedAppStorageOptions {
  /** Called when persistence fails or approaches the quota. Default: console warn. */
  onError?: (message: string, cause?: unknown) => void;
}

/** All-in-one storage backend bound to a single localStorage key. */
export interface SavedAppStorage {
  load: () => SavedApp[];
  persist: (apps: readonly SavedApp[]) => void;
  upsert: (app: SavedApp) => SavedApp[];
  delete: (id: string) => SavedApp[];
  get: (id: string) => SavedApp | null;
}

export function createSavedAppStorage(
  storageKey: string,
  options: SavedAppStorageOptions = {},
): SavedAppStorage {
  const { onError = (message: string, cause?: unknown) => console.warn(message, cause) } = options;
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isSavedApp).sort((a, b) => b.updatedAt - a.updatedAt);
      } catch (cause) {
        onError("Couldn't read your saved projects from local storage.", cause);
        return [];
      }
    },
    persist(apps) {
      try {
        const size = estimateStorageBytes(apps);
        if (size >= STORAGE_WARN_BYTES) {
          onError(
            `Your saved projects are approaching the browser's storage limit (${Math.round(size / (1024 * 1024))} MB). Delete some to keep saving safely.`,
          );
        }
        window.localStorage.setItem(storageKey, JSON.stringify(apps));
      } catch (cause) {
        onError("Couldn't save your project — the browser's local storage may be full.", cause);
      }
    },
    upsert(app) {
      const apps = this.load();
      const index = apps.findIndex((existing) => existing.id === app.id);
      const next = index === -1 ? [app, ...apps] : [...apps];
      if (index !== -1) next[index] = app;
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      this.persist(next);
      return next;
    },
    delete(id) {
      const next = this.load().filter((app) => app.id !== id);
      this.persist(next);
      return next;
    },
    get(id) {
      return this.load().find((app) => app.id === id) ?? null;
    },
  };
}

const appsStorage = createSavedAppStorage(APPS_KEY);

function isGeneratedFile(value: unknown): value is AppGeneratedFile {
  return (
    !!value &&
    typeof (value as AppGeneratedFile).path === "string" &&
    typeof (value as AppGeneratedFile).content === "string"
  );
}

function isChatMessage(value: unknown): value is AppChatMessage {
  return (
    !!value &&
    typeof (value as AppChatMessage).id === "string" &&
    ((value as AppChatMessage).role === "user" || (value as AppChatMessage).role === "assistant") &&
    typeof (value as AppChatMessage).text === "string"
  );
}

function isSavedApp(value: unknown): value is SavedApp {
  if (!value || typeof value !== "object") return false;
  const app = value as Partial<SavedApp>;
  return (
    typeof app.id === "string" &&
    typeof app.name === "string" &&
    (app.status === "in-progress" || app.status === "completed") &&
    typeof app.createdAt === "number" &&
    typeof app.updatedAt === "number" &&
    !!app.project &&
    typeof app.project.name === "string" &&
    Array.isArray(app.project.files) &&
    app.project.files.every(isGeneratedFile) &&
    Array.isArray(app.messages) &&
    app.messages.every(isChatMessage)
  );
}

export function loadSavedApps(): SavedApp[] {
  return appsStorage.load();
}

/** Insert a new saved app or update the entry with a matching id. */
export function upsertSavedApp(app: SavedApp): SavedApp[] {
  return appsStorage.upsert(app);
}

export function deleteSavedApp(id: string): SavedApp[] {
  return appsStorage.delete(id);
}

export function getSavedApp(id: string): SavedApp | null {
  return appsStorage.get(id);
}

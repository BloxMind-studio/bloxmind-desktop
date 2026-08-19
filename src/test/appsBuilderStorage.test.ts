import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSavedAppStorage,
  deleteSavedApp,
  estimateStorageBytes,
  getSavedApp,
  loadSavedApps,
  upsertSavedApp,
} from "@/lib/appsBuilder/storage";
import type { AppProject, SavedApp } from "@/lib/appsBuilder/types";

const project: AppProject = {
  name: "Task Flow",
  description: "A todo list app",
  target: "mobile",
  theme: "dark",
  engine: "web",
  entry: "src/main.tsx",
  files: [
    { path: "package.json", content: '{ "name": "task-flow" }' },
    { path: "src/App.tsx", content: "export default () => <h1>Hi</h1>;" },
  ],
};

function makeApp(overrides: Partial<SavedApp> = {}): SavedApp {
  return {
    id: "task-flow",
    name: "Task Flow",
    description: "A todo list app",
    status: "in-progress",
    createdAt: 1000,
    updatedAt: 1000,
    project,
    messages: [{ id: "m1", role: "user", text: "Build a todo app" }],
    ...overrides,
  };
}

beforeEach(() => window.localStorage.clear());

describe("appsBuilder storage", () => {
  it("returns an empty list when nothing is saved", () => {
    expect(loadSavedApps()).toEqual([]);
  });

  it("upserts a new app and returns the sorted list", () => {
    const apps = upsertSavedApp(makeApp({ updatedAt: 2000 }));
    expect(apps).toHaveLength(1);
    expect(loadSavedApps()[0].name).toBe("Task Flow");
  });

  it("updates an existing app instead of duplicating it", () => {
    upsertSavedApp(makeApp({ id: "task-flow", updatedAt: 1000 }));
    upsertSavedApp(makeApp({ id: "task-flow", updatedAt: 3000, name: "Task Flow v2" }));
    const apps = loadSavedApps();
    expect(apps).toHaveLength(1);
    expect(apps[0].name).toBe("Task Flow v2");
    expect(apps[0].updatedAt).toBe(3000);
  });

  it("sorts apps by most recently updated first", () => {
    upsertSavedApp(makeApp({ id: "a", name: "A", updatedAt: 1000 }));
    upsertSavedApp(makeApp({ id: "b", name: "B", updatedAt: 2000 }));
    expect(loadSavedApps().map((app) => app.id)).toEqual(["b", "a"]);
  });

  it("deletes an app by id", () => {
    upsertSavedApp(makeApp({ id: "a" }));
    upsertSavedApp(makeApp({ id: "b" }));
    deleteSavedApp("a");
    expect(loadSavedApps().map((app) => app.id)).toEqual(["b"]);
  });

  it("gets a single app by id", () => {
    upsertSavedApp(makeApp({ id: "a" }));
    expect(getSavedApp("a")?.id).toBe("a");
    expect(getSavedApp("missing")).toBeNull();
  });

  it("ignores corrupt entries in storage", () => {
    window.localStorage.setItem(
      "BloxMind-apps-studio-apps",
      JSON.stringify([{ id: "broken" }, makeApp({ id: "ok" })]),
    );
    expect(loadSavedApps().map((app) => app.id)).toEqual(["ok"]);
  });
});

describe("estimateStorageBytes", () => {
  it("returns a finite size that grows with project content", () => {
    const small = estimateStorageBytes([makeApp()]);
    const big = estimateStorageBytes([makeApp({ name: "x".repeat(10_000) })]);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
  });

  it("handles non-serializable input without throwing", () => {
    const circular: SavedApp = makeApp();
    (circular as unknown as Record<string, unknown>).self = circular;
    expect(Number.isFinite(estimateStorageBytes([circular]))).toBe(false);
  });
});

describe("createSavedAppStorage observability", () => {
  it("surfaces a quota write failure instead of swallowing it", () => {
    const onError = vi.fn();
    const storage = createSavedAppStorage("test-quota-key", { onError });
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      storage.persist([makeApp()]);
    } finally {
      spy.mockRestore();
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/couldn't save|local storage may be full/i);
    expect(onError.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it("reports a corrupt read and still returns an empty list", () => {
    const onError = vi.fn();
    const storage = createSavedAppStorage("test-read-key", { onError });
    window.localStorage.setItem("test-read-key", "{ not valid json");
    expect(storage.load()).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

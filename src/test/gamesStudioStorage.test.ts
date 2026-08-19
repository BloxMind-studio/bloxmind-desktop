import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteSavedGame,
  getSavedGame,
  loadSavedGames,
  upsertSavedGame,
} from "@/lib/gamesStudio/storage";
import type { AppProject, SavedApp } from "@/lib/appsBuilder/types";

const project: AppProject = {
  name: "Sky Racers",
  description: "A low-poly racing game",
  target: "desktop",
  theme: "dark",
  engine: "3d",
  entry: "src/main.tsx",
  files: [
    { path: "package.json", content: '{ "name": "sky-racers" }' },
    { path: "src/App.tsx", content: "export default () => <h1>Game</h1>;" },
  ],
};

function makeGame(overrides: Partial<SavedApp> = {}): SavedApp {
  return {
    id: "sky-racers",
    name: "Sky Racers",
    description: "A low-poly racing game",
    status: "in-progress",
    createdAt: 1000,
    updatedAt: 1000,
    project,
    messages: [{ id: "m1", role: "user", text: "Build a racing game" }],
    ...overrides,
  };
}

beforeEach(() => window.localStorage.clear());

describe("gamesStudio storage", () => {
  it("returns an empty list when nothing is saved", () => {
    expect(loadSavedGames()).toEqual([]);
  });

  it("upserts a new game and returns the sorted list", () => {
    const games = upsertSavedGame(makeGame({ updatedAt: 2000 }));
    expect(games).toHaveLength(1);
    expect(loadSavedGames()[0].name).toBe("Sky Racers");
  });

  it("updates an existing game instead of duplicating it", () => {
    upsertSavedGame(makeGame({ id: "sky-racers", updatedAt: 1000 }));
    upsertSavedGame(makeGame({ id: "sky-racers", updatedAt: 3000, name: "Sky Racers 2" }));
    const games = loadSavedGames();
    expect(games).toHaveLength(1);
    expect(games[0].name).toBe("Sky Racers 2");
    expect(games[0].updatedAt).toBe(3000);
  });

  it("keeps games separate from saved apps", () => {
    upsertSavedGame(makeGame());
    expect(loadSavedGames()).toHaveLength(1);
  });

  it("deletes a game by id", () => {
    upsertSavedGame(makeGame({ id: "a" }));
    upsertSavedGame(makeGame({ id: "b" }));
    deleteSavedGame("a");
    expect(loadSavedGames().map((game) => game.id)).toEqual(["b"]);
  });

  it("gets a single game by id", () => {
    upsertSavedGame(makeGame({ id: "a" }));
    expect(getSavedGame("a")?.id).toBe("a");
    expect(getSavedGame("missing")).toBeNull();
  });

  it("ignores corrupt entries in storage", () => {
    window.localStorage.setItem(
      "BloxMind-games-studio-games",
      JSON.stringify([{ id: "broken" }, makeGame({ id: "ok" })]),
    );
    expect(loadSavedGames().map((game) => game.id)).toEqual(["ok"]);
  });
});
import { createSavedAppStorage } from "@/lib/appsBuilder/storage";
import type { SavedApp } from "@/lib/appsBuilder/types";

/**
 * Games mode keeps its own saved-game list, separate from the Apps mode
 * gallery, so the two studios never mix. Reuses the shared storage factory
 * (and its validation) bound to a games-only localStorage key.
 */
const GAMES_KEY = "BloxMind-games-studio-games";

const gamesStorage = createSavedAppStorage(GAMES_KEY);

export function loadSavedGames(): SavedApp[] {
  return gamesStorage.load();
}

export function upsertSavedGame(game: SavedApp): SavedApp[] {
  return gamesStorage.upsert(game);
}

export function deleteSavedGame(id: string): SavedApp[] {
  return gamesStorage.delete(id);
}

export function getSavedGame(id: string): SavedApp | null {
  return gamesStorage.get(id);
}

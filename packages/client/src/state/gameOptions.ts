import type { VictoryCondition } from "@fairy/shared";
import { DEFAULT_VICTORY_CONDITION, DEFAULT_PUSH_PULL_SIDEWAYS_ALLOWED } from "@fairy/shared";

// Local persistence for the Options screen's choices (which cards are
// disabled, the default victory condition) — these apply to the *next* game
// this browser creates. There's no server-side account system, so this is
// purely a per-browser preference via localStorage, read by CreateRoom.tsx.

const STORAGE_KEY = "fairy_game_options";

export type GameOptions = {
  disabledCardIds: string[];
  victoryCondition: VictoryCondition;
  pushPullSidewaysAllowed: boolean;
};

export function defaultGameOptions(): GameOptions {
  return { disabledCardIds: [], victoryCondition: DEFAULT_VICTORY_CONDITION, pushPullSidewaysAllowed: DEFAULT_PUSH_PULL_SIDEWAYS_ALLOWED };
}

export function loadGameOptions(): GameOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultGameOptions();
    const parsed = JSON.parse(raw);
    return {
      disabledCardIds: Array.isArray(parsed.disabledCardIds) ? parsed.disabledCardIds : [],
      victoryCondition: parsed.victoryCondition ?? DEFAULT_VICTORY_CONDITION,
      pushPullSidewaysAllowed: typeof parsed.pushPullSidewaysAllowed === "boolean" ? parsed.pushPullSidewaysAllowed : DEFAULT_PUSH_PULL_SIDEWAYS_ALLOWED,
    };
  } catch {
    return defaultGameOptions();
  }
}

export function saveGameOptions(options: GameOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // localStorage may be unavailable (private mode) — options just won't persist across reloads.
  }
}

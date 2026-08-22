import { VictoryCondition } from "../types";

// Central home for every rule constant called out in the spec as "keep this
// configurable / a named constant" rather than buried in engine logic.
// Anything with a TODO_RULE_CONFIRMATION comment is a best-guess default the
// rules author should confirm — see RULES_TODO.md at the project root.

// Matches the "5x5 Hexboard" reference art: a hexagon 5 hexes per side
// (radius 4 from the Portal), 61 hexes total.
export const BOARD_EDGE_LENGTH = 5;

export const ACTIONS_PER_TURN = 3;

// Confirmed by the user. Starting hand size (5, or 8 for Moonlight Pixies)
// is applied in setup.ts. The discard-and-draw action's draw count is kept
// as its own separate constant below — it's an unrelated, optional,
// once-per-turn action, not this cap.
export const HAND_SIZE_START = 5;
export const HAND_SIZE_MAX = 7;
export const MOONLIGHT_PIXIES_HAND_SIZE_START = 8;
export const MOONLIGHT_PIXIES_HAND_SIZE_MAX = 10;

// Confirmed by the user: Discard & Draw discards the player's ENTIRE hand
// (no selection — unlike the old "discard any number you choose" flow) and
// draws exactly this many cards back, flat, regardless of Domain.
export const DISCARD_DRAW_COUNT = 4;

// TODO_RULE_CONFIRMATION: physical game says "lay the Human down"; whether
// clearing a lure removes the whole stack or just the top lure is not fully
// specified in the source material. Default: remove the whole stack.
export type LureClearMode = "full-stack" | "single-lure";
export const LURE_CLEAR_MODE: LureClearMode = "full-stack";

// TODO_RULE_CONFIRMATION: exact bonus-step count for Acceleration markers.
export const ACCELERATION_BONUS_STEPS = 1;

export const TOADSTOOL_MAX_ON_BOARD = 2;

// TODO_RULE_CONFIRMATION: Veil of Mist's card text doesn't give an exact
// number of spaces for "lures only within range this round" — 1 is the
// smallest cap that still reads as a meaningful restriction.
export const VEIL_OF_MIST_ATTRACTION_RADIUS = 1;

// Moon's Ascendance: Humans move this many spaces per Movement Phase step
// instead of the normal 1, for the rest of the round it's played.
export const MOONS_ASCENDANCE_MOVES_PER_HUMAN = 2;

// Victory condition, confirmed by the user: points mode ends the instant
// someone reaches the target (default 8); turns mode plays a fixed number
// of rounds, extending on a tie, then falling back to the nearest-townsfolk
// tiebreak (or a draw) — see engine/victory.ts.
export const DEFAULT_VICTORY_CONDITION: VictoryCondition = { kind: "points", targetScore: 8 };
export const DEFAULT_TURN_LIMIT = 10;
export const TIE_EXTENSION_ROUND_LIMIT = 12;

// Default response-window timer, in seconds. `null` chosen in lobby means
// "no timer, wait for every eligible player."
export const DEFAULT_RESPONSE_TIMER_SEC: number | null = null;

// Confirmed by the user: push/pull abilities and cards are restricted to
// directions relative to the acting player's own Domain (pull only
// toward/sideways, push only away/sideways, relative to the nearest Domain
// hex — see hex/coordinates.ts::classifyDirections) — never straight toward
// a domain for a push, or straight away for a pull. Whether "sideways" (the
// two directions that don't change distance to the Domain) count as legal
// options is a per-room toggle; this is its default when a room doesn't set
// one explicitly.
export const DEFAULT_PUSH_PULL_SIDEWAYS_ALLOWED = true;

// Room cleanup: how long a room may sit with zero connected players before
// the server frees it from memory.
export const ROOM_INACTIVITY_TIMEOUT_MS = 1000 * 60 * 60 * 6; // 6 hours

// Reconnect token: bytes of entropy for the secret token.
export const RECONNECT_TOKEN_BYTES = 32;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

// Which of the board's 6 edges (numbered 1-6, clockwise from the
// upper-right edge) get a Domain board attached, by player count. Players
// are randomly assigned to these side numbers at setup — see
// buildInitialGameState. Confirmed by the user against the physical layout.
export const DOMAIN_SIDE_ASSIGNMENTS: Record<number, number[]> = {
  2: [1, 4],
  3: [2, 4, 6],
  4: [2, 3, 5, 6],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
};

/**
 * Default tie-break when multiple players cross the target score within the
 * same indivisible effect: first-player order. Isolated as a function so an
 * alternate rule can be swapped in without touching victory-check call sites.
 */
export function resolveSimultaneousVictoryTie(
  candidatePlayerIdsInFirstPlayerOrder: string[]
): string {
  return candidatePlayerIdsInFirstPlayerOrder[0];
}

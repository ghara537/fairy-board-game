import type { DomainId, GamePhase } from "@fairy/shared";

/** Three-letter Domain codes for the compact layout's chips and on-board
 * banners. Every one of them is only ever shown next to something that taps
 * through to the full name (a mat lightbox, a player popup, the scores
 * sheet) — an abbreviation with no way to expand it is a riddle, not a UI. */
export const DOMAIN_ABBR: Record<DomainId, string> = {
  "ocean-sirens": "SIR",
  "forest-elves": "ELF",
  "wind-djinn": "DJN",
  "river-nymphs": "NYM",
  "moonlight-pixies": "PIX",
  "earth-gnomes": "GNM",
  "fire-sprites": "SPR",
  "frost-spirits": "FRS",
  "shadow-fae": "FAE",
  dreamweavers: "DRM",
};

/** Short phase label + the long form its popup expands to. */
export const PHASE_LABELS: Record<GamePhase, { abbr: string; full: string }> = {
  lobby: { abbr: "LOBBY", full: "Waiting in the lobby" },
  setup: { abbr: "SETUP", full: "Setting up the board" },
  "starting-abilities": { abbr: "START", full: "Starting abilities are resolving" },
  "player-turn": { abbr: "TURN", full: "Player turns" },
  "response-window": { abbr: "RESP", full: "Response window — Instants may be played" },
  "human-movement": { abbr: "MOVE", full: "Human Movement Phase" },
  "human-spawn": { abbr: "SPAWN", full: "New Humans are arriving through the Portal" },
  "round-cleanup": { abbr: "CLEAN", full: "End-of-round cleanup" },
  "game-over": { abbr: "END", full: "Game over" },
};

/** Card timing as a single glyph: ⚡ plays out of turn, ▸ costs an action. */
export function timingGlyph(timing: string): string {
  return timing === "instant" ? "⚡" : "▸";
}

/** Up to two letters standing in for a player's name in a turn-order chip —
 * initials of the first two words, else the first two characters. */
export function playerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/** Trims a long card/ability name to fit a chip, keeping whole words where
 * it can. The full name is always one tap away in the expanded detail. */
export function shortName(name: string, max = 16): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

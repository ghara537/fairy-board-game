/** Every glyph the board draws a game piece with. Shared so the compact
 * layout's legend popup can never drift from what's actually on the board. */

export const HUMAN_ICONS: Record<string, string> = {
  adult: "🧑",
  child: "🧒",
  baby: "👶",
  lover: "💞",
  mother: "🤱",
  hunter: "🏹",
};

export const OBSTACLE_ICONS: Record<string, string> = {
  tree: "🌲",
  stone: "🪨",
  toadstool: "🍄",
};

export const PORTAL_ICON = "🌀";
export const ACCEL_MARKER_ICON = "⚡";

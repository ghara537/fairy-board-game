import type { PersonalizedGameView, PlayerId } from "@fairy/shared";

const PALETTE = ["#e05c5c", "#5c8ee0", "#e0c15c", "#7ad17a", "#c07ae0", "#e08c5c"];

export function computePlayerColors(view: PersonalizedGameView | null): Record<PlayerId, string> {
  if (!view) return {};
  const out: Record<PlayerId, string> = {};
  [...view.players]
    .sort((a, b) => a.seat - b.seat)
    .forEach((p, i) => {
      out[p.id] = PALETTE[i % PALETTE.length];
    });
  return out;
}

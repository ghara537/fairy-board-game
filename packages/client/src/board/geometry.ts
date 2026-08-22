import type { Axial } from "@fairy/shared";

// Presentation-only pixel math (pointy-top hexes, arranged in rows).
// Deliberately kept separate from the shared hex/coordinates module, which
// is pure board logic with no notion of pixels — spec section 6: "keep
// board appearance separate from board logic." Confirmed by the user: the
// overall board silhouette should have a flat edge at the top and bottom
// (2 hexes wide), not a single hex pointing straight up/down — this pairing
// (pointy-top individual hexes + row-based axial formula) is what produces
// that silhouette; verified by rendering both orientations and comparing.
// It's a pure rotation of the same axial coordinates — no game logic reads
// pixel space, so this has zero effect on movement/targeting/hit-testing.

export function axialToPixel(a: Axial, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (a.q + a.r / 2);
  const y = size * 1.5 * a.r;
  return { x, y };
}

// `extraRotationDeg`: HexBoard rotates the whole board per-viewer (see
// HexBoard.tsx's `rotationDeg`) so the viewing player's own Domain always
// renders at the bottom — every hex tile's own corners need to turn by that
// same amount, or the rotated tiling would leave gaps between neighbors.
export function hexCornerPoints(center: { x: number; y: number }, size: number, extraRotationDeg = 0): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i + 30 + extraRotationDeg);
    points.push(`${center.x + size * Math.cos(angle)},${center.y + size * Math.sin(angle)}`);
  }
  return points.join(" ");
}

/** Rotates point `p` by `deg` around `center` — the one primitive HexBoard needs to reorient every position for the per-viewer "your Domain is always at the bottom" rotation. */
export function rotatePoint(p: { x: number; y: number }, deg: number, center: { x: number; y: number }): { x: number; y: number } {
  const rad = (Math.PI / 180) * deg;
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: center.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

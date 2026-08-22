// Axial hex coordinates. "Pointy" layout is irrelevant to the math — this module
// is pure geometry, independent of how the client renders hexes.

export type Axial = { q: number; r: number };

export function axialKey(a: Axial): string {
  return `${a.q},${a.r}`;
}

export function keyToAxial(key: string): Axial {
  const [q, r] = key.split(",").map(Number);
  return { q, r };
}

export function axialEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

// The six axial direction vectors, in a fixed clockwise-from-top order.
// This ordering is the canonical "direction index" used by movement/ability
// code (e.g. Wind Djinn's Gust, "push two spaces in a straight line").
export const HEX_DIRECTIONS: Axial[] = [
  { q: 0, r: -1 }, // N
  { q: 1, r: -1 }, // NE
  { q: 1, r: 0 }, // SE
  { q: 0, r: 1 }, // S
  { q: -1, r: 1 }, // SW
  { q: -1, r: 0 }, // NW
];

export function axialAdd(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function axialSubtract(a: Axial, b: Axial): Axial {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function axialScale(a: Axial, factor: number): Axial {
  return { q: a.q * factor, r: a.r * factor };
}

export function neighbor(a: Axial, directionIndex: number): Axial {
  return axialAdd(a, HEX_DIRECTIONS[((directionIndex % 6) + 6) % 6]);
}

export function neighbors(a: Axial): Axial[] {
  return HEX_DIRECTIONS.map((d) => axialAdd(a, d));
}

/** The `HEX_DIRECTIONS` index of the single step from `a` to its neighbor `b`, or null if `b` isn't one of `a`'s 6 neighbors. */
export function neighborDirectionIndex(a: Axial, b: Axial): number | null {
  const idx = HEX_DIRECTIONS.findIndex((d) => a.q + d.q === b.q && a.r + d.r === b.r);
  return idx === -1 ? null : idx;
}

// Cube coordinates are used only for distance math (x + y + z === 0).
export function axialToCube(a: Axial): { x: number; y: number; z: number } {
  const x = a.q;
  const z = a.r;
  const y = -x - z;
  return { x, y, z };
}

// Straight-line hex distance, ignoring obstacles. This is NOT the distance
// used for lure attraction (which must be shortest *legal path* — see
// hex/pathfinding.ts). Use this only for geometry that explicitly wants
// as-the-crow-flies distance (e.g. bounding a search radius).
export function axialDistance(a: Axial, b: Axial): number {
  const ac = axialToCube(a);
  const bc = axialToCube(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
}

export type DirectionClass = "toward" | "sideways" | "away";

/**
 * Classifies each of `pos`'s 6 neighbor directions (aligned with
 * `HEX_DIRECTIONS`, same index) by how stepping that way changes plain hex
 * distance to the nearest hex in `targetHexes`: "toward" (strictly closer),
 * "sideways" (unchanged — a tangential step), or "away" (strictly farther).
 * Used to restrict push/pull abilities to directions relative to a player's
 * Domain — confirmed by the user: pull only toward/sideways, push only
 * away/sideways, never in the "wrong" direction outright.
 */
export function classifyDirections(pos: Axial, targetHexes: Axial[]): DirectionClass[] {
  const distanceToNearest = (p: Axial) => Math.min(...targetHexes.map((t) => axialDistance(p, t)));
  const current = distanceToNearest(pos);
  return HEX_DIRECTIONS.map((d) => {
    const next = distanceToNearest(axialAdd(pos, d));
    if (next < current) return "toward";
    if (next > current) return "away";
    return "sideways";
  });
}

/** All hexes forming a ring of the given radius around `center` (radius 0 => [center]). */
export function hexRing(center: Axial, radius: number): Axial[] {
  if (radius === 0) return [center];
  const results: Axial[] = [];
  let cell = axialAdd(center, axialScale(HEX_DIRECTIONS[4], radius)); // start SW * radius
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push(cell);
      cell = neighbor(cell, side);
    }
  }
  return results;
}

/**
 * Generates the axial coordinates for a regular hexagonal board whose outer
 * edge has `edgeLength` hexes per side. For edgeLength = 5 (the default,
 * `BOARD_EDGE_LENGTH`) this produces the row-length sequence
 * 5,6,7,8,9,8,7,6,5 with one exact center hex at {q:0, r:0} — the shape
 * required by the spec.
 */
export function generateHexagonalBoard(edgeLength: number): Axial[] {
  const radius = edgeLength - 1;
  const cells: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      cells.push({ q, r });
    }
  }
  return cells;
}

/**
 * The 4 hexes forming a Domain board attached to one edge of a hexagonal
 * board — physical 4-hex extensions that sit just outside the main board
 * (see the "domain_markers_4hexes_5x5grid" reference art). `side` is 1-6,
 * numbered clockwise starting from the upper-right edge (matches the
 * client's rendering orientation and `DOMAIN_SIDE_ASSIGNMENTS`). Each
 * returned hex directly borders one of that side's 4 innermost boundary
 * hexes (`hexRing(center, edgeLength - 1)`, sliced into 6 equal per-side
 * segments) in a single fixed outward direction — verified (see git history
 * of this comment) to produce a clean straight row for every edgeLength.
 */
export function domainAttachmentHexes(side: number, edgeLength: number, center: Axial = { q: 0, r: 0 }): Axial[] {
  const radius = edgeLength - 1;
  const ring = hexRing(center, radius);
  // hexRing's own internal side-loop index 0 starts at the board's
  // upper-left-ish edge; side 1 (upper-right, per this game's numbering)
  // corresponds to internal loop index 2.
  const loopIndex = (side + 1) % 6;
  const segment = ring.slice(loopIndex * radius, loopIndex * radius + radius);
  const outwardDir = (loopIndex + 5) % 6;
  return segment.map((hex) => neighbor(hex, outwardDir));
}

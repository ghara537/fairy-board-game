import { Axial, axialKey, neighbors, HEX_DIRECTIONS, axialAdd } from "./coordinates";

/**
 * A `passable` predicate decides whether a given hex can be entered. It is
 * supplied by the caller (the movement engine) rather than baked in here, so
 * this module stays a pure graph-search library with no game-rule knowledge.
 * All distance/path queries used by lure attraction MUST go through this
 * module — never raw axial distance — because obstacles change the shortest
 * legal path (spec section 13/17).
 */
export type Passable = (hex: Axial) => boolean;

export type PathResult = {
  distance: number;
  // All shortest-path first steps (neighbor hexes) that begin a shortest
  // path from start to target. More than one means the mover has a genuine
  // choice of equally-short first steps (spec section 15).
  firstSteps: Axial[];
  // One concrete shortest path (first of possibly several), start included.
  path: Axial[];
};

/**
 * Multi-source-free BFS distance map from `start` over all hexes satisfying
 * `passable` (the start hex itself is always considered enterable/steppable
 * even if it fails `passable`, since a piece already standing there doesn't
 * need to "enter" it). Returns distances and predecessor sets so callers can
 * reconstruct every shortest path, not just one.
 */
export function bfsDistances(
  start: Axial,
  passable: Passable,
  boardHexes: Set<string>
): { dist: Map<string, number>; preds: Map<string, string[]> } {
  const dist = new Map<string, number>();
  const preds = new Map<string, string[]>();
  const startKey = axialKey(start);
  dist.set(startKey, 0);
  preds.set(startKey, []);
  const queue: Axial[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentKey = axialKey(current);
    const d = dist.get(currentKey)!;
    for (const n of neighbors(current)) {
      const nKey = axialKey(n);
      if (!boardHexes.has(nKey)) continue;
      if (!passable(n)) continue;
      if (!dist.has(nKey)) {
        dist.set(nKey, d + 1);
        preds.set(nKey, [currentKey]);
        queue.push(n);
      } else if (dist.get(nKey) === d + 1) {
        preds.get(nKey)!.push(currentKey);
      }
    }
  }
  return { dist, preds };
}

/** Shortest legal-path distance + reconstructable path(s) from start to target. */
export function shortestPath(
  start: Axial,
  target: Axial,
  passable: Passable,
  boardHexes: Set<string>
): PathResult | null {
  const { dist, preds } = bfsDistances(start, passable, boardHexes);
  const targetKey = axialKey(target);
  if (!dist.has(targetKey)) return null;
  const distance = dist.get(targetKey)!;

  // Reconstruct one path by walking predecessors back to start.
  const path: Axial[] = [];
  let curKey = targetKey;
  while (curKey !== axialKey(start)) {
    const [q, r] = curKey.split(",").map(Number);
    path.push({ q, r });
    curKey = preds.get(curKey)![0];
  }
  path.push(start);
  path.reverse();

  // First steps: every neighbor of start that lies on *some* shortest path.
  const firstSteps: Axial[] = [];
  for (const n of neighbors(start)) {
    const nKey = axialKey(n);
    if (!boardHexes.has(nKey) || !passable(n)) continue;
    if (!dist.has(nKey) || dist.get(nKey) !== 1) continue;
    // n is distance 1 from start; check it participates in a shortest path to target
    if (isOnSomeShortestPath(n, target, dist, preds)) firstSteps.push(n);
  }

  return { distance, firstSteps, path };
}

function isOnSomeShortestPath(
  from: Axial,
  target: Axial,
  dist: Map<string, number>,
  preds: Map<string, string[]>
): boolean {
  const fromKey = axialKey(from);
  const targetKey = axialKey(target);
  if (!dist.has(fromKey) || !dist.has(targetKey)) return false;
  // Walk backwards from target; from is on a shortest path iff it appears
  // as an ancestor at the correct distance in the predecessor DAG.
  const stack = [targetKey];
  const seen = new Set<string>();
  while (stack.length) {
    const k = stack.pop()!;
    if (k === fromKey) return true;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const p of preds.get(k) ?? []) stack.push(p);
  }
  return false;
}

/** All hexes reachable from `start` within `maxSteps` (or unbounded if omitted). */
export function reachableHexes(
  start: Axial,
  passable: Passable,
  boardHexes: Set<string>,
  maxSteps?: number
): Axial[] {
  const { dist } = bfsDistances(start, passable, boardHexes);
  const out: Axial[] = [];
  for (const [key, d] of dist.entries()) {
    if (maxSteps === undefined || d <= maxSteps) {
      const [q, r] = key.split(",").map(Number);
      out.push({ q, r });
    }
  }
  return out;
}

/** Straight-line hex direction index (0-5) from a to b, or null if not collinear. */
export function straightLineDirection(a: Axial, b: Axial): number | null {
  for (let i = 0; i < HEX_DIRECTIONS.length; i++) {
    let cur = a;
    for (let steps = 1; steps <= 32; steps++) {
      cur = axialAdd(cur, HEX_DIRECTIONS[i]);
      if (cur.q === b.q && cur.r === b.r) return i;
    }
  }
  return null;
}

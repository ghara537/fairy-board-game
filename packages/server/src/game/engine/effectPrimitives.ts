import {
  Axial,
  axialDistance,
  axialKey,
  classifyDirections,
  neighborDirectionIndex,
  shortestPath,
  straightLineDirection,
  DirectionClass,
  HumanInstance,
  ObstacleType,
} from "@fairy/shared";
import { ServerGameState, EffectStackItem } from "../state";
import { collectHumanForPlayer } from "./scoring";
import { checkVictory } from "./victory";
import { domainOwnerAt, domainHexesForPlayer } from "./domains";

// ---------------------------------------------------------------------------
// Low-level mechanics shared by many card/ability effect handlers: forced
// movement, pulling/pushing, and position swaps. Kept separate from the
// (much larger, independently tested) Human Movement Phase engine in
// movement.ts — these are one-off effect-driven moves, not the per-round
// attraction/priority resolution that module owns.
// ---------------------------------------------------------------------------

export function isBlockingObstacleAt(state: ServerGameState, pos: Axial): boolean {
  return state.board.obstacles.some(
    (o) => (o.type === "tree" || o.type === "stone" || o.type === "toadstool") && o.position.q === pos.q && o.position.r === pos.r
  );
}

/** Confirmed rule: exactly one Human per hex, ever. */
export function isHexOccupiedByHuman(state: ServerGameState, pos: Axial): boolean {
  return state.board.humans.some((h) => h.position.q === pos.q && h.position.r === pos.r);
}

export function passableForForcedMove(state: ServerGameState) {
  return (pos: Axial) => !isBlockingObstacleAt(state, pos) && !isHexOccupiedByHuman(state, pos);
}

/**
 * Confirmed by the user: push/pull abilities and cards may only move a Human
 * relative to the ACTING player's own Domain — pull only toward it (plus
 * sideways, if the room allows), push only away from it (plus sideways).
 * Never straight toward a Domain for a push, or straight away for a pull.
 * Returns the set of legal `HEX_DIRECTIONS` indices from `pos`.
 */
export function legalPushPullDirections(state: ServerGameState, playerId: string, pos: Axial, kind: "push" | "pull"): Set<number> {
  const domainHexes = domainHexesForPlayer(state, playerId);
  const classes = classifyDirections(pos, domainHexes);
  const primary: DirectionClass = kind === "pull" ? "toward" : "away";
  const legal = new Set<number>();
  classes.forEach((c, i) => {
    if (c === primary || (state.pushPullSidewaysAllowed && c === "sideways")) legal.add(i);
  });
  return legal;
}

/** Force a Human directly onto `dest`, handling Domain arrival / lure clearing / victory. Returns false if the Human no longer exists. */
export function forceHumanTo(state: ServerGameState, humanInstanceId: string, dest: Axial): boolean {
  const human = state.board.humans.find((h) => h.instanceId === humanInstanceId);
  if (!human) return false;
  human.position = dest;
  const stack = state.board.lureStacks.find((s) => s.position.q === dest.q && s.position.r === dest.r);
  const domainOwner = domainOwnerAt(state, dest);

  if (domainOwner) {
    // Reaching a Domain's own territory is what scores — a lure on the same
    // hex just clears along with the collection, no separate score for it.
    if (stack) state.board.lureStacks = state.board.lureStacks.filter((s) => s.id !== stack.id);
    state.board.humans = state.board.humans.filter((h) => h.instanceId !== humanInstanceId);
    collectHumanForPlayer(state, domainOwner, human.definitionId);
    checkVictory(state);
  } else if (stack) {
    // An ordinary lure is only "bait" — it clears when reached, but doesn't
    // collect/score the Human. Only arriving at a Domain hex does that.
    state.board.lureStacks = state.board.lureStacks.filter((s) => s.id !== stack.id);
  }
  return true;
}

/** Pull `humanInstanceId` toward `playerId`'s own nearest reachable lure, up to `steps` spaces. */
export function pullTowardOwnNearestLure(
  state: ServerGameState,
  playerId: string,
  humanInstanceId: string,
  steps: number
): { ok: true } | { ok: false; error: string } {
  const human = findHuman(state, humanInstanceId);
  if (!human) return { ok: false, error: "Unknown Human." };
  const ownLures = state.board.lureStacks.filter((s) => s.owner === playerId);
  if (ownLures.length === 0) return { ok: false, error: "You have no lures on the board." };
  const passable = passableForForcedMove(state);
  let best: { stackId: string; distance: number } | null = null;
  for (const stack of ownLures) {
    const path = shortestPath(human.position, stack.position, passable, state.board.hexes);
    if (!path || path.distance === 0) continue;
    if (!best || path.distance < best.distance) best = { stackId: stack.id, distance: path.distance };
  }
  if (!best) return { ok: false, error: "No reachable lure of yours to pull toward." };
  const taken = pullTowardLure(state, playerId, humanInstanceId, best.stackId, steps);
  if (taken === 0) return { ok: false, error: "That Human can't be pulled toward your lure without moving away from your Domain." };
  return { ok: true };
}

/** Pull `humanInstanceId` up to `steps` spaces toward `lureStackId`, re-pathing each step (stops early if the lure is reached, becomes unreachable, or the next step would move away from `playerId`'s own Domain — see `legalPushPullDirections`). Returns the number of steps actually taken. */
export function pullTowardLure(state: ServerGameState, playerId: string, humanInstanceId: string, lureStackId: string, steps: number): number {
  const passable = passableForForcedMove(state);
  let taken = 0;
  for (let i = 0; i < steps; i++) {
    const human = state.board.humans.find((h) => h.instanceId === humanInstanceId);
    if (!human) break; // collected mid-pull
    const stack = state.board.lureStacks.find((s) => s.id === lureStackId);
    if (!stack) break; // lure no longer exists
    const path = shortestPath(human.position, stack.position, passable, state.board.hexes);
    if (!path || path.distance === 0) break;
    const dest = path.firstSteps[0];
    const dir = neighborDirectionIndex(human.position, dest);
    if (dir === null || !legalPushPullDirections(state, playerId, human.position, "pull").has(dir)) break;
    forceHumanTo(state, humanInstanceId, dest);
    taken += 1;
  }
  return taken;
}

/** Push a Human in a straight line to `dest`, which must be exactly `distance` spaces away in one of the 6 hex directions with every intervening space unobstructed, and that direction must move the Human away from `playerId`'s own Domain (or sideways, if the room allows — see `legalPushPullDirections`). */
export function pushHumanStraightLine(state: ServerGameState, playerId: string, humanInstanceId: string, dest: Axial, distance: number): { ok: true } | { ok: false; error: string } {
  const human = state.board.humans.find((h) => h.instanceId === humanInstanceId);
  if (!human) return { ok: false, error: "Unknown Human." };
  if (axialDistance(human.position, dest) !== distance) return { ok: false, error: `Destination must be exactly ${distance} space(s) away in a straight line.` };
  const dir = straightLineDirection(human.position, dest);
  if (dir === null) return { ok: false, error: "Destination is not in a straight line." };
  if (!legalPushPullDirections(state, playerId, human.position, "push").has(dir)) {
    return { ok: false, error: "That direction doesn't move the Human away from your Domain." };
  }
  if (!state.board.hexes.has(axialKey(dest))) return { ok: false, error: "Destination is off the board." };
  if (isBlockingObstacleAt(state, dest)) return { ok: false, error: "Destination is blocked." };
  if (isHexOccupiedByHuman(state, dest)) return { ok: false, error: "Destination is occupied by another Human." };
  forceHumanTo(state, humanInstanceId, dest);
  return { ok: true };
}

export function neighborsOfObstacleTypes(state: ServerGameState, pos: Axial, types: ObstacleType[]): boolean {
  return state.board.obstacles.some((o) => types.includes(o.type) && axialDistance(o.position, pos) === 1);
}

export function findHuman(state: ServerGameState, id: string): HumanInstance | undefined {
  return state.board.humans.find((h) => h.instanceId === id);
}

export function swapHumanPositions(state: ServerGameState, idA: string, idB: string): { ok: true } | { ok: false; error: string } {
  const a = findHuman(state, idA);
  const b = findHuman(state, idB);
  if (!a || !b || a.instanceId === b.instanceId) return { ok: false, error: "Select two distinct Humans." };
  const posA = a.position;
  a.position = b.position;
  b.position = posA;
  return { ok: true };
}

let cloneCounter = 0;

/** Shadow Copy / Dream Surge: clones a pending effect (optionally with a new target) and re-queues it to resolve independently. */
export function cloneAndRequeueEffect(
  state: ServerGameState,
  sourceEffectId: string,
  overrideTarget?: unknown
): { ok: true } | { ok: false; error: string } {
  const item = state.responseStack.find((e) => e.id === sourceEffectId);
  if (!item) return { ok: false, error: "Unknown effect." };
  if (item.status !== "pending") return { ok: false, error: "That effect is no longer pending." };
  cloneCounter += 1;
  const clone: EffectStackItem = {
    id: `effect-clone-${cloneCounter}`,
    sourcePlayerId: item.sourcePlayerId,
    kind: item.kind,
    cardId: item.cardId,
    abilityKey: item.abilityKey,
    name: item.name,
    timing: item.timing,
    target: overrideTarget !== undefined ? overrideTarget : item.target,
    status: "pending",
  };
  state.responseStack.push(clone);
  return { ok: true };
}

/** Impish Interference / Wrong Turn / Clockwork Contraption: overrides a pending effect's target. `mode: "field"` replaces only the `to` sub-field (direction-style cards); `mode: "whole"` replaces the entire target object (Clockwork Contraption / Fickle Fate style). */
export function retargetPendingEffect(
  state: ServerGameState,
  effectId: string,
  mode: "field" | "whole",
  newValue: unknown
): { ok: true } | { ok: false; error: string } {
  const item = state.responseStack.find((e) => e.id === effectId);
  if (!item) return { ok: false, error: "Unknown effect." };
  if (item.status !== "pending") return { ok: false, error: "That effect is no longer pending." };
  if (mode === "whole") {
    item.target = newValue;
  } else {
    const current = (item.target ?? {}) as Record<string, unknown>;
    if (!("to" in current)) return { ok: false, error: "That effect has no movement direction to change." };
    item.target = { ...current, to: newValue };
  }
  item.status = "modified";
  return { ok: true };
}

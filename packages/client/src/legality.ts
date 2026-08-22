// Client-side legality HINTS only — purely for highlighting; the server is
// always the final authority and re-validates every submission independently
// (spec section 2/12).
import {
  Axial,
  axialDistance,
  axialKey,
  classifyDirections,
  DirectionClass,
  generateHexagonalBoard,
  neighborDirectionIndex,
  neighbors,
  PersonalizedGameView,
  PlayerId,
  SPAWN_DATA,
  straightLineDirection,
} from "@fairy/shared";
import { TargetStep } from "./targetingScripts";

/** Mirrors the server's `legalPushPullDirections` (effectPrimitives.ts): which `HEX_DIRECTIONS` indices from `origin` are legal for a push (away from your own Domain) or pull (toward it), honoring the room's sideways toggle. */
function legalPushPullDirections(view: PersonalizedGameView, origin: Axial, kind: "push" | "pull"): Set<number> {
  const domainHexes = view.board?.domainBoards.find((d) => d.playerId === view.yourPlayerId)?.hexes ?? [];
  const classes = classifyDirections(origin, domainHexes);
  const primary: DirectionClass = kind === "pull" ? "toward" : "away";
  const legal = new Set<number>();
  classes.forEach((c, i) => {
    if (c === primary || (view.config.pushPullSidewaysAllowed && c === "sideways")) legal.add(i);
  });
  return legal;
}

/** Resolves a previously-collected targeting field back to a board position, based on what kind of thing that step picked. */
function resolveTargetPosition(view: PersonalizedGameView, steps: TargetStep[], collected: Record<string, unknown>, fieldNames: string[]): Axial | null {
  if (!view.board) return null;
  for (const field of fieldNames) {
    const raw = collected[field];
    if (raw == null) continue;
    const step = steps.find((s) => s.field === field);
    const picks = step?.picks ?? (steps.find((s) => s.alt?.field === field) ? "obstacle" /* alt fields are always marker toggles off an obstacle step */ : null);
    if (picks === "human") {
      const human = view.board.humans.find((h) => h.instanceId === raw);
      if (human) return human.position;
    } else if (picks === "lureStack" || picks === "ownLureStack") {
      const stack = view.board.lureStacks.find((s) => s.id === raw);
      if (stack) return stack.position;
    } else if (picks === "obstacle") {
      const obstacle = view.board.obstacles.find((o) => o.id === raw);
      if (obstacle) return obstacle.position;
      const marker = view.board.accelMarkers.find((m) => m.id === raw);
      if (marker) return marker.position;
    } else if (picks === "boardSpace" || picks === "upcomingSpawnSpace") {
      return raw as Axial;
    }
  }
  return null;
}

/** Legal destinations for a "boardSpace" targeting step, honoring its declared occupancy rule and geometric constraint (see targetingScripts.ts). */
export function legalBoardSpacesForStep(view: PersonalizedGameView, step: TargetStep, steps: TargetStep[], collected: Record<string, unknown>): Axial[] {
  if (!view.board) return [];
  const obstaclePositions = new Set(view.board.obstacles.map((o) => axialKey(o.position)));
  const lurePositions = new Set(view.board.lureStacks.map((s) => axialKey(s.position)));
  const humanPositions = new Set(view.board.humans.map((h) => axialKey(h.position)));
  const occupancy = step.boardSpaceOccupancy ?? "empty";

  let candidates = generateHexagonalBoard(view.board.edgeLength).filter((h) => {
    const key = axialKey(h);
    if (occupancy === "unrestricted") return true;
    if (obstaclePositions.has(key) || humanPositions.has(key)) return false;
    if (occupancy === "empty" && lurePositions.has(key)) return false;
    return true;
  });

  const constraint = step.boardSpaceConstraint;
  if (!constraint) return candidates;

  if (constraint.kind === "adjacentToObstacle") {
    return candidates.filter((h) => view.board!.obstacles.some((o) => constraint.types.includes(o.type) && axialDistance(o.position, h) === 1));
  }
  if (constraint.kind === "adjacentToPortal") {
    return candidates.filter((h) => axialDistance(view.board!.portalCenter, h) === 1);
  }
  if (constraint.kind === "noAdjacentHuman") {
    return candidates.filter((h) => !neighbors(h).some((n) => humanPositions.has(axialKey(n))));
  }

  const origin = resolveTargetPosition(view, steps, collected, constraint.of);
  if (!origin) return [];

  if (constraint.kind === "adjacent") {
    candidates = candidates.filter((h) => axialDistance(origin, h) === 1);
    if (constraint.pushPull) {
      const legalDirs = legalPushPullDirections(view, origin, constraint.pushPull);
      candidates = candidates.filter((h) => {
        const dir = neighborDirectionIndex(origin, h);
        return dir !== null && legalDirs.has(dir);
      });
    }
    return candidates;
  }
  if (constraint.kind === "straightLine") {
    candidates = candidates.filter((h) => axialDistance(origin, h) === constraint.distance && straightLineDirection(origin, h) !== null);
    if (constraint.pushPull) {
      const legalDirs = legalPushPullDirections(view, origin, constraint.pushPull);
      candidates = candidates.filter((h) => {
        const dir = straightLineDirection(origin, h);
        return dir !== null && legalDirs.has(dir);
      });
    }
    return candidates;
  }
  // "within"
  return candidates.filter((h) => axialDistance(origin, h) <= constraint.max);
}

export function legalLurePlacementSpaces(view: PersonalizedGameView, playerId: PlayerId): Axial[] {
  if (!view.board) return [];
  const opposing = new Set(
    view.board.lureStacks.filter((s) => s.owner !== playerId).map((s) => axialKey(s.position))
  );
  return generateHexagonalBoard(view.board.edgeLength).filter((h) => !opposing.has(axialKey(h)));
}

/** Positions the next Human spawn (current spawnIndicator's set) will use — for Threads of Fate. */
export function upcomingSpawnSpaces(view: PersonalizedGameView): Axial[] {
  if (!view.board) return [];
  const set = SPAWN_DATA.sets[view.board.spawnIndicator];
  return [...set.positions, set.hunterCenterPosition];
}

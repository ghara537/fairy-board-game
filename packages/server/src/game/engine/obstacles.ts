import { Axial, axialKey, ObstacleType } from "@fairy/shared";
import { ServerGameState } from "../state";
import { logEvent } from "./log";

export function isSpaceEmpty(state: ServerGameState, pos: Axial): boolean {
  if (!state.board.hexes.has(axialKey(pos))) return false;
  const hasObstacle = state.board.obstacles.some((o) => o.position.q === pos.q && o.position.r === pos.r);
  const hasLure = state.board.lureStacks.some((s) => s.position.q === pos.q && s.position.r === pos.r);
  // Confirmed rule: a Human can never share a hex with an obstacle either
  // (same "one thing per space" principle already enforced Human-vs-Human
  // and Human-vs-obstacle during movement — this closes the other
  // direction, an obstacle being placed/moved onto an occupied Human).
  const hasHuman = state.board.humans.some((h) => h.position.q === pos.q && h.position.r === pos.r);
  return !hasObstacle && !hasLure && !hasHuman;
}

export function legalEmptySpaces(state: ServerGameState): Axial[] {
  const out: Axial[] = [];
  for (const key of state.board.hexes) {
    const [q, r] = key.split(",").map(Number);
    if (isSpaceEmpty(state, { q, r })) out.push({ q, r });
  }
  return out;
}

let obstacleCounter = 0;

export function placeObstacle(state: ServerGameState, type: ObstacleType, pos: Axial): string {
  obstacleCounter += 1;
  const id = `obstacle-${obstacleCounter}`;
  state.board.obstacles.push({ id, type, position: pos });
  logEvent(state, "obstacle:placed", `A ${type} was placed at (${pos.q},${pos.r}).`, { type, pos, id });
  return id;
}

export function removeObstacle(state: ServerGameState, id: string): void {
  const obstacle = state.board.obstacles.find((o) => o.id === id);
  if (!obstacle) return;
  state.board.obstacles = state.board.obstacles.filter((o) => o.id !== id);
  logEvent(state, "obstacle:removed", `A ${obstacle.type} was removed from (${obstacle.position.q},${obstacle.position.r}).`, {
    id,
  });
}

export function moveObstacle(state: ServerGameState, id: string, to: Axial): void {
  const obstacle = state.board.obstacles.find((o) => o.id === id);
  if (!obstacle) return;
  const from = obstacle.position;
  obstacle.position = to;
  logEvent(state, "obstacle:moved", `A ${obstacle.type} moved from (${from.q},${from.r}) to (${to.q},${to.r}).`, {
    id,
    from,
    to,
  });
}

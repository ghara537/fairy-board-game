import { Axial, TOADSTOOL_MAX_ON_BOARD, Obstacle } from "@fairy/shared";
import { ServerGameState } from "../state";
import { legalEmptySpaces, placeObstacle, moveObstacle } from "./obstacles";

export function toadstoolCount(state: ServerGameState): number {
  return state.board.obstacles.filter((o) => o.type === "toadstool").length;
}

export function existingToadstools(state: ServerGameState): Obstacle[] {
  return state.board.obstacles.filter((o) => o.type === "toadstool");
}

/**
 * Whether placing a new Toadstool right now would exceed the max (spec
 * section 18) and therefore needs the relocate-an-existing-one flow instead
 * of a direct placement.
 */
export function needsRelocationFlow(state: ServerGameState): boolean {
  return toadstoolCount(state) >= TOADSTOOL_MAX_ON_BOARD;
}

export function placeNewToadstool(state: ServerGameState, pos: Axial): void {
  placeObstacle(state, "toadstool", pos);
}

export function relocateToadstool(state: ServerGameState, toadstoolId: string, pos: Axial): void {
  moveObstacle(state, toadstoolId, pos);
}

export { legalEmptySpaces };

import { Axial, PlayerId } from "@fairy/shared";
import { ServerGameState } from "../state";

/** The owner of the Domain hex at `pos`, if any — reaching it is what scores a Human (see movement.ts::handleArrival). */
export function domainOwnerAt(state: ServerGameState, pos: Axial): PlayerId | undefined {
  for (const board of state.board.domainBoards) {
    if (board.hexes.some((h) => h.q === pos.q && h.r === pos.r)) return board.playerId;
  }
  return undefined;
}

/** A player's own Domain hexes (the 4-hex scoring territory), or `[]` if this room somehow has none assigned for them. */
export function domainHexesForPlayer(state: ServerGameState, playerId: PlayerId): Axial[] {
  return state.board.domainBoards.find((b) => b.playerId === playerId)?.hexes ?? [];
}

/** A lookup Map suitable for MovementBoard.domainHexes, built fresh from current state each call. */
export function buildDomainHexMap(state: ServerGameState): Map<string, PlayerId> {
  const m = new Map<string, PlayerId>();
  for (const board of state.board.domainBoards) {
    for (const h of board.hexes) m.set(`${h.q},${h.r}`, board.playerId);
  }
  return m;
}

import { Axial, axialKey, PlayerId } from "@fairy/shared";
import { ServerGameState } from "../state";
import { logEvent } from "./log";

function totalLureHeight(state: ServerGameState, playerId: PlayerId): number {
  return state.board.lureStacks.filter((s) => s.owner === playerId).reduce((sum, s) => sum + s.height, 0);
}

function underLureCap(state: ServerGameState, playerId: PlayerId): boolean {
  const cap = state.players[playerId]?.lureCap;
  if (cap === null || cap === undefined) return true;
  return totalLureHeight(state, playerId) < cap;
}

/** Every space where `playerId` may legally place a lure, per spec section 12. */
export function legalLurePlacementSpaces(state: ServerGameState, playerId: PlayerId): Axial[] {
  if (!underLureCap(state, playerId)) return [];
  const out: Axial[] = [];
  for (const key of state.board.hexes) {
    const [q, r] = key.split(",").map(Number);
    const existing = state.board.lureStacks.find((s) => s.position.q === q && s.position.r === r);
    if (!existing || existing.owner === playerId) {
      out.push({ q, r });
    }
  }
  return out;
}

export function isLegalLurePlacement(state: ServerGameState, playerId: PlayerId, pos: Axial): boolean {
  if (!state.board.hexes.has(axialKey(pos))) return false;
  if (!underLureCap(state, playerId)) return false;
  const existing = state.board.lureStacks.find((s) => s.position.q === pos.q && s.position.r === pos.r);
  return !existing || existing.owner === playerId;
}

let stackCounter = 0;

/** Places (or stacks onto) a lure at `pos` for `playerId`. Caller must have already validated legality. */
export function placeLure(state: ServerGameState, playerId: PlayerId, pos: Axial): void {
  const existing = state.board.lureStacks.find((s) => s.position.q === pos.q && s.position.r === pos.r);
  if (existing) {
    existing.height += 1;
    logEvent(state, "lure:placed", `${playerId} stacked a lure at (${pos.q},${pos.r}) — height ${existing.height}.`, {
      playerId,
      pos,
      height: existing.height,
    });
  } else {
    stackCounter += 1;
    state.board.lureStacks.push({ id: `lure-${stackCounter}`, position: pos, owner: playerId, height: 1 });
    logEvent(state, "lure:placed", `${playerId} placed a new lure at (${pos.q},${pos.r}).`, { playerId, pos });
  }
}

export function findLureStack(state: ServerGameState, id: string | undefined) {
  if (!id) return undefined;
  return state.board.lureStacks.find((s) => s.id === id);
}

/** Moves an entire lure stack one space (used by several Domain abilities / cards). Caller validates legality. */
export function moveLureStack(state: ServerGameState, stackId: string, to: Axial): void {
  const stack = findLureStack(state, stackId);
  if (!stack) return;
  const from = stack.position;
  // If destination already has a same-owner stack, merge; if different-owner stack, that's illegal and
  // must be checked by the caller before invoking this function.
  const destExisting = state.board.lureStacks.find(
    (s) => s.id !== stackId && s.position.q === to.q && s.position.r === to.r
  );
  if (destExisting && destExisting.owner === stack.owner) {
    destExisting.height += stack.height;
    state.board.lureStacks = state.board.lureStacks.filter((s) => s.id !== stackId);
    logEvent(state, "lure:moved", `Lure stack merged at (${to.q},${to.r}).`, { stackId, from, to });
  } else {
    stack.position = to;
    logEvent(state, "lure:moved", `Lure stack moved from (${from.q},${from.r}) to (${to.q},${to.r}).`, {
      stackId,
      from,
      to,
    });
  }
}

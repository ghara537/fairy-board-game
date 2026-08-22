import { resolveSimultaneousVictoryTie, shortestPath, Axial, HUMAN_DEFINITIONS_BY_ID, PlayerId } from "@fairy/shared";
import { ServerGameState } from "../state";
import { logEvent } from "./log";

/**
 * Must be called immediately after any score change (spec section 23). If
 * one or more players are at/above the target score, the current atomic
 * effect is allowed to finish (callers invoke this at the END of an atomic
 * effect, not mid-effect), then a winner is declared using first-player-order
 * as the tie-break (isolated in resolveSimultaneousVictoryTie so an
 * alternate rule can be swapped in later).
 */
export function checkVictory(state: ServerGameState): void {
  if (state.winnerId) return; // already decided
  const qualifying = state.turnOrder.filter((id) => state.players[id]?.score >= state.targetScore);
  if (qualifying.length === 0) return;

  const winnerId: PlayerId =
    qualifying.length === 1 ? qualifying[0] : resolveSimultaneousVictoryTie(orderByFirstPlayer(state, qualifying));

  state.winnerId = winnerId;
  state.phase = "game-over";
  state.pendingInteraction = null;
  logEvent(state, "game:victory", `${winnerId} reached ${state.targetScore} points and wins the game!`, {
    winnerId,
    qualifying,
  });
}

function orderByFirstPlayer(state: ServerGameState, ids: PlayerId[]): PlayerId[] {
  const idxOf = (id: PlayerId) => {
    const i = state.turnOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...ids].sort((a, b) => idxOf(a) - idxOf(b));
}

// Local, tiny copy of the same "blocking obstacle" rule used everywhere else
// in the engine (movement.ts, effectPrimitives.ts) — kept local rather than
// imported to avoid a circular module dependency (effectPrimitives.ts
// already imports checkVictory from this file).
function isPassable(state: ServerGameState, pos: Axial): boolean {
  return !state.board.obstacles.some(
    (o) => (o.type === "tree" || o.type === "stone" || o.type === "toadstool") && o.position.q === pos.q && o.position.r === pos.r
  );
}

/**
 * Turns-mode end-of-game check (spec confirmed by the user): once the round
 * that just completed reaches `turnLimit`, the highest score wins. A tie
 * lets play continue (re-checked at the end of every subsequent round) up
 * to `tieExtensionLimit`; if still tied there, the nearest-townsfolk
 * distance tiebreak below decides it, or the game ends in a declared draw.
 * Called from GameEngine's round-cleanup transition, once per round, with
 * `state.round` still holding the round that just finished (before it's
 * incremented for the next one).
 */
export function checkTurnBasedEnd(state: ServerGameState): void {
  if (state.winnerId || state.drawPlayerIds) return; // already decided
  const vc = state.victoryCondition;
  if (vc.kind !== "turns") return;
  if (state.round < vc.turnLimit) return;

  const maxScore = Math.max(...state.turnOrder.map((id) => state.players[id]?.score ?? -Infinity));
  const leaders = state.turnOrder.filter((id) => state.players[id]?.score === maxScore);

  if (leaders.length === 1) {
    declareWinner(state, leaders[0], `reached round ${vc.turnLimit} with the high score (${maxScore} points)`);
    return;
  }

  if (state.round < vc.tieExtensionLimit) {
    logEvent(state, "game:tieExtended", `Round ${vc.turnLimit} ended tied at ${maxScore} points — play continues to round ${vc.tieExtensionLimit}.`, {
      tiedPlayerIds: leaders,
      score: maxScore,
    });
    return;
  }

  const resolved = breakTieByNearestTownsfolk(state, leaders);
  if (resolved.length === 1) {
    declareWinner(
      state,
      resolved[0],
      `won the round ${vc.tieExtensionLimit} tiebreak — Domain closest to the nearest remaining townsfolk`
    );
    return;
  }

  state.drawPlayerIds = resolved;
  state.phase = "game-over";
  state.pendingInteraction = null;
  logEvent(state, "game:draw", `Tie game between ${resolved.join(", ")} — unresolved even after the round ${vc.tieExtensionLimit} tiebreak.`, {
    playerIds: resolved,
  });
}

function declareWinner(state: ServerGameState, winnerId: PlayerId, reason: string): void {
  state.winnerId = winnerId;
  state.phase = "game-over";
  state.pendingInteraction = null;
  logEvent(state, "game:victory", `${winnerId} ${reason} and wins the game!`, { winnerId });
}

/**
 * Confirmed tiebreak rule: for each tied player, sort every remaining
 * "townsfolk" Human on the board (any non-hazard Human — Hunters don't
 * count) by shortest path distance from the *closest* of that player's own
 * Domain hexes. Compare the tied players' sorted lists position by
 * position (nearest vs. nearest, then next-nearest vs. next-nearest, ...);
 * whoever is closer at the first point of difference wins. If every
 * position ties (or there are no townsfolk left on the board at all), the
 * tie stands among whichever players remain.
 */
function breakTieByNearestTownsfolk(state: ServerGameState, tiedIds: PlayerId[]): PlayerId[] {
  const townsfolk = state.board.humans.filter((h) => !HUMAN_DEFINITIONS_BY_ID[h.definitionId]?.isHazard);
  if (townsfolk.length === 0) return tiedIds;

  const passable = (pos: Axial) => isPassable(state, pos);
  const distanceLists = new Map<PlayerId, number[]>();
  for (const id of tiedIds) {
    const domainHexes = state.board.domainBoards.find((d) => d.playerId === id)?.hexes ?? [];
    const distances = townsfolk.map((h) => {
      let min = Infinity;
      for (const domainHex of domainHexes) {
        const path = shortestPath(domainHex, h.position, passable, state.board.hexes);
        if (path && path.distance < min) min = path.distance;
      }
      return min;
    });
    distances.sort((a, b) => a - b);
    distanceLists.set(id, distances);
  }

  let candidates = [...tiedIds];
  for (let i = 0; i < townsfolk.length && candidates.length > 1; i++) {
    const minAtIndex = Math.min(...candidates.map((id) => distanceLists.get(id)![i]));
    candidates = candidates.filter((id) => distanceLists.get(id)![i] === minAtIndex);
  }
  return candidates;
}

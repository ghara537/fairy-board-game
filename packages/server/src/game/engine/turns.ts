import { ACTIONS_PER_TURN, PlayerId } from "@fairy/shared";
import { ServerGameState } from "../state";
import { logEvent } from "./log";

export function nextPlayerId(state: ServerGameState, current: PlayerId): PlayerId {
  const idx = state.turnOrder.indexOf(current);
  return state.turnOrder[(idx + 1) % state.turnOrder.length];
}

/** True once every seated player has completed a turn since the round began (used to decide when to enter Human Movement). */
export function isRoundOfTurnsComplete(state: ServerGameState, roundStartPlayerId: PlayerId): boolean {
  return state.activePlayerId === roundStartPlayerId;
}

export function beginNextPlayerTurn(state: ServerGameState): void {
  state.activePlayerId = nextPlayerId(state, state.activePlayerId);
  state.actionsRemaining = ACTIONS_PER_TURN;
  state.discardDrawUsedThisTurn = false;
  const player = state.players[state.activePlayerId];
  if (player) player.extraEnchantmentPlaysThisTurn = 0;
  logEvent(state, "turn:begin", `${state.activePlayerId}'s turn begins.`, { playerId: state.activePlayerId });
}

/** Available normal action types for the given player right now, with a reason when unavailable — drives the UI's "why can't I do this" prompts (spec section 9/25). */
export type ActionAvailability = { type: string; available: boolean; reason?: string };

export function availableActions(state: ServerGameState, playerId: PlayerId): ActionAvailability[] {
  const isActive = state.activePlayerId === playerId && state.phase === "player-turn";
  const player = state.players[playerId];
  const hasActionsLeft = state.actionsRemaining > 0 || (player?.extraEnchantmentPlaysThisTurn ?? 0) > 0;

  const base = (): string | undefined => {
    if (!isActive) return "It is not your turn.";
    if (!hasActionsLeft) return "You have no actions remaining this turn.";
    return undefined;
  };

  const placeLureReason = base();
  const playCardReason = base() ?? (player && player.hand.length === 0 ? "Your hand is empty." : undefined);
  const domainAbilityReason = base();
  const drawCardReason = base();
  const discardDrawReason =
    !isActive
      ? "It is not your turn."
      : state.actionsRemaining <= 0
      ? "You have no actions remaining this turn."
      : state.discardDrawUsedThisTurn
      ? "You have already used discard-and-draw this turn."
      : undefined;

  return [
    { type: "placeLure", available: !placeLureReason, reason: placeLureReason },
    { type: "playCard", available: !playCardReason, reason: playCardReason },
    { type: "useDomainAbility", available: !domainAbilityReason, reason: domainAbilityReason },
    { type: "drawCard", available: !drawCardReason, reason: drawCardReason },
    { type: "discardDraw", available: !discardDrawReason, reason: discardDrawReason },
  ];
}

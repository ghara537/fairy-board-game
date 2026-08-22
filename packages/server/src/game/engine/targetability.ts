import { axialDistance, HumanInstance, LureStack } from "@fairy/shared";
import { ServerGameState } from "../state";

// ---------------------------------------------------------------------------
// Generic "can this be targeted right now" checks, shared by every card/
// ability that grants temporary protection (Blessing of the Good Folk,
// Faerie Slumber, Crystal Ward, Mesmerize, Cleansing Waters) and by the
// round-wide Shrouded Hollow Landscape.
//
// Simplification (documented in RULES_TODO.md): the source text for several
// of these says "...its controller may select another legal target" when a
// pending effect is invalidated. Rather than building a full redirect-choice
// flow, applying protection here CANCELS any pending response-stack item
// that already targets the now-protected Human/lure. Detection is a shallow
// string match over the pending item's target payload — targets always
// carry the human/lure's unique id as a string, so this is reliable in
// practice without needing per-handler-shape parsing.
// ---------------------------------------------------------------------------

export function isHumanTargetable(state: ServerGameState, human: HumanInstance): boolean {
  if (human.untargetableUntilRound !== undefined && state.round <= human.untargetableUntilRound) return false;
  if (state.thickMistUntilRound !== null && state.round <= state.thickMistUntilRound) {
    const adjacentToLure = state.board.lureStacks.some((s) => axialDistance(s.position, human.position) === 1);
    if (!adjacentToLure) return false;
  }
  return true;
}

export function isLureTargetable(state: ServerGameState, lure: LureStack): boolean {
  if (lure.untargetableUntilRound !== undefined && state.round <= lure.untargetableUntilRound) return false;
  return true;
}

export function cancelPendingEffectsTargeting(state: ServerGameState, id: string): void {
  for (const item of state.responseStack) {
    if (item.status !== "pending") continue;
    if (JSON.stringify(item.target ?? {}).includes(id)) {
      item.status = "canceled";
    }
  }
}

export function protectHuman(state: ServerGameState, human: HumanInstance, rounds: number): void {
  human.untargetableUntilRound = state.round + rounds;
  cancelPendingEffectsTargeting(state, human.instanceId);
}

export function protectLure(state: ServerGameState, lure: LureStack, rounds: number): void {
  lure.untargetableUntilRound = state.round + rounds;
  cancelPendingEffectsTargeting(state, lure.id);
}

import { PlayerId, ENCHANTMENT_DEFINITIONS_BY_ID, DOMAIN_DEFINITIONS_BY_ID } from "@fairy/shared";
import { EffectStackItem, PendingInteraction, ServerGameState } from "../state";
import { logEvent } from "./log";
import { runCardEffect } from "./cards";
import { runDomainAbility } from "./domainAbilities";
import { discardCard } from "./cards";
import { checkVictory } from "./victory";

let itemCounter = 0;
function nextItemId(): string {
  itemCounter += 1;
  return `effect-${itemCounter}`;
}

export function makeEffectItem(
  sourcePlayerId: PlayerId,
  kind: "card" | "domainAbility",
  name: string,
  timing: "action" | "instant",
  target: unknown,
  extra: { cardId?: string; abilityKey?: string }
): EffectStackItem {
  itemCounter += 1;
  return {
    id: nextItemId(),
    sourcePlayerId,
    kind,
    name,
    timing,
    target,
    status: "pending",
    ...extra,
  };
}

function instantsAreDisabled(state: ServerGameState): boolean {
  return state.instantsDisabledUntilRound !== null && state.round <= state.instantsDisabledUntilRound;
}

function eligibleInstantCardsFor(state: ServerGameState, playerId: PlayerId): string[] {
  if (instantsAreDisabled(state)) return [];
  const player = state.players[playerId];
  if (!player) return [];
  return player.hand.filter((cardId) => ENCHANTMENT_DEFINITIONS_BY_ID[cardId]?.timing === "instant");
}

/** Domain abilities (numbered 1-3, not yet used this game) with instant timing — reactively playable during any response window, same as a hand Instant. */
function eligibleInstantAbilitiesFor(state: ServerGameState, playerId: PlayerId): number[] {
  if (instantsAreDisabled(state)) return [];
  const player = state.players[playerId];
  if (!player) return [];
  const domain = DOMAIN_DEFINITIONS_BY_ID[player.domainId];
  if (!domain) return [];
  const indices: number[] = [];
  domain.abilities.forEach((a, i) => {
    if (a.timing === "instant" && a.implementationStatus === "implemented" && !player.abilitiesUsed[i]) indices.push(i);
  });
  return indices;
}

/** Opens a response window for a just-played action-timing effect. Every OTHER player, in turn order starting right after the source, then finally the source player themself, gets a chance to play an Instant or pass. */
export function openResponseWindow(state: ServerGameState, item: EffectStackItem): void {
  state.responseStack.push(item);
  const n = state.turnOrder.length;
  const startIdx = state.turnOrder.indexOf(item.sourcePlayerId);
  const queue: PlayerId[] = [];
  for (let i = 1; i <= n; i++) {
    queue.push(state.turnOrder[(startIdx + i) % n]);
  }
  state.responseWindowQueue = queue;
  state.responseConsecutivePasses = 0;
  // Remember what phase to restore once this window closes — normally
  // "player-turn", but the pre-spawn window (Threads of Fate) opens one from
  // "human-spawn" and must return there so spawning can continue.
  state.phaseBeforeResponseWindow = state.phase === "response-window" ? state.phaseBeforeResponseWindow : state.phase;
  state.phase = "response-window";
  logEvent(state, "response:windowOpened", `A response window opened for ${item.name}.`, { itemId: item.id });
  promptNextResponder(state);
}

/** Opens the same response-window machinery around a no-op synthetic item, purely to give every player one turn-order pass at reactive Instants — used for the pre-spawn window. Queue starts at the first player (sourcePlayerId is set to the last player in turn order so the +1 offset wraps to the first). */
export function openSystemResponseWindow(state: ServerGameState, name: string): void {
  const lastPlayerId = state.turnOrder[state.turnOrder.length - 1];
  const item = makeEffectItem(lastPlayerId, "card", name, "instant", null, {});
  openResponseWindow(state, item);
}

function promptNextResponder(state: ServerGameState): void {
  if (!state.responseWindowQueue || state.responseWindowQueue.length === 0) {
    resolveStackAndClose(state);
    return;
  }
  const playerId = state.responseWindowQueue[0];
  const cardOptions = eligibleInstantCardsFor(state, playerId);
  const abilityOptions = eligibleInstantAbilitiesFor(state, playerId);
  const deadline = state.responseTimerSec ? Date.now() + state.responseTimerSec * 1000 : null;
  const interaction: PendingInteraction = {
    id: `interaction-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    kind: "chooseInstantResponse",
    forPlayerIds: [playerId],
    prompt:
      cardOptions.length > 0 || abilityOptions.length > 0
        ? "You may play an Instant or pass."
        : "Waiting for the other players to respond. (You have no eligible Instants.)",
    legalOptions: { instantCardIds: cardOptions, instantAbilityIndices: abilityOptions },
    deadlineAt: deadline,
  };
  state.pendingInteraction = interaction;
}

export function respondPass(state: ServerGameState, playerId: PlayerId): void {
  if (!state.responseWindowQueue || state.responseWindowQueue[0] !== playerId) return;
  state.responseWindowQueue.shift();
  state.responseConsecutivePasses += 1;
  logEvent(state, "response:pass", `${playerId} passed.`, { playerId });
  if (state.responseConsecutivePasses >= state.turnOrder.length || state.responseWindowQueue.length === 0) {
    resolveStackAndClose(state);
  } else {
    promptNextResponder(state);
  }
}

/** Any instant may be responded to (spec section 11) — restart the round-robin from the player after the one who just acted, and reset the pass counter. */
function restartResponseQueueAfter(state: ServerGameState, playerId: PlayerId): void {
  const n = state.turnOrder.length;
  const startIdx = state.turnOrder.indexOf(playerId);
  const queue: PlayerId[] = [];
  for (let i = 1; i <= n; i++) queue.push(state.turnOrder[(startIdx + i) % n]);
  state.responseWindowQueue = queue;
  state.responseConsecutivePasses = 0;
}

export function respondWithInstant(state: ServerGameState, playerId: PlayerId, cardId: string, target: unknown): boolean {
  if (!state.responseWindowQueue || state.responseWindowQueue[0] !== playerId) return false;
  if (instantsAreDisabled(state)) return false;
  const def = ENCHANTMENT_DEFINITIONS_BY_ID[cardId];
  if (!def || def.timing !== "instant" || def.implementationStatus !== "implemented") return false;
  if (!discardCard(state, playerId, cardId)) return false; // removes from hand into discard; played face-up conceptually

  const item = makeEffectItem(playerId, "card", def.name, "instant", target, { cardId });
  state.responseStack.push(item);
  logEvent(state, "response:instantPlayed", `${playerId} played the Instant ${def.name}.`, { playerId, cardId, target });
  restartResponseQueueAfter(state, playerId);
  promptNextResponder(state);
  return true;
}

/** Reactively uses a numbered (1-3) instant-timing Domain ability during an open response window — same round-robin restart as a hand Instant. */
export function respondWithInstantAbility(state: ServerGameState, playerId: PlayerId, abilityIndex: number, target: unknown): boolean {
  if (!state.responseWindowQueue || state.responseWindowQueue[0] !== playerId) return false;
  if (instantsAreDisabled(state)) return false;
  const player = state.players[playerId];
  if (!player) return false;
  const domain = DOMAIN_DEFINITIONS_BY_ID[player.domainId];
  const abilityDef = domain?.abilities[abilityIndex];
  if (!abilityDef || abilityDef.timing !== "instant" || abilityDef.implementationStatus !== "implemented") return false;
  if (player.abilitiesUsed[abilityIndex]) return false;
  player.abilitiesUsed[abilityIndex] = true;

  const item = makeEffectItem(playerId, "domainAbility", abilityDef.name, "instant", target, { abilityKey: abilityDef.key });
  state.responseStack.push(item);
  logEvent(state, "response:instantAbilityUsed", `${playerId} used ${abilityDef.name}.`, { playerId, abilityKey: abilityDef.key, target });
  restartResponseQueueAfter(state, playerId);
  promptNextResponder(state);
  return true;
}

/** Resolves the response stack top-down (last played, first resolved), then returns to normal play. */
function resolveStackAndClose(state: ServerGameState): void {
  state.responseWindowQueue = null;
  state.pendingInteraction = null;

  while (state.responseStack.length > 0) {
    const item = state.responseStack[state.responseStack.length - 1];
    state.responseStack.pop();
    if (item.status === "canceled") {
      logEvent(state, "response:resolvedCanceled", `${item.name} was canceled and did not resolve.`, { itemId: item.id });
      continue;
    }
    // Frozen Magic: fold any duration-extension bonus into the target payload
    // so duration-granting handlers (Blessing of the Good Folk, Crystal Ward,
    // Mesmerize, Cleansing Waters) can see it without a signature change.
    const targetWithContext =
      item.extendDurationBonus && typeof item.target === "object" && item.target !== null
        ? { ...(item.target as Record<string, unknown>), __extendRounds: item.extendDurationBonus }
        : item.target;

    let result: { ok: boolean; error?: string };
    if (item.kind === "card") {
      const def = ENCHANTMENT_DEFINITIONS_BY_ID[item.cardId ?? ""];
      result = def ? runCardEffect(state, item.sourcePlayerId, def.effectKey, targetWithContext) : { ok: false, error: "Unknown card." };
    } else {
      result = runDomainAbility(state, item.sourcePlayerId, item.abilityKey ?? "", targetWithContext);
    }
    item.status = result.ok ? "resolved" : "canceled";
    if (!result.ok) {
      logEvent(state, "response:resolveFailed", `${item.name} failed to resolve: ${result.error}`, { itemId: item.id, error: result.error });
    }

    // Wildfire: run the same handler a second time against the extra Human.
    if (result.ok && item.extraHumanInstanceId && typeof item.target === "object" && item.target !== null && "humanInstanceId" in item.target) {
      const secondTarget = { ...(item.target as Record<string, unknown>), humanInstanceId: item.extraHumanInstanceId };
      if (item.kind === "card") {
        const def = ENCHANTMENT_DEFINITIONS_BY_ID[item.cardId ?? ""];
        if (def) runCardEffect(state, item.sourcePlayerId, def.effectKey, secondTarget);
      } else {
        runDomainAbility(state, item.sourcePlayerId, item.abilityKey ?? "", secondTarget);
      }
    }

    // Faerie Bargain: redirect the just-resolved card from the discard pile
    // into the requesting player's hand instead.
    if (result.ok && item.kind === "card" && item.cardId && item.redirectToHandPlayerId) {
      const idx = state.discardPile.lastIndexOf(item.cardId);
      if (idx !== -1) {
        state.discardPile.splice(idx, 1);
        const recipient = state.players[item.redirectToHandPlayerId];
        if (recipient) {
          recipient.hand.push(item.cardId);
          logEvent(state, "card:redirectedToHand", `${item.name} went to ${item.redirectToHandPlayerId}'s hand instead of the discard pile.`, {
            itemId: item.id,
            cardId: item.cardId,
            playerId: item.redirectToHandPlayerId,
          });
        }
      }
    }

    checkVictory(state);
    if (state.winnerId) break;
  }

  if (!state.winnerId) {
    state.phase = state.phaseBeforeResponseWindow ?? "player-turn";
    state.phaseBeforeResponseWindow = null;
  }
}

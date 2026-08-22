import {
  Axial,
  ACTIONS_PER_TURN,
  DISCARD_DRAW_COUNT,
  ENCHANTMENT_DEFINITIONS_BY_ID,
  DOMAIN_DEFINITIONS_BY_ID,
  PlayerId,
  VEIL_OF_MIST_ATTRACTION_RADIUS,
  MOONS_ASCENDANCE_MOVES_PER_HUMAN,
} from "@fairy/shared";
import { ServerGameState, PendingInteraction } from "./state";
import { logEvent } from "./engine/log";
import { isLegalLurePlacement, legalLurePlacementSpaces, placeLure } from "./engine/lures";
import { drawCard, discardCard, runCardEffect } from "./engine/cards";
import { runDomainAbility } from "./engine/domainAbilities";
import {
  openResponseWindow,
  openSystemResponseWindow,
  respondPass,
  respondWithInstant,
  respondWithInstantAbility,
  makeEffectItem,
} from "./engine/responseWindow";
import { checkVictory, checkTurnBasedEnd } from "./engine/victory";
import { beginNextPlayerTurn, nextPlayerId, availableActions } from "./engine/turns";
import { spawnHumans } from "./engine/setup";
import {
  MovementBoard,
  advanceMovementPhase,
  resolvePathChoice,
  resetMovedMarkers,
  MovementEvent,
} from "./engine/movement";
import { collectHumanForPlayer } from "./engine/scoring";
import { buildDomainHexMap } from "./engine/domains";

export type EngineResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// asMovementBoard / syncBoardBack: the movement engine is intentionally a
// standalone module with its own MovementBoard shape (see movement.ts). This
// adapter bridges it to ServerGameState without duplicating logic: it
// operates on the SAME array instances until the movement engine reassigns
// one (e.g. `board.humans = board.humans.filter(...)`), at which point we
// copy the new reference back onto state.board.
// ---------------------------------------------------------------------------
function asMovementBoard(state: ServerGameState): MovementBoard {
  return {
    hexes: state.board.hexes,
    humans: state.board.humans,
    lureStacks: state.board.lureStacks,
    obstacles: state.board.obstacles,
    accelMarkers: state.board.accelMarkers,
    firstPlayerOrder: state.turnOrder,
    pendingPathChoice: state.board.pendingPathChoice,
    currentRound: state.round,
    attractionRadiusCap:
      state.veilOfMistUntilRound !== null && state.round <= state.veilOfMistUntilRound
        ? VEIL_OF_MIST_ATTRACTION_RADIUS
        : undefined,
    movesPerHuman:
      state.moonsAscendanceUntilRound !== null && state.round <= state.moonsAscendanceUntilRound
        ? MOONS_ASCENDANCE_MOVES_PER_HUMAN
        : undefined,
    domainHexes: buildDomainHexMap(state),
  };
}

function syncBoardBack(state: ServerGameState, movBoard: MovementBoard): void {
  state.board.humans = movBoard.humans;
  state.board.lureStacks = movBoard.lureStacks;
  state.board.obstacles = movBoard.obstacles;
  state.board.accelMarkers = movBoard.accelMarkers;
  state.board.pendingPathChoice = movBoard.pendingPathChoice;
}

function applyMovementEvents(state: ServerGameState, events: MovementEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case "moved":
        logEvent(state, "human:moved", `A Human moved to (${e.to.q},${e.to.r}).`, e as any);
        break;
      case "confused":
        logEvent(state, "human:confused", "A Human is confused and cannot currently move.", e as any);
        break;
      case "lureCleared":
        logEvent(state, "lure:cleared", `A lure at (${e.position.q},${e.position.r}) was cleared.`, e as any);
        break;
      case "accelerationTriggered":
        logEvent(state, "human:acceleration", "A Human triggered an Acceleration marker.", e as any);
        break;
      case "humanCollected":
        collectHumanForPlayer(state, e.collectedBy, e.definitionId);
        checkVictory(state);
        break;
      case "pathChoiceRequired":
        break; // surfaced via board.pendingPathChoice; handled by tickMovementPhase
    }
    if (state.winnerId) return;
  }
}

/** Advances from a just-finished player-turn to whatever comes next: the following player's turn, or the Human Movement Phase if the table has come back around to the first player. */
function finishPlayerTurn(state: ServerGameState): void {
  const upNext = nextPlayerId(state, state.activePlayerId);
  if (upNext === state.firstPlayerId) {
    state.phase = "human-movement";
    resetMovedMarkers(asMovementBoard(state));
    logEvent(state, "phase:humanMovementBegin", "The Human Movement Phase begins.");
    tickMovementPhase(state);
  } else {
    beginNextPlayerTurn(state);
  }
}

/** Confirmed rule: a hand over its max size at the end of a turn must be discarded down to that max before play continues. */
function openMandatoryDiscardInteraction(state: ServerGameState, playerId: PlayerId): void {
  const player = state.players[playerId];
  if (!player) return;
  const mustDiscardCount = player.hand.length - player.handSizeMax;
  state.pendingInteraction = {
    id: `interaction-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    kind: "mandatoryDiscard",
    forPlayerIds: [playerId],
    prompt: `Your hand has ${player.hand.length} cards, over the ${player.handSizeMax}-card max — discard ${mustDiscardCount} to continue.`,
    legalOptions: { hand: [...player.hand], mustDiscardCount, handSizeMax: player.handSizeMax },
    deadlineAt: null,
  };
  logEvent(state, "hand:overMax", `${playerId} must discard ${mustDiscardCount} card(s) down to the ${player.handSizeMax}-card max.`, {
    playerId,
    mustDiscardCount,
    handSizeMax: player.handSizeMax,
  });
}

function ensureMovementPathInteraction(state: ServerGameState): void {
  const choice = state.board.pendingPathChoice;
  if (!choice) return;
  state.pendingInteraction = {
    id: `interaction-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    kind: "chooseMovementPath",
    forPlayerIds: [choice.controllingPlayerId],
    prompt: "Choose the Human's path.",
    legalOptions: { positions: choice.options },
    deadlineAt: null,
    data: { humanInstanceId: choice.humanInstanceId },
  };
}

function tickMovementPhase(state: ServerGameState): void {
  while (!state.winnerId) {
    const movBoard = asMovementBoard(state);
    if (movBoard.pendingPathChoice) {
      ensureMovementPathInteraction(state);
      return;
    }
    const { result, events } = advanceMovementPhase(movBoard);
    syncBoardBack(state, movBoard);
    applyMovementEvents(state, events);
    if (state.winnerId) return;
    if (result.status === "waitingOnChoice") {
      ensureMovementPathInteraction(state);
      return;
    }
    if (result.status === "done") {
      logEvent(state, "phase:humanMovementComplete", "The Human Movement Phase has ended.");
      state.phase = "human-spawn";
      maybeAdvancePhase(state);
      return;
    }
    // 'advanced' — loop again to process the next Human immediately.
  }
}

/** Central phase-transition dispatcher. Call after any mutation; it's a no-op unless a phase is ready to auto-advance. */
export function maybeAdvancePhase(state: ServerGameState): void {
  if (state.winnerId) return;
  if (state.pendingInteraction) return;
  if (state.responseWindowQueue) return;

  if (state.phase === "player-turn") {
    const player = state.players[state.activePlayerId];
    const turnDone = state.actionsRemaining <= 0 && (player?.extraEnchantmentPlaysThisTurn ?? 0) <= 0;
    if (turnDone) {
      const endingPlayerId = state.activePlayerId;
      const drawn = drawCard(state, endingPlayerId);
      logEvent(state, "turn:end", `${endingPlayerId}'s turn ends.${drawn ? " Drew a card." : ""}`, {
        playerId: endingPlayerId,
      });
      const endingPlayer = state.players[endingPlayerId];
      if (endingPlayer && endingPlayer.hand.length > endingPlayer.handSizeMax) {
        openMandatoryDiscardInteraction(state, endingPlayerId);
        return;
      }
      finishPlayerTurn(state);
    }
    return;
  }

  if (state.phase === "human-spawn") {
    // Threads of Fate: give players holding it one chance to react "right
    // before Humans arrive in portal" before the spawn actually happens.
    // Skipped when nobody could possibly play it, to avoid a no-op prompt
    // parade every single round.
    if (!state.preSpawnWindowOffered) {
      state.preSpawnWindowOffered = true;
      const anyoneHoldsThreadsOfFate = Object.values(state.players).some((p) => p.hand.includes("threads-of-fate"));
      if (anyoneHoldsThreadsOfFate) {
        openSystemResponseWindow(state, "Portal Arrival");
        return;
      }
    }
    spawnHumans(state, state.board.spawnIndicator, false);
    state.phase = "round-cleanup";
    state.preSpawnWindowOffered = false;
    maybeAdvancePhase(state);
    return;
  }

  if (state.phase === "round-cleanup") {
    // Turns-mode end check, evaluated once per completed round, before the
    // round counter advances (so it still reflects the round that just
    // finished) — see engine/victory.ts::checkTurnBasedEnd.
    checkTurnBasedEnd(state);
    if (state.winnerId || state.drawPlayerIds) return;

    state.round += 1;
    state.activePlayerId = state.firstPlayerId;
    state.actionsRemaining = ACTIONS_PER_TURN;
    state.discardDrawUsedThisTurn = false;
    const p = state.players[state.activePlayerId];
    if (p) p.extraEnchantmentPlaysThisTurn = 0;
    state.phase = "player-turn";
    logEvent(state, "round:begin", `Round ${state.round} begins.`, { round: state.round });

    // Delayed Curse: resolve anything scheduled for this round now, bypassing a new response window.
    const due = state.deferredEffects.filter((d) => d.resolveAtRound <= state.round);
    state.deferredEffects = state.deferredEffects.filter((d) => d.resolveAtRound > state.round);
    for (const { item } of due) {
      const result =
        item.kind === "card"
          ? (() => {
              const def = ENCHANTMENT_DEFINITIONS_BY_ID[item.cardId ?? ""];
              return def ? runCardEffect(state, item.sourcePlayerId, def.effectKey, item.target) : { ok: false, error: "Unknown card." };
            })()
          : runDomainAbility(state, item.sourcePlayerId, item.abilityKey ?? "", item.target);
      logEvent(state, "effect:deferredResolved", `${item.name} resolved (Delayed Curse).${result.ok ? "" : ` Failed: ${result.error}`}`, {
        itemId: item.id,
        ok: result.ok,
      });
      checkVictory(state);
      if (state.winnerId) return;
    }
    return;
  }
}

/** Called once, right after a game is created, to kick off the starting-abilities queue if one exists. No-op if play starts directly at "player-turn". */
export function beginGameplay(state: ServerGameState): void {
  if (state.phase === "starting-abilities") {
    promptNextStartingAbility(state);
  }
}

function promptNextStartingAbility(state: ServerGameState): void {
  if (state.startingAbilityQueue.length === 0) {
    state.phase = "player-turn";
    return;
  }
  const playerId = state.startingAbilityQueue[0];
  const domain = DOMAIN_DEFINITIONS_BY_ID[state.players[playerId]?.domainId ?? ""];
  const ability = domain?.startingAbility;
  if (!ability) {
    // Shouldn't happen (the queue is built from players with a real ability), but stay safe.
    state.startingAbilityQueue.shift();
    promptNextStartingAbility(state);
    return;
  }
  state.pendingInteraction = {
    id: `interaction-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    kind: "chooseDomainAbility",
    forPlayerIds: [playerId],
    prompt: `Resolve your Domain's starting ability — ${ability.name}: ${ability.rulesText}`,
    legalOptions: { targetType: ability.targetType, abilityKey: ability.key },
    deadlineAt: null,
  };
}

// ---------------------------------------------------------------------------
// Action submission
// ---------------------------------------------------------------------------

export function submitAction(
  state: ServerGameState,
  playerId: PlayerId,
  type: string,
  payload: Record<string, unknown>
): EngineResult {
  if (state.phase !== "player-turn") return { ok: false, error: "Actions can only be taken during a player's turn." };
  if (state.activePlayerId !== playerId) return { ok: false, error: "It is not your turn." };
  const player = state.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };

  switch (type) {
    case "placeLure": {
      const pos = payload.position as Axial;
      if (state.actionsRemaining <= 0) return { ok: false, error: "No actions remaining." };
      if (!pos || !isLegalLurePlacement(state, playerId, pos)) return { ok: false, error: "Illegal lure placement." };
      placeLure(state, playerId, pos);
      state.actionsRemaining -= 1;
      maybeAdvancePhase(state);
      return { ok: true };
    }

    case "drawCard": {
      if (state.actionsRemaining <= 0) return { ok: false, error: "No actions remaining." };
      state.actionsRemaining -= 1;
      const drawn = drawCard(state, playerId);
      logEvent(state, "action:drawCard", `${playerId} drew a card.${drawn ? "" : " The deck and discard pile were both empty."}`, {
        playerId,
        drawn,
      });
      maybeAdvancePhase(state);
      return { ok: true };
    }

    case "discardDraw": {
      // Confirmed by the user: discards the player's ENTIRE hand (no
      // selection) and draws exactly DISCARD_DRAW_COUNT cards back — no
      // longer "discard any number you choose, refill to a target size."
      if (state.actionsRemaining <= 0) return { ok: false, error: "No actions remaining." };
      if (state.discardDrawUsedThisTurn) return { ok: false, error: "Already used discard-and-draw this turn." };
      const discardedCount = player.hand.length;
      for (const id of [...player.hand]) discardCard(state, playerId, id);
      let drawnCount = 0;
      for (let i = 0; i < DISCARD_DRAW_COUNT; i++) {
        if (!drawCard(state, playerId)) break;
        drawnCount += 1;
      }
      state.discardDrawUsedThisTurn = true;
      state.actionsRemaining -= 1;
      logEvent(state, "action:discardDraw", `${playerId} discarded their entire hand (${discardedCount} card(s)) and drew ${drawnCount}.`, {
        playerId,
        discarded: discardedCount,
        drawn: drawnCount,
      });
      maybeAdvancePhase(state);
      return { ok: true };
    }

    case "playCard": {
      const cardId = payload.cardId as string;
      const target = payload.target;
      const def = ENCHANTMENT_DEFINITIONS_BY_ID[cardId];
      if (!def) return { ok: false, error: "Unknown card." };
      if (def.implementationStatus !== "implemented") return { ok: false, error: "This card is not yet implemented." };
      if (!player.hand.includes(cardId)) return { ok: false, error: "You do not hold that card." };
      if (def.actionCost > 0) {
        if (state.actionsRemaining >= def.actionCost) {
          state.actionsRemaining -= def.actionCost;
        } else if (player.extraEnchantmentPlaysThisTurn > 0) {
          player.extraEnchantmentPlaysThisTurn -= 1;
        } else {
          return { ok: false, error: "No actions remaining." };
        }
      }
      discardCard(state, playerId, cardId);
      const item = makeEffectItem(playerId, "card", def.name, def.timing, target, { cardId });
      logEvent(state, "card:played", `${playerId} played ${def.name}.`, { playerId, cardId, target });
      openResponseWindow(state, item);
      return { ok: true };
    }

    case "useDomainAbility": {
      const abilityIndex = payload.abilityIndex as number;
      const target = payload.target;
      const domain = DOMAIN_DEFINITIONS_BY_ID[player.domainId];
      if (!domain || abilityIndex < 0 || abilityIndex > 2) return { ok: false, error: "Unknown ability." };
      const abilityDef = domain.abilities[abilityIndex];
      if (abilityDef.implementationStatus !== "implemented") return { ok: false, error: "This ability is not yet implemented." };
      if (player.abilitiesUsed[abilityIndex]) return { ok: false, error: "That ability has already been used this game." };
      if (abilityDef.timing === "action") {
        if (state.actionsRemaining <= 0) return { ok: false, error: "No actions remaining." };
        state.actionsRemaining -= 1;
      }
      player.abilitiesUsed[abilityIndex] = true;
      const item = makeEffectItem(playerId, "domainAbility", abilityDef.name, abilityDef.timing, target, {
        abilityKey: abilityDef.key,
      });
      logEvent(state, "domainAbility:used", `${playerId} used ${abilityDef.name}.`, { playerId, ability: abilityDef.key, target });
      openResponseWindow(state, item);
      return { ok: true };
    }

    case "useMainAbility": {
      const target = payload.target;
      const domain = DOMAIN_DEFINITIONS_BY_ID[player.domainId];
      const mainAbility = domain?.mainAbility;
      if (!mainAbility) return { ok: false, error: "Your Domain has no Main Ability." };
      if (mainAbility.implementationStatus !== "implemented") return { ok: false, error: "This Main Ability is not yet implemented." };
      if (state.actionsRemaining < mainAbility.actionCost) return { ok: false, error: "Not enough actions remaining." };
      state.actionsRemaining -= mainAbility.actionCost;
      const item = makeEffectItem(playerId, "domainAbility", mainAbility.name, mainAbility.timing, target, {
        abilityKey: mainAbility.key,
      });
      logEvent(state, "mainAbility:used", `${playerId} used their Main Ability.`, { playerId, ability: mainAbility.key, target });
      openResponseWindow(state, item);
      return { ok: true };
    }

    case "endTurn": {
      // Not one of the four action *choices* in the spec, but a necessary UX
      // escape hatch: declines any unused actions (e.g. an unused
      // Mirage-granted bonus play) instead of soft-locking the turn.
      state.actionsRemaining = 0;
      player.extraEnchantmentPlaysThisTurn = 0;
      maybeAdvancePhase(state);
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown action type: ${type}` };
  }
}

// ---------------------------------------------------------------------------
// Pending-interaction responses
// ---------------------------------------------------------------------------

export function respondToInteraction(
  state: ServerGameState,
  playerId: PlayerId,
  interactionId: string,
  payload: Record<string, unknown>
): EngineResult {
  const interaction = state.pendingInteraction;
  if (!interaction || interaction.id !== interactionId) return { ok: false, error: "That prompt is no longer active." };
  if (!interaction.forPlayerIds.includes(playerId)) return { ok: false, error: "This prompt is not for you." };

  switch (interaction.kind) {
    case "chooseInstantResponse": {
      const pass = Boolean(payload.pass);
      if (pass) {
        respondPass(state, playerId);
      } else if (payload.abilityIndex !== undefined) {
        const applied = respondWithInstantAbility(state, playerId, payload.abilityIndex as number, payload.target);
        if (!applied) return { ok: false, error: "That ability cannot be used right now." };
      } else {
        const cardId = payload.cardId as string;
        const target = payload.target;
        if (!cardId) return { ok: false, error: "Choose a card or ability to play, or pass." };
        const applied = respondWithInstant(state, playerId, cardId, target);
        if (!applied) return { ok: false, error: "That Instant cannot be played right now." };
      }
      maybeAdvancePhase(state);
      return { ok: true };
    }

    case "chooseMovementPath": {
      const chosen = payload.position as Axial;
      const movBoard = asMovementBoard(state);
      if (!movBoard.pendingPathChoice) return { ok: false, error: "No path choice is pending." };
      try {
        const events = resolvePathChoice(movBoard, chosen);
        syncBoardBack(state, movBoard);
        state.pendingInteraction = null;
        applyMovementEvents(state, events);
        if (!state.winnerId) tickMovementPhase(state);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    case "chooseDomainAbility": {
      const domain = DOMAIN_DEFINITIONS_BY_ID[state.players[playerId]?.domainId ?? ""];
      const ability = domain?.startingAbility;
      if (!ability) return { ok: false, error: "No starting ability to resolve." };
      const result = runDomainAbility(state, playerId, ability.key, payload.target);
      if (!result.ok) return { ok: false, error: result.error };
      logEvent(state, "startingAbility:used", `${playerId} resolved their starting ability (${ability.name}).`, { playerId, ability: ability.key });
      state.startingAbilityQueue.shift();
      state.pendingInteraction = null;
      promptNextStartingAbility(state);
      checkVictory(state);
      return { ok: true };
    }

    case "mandatoryDiscard": {
      const player = state.players[playerId];
      if (!player) return { ok: false, error: "Unknown player." };
      const mustDiscardCount = (interaction.legalOptions as { mustDiscardCount: number }).mustDiscardCount;
      const cardIds = (payload.cardIds as string[]) ?? [];
      if (cardIds.length !== mustDiscardCount) return { ok: false, error: `Choose exactly ${mustDiscardCount} card(s) to discard.` };
      for (const id of cardIds) {
        if (!player.hand.includes(id)) return { ok: false, error: `You do not hold ${id}.` };
      }
      for (const id of cardIds) discardCard(state, playerId, id);
      logEvent(state, "hand:discardedToMax", `${playerId} discarded ${cardIds.length} card(s) down to the hand max.`, {
        playerId,
        discarded: cardIds.length,
      });
      state.pendingInteraction = null;
      finishPlayerTurn(state);
      return { ok: true };
    }

    default:
      return { ok: false, error: "Unhandled interaction kind." };
  }
}

// ---------------------------------------------------------------------------
// Host correction tools (spec section 28) — always logged, never silent.
// ---------------------------------------------------------------------------

export function applyHostCorrection(
  state: ServerGameState,
  hostPlayerId: PlayerId,
  type: string,
  payload: Record<string, unknown>
): EngineResult {
  switch (type) {
    case "moveHuman": {
      const human = state.board.humans.find((h) => h.instanceId === payload.humanInstanceId);
      if (!human) return { ok: false, error: "Unknown Human." };
      human.position = payload.to as Axial;
      logEvent(state, "host:correction", `Host moved a Human.`, { type, payload, by: hostPlayerId });
      return { ok: true };
    }
    case "moveLure": {
      const stack = state.board.lureStacks.find((s) => s.id === payload.stackId);
      if (!stack) return { ok: false, error: "Unknown lure stack." };
      stack.position = payload.to as Axial;
      logEvent(state, "host:correction", `Host moved a lure.`, { type, payload, by: hostPlayerId });
      return { ok: true };
    }
    case "addObstacle": {
      state.board.obstacles.push({
        id: `obstacle-host-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        type: payload.obstacleType as any,
        position: payload.position as Axial,
      });
      logEvent(state, "host:correction", `Host added an obstacle.`, { type, payload, by: hostPlayerId });
      return { ok: true };
    }
    case "removeObstacle": {
      state.board.obstacles = state.board.obstacles.filter((o) => o.id !== payload.obstacleId);
      logEvent(state, "host:correction", `Host removed an obstacle.`, { type, payload, by: hostPlayerId });
      return { ok: true };
    }
    case "adjustScore": {
      const target = state.players[payload.playerId as string];
      if (!target) return { ok: false, error: "Unknown player." };
      target.score += payload.delta as number;
      logEvent(state, "host:correction", `Host adjusted ${payload.playerId}'s score by ${payload.delta}.`, {
        type,
        payload,
        by: hostPlayerId,
      });
      checkVictory(state);
      return { ok: true };
    }
    case "drawCard": {
      drawCard(state, payload.playerId as string);
      logEvent(state, "host:correction", `Host drew a card for ${payload.playerId}.`, { type, payload, by: hostPlayerId });
      return { ok: true };
    }
    case "discardCard": {
      discardCard(state, payload.playerId as string, payload.cardId as string);
      logEvent(state, "host:correction", `Host discarded a card for ${payload.playerId}.`, { type, payload, by: hostPlayerId });
      return { ok: true };
    }
    case "advancePhase": {
      logEvent(state, "host:correction", `Host manually advanced a stuck phase.`, { type, payload, by: hostPlayerId });
      maybeAdvancePhase(state);
      return { ok: true };
    }
    default:
      return { ok: false, error: `Unsupported host correction: ${type}` };
  }
}

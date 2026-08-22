import {
  DomainId,
  VictoryCondition,
  BOARD_EDGE_LENGTH,
  DOMAIN_SIDE_ASSIGNMENTS,
  HAND_SIZE_START,
  HAND_SIZE_MAX,
  MOONLIGHT_PIXIES_HAND_SIZE_START,
  MOONLIGHT_PIXIES_HAND_SIZE_MAX,
  ACTIONS_PER_TURN,
  SPAWN_DATA,
  playableDeckDefinitions,
  generateHexagonalBoard,
  domainAttachmentHexes,
  axialKey,
  Axial,
  HumanInstance,
  PlayerId,
  DOMAIN_DEFINITIONS_BY_ID,
} from "@fairy/shared";
import { ServerGameState, ServerPlayerState, DomainBoardAssignment } from "../state";
import { logEvent } from "./log";

export type SetupPlayerInput = {
  id: PlayerId;
  seat: number;
  domainId: DomainId;
  birthYear: number | null;
};

function shuffle<T>(arr: T[]): T[] {
  // Fisher-Yates. Server-side only; not used inside any Workflow-style pure
  // context, so Math.random() is fine here.
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildDeck(disabledCardIds: string[]): string[] {
  const deck: string[] = [];
  for (const def of playableDeckDefinitions(disabledCardIds)) {
    // TODO_RULE_CONFIRMATION: a handful of implemented cards (mostly
    // Landscapes) have no "Copies" count in the source spreadsheet at all;
    // default to a single copy each until a real count is confirmed.
    const copies = def.quantity ?? 1;
    for (let i = 0; i < copies; i++) deck.push(def.id);
  }
  return shuffle(deck);
}

/** Determines the first player per the lobby's configured rule (spec section 8-9). */
export function determineFirstPlayer(
  players: SetupPlayerInput[],
  rule: "youngest" | "previousWinner",
  previousWinnerId: PlayerId | null
): PlayerId {
  if (rule === "previousWinner" && previousWinnerId && players.some((p) => p.id === previousWinnerId)) {
    return previousWinnerId;
  }
  // Default / fallback: youngest player. Players without a supplied birth year
  // are treated as "oldest" (lowest priority) rather than crashing the sort.
  const withYear = players.filter((p) => p.birthYear !== null);
  if (withYear.length === 0) {
    // Nobody supplied an age — fall back to seat order deterministically.
    return [...players].sort((a, b) => a.seat - b.seat)[0].id;
  }
  const youngest = [...withYear].sort((a, b) => (b.birthYear! - a.birthYear!))[0];
  return youngest.id;
}

export function buildInitialGameState(
  players: SetupPlayerInput[],
  victoryCondition: VictoryCondition,
  disabledCardIds: string[],
  firstPlayerRule: "youngest" | "previousWinner",
  responseTimerSec: number | null,
  pushPullSidewaysAllowed: boolean,
  previousWinnerId: PlayerId | null
): ServerGameState {
  const firstPlayerId = determineFirstPlayer(players, firstPlayerRule, previousWinnerId);
  const orderedBySeat = [...players].sort((a, b) => a.seat - b.seat);
  const startIdx = orderedBySeat.findIndex((p) => p.id === firstPlayerId);
  const turnOrder = [
    ...orderedBySeat.slice(startIdx),
    ...orderedBySeat.slice(0, startIdx),
  ].map((p) => p.id);

  const hexes = new Set(generateHexagonalBoard(BOARD_EDGE_LENGTH).map(axialKey));
  const deck = buildDeck(disabledCardIds);

  // Domain boards: physical 4-hex extensions attached past one edge of the
  // main board (see domainAttachmentHexes). Players are randomly assigned to
  // the side numbers appropriate for the table size (DOMAIN_SIDE_ASSIGNMENTS);
  // reaching your own Domain's hexes is what scores a Human (see movement.ts).
  const sideNumbers = DOMAIN_SIDE_ASSIGNMENTS[players.length] ?? [];
  const domainBoards: DomainBoardAssignment[] = shuffle(players).map((p, i) => {
    const side = sideNumbers[i];
    const domainHexes = domainAttachmentHexes(side, BOARD_EDGE_LENGTH);
    for (const h of domainHexes) hexes.add(axialKey(h));
    return { playerId: p.id, domainId: p.domainId, side, hexes: domainHexes };
  });

  const playerStates: Record<PlayerId, ServerPlayerState> = {};
  for (const p of players) {
    // Passive starting-ability stat modifiers, applied automatically (see
    // domains.ts — the targeted starting abilities are not auto-applied).
    const isRiverNymphs = p.domainId === "river-nymphs";
    const isMoonlightPixies = p.domainId === "moonlight-pixies";
    const lureCap = isRiverNymphs ? 4 : null;
    const openingHandSize = isMoonlightPixies ? MOONLIGHT_PIXIES_HAND_SIZE_START : HAND_SIZE_START;
    const handSizeMax = isMoonlightPixies ? MOONLIGHT_PIXIES_HAND_SIZE_MAX : HAND_SIZE_MAX;

    const hand: string[] = [];
    for (let i = 0; i < openingHandSize; i++) {
      const card = deck.pop();
      if (card) hand.push(card);
    }
    playerStates[p.id] = {
      id: p.id,
      domainId: p.domainId,
      hand,
      score: 0,
      collectedHumanDefinitionIds: [],
      abilitiesUsed: [false, false, false],
      startingAbilityUsed: false,
      extraEnchantmentPlaysThisTurn: 0,
      lureCap,
      handSizeMax,
    };
  }

  const state: ServerGameState = {
    phase: "setup",
    version: 1,
    victoryCondition,
    // Turns mode ends the game via checkTurnBasedEnd (round-cleanup), not the
    // points threshold — Infinity keeps checkVictory's early-exit inert.
    targetScore: victoryCondition.kind === "points" ? victoryCondition.targetScore : Infinity,
    firstPlayerRule,
    responseTimerSec,
    pushPullSidewaysAllowed,
    board: {
      edgeLength: BOARD_EDGE_LENGTH,
      hexes,
      portalCenter: SPAWN_DATA.portalCenter,
      humans: [],
      lureStacks: [],
      obstacles: [],
      accelMarkers: [],
      spawnIndicator: SPAWN_DATA.initialSet,
      pendingPathChoice: null,
      domainBoards,
    },
    players: playerStates,
    turnOrder,
    firstPlayerId,
    activePlayerId: firstPlayerId,
    actionsRemaining: ACTIONS_PER_TURN,
    discardDrawUsedThisTurn: false,
    deck,
    discardPile: [],
    responseStack: [],
    responseWindowQueue: null,
    responseConsecutivePasses: 0,
    pendingInteraction: null,
    round: 1,
    winnerId: null,
    drawPlayerIds: null,
    log: [],
    ephemeralReveals: [],
    ephemeralDeckPeeks: [],
    instantsDisabledUntilRound: null,
    thickMistUntilRound: null,
    veilOfMistUntilRound: null,
    moonsAscendanceUntilRound: null,
    startingAbilityQueue: [],
    deferredEffects: [],
    spawnOverrides: [],
    phaseBeforeResponseWindow: null,
    preSpawnWindowOffered: false,
  };

  logEvent(state, "setup:firstPlayer", `${firstPlayerId} is the first player (${firstPlayerRule}).`, {
    firstPlayerId,
    rule: firstPlayerRule,
  });

  spawnHumans(state, SPAWN_DATA.initialSet, true);

  // Targeted starting abilities (Ocean Sirens, Forest Elves, Wind Djinn,
  // Earth Gnomes) resolve one at a time, in turn order, before normal play
  // begins. Passive ones (River Nymphs, Moonlight Pixies) were already
  // applied above via lureCap/handSizeMax and need no queue
  // entry (their startingAbility.targetType is "none").
  state.startingAbilityQueue = turnOrder.filter((id) => {
    const domain = DOMAIN_DEFINITIONS_BY_ID[playerStates[id].domainId];
    return domain?.startingAbility && domain.startingAbility.implementationStatus === "implemented" && domain.startingAbility.targetType !== "none";
  });
  state.phase = state.startingAbilityQueue.length > 0 ? "starting-abilities" : "player-turn";

  return state;
}

let instanceCounter = 0;
function nextInstanceId(prefix: string): string {
  instanceCounter += 1;
  return `${prefix}-${instanceCounter}`;
}

/** Confirmed rule: exactly one Human per hex, ever. */
function isHexOccupiedByHuman(state: ServerGameState, pos: Axial): boolean {
  return state.board.humans.some((h) => h.position.q === pos.q && h.position.r === pos.r);
}

/**
 * Spawns Humans + the associated Hunter for the given Portal spawn set (A or
 * B), per spec section 7. Does NOT use dice — purely data-driven from
 * SPAWN_DATA. After spawning, flips the indicator to the other set unless
 * `isInitialSetup` (the very first spawn doesn't "flip" — it sets B as the
 * *next* indicator per the spec's explicit wording).
 *
 * Confirmed rule: a designated spawn hex that's already occupied (by a
 * Human left over from an earlier round, or one that just spawned in this
 * same batch) simply spawns nothing there — one fewer Human this round, not
 * a relocation to some other hex. Same for the Hunter's center position. If
 * every designated hex is occupied, nothing spawns at all this round.
 */
export function spawnHumans(state: ServerGameState, set: "A" | "B", isInitialSetup: boolean): void {
  const config = SPAWN_DATA.sets[set];
  const positions = [...config.positions];
  let posIdx = 0;
  for (const entry of config.humans) {
    for (let i = 0; i < entry.count; i++) {
      const pos = positions[posIdx % positions.length];
      posIdx += 1;
      if (isHexOccupiedByHuman(state, pos)) continue;
      // Threads of Fate: an override for this exact position replaces the
      // configured Human type for this one spawn only.
      const override = state.spawnOverrides.find((o) => o.position.q === pos.q && o.position.r === pos.r);
      const definitionId = override?.definitionId ?? entry.definitionId;
      const instance: HumanInstance = {
        instanceId: nextInstanceId("human"),
        definitionId,
        position: pos,
        moved: false,
        confused: false,
        attractedToStackId: null,
        blockedNoLure: false,
      };
      state.board.humans.push(instance);
    }
  }
  state.spawnOverrides = [];
  if (!isHexOccupiedByHuman(state, config.hunterCenterPosition)) {
    const hunter: HumanInstance = {
      instanceId: nextInstanceId("human"),
      definitionId: "hunter",
      position: config.hunterCenterPosition,
      moved: false,
      confused: false,
      attractedToStackId: null,
      blockedNoLure: false,
    };
    state.board.humans.push(hunter);
  }

  logEvent(state, "spawn:humans", `Humans spawned from Portal set ${set}.`, { set });

  // Advance the indicator to the *other* set for the next spawn.
  state.board.spawnIndicator = set === "A" ? "B" : "A";
}

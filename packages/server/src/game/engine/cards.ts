import {
  Axial,
  axialKey,
  axialDistance,
  shortestPath,
  neighbors,
  PlayerId,
  ENCHANTMENT_DEFINITIONS_BY_ID,
  HUMAN_DEFINITIONS_BY_ID,
  SPAWN_DATA,
} from "@fairy/shared";
import { ServerGameState } from "../state";
import { logEvent } from "./log";
import { isSpaceEmpty, placeObstacle, moveObstacle, removeObstacle } from "./obstacles";
import { moveLureStack, findLureStack } from "./lures";
import { needsRelocationFlow, placeNewToadstool, relocateToadstool } from "./toadstools";
import { placeAccelMarker, moveAccelMarker, removeAccelMarker } from "./accelMarkers";
import { protectHuman, protectLure, cancelPendingEffectsTargeting } from "./targetability";
import {
  forceHumanTo,
  pushHumanStraightLine,
  neighborsOfObstacleTypes,
  findHuman,
  swapHumanPositions,
  passableForForcedMove,
  isHexOccupiedByHuman,
  retargetPendingEffect,
  pullTowardOwnNearestLure,
} from "./effectPrimitives";

export type CardEffectResult = { ok: true } | { ok: false; error: string };

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Draws one card for `playerId`, reshuffling the discard pile into the deck if the deck is empty. */
export function drawCard(state: ServerGameState, playerId: PlayerId): string | null {
  if (state.deck.length === 0) {
    if (state.discardPile.length === 0) return null;
    state.deck = shuffle(state.discardPile);
    state.discardPile = [];
    logEvent(state, "deck:reshuffled", "The discard pile was reshuffled into the deck.");
  }
  const card = state.deck.pop();
  if (!card) return null;
  const player = state.players[playerId];
  if (player) player.hand.push(card);
  return card;
}

export function discardCard(state: ServerGameState, playerId: PlayerId, cardId: string): boolean {
  const player = state.players[playerId];
  if (!player) return false;
  const idx = player.hand.indexOf(cardId);
  if (idx === -1) return false;
  player.hand.splice(idx, 1);
  state.discardPile.push(cardId);
  return true;
}

function neighborInTurnOrder(state: ServerGameState, playerId: PlayerId, direction: "left" | "right"): PlayerId | null {
  const idx = state.turnOrder.indexOf(playerId);
  if (idx === -1) return null;
  const n = state.turnOrder.length;
  if (n < 2) return null;
  const offset = direction === "left" ? 1 : -1;
  return state.turnOrder[(idx + offset + n) % n];
}

// ---------------------------------------------------------------------------
// Card effect handlers, keyed by effectKey (see data/cards.ts). Every
// handler here corresponds to a card with implementationStatus: "implemented".
// ---------------------------------------------------------------------------

type Handlers = Record<string, (state: ServerGameState, playerId: PlayerId, target: any) => CardEffectResult>;

export const CARD_EFFECT_HANDLERS: Handlers = {
  pixiesPrank: (state, playerId, target: { humanInstanceId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    if (!human.moved) return { ok: false, error: "That Human hasn't moved yet this phase." };
    if (!human.attractedToStackId) return { ok: false, error: "That Human has no current lure to continue toward." };
    const stack = findLureStack(state, human.attractedToStackId);
    if (!stack) return { ok: false, error: "Target lure no longer exists." };
    const passable = passableForForcedMove(state);
    const path = shortestPath(human.position, stack.position, passable, state.board.hexes);
    if (!path || path.distance === 0) return { ok: false, error: "No further legal step." };
    forceHumanTo(state, human.instanceId, path.firstSteps[0]);
    logEvent(state, "card:pixiesPrank", `${playerId} played Pixie's Prank on ${human.instanceId}.`, { playerId, target });
    return { ok: true };
  },

  blessingOfTheGoodFolk: (state, playerId, target: { humanInstanceId: string; __extendRounds?: number }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    protectHuman(state, human, 1 + (target?.__extendRounds ?? 0));
    logEvent(state, "card:blessingOfTheGoodFolk", `${playerId} played Blessing of the Good Folk on ${human.instanceId}.`, { playerId, target });
    return { ok: true };
  },

  faerieSlumber: (state, playerId, target: { humanInstanceId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    human.moved = true;
    cancelPendingEffectsTargeting(state, human.instanceId);
    logEvent(state, "card:faerieSlumber", `${playerId} played Faerie Slumber on ${human.instanceId}.`, { playerId, target });
    return { ok: true };
  },

  moonlitScrying: (state, playerId) => {
    const peek = state.deck.slice(-5).reverse(); // deck is popped from the end, so the "top" is the end
    state.ephemeralDeckPeeks.push({ forPlayerId: playerId, cardIds: peek });
    logEvent(state, "card:moonlitScrying", `${playerId} played Moonlit Scrying.`, { playerId });
    return { ok: true };
  },

  brokenGlamour: (state, playerId, target: { effectId: string }) => {
    const item = state.responseStack.find((e) => e.id === target?.effectId);
    if (!item) return { ok: false, error: "Unknown effect." };
    if (item.status !== "pending") return { ok: false, error: "That effect is no longer pending." };
    if (item.kind !== "card") return { ok: false, error: "This can only cancel an Enchantment, not a Domain ability." };
    if (item.sourcePlayerId === playerId) return { ok: false, error: "Must target a card another player played." };
    item.status = "canceled";
    logEvent(state, "card:brokenGlamour", `${playerId} played Broken Glamour, canceling ${item.name}.`, { playerId, target });
    return { ok: true };
  },

  faerieBargain: (state, playerId, target: { effectId: string }) => {
    const item = state.responseStack.find((e) => e.id === target?.effectId);
    if (!item) return { ok: false, error: "Unknown effect." };
    if (item.status !== "pending") return { ok: false, error: "That effect is no longer pending." };
    if (item.kind !== "card") return { ok: false, error: "Faerie Bargain only applies to Enchantments." };
    item.redirectToHandPlayerId = playerId;
    logEvent(state, "card:faerieBargain", `${playerId} played Faerie Bargain on ${item.name}.`, { playerId, target });
    return { ok: true };
  },

  glimpseBeyond: (state, playerId, target: { direction: "left" | "right" }) => {
    const neighborId = neighborInTurnOrder(state, playerId, target?.direction === "right" ? "right" : "left");
    if (!neighborId) return { ok: false, error: "No such neighboring player." };
    state.ephemeralReveals.push({ forPlayerId: playerId, revealedPlayerId: neighborId, hand: [...(state.players[neighborId]?.hand ?? [])] });
    logEvent(state, "card:glimpseBeyond", `${playerId} played Glimpse Beyond.`, { playerId, target });
    return { ok: true };
  },

  crystalWard: (state, playerId, target: { stackId: string; __extendRounds?: number }) => {
    const stack = findLureStack(state, target?.stackId);
    if (!stack) return { ok: false, error: "Unknown lure stack." };
    protectLure(state, stack, 1 + (target?.__extendRounds ?? 0));
    logEvent(state, "card:crystalWard", `${playerId} played Crystal Ward.`, { playerId, target });
    return { ok: true };
  },

  fickleFate: (state, playerId, target: { effectId: string; newTarget: unknown }) => {
    const item = state.responseStack.find((e) => e.id === target?.effectId);
    if (!item) return { ok: false, error: "Unknown effect." };
    if (item.status !== "pending") return { ok: false, error: "That effect is no longer pending." };
    item.target = target.newTarget;
    item.status = "modified";
    logEvent(state, "card:fickleFate", `${playerId} played Fickle Fate, redirecting ${item.name}.`, { playerId, target });
    return { ok: true };
  },

  lanternOfLostSouls: (state, playerId, target: { stackId: string; to: Axial }) => {
    const stack = findLureStack(state, target?.stackId);
    if (!stack || stack.owner !== playerId) return { ok: false, error: "That is not your lure." };
    if (axialDistance(stack.position, target.to) > 2) return { ok: false, error: "Destination is more than 2 spaces away." };
    if (!state.board.hexes.has(axialKey(target.to))) return { ok: false, error: "Destination is off the board." };
    moveLureStack(state, stack.id, target.to);
    logEvent(state, "card:lanternOfLostSouls", `${playerId} played Lantern of Lost Souls.`, { playerId, target });
    return { ok: true };
  },

  toadstoolCard: (state, playerId, target: { to?: Axial; relocateFromId?: string }) => {
    if (needsRelocationFlow(state)) {
      if (!target?.relocateFromId || !target?.to) return { ok: false, error: "Toadstool maximum reached; a relocation choice is required." };
      if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
      relocateToadstool(state, target.relocateFromId, target.to);
      logEvent(state, "card:toadstool", `${playerId} played Toadstool, relocating one.`, { playerId, target });
      return { ok: true };
    }
    if (!target?.to || !isSpaceEmpty(state, target.to)) return { ok: false, error: "That space is not empty." };
    placeNewToadstool(state, target.to);
    logEvent(state, "card:toadstool", `${playerId} played Toadstool.`, { playerId, target });
    return { ok: true };
  },

  fairyRing: (state, playerId, target: { humanInstanceId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    const passable = passableForForcedMove(state);
    const path = shortestPath(human.position, state.board.portalCenter, passable, state.board.hexes);
    if (!path || path.distance === 0) return { ok: false, error: "No legal step toward the Portal." };
    forceHumanTo(state, human.instanceId, path.firstSteps[0]);
    logEvent(state, "card:fairyRing", `${playerId} played Fairy Ring on ${human.instanceId}.`, { playerId, target });
    return { ok: true };
  },

  ancientMenhir: (state, playerId, target: { to: Axial }) => {
    if (!target?.to || !isSpaceEmpty(state, target.to)) return { ok: false, error: "That space is not empty." };
    placeObstacle(state, "stone", target.to);
    logEvent(state, "card:ancientMenhir", `${playerId} played Ancient Menhir.`, { playerId, target });
    return { ok: true };
  },

  seedsOfTheElderGrove: (state, playerId, target: { to: Axial }) => {
    if (!target?.to || !isSpaceEmpty(state, target.to)) return { ok: false, error: "That space is not empty." };
    placeObstacle(state, "tree", target.to);
    logEvent(state, "card:seedsOfTheElderGrove", `${playerId} played Seeds of the Elder Grove.`, { playerId, target });
    return { ok: true };
  },

  giantsStride: (state, playerId, target: { obstacleId?: string; markerId?: string; to: Axial }) => {
    if (!target?.to || !state.board.hexes.has(axialKey(target.to))) return { ok: false, error: "Destination is off the board." };
    if (target.obstacleId) {
      const obstacle = state.board.obstacles.find((o) => o.id === target.obstacleId);
      if (!obstacle) return { ok: false, error: "Unknown obstacle." };
      if (axialDistance(obstacle.position, target.to) > 2) return { ok: false, error: "Destination is more than 2 spaces away." };
      if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
      moveObstacle(state, target.obstacleId, target.to);
    } else if (target.markerId) {
      const marker = state.board.accelMarkers.find((m) => m.id === target.markerId);
      if (!marker) return { ok: false, error: "Unknown marker." };
      if (axialDistance(marker.position, target.to) > 2) return { ok: false, error: "Destination is more than 2 spaces away." };
      if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
      moveAccelMarker(state, target.markerId, target.to);
    } else {
      return { ok: false, error: "Select an obstacle or marker." };
    }
    logEvent(state, "card:giantsStride", `${playerId} played Giant's Stride.`, { playerId, target });
    return { ok: true };
  },

  theEarthStirs: (state, playerId, target: { obstacleId?: string; markerId?: string }) => {
    if (target?.obstacleId) {
      removeObstacle(state, target.obstacleId);
    } else if (target?.markerId) {
      removeAccelMarker(state, target.markerId);
    } else {
      return { ok: false, error: "Select an obstacle or marker." };
    }
    logEvent(state, "card:theEarthStirs", `${playerId} played The Earth Stirs.`, { playerId, target });
    return { ok: true };
  },

  hiddenBurrow: (state, playerId, target: { humanInstanceId: string; to: Axial }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    if (!neighborsOfObstacleTypes(state, human.position, ["tree", "stone", "toadstool"])) {
      return { ok: false, error: "Human is not adjacent to an obstacle." };
    }
    if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
    if (!neighborsOfObstacleTypes(state, target.to, ["tree", "stone", "toadstool"])) {
      return { ok: false, error: "Destination is not adjacent to an obstacle." };
    }
    human.position = target.to;
    logEvent(state, "card:hiddenBurrow", `${playerId} played Hidden Burrow.`, { playerId, target });
    return { ok: true };
  },

  nymphsEmbrace: (state, playerId, target: { humanInstanceId: string }) => {
    const result = pullTowardOwnNearestLure(state, playerId, target?.humanInstanceId, 2);
    if (result.ok) logEvent(state, "card:nymphsEmbrace", `${playerId} played Nymph's Embrace.`, { playerId, target });
    return result;
  },

  riversReflection: (state, playerId, target: { stackIdA: string; stackIdB: string }) => {
    const a = findLureStack(state, target?.stackIdA);
    const b = findLureStack(state, target?.stackIdB);
    if (!a || !b || a.id === b.id) return { ok: false, error: "Select two distinct legal lures." };
    const posA = a.position;
    a.position = b.position;
    b.position = posA;
    logEvent(state, "card:riversReflection", `${playerId} played River's Reflection.`, { playerId, target });
    return { ok: true };
  },

  spritesSwitch: (state, playerId, target: { humanIdA: string; humanIdB: string }) => {
    const result = swapHumanPositions(state, target?.humanIdA, target?.humanIdB);
    if (result.ok) logEvent(state, "card:spritesSwitch", `${playerId} played Sprite's Switch.`, { playerId, target });
    return result;
  },

  wildGale: (state, playerId, target: { humanInstanceId: string; to: Axial }) => {
    const result = pushHumanStraightLine(state, playerId, target?.humanInstanceId, target?.to, 2);
    if (result.ok) logEvent(state, "card:wildGale", `${playerId} played Wild Gale.`, { playerId, target });
    return result;
  },

  ancientSpellbook: (state, playerId) => {
    const drawn = [drawCard(state, playerId), drawCard(state, playerId), drawCard(state, playerId)].filter((c): c is string => Boolean(c));
    if (drawn.length === 3) discardCard(state, playerId, drawn[2]);
    logEvent(state, "card:ancientSpellbook", `${playerId} played Ancient Spellbook.`, { playerId, drawn });
    return { ok: true };
  },

  phoenixAshes: (state, playerId, target: { cardId: string }) => {
    const idx = state.discardPile.indexOf(target?.cardId);
    if (idx === -1) return { ok: false, error: "That card is not in the discard pile." };
    state.discardPile.splice(idx, 1);
    state.players[playerId]?.hand.push(target.cardId);
    logEvent(state, "card:phoenixAshes", `${playerId} played Phoenix Ashes, reclaiming a card.`, { playerId, target });
    return { ok: true };
  },

  pixiePilfering: (state, playerId, target: { direction: "left" | "right" }) => {
    const neighborId = neighborInTurnOrder(state, playerId, target?.direction === "right" ? "right" : "left");
    if (!neighborId) return { ok: false, error: "No such neighboring player." };
    const neighbor = state.players[neighborId];
    if (!neighbor || neighbor.hand.length === 0) return { ok: false, error: "That player has no cards." };
    const idx = Math.floor(Math.random() * neighbor.hand.length);
    const [stolen] = neighbor.hand.splice(idx, 1);
    state.players[playerId]?.hand.push(stolen);
    logEvent(state, "card:pixiePilfering", `${playerId} played Pixie Pilfering.`, { playerId, target });
    return { ok: true };
  },

  willOTheWisp: (state, playerId, target: { humanInstanceId: string; to: Axial }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    if (axialDistance(human.position, target.to) !== 1) return { ok: false, error: "Destination must be exactly 1 space away." };
    if (!state.board.hexes.has(axialKey(target.to))) return { ok: false, error: "Destination is off the board." };
    if (!passableForForcedMove(state)(target.to)) return { ok: false, error: "Destination is blocked." };
    forceHumanTo(state, human.instanceId, target.to);
    logEvent(state, "card:willOTheWisp", `${playerId} played Will-o'-the-Wisp.`, { playerId, target });
    return { ok: true };
  },

  zephyrsKiss: (state, playerId, target: { humanInstanceId: string; to: Axial }) => {
    const result = pushHumanStraightLine(state, playerId, target?.humanInstanceId, target?.to, 1);
    if (result.ok) logEvent(state, "card:zephyrsKiss", `${playerId} played Zephyr's Kiss.`, { playerId, target });
    return result;
  },

  banishedBeyondTheVeil: (state, playerId, target: { humanInstanceId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    state.board.humans = state.board.humans.filter((h) => h.instanceId !== human.instanceId);
    logEvent(state, "card:banishedBeyondTheVeil", `${playerId} played Banished Beyond the Veil.`, { playerId, target });
    return { ok: true };
  },

  sirensLureCard: (state, playerId, target: { humanInstanceId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    if (human.definitionId !== "adult") return { ok: false, error: "Siren's Lure can only target an Adult." };
    const result = pullTowardOwnNearestLure(state, playerId, human.instanceId, 1);
    if (result.ok) logEvent(state, "card:sirensLure", `${playerId} played Siren's Lure.`, { playerId, target });
    return result;
  },

  ogreMarket: (state, playerId) => {
    const drawn = [drawCard(state, playerId), drawCard(state, playerId)].filter((c): c is string => Boolean(c));
    logEvent(state, "card:ogreMarket", `${playerId} played Ogre Market, drawing ${drawn.length} card(s).`, { playerId, drawn });
    return { ok: true };
  },

  danceOfMischief: (state, playerId, target: { stackId: string; to: Axial }) => {
    const stack = findLureStack(state, target?.stackId);
    if (!stack) return { ok: false, error: "Unknown lure stack." };
    if (axialDistance(stack.position, target.to) !== 1) return { ok: false, error: "Destination must be exactly 1 space away." };
    if (!state.board.hexes.has(axialKey(target.to))) return { ok: false, error: "Destination is off the board." };
    moveLureStack(state, stack.id, target.to);
    logEvent(state, "card:danceOfMischief", `${playerId} played Dance of Mischief.`, { playerId, target });
    return { ok: true };
  },

  shatteredTrance: (state, playerId, target: { stackId: string }) => {
    const stack = findLureStack(state, target?.stackId);
    if (!stack) return { ok: false, error: "Unknown lure stack." };
    stack.height -= 1;
    if (stack.height <= 0) state.board.lureStacks = state.board.lureStacks.filter((s) => s.id !== stack.id);
    logEvent(state, "card:shatteredTrance", `${playerId} played Shattered Trance.`, { playerId, target });
    return { ok: true };
  },

  whisperwindCard: (state, playerId, target: { to: Axial }) => {
    if (!target?.to || !isSpaceEmpty(state, target.to)) return { ok: false, error: "That space is not empty." };
    placeAccelMarker(state, target.to);
    logEvent(state, "card:whisperwind", `${playerId} played Whisperwind.`, { playerId, target });
    return { ok: true };
  },

  portalInBloom: (state, playerId, target: { to: Axial }) => {
    if (!target?.to) return { ok: false, error: "Select a space adjacent to the Portal." };
    if (axialDistance(state.board.portalCenter, target.to) !== 1) return { ok: false, error: "Must be adjacent to the Portal." };
    if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "That space is not empty." };
    state.board.humans.push({
      instanceId: `human-portal-in-bloom-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      definitionId: "adult",
      position: target.to,
      moved: false,
      confused: false,
      attractedToStackId: null,
      blockedNoLure: false,
    });
    logEvent(state, "card:portalInBloom", `${playerId} played Portal in Bloom.`, { playerId, target });
    return { ok: true };
  },

  // --- Landscapes -----------------------------------------------------------

  theGateBeckons: (state, playerId) => {
    const passable = passableForForcedMove(state);
    const withDistance = state.board.humans
      .map((h) => ({ h, path: shortestPath(h.position, state.board.portalCenter, passable, state.board.hexes) }))
      .filter((x): x is { h: (typeof state.board.humans)[number]; path: NonNullable<typeof x.path> } => Boolean(x.path) && x.path!.distance > 0)
      .sort((a, b) => a.path.distance - b.path.distance);
    for (const { h, path } of withDistance) {
      const stillThere = findHuman(state, h.instanceId);
      if (!stillThere) continue;
      const freshPath = shortestPath(stillThere.position, state.board.portalCenter, passable, state.board.hexes);
      if (!freshPath || freshPath.distance === 0) continue;
      forceHumanTo(state, h.instanceId, freshPath.firstSteps[0]);
    }
    logEvent(state, "landscape:theGateBeckons", `${playerId} played The Gate Beckons.`, { playerId });
    return { ok: true };
  },

  eclipseCard: (state, playerId) => {
    state.instantsDisabledUntilRound = state.round;
    logEvent(state, "landscape:eclipse", `${playerId} played Eclipse — no more Instants this round.`, { playerId });
    return { ok: true };
  },

  morningRevel: (state, playerId) => {
    for (const otherId of state.turnOrder) {
      if (otherId === playerId) continue;
      drawCard(state, otherId);
    }
    drawCard(state, playerId);
    drawCard(state, playerId);
    drawCard(state, playerId);
    logEvent(state, "landscape:morningRevel", `${playerId} played Morning Revel.`, { playerId });
    return { ok: true };
  },

  shroudedHollow: (state, playerId) => {
    state.thickMistUntilRound = state.round;
    logEvent(state, "landscape:shroudedHollow", `${playerId} played Shrouded Hollow.`, { playerId });
    return { ok: true };
  },

  veilOfMist: (state, playerId) => {
    state.veilOfMistUntilRound = state.round;
    logEvent(state, "landscape:veilOfMist", `${playerId} played Veil of Mist — lures only attract Humans within range this round.`, { playerId });
    return { ok: true };
  },

  moonsAscendance: (state, playerId) => {
    state.moonsAscendanceUntilRound = state.round;
    logEvent(state, "landscape:moonsAscendance", `${playerId} played Moon's Ascendance — Humans move twice as far this round.`, { playerId });
    return { ok: true };
  },

  theQueensBanquet: (state, playerId) => {
    const n = state.turnOrder.length;
    const oldHands = new Map(state.turnOrder.map((id) => [id, [...(state.players[id]?.hand ?? [])]]));
    for (let i = 0; i < n; i++) {
      const recipientId = state.turnOrder[i];
      const donorId = state.turnOrder[(i - 1 + n) % n]; // recipient receives from the player before them
      const recipient = state.players[recipientId];
      if (recipient) recipient.hand = oldHands.get(donorId) ?? [];
    }
    logEvent(state, "landscape:theQueensBanquet", `${playerId} played The Queen's Banquet.`, { playerId });
    return { ok: true };
  },

  threadsOfFate: (state, playerId, target: { to: Axial; definitionId: string }) => {
    if (!target?.to || !target?.definitionId) return { ok: false, error: "Select a spawn position and a Human type." };
    if (!HUMAN_DEFINITIONS_BY_ID[target.definitionId]) return { ok: false, error: "Unknown Human type." };
    const upcoming = SPAWN_DATA.sets[state.board.spawnIndicator];
    const validPosition =
      upcoming.positions.some((p) => p.q === target.to.q && p.r === target.to.r) ||
      (upcoming.hunterCenterPosition.q === target.to.q && upcoming.hunterCenterPosition.r === target.to.r);
    if (!validPosition) return { ok: false, error: "That is not one of the upcoming spawn positions." };
    state.spawnOverrides = state.spawnOverrides.filter((o) => !(o.position.q === target.to.q && o.position.r === target.to.r));
    state.spawnOverrides.push({ position: target.to, definitionId: target.definitionId });
    logEvent(state, "card:threadsOfFate", `${playerId} played Threads of Fate.`, { playerId, target });
    return { ok: true };
  },

  impishInterference: (state, playerId, target: { effectId: string; to: Axial }) => {
    const result = retargetPendingEffect(state, target?.effectId, "field", target?.to);
    if (result.ok) logEvent(state, "card:impishInterference", `${playerId} played Impish Interference.`, { playerId, target });
    return result;
  },

  travelersFire: (state, playerId, target: { to: Axial }) => {
    if (!target?.to || !isSpaceEmpty(state, target.to)) return { ok: false, error: "That space is not empty." };
    const hasAdjacentHuman = neighbors(target.to).some((n) => state.board.humans.some((h) => h.position.q === n.q && h.position.r === n.r));
    if (hasAdjacentHuman) return { ok: false, error: "That space has an adjacent Human." };
    const passable = passableForForcedMove(state);
    // Snapshot who's eligible (within 2 spaces) before moving anyone, so a Human's own move can't pull it into or out of range mid-resolution.
    const eligible = state.board.humans
      .map((h) => ({ id: h.instanceId, path: shortestPath(h.position, target.to, passable, state.board.hexes) }))
      .filter((x) => x.path && x.path.distance > 0 && x.path.distance <= 2);
    for (const { id, path } of eligible) {
      const human = findHuman(state, id);
      if (!human || !path) continue;
      // The eligibility snapshot above is deliberately pre-move (see comment), so
      // an earlier Human in this same loop may have just landed on this one's
      // first step — re-check right before moving; skip (don't move) rather than
      // ever double up on a hex.
      if (isHexOccupiedByHuman(state, path.firstSteps[0])) continue;
      forceHumanTo(state, id, path.firstSteps[0]);
    }
    logEvent(state, "card:travelersFire", `${playerId} played Traveler's Fire.`, { playerId, target });
    return { ok: true };
  },

  theWildHuntsGale: (state, playerId) => {
    for (const obstacle of [...state.board.obstacles]) {
      const dest = neighbors(obstacle.position).find(
        (n) => state.board.hexes.has(axialKey(n)) && isSpaceEmpty(state, n)
      );
      if (dest) moveObstacle(state, obstacle.id, dest);
    }
    logEvent(state, "landscape:theWildHuntsGale", `${playerId} played The Wild Hunt's Gale.`, { playerId });
    return { ok: true };
  },
};

export function runCardEffect(state: ServerGameState, playerId: PlayerId, effectKey: string, target: unknown): CardEffectResult {
  const handler = CARD_EFFECT_HANDLERS[effectKey];
  if (!handler) return { ok: false, error: "This card has no implemented effect yet." };
  return handler(state, playerId, target);
}

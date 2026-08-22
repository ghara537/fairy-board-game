import { Axial, axialDistance, axialKey, shortestPath, neighbors, neighborDirectionIndex, PlayerId } from "@fairy/shared";
import { ServerGameState } from "../state";
import { logEvent } from "./log";
import { placeObstacle, moveObstacle, isSpaceEmpty } from "./obstacles";
import { placeAccelMarker, moveAccelMarker } from "./accelMarkers";
import { needsRelocationFlow, placeNewToadstool, relocateToadstool } from "./toadstools";
import { moveLureStack, findLureStack } from "./lures";
import { protectLure, cancelPendingEffectsTargeting } from "./targetability";
import { drawCard } from "./cards";
import {
  forceHumanTo,
  pullTowardLure,
  pullTowardOwnNearestLure,
  pushHumanStraightLine,
  legalPushPullDirections,
  neighborsOfObstacleTypes,
  findHuman,
  swapHumanPositions,
  passableForForcedMove,
  cloneAndRequeueEffect,
  retargetPendingEffect,
} from "./effectPrimitives";

// ---------------------------------------------------------------------------
// Modular Domain-ability effect handlers (spec section 20). Each handler is
// keyed by the `key` field on DomainAbilityDefinition so wording/targeting
// edits in data/domains.ts never require touching this file, and vice versa.
// Only abilities flagged implementationStatus: "implemented" in domains.ts
// are reachable from the action layer.
// ---------------------------------------------------------------------------

export type AbilityResult = { ok: true } | { ok: false; error: string };

type Handlers = Record<string, (state: ServerGameState, playerId: PlayerId, target: any) => AbilityResult>;

export const DOMAIN_ABILITY_HANDLERS: Handlers = {
  sirensCall: (state, playerId, target: { humanInstanceId: string; lureStackId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    const stack = findLureStack(state, target?.lureStackId);
    if (!stack || stack.owner !== playerId) return { ok: false, error: "That is not your lure." };
    const taken = pullTowardLure(state, playerId, human.instanceId, stack.id, 2);
    if (taken === 0) return { ok: false, error: "That Human can't be pulled toward that lure without moving away from your Domain." };
    logEvent(state, "domainAbility:sirensCall", `${playerId} used Siren's Call on ${human.instanceId}.`, { playerId, target });
    return { ok: true };
  },

  mesmerize: (state, playerId, target: { humanInstanceId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    // TODO_RULE_CONFIRMATION: "cannot move this round" assumed to mean the
    // current Human Movement Phase; redirect-on-cancel simplified to a
    // straight cancellation (see targetability.ts).
    human.moved = true;
    cancelPendingEffectsTargeting(state, human.instanceId);
    logEvent(state, "domainAbility:mesmerize", `${playerId} mesmerized ${human.instanceId} — it cannot move this round.`, { playerId, target });
    return { ok: true };
  },

  irresistibleSong: (state, playerId, target: { mode: "add" | "relocate"; stackId?: string; fromStackId?: string; toStackId?: string }) => {
    if (target?.mode === "relocate") {
      const from = findLureStack(state, target.fromStackId);
      const to = findLureStack(state, target.toStackId);
      if (!from || from.owner !== playerId || !to || to.owner !== playerId) return { ok: false, error: "Select two of your own lure stacks." };
      if (from.id === to.id) return { ok: false, error: "Select two distinct stacks." };
      if (from.height <= 0) return { ok: false, error: "That stack has no lures to relocate." };
      from.height -= 1;
      to.height += 1;
      if (from.height <= 0) state.board.lureStacks = state.board.lureStacks.filter((s) => s.id !== from.id);
    } else {
      const stack = findLureStack(state, target?.stackId);
      if (!stack || stack.owner !== playerId) return { ok: false, error: "That is not your lure." };
      stack.height += 1;
    }
    logEvent(state, "domainAbility:irresistibleSong", `${playerId} used Irresistible Song.`, { playerId, target });
    return { ok: true };
  },

  blockingVines: (state, playerId, target: { to: Axial }) => {
    if (!isSpaceEmpty(state, target?.to)) return { ok: false, error: "That space is not empty." };
    placeObstacle(state, "tree", target.to);
    logEvent(state, "domainAbility:blockingVines", `${playerId} used Blocking Vines.`, { playerId, target });
    return { ok: true };
  },

  secretTrail: (state, playerId, target: { humanInstanceId: string; to: Axial }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    if (!neighborsOfObstacleTypes(state, human.position, ["tree"])) return { ok: false, error: "Human is not adjacent to a Tree." };
    if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
    if (!neighborsOfObstacleTypes(state, target.to, ["tree"])) return { ok: false, error: "Destination is not adjacent to a Tree." };
    human.position = target.to;
    logEvent(state, "domainAbility:secretTrail", `${playerId} used Secret Trail.`, { playerId, target });
    return { ok: true };
  },

  tailwind: (state, playerId, target: { humanInstanceId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    if (!human.moved) return { ok: false, error: "Tailwind only follows a Human that has already moved." };
    if (!human.attractedToStackId) return { ok: false, error: "That Human has no current lure to continue toward." };
    const stack = findLureStack(state, human.attractedToStackId);
    if (!stack) return { ok: false, error: "Target lure no longer exists." };
    const passable = passableForForcedMove(state);
    const path = shortestPath(human.position, stack.position, passable, state.board.hexes);
    if (!path || path.distance === 0) return { ok: false, error: "No further legal step." };
    forceHumanTo(state, human.instanceId, path.firstSteps[0]);
    logEvent(state, "domainAbility:tailwind", `${playerId} used Tailwind on ${human.instanceId}.`, { playerId, target });
    return { ok: true };
  },

  whirlwind: (state, playerId, target: { obstacleId?: string; markerId?: string; to: Axial }) => {
    if (!target?.to || !state.board.hexes.has(axialKey(target.to))) return { ok: false, error: "Destination is off the board." };
    if (target.obstacleId) {
      const obstacle = state.board.obstacles.find((o) => o.id === target.obstacleId);
      if (!obstacle) return { ok: false, error: "Unknown obstacle." };
      if (axialDistance(obstacle.position, target.to) > 3) return { ok: false, error: "Destination is more than 3 spaces away." };
      if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
      moveObstacle(state, target.obstacleId, target.to);
    } else if (target.markerId) {
      const marker = state.board.accelMarkers.find((m) => m.id === target.markerId);
      if (!marker) return { ok: false, error: "Unknown marker." };
      if (axialDistance(marker.position, target.to) > 3) return { ok: false, error: "Destination is more than 3 spaces away." };
      if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
      moveAccelMarker(state, target.markerId, target.to);
    } else {
      return { ok: false, error: "Select an obstacle or marker." };
    }
    logEvent(state, "domainAbility:whirlwind", `${playerId} used Whirlwind.`, { playerId, target });
    return { ok: true };
  },

  gust: (state, playerId, target: { humanInstanceId: string; to: Axial }) => {
    const result = pushHumanStraightLine(state, playerId, target?.humanInstanceId, target?.to, 1);
    if (result.ok) logEvent(state, "domainAbility:gust", `${playerId} used Gust.`, { playerId, target });
    return result;
  },

  gatheringCurrent: (state, playerId, target: { to: Axial }) => {
    if (!target?.to || !isSpaceEmpty(state, target.to)) return { ok: false, error: "That space is not empty." };
    let stackCounter = state.board.lureStacks.length + 1;
    while (state.board.lureStacks.some((s) => s.id === `lure-gathering-${stackCounter}`)) stackCounter += 1;
    state.board.lureStacks.push({ id: `lure-gathering-${stackCounter}`, position: target.to, owner: playerId, height: 3 });
    logEvent(state, "domainAbility:gatheringCurrent", `${playerId} used Gathering Current.`, { playerId, target });
    return { ok: true };
  },

  flowingStream: (state, playerId, target: { stackIdA: string; toA: Axial; stackIdB: string; toB: Axial }) => {
    const moves = [
      { stackId: target?.stackIdA, to: target?.toA },
      { stackId: target?.stackIdB, to: target?.toB },
    ];
    for (const m of moves) {
      const stack = findLureStack(state, m.stackId);
      if (!stack) return { ok: false, error: "Unknown lure stack." };
      if (!m.to || axialDistance(stack.position, m.to) > 2) return { ok: false, error: "Destination is more than 2 spaces away." };
      if (!state.board.hexes.has(axialKey(m.to))) return { ok: false, error: "Destination is off the board." };
    }
    for (const m of moves) moveLureStack(state, m.stackId as string, m.to as Axial);
    logEvent(state, "domainAbility:flowingStream", `${playerId} used Flowing Stream.`, { playerId, target });
    return { ok: true };
  },

  cleansingWaters: (state, playerId, target: { __extendRounds?: number } = {}) => {
    const own = state.board.lureStacks.filter((s) => s.owner === playerId);
    if (own.length === 0) return { ok: false, error: "You have no lures on the board." };
    const rounds = 1 + (target?.__extendRounds ?? 0);
    for (const stack of own) protectLure(state, stack, rounds);
    logEvent(state, "domainAbility:cleansingWaters", `${playerId} used Cleansing Waters.`, { playerId });
    return { ok: true };
  },

  starlightProphecy: (state, playerId) => {
    const drawn = [drawCard(state, playerId), drawCard(state, playerId), drawCard(state, playerId)].filter((c): c is string => Boolean(c));
    logEvent(state, "domainAbility:starlightProphecy", `${playerId} used Starlight Prophecy, drawing ${drawn.length} card(s).`, { playerId, drawn });
    return { ok: true };
  },

  mirage: (state, playerId) => {
    const player = state.players[playerId];
    if (!player) return { ok: false, error: "Not seated." };
    player.extraEnchantmentPlaysThisTurn += 1;
    logEvent(state, "domainAbility:mirage", `${playerId} used Mirage — may play an extra Enchantment this turn.`, { playerId });
    return { ok: true };
  },

  lucidDream: (state, playerId) => {
    const player = state.players[playerId];
    if (!player) return { ok: false, error: "Not seated." };
    player.extraEnchantmentPlaysThisTurn += 1;
    logEvent(state, "domainAbility:lucidDream", `${playerId} used Lucid Dream — may play an extra Enchantment this turn.`, { playerId });
    return { ok: true };
  },

  tricksterSwap: (state, playerId, target: { humanIdA: string; humanIdB: string }) => {
    const result = swapHumanPositions(state, target?.humanIdA, target?.humanIdB);
    if (result.ok) logEvent(state, "domainAbility:tricksterSwap", `${playerId} used Trickster Swap.`, { playerId, target });
    return result;
  },

  kindling: (state, playerId, target: { obstacleId: string }) => {
    const obstacle = state.board.obstacles.find((o) => o.id === target?.obstacleId);
    if (!obstacle) return { ok: false, error: "Unknown obstacle." };
    state.board.obstacles = state.board.obstacles.filter((o) => o.id !== target.obstacleId);
    logEvent(state, "domainAbility:kindling", `${playerId} used Kindling.`, { playerId, target });
    return { ok: true };
  },

  phoenixAshesAbility: (state, playerId, target: { cardId: string }) => {
    const idx = state.discardPile.indexOf(target?.cardId);
    if (idx === -1) return { ok: false, error: "That card is not in the discard pile." };
    state.discardPile.splice(idx, 1);
    state.players[playerId]?.hand.push(target.cardId);
    logEvent(state, "domainAbility:phoenixAshesAbility", `${playerId} used Phoenix Ashes.`, { playerId, target });
    return { ok: true };
  },

  deepFreeze: (state, playerId, target: { humanInstanceId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    human.moved = true;
    logEvent(state, "domainAbility:deepFreeze", `${playerId} used Deep Freeze.`, { playerId, target });
    return { ok: true };
  },

  shadowStep: (state, playerId, target: { stackId: string; to: Axial }) => {
    const stack = findLureStack(state, target?.stackId);
    if (!stack) return { ok: false, error: "Unknown lure stack." };
    if (axialDistance(stack.position, target.to) !== 1) return { ok: false, error: "Destination must be exactly 1 space away." };
    if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
    moveLureStack(state, stack.id, target.to);
    logEvent(state, "domainAbility:shadowStep", `${playerId} used Shadow Step.`, { playerId, target });
    return { ok: true };
  },

  wrongTurn: (state, playerId, target: { effectId: string; to: Axial }) => {
    const result = retargetPendingEffect(state, target?.effectId, "field", target?.to);
    if (result.ok) logEvent(state, "domainAbility:wrongTurn", `${playerId} used Wrong Turn.`, { playerId, target });
    return result;
  },

  clockworkContraption: (state, playerId, target: { effectId: string; newTarget: unknown }) => {
    const item = state.responseStack.find((e) => e.id === target?.effectId);
    if (!item) return { ok: false, error: "Unknown effect." };
    if (item.kind !== "card") return { ok: false, error: "This can only take over an Enchantment, not a Domain ability." };
    if (item.sourcePlayerId === playerId) return { ok: false, error: "Must target another player's card." };
    const result = retargetPendingEffect(state, target?.effectId, "whole", target?.newTarget);
    if (result.ok) logEvent(state, "domainAbility:clockworkContraption", `${playerId} used Clockwork Contraption on ${item.name}.`, { playerId, target });
    return result;
  },

  moonlightVision: (state, playerId) => {
    let stolenCount = 0;
    for (const otherId of state.turnOrder) {
      if (otherId === playerId) continue;
      const other = state.players[otherId];
      if (!other || other.hand.length === 0) continue;
      const idx = Math.floor(Math.random() * other.hand.length);
      const [stolen] = other.hand.splice(idx, 1);
      state.players[playerId]?.hand.push(stolen);
      stolenCount += 1;
    }
    logEvent(state, "domainAbility:moonlightVision", `${playerId} used Moonlight Vision, stealing ${stolenCount} card(s).`, { playerId });
    return { ok: true };
  },

  wildfire: (state, playerId, target: { effectId: string; extraHumanInstanceId: string }) => {
    const item = state.responseStack.find((e) => e.id === target?.effectId);
    if (!item) return { ok: false, error: "Unknown effect." };
    if (item.status !== "pending") return { ok: false, error: "That effect is no longer pending." };
    if (!target?.extraHumanInstanceId) return { ok: false, error: "Select an adjacent Human." };
    item.extraHumanInstanceId = target.extraHumanInstanceId;
    logEvent(state, "domainAbility:wildfire", `${playerId} used Wildfire on ${item.name}.`, { playerId, target });
    return { ok: true };
  },

  frozenMagic: (state, playerId, target: { effectId: string }) => {
    const item = state.responseStack.find((e) => e.id === target?.effectId);
    if (!item) return { ok: false, error: "Unknown effect." };
    if (item.status !== "pending") return { ok: false, error: "That effect is no longer pending." };
    item.extendDurationBonus = (item.extendDurationBonus ?? 0) + 1;
    logEvent(state, "domainAbility:frozenMagic", `${playerId} used Frozen Magic on ${item.name}.`, { playerId, target });
    return { ok: true };
  },

  delayedCurse: (state, playerId, target: { effectId: string }) => {
    const item = state.responseStack.find((e) => e.id === target?.effectId);
    if (!item) return { ok: false, error: "Unknown effect." };
    if (item.status !== "pending") return { ok: false, error: "That effect is no longer pending." };
    state.responseStack = state.responseStack.filter((e) => e.id !== item.id);
    state.deferredEffects.push({ item, resolveAtRound: state.round + 1 });
    logEvent(state, "domainAbility:delayedCurse", `${playerId} used Delayed Curse on ${item.name} — it will resolve at the start of next round.`, {
      playerId,
      target,
    });
    return { ok: true };
  },

  veilOfDarkness: (state, playerId, target: { stackId: string }) => {
    const stack = findLureStack(state, target?.stackId);
    if (!stack) return { ok: false, error: "Unknown lure stack." };
    stack.inactiveUntilRound = state.round + 1;
    logEvent(state, "domainAbility:veilOfDarkness", `${playerId} used Veil of Darkness.`, { playerId, target });
    return { ok: true };
  },

  shadowCopy: (state, playerId, target: { effectId: string }) => {
    const result = cloneAndRequeueEffect(state, target?.effectId);
    if (result.ok) logEvent(state, "domainAbility:shadowCopy", `${playerId} used Shadow Copy.`, { playerId, target });
    return result;
  },

  dreamSurge: (state, playerId, target: { effectId: string }) => {
    const result = cloneAndRequeueEffect(state, target?.effectId);
    if (result.ok) logEvent(state, "domainAbility:dreamSurge", `${playerId} used Dream Surge.`, { playerId, target });
    return result;
  },

  twistedFate: (state, playerId, target: { humanInstanceId: string }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    const passable = passableForForcedMove(state);
    let farthest: { pos: Axial; distance: number } | null = null;
    for (const n of neighbors(human.position)) {
      if (!state.board.hexes.has(axialKey(n)) || !passable(n)) continue;
      let distance = -1;
      if (human.attractedToStackId) {
        const stack = findLureStack(state, human.attractedToStackId);
        if (stack) {
          const path = shortestPath(n, stack.position, passable, state.board.hexes);
          distance = path ? path.distance : Number.MAX_SAFE_INTEGER;
        }
      }
      if (!farthest || distance > farthest.distance) farthest = { pos: n, distance };
    }
    if (!farthest) return { ok: false, error: "No legal space to move away to." };
    forceHumanTo(state, human.instanceId, farthest.pos);
    logEvent(state, "domainAbility:twistedFate", `${playerId} used Twisted Fate on ${human.instanceId}.`, { playerId, target });
    return { ok: true };
  },

  // --- Main Abilities (repeatable) ---------------------------------------

  sirensMain: (state, playerId, target: { humanInstanceId: string }) => {
    const result = pullTowardOwnNearestLure(state, playerId, target?.humanInstanceId, 1);
    if (result.ok) logEvent(state, "mainAbility:sirensMain", `${playerId} used their Main Ability (pull 1 Human).`, { playerId, target });
    return result;
  },

  elvesMain: (state, playerId, target: { to: Axial }) => {
    if (!isSpaceEmpty(state, target?.to)) return { ok: false, error: "That space is not empty." };
    placeObstacle(state, "tree", target.to);
    logEvent(state, "mainAbility:elvesMain", `${playerId} used their Main Ability (place a tree).`, { playerId, target });
    return { ok: true };
  },

  djinnMain: (state, playerId, target: { humanInstanceId: string; to: Axial }) => {
    const result = pushHumanStraightLine(state, playerId, target?.humanInstanceId, target?.to, 2);
    if (result.ok) logEvent(state, "mainAbility:djinnMain", `${playerId} used their Main Ability (push 1 Human 2 spaces).`, { playerId, target });
    return result;
  },

  nymphsMain: (state, playerId, target: { stackId: string; to: Axial }) => {
    const stack = findLureStack(state, target?.stackId);
    if (!stack) return { ok: false, error: "Unknown lure stack." };
    if (axialDistance(stack.position, target.to) !== 1) return { ok: false, error: "Destination must be exactly 1 space away." };
    if (!state.board.hexes.has(axialKey(target.to))) return { ok: false, error: "Destination is off the board." };
    moveLureStack(state, stack.id, target.to);
    logEvent(state, "mainAbility:nymphsMain", `${playerId} used their Main Ability (relocate 1 lure).`, { playerId, target });
    return { ok: true };
  },

  pixiesMain: (state, playerId, target: { targetPlayerId: string }) => {
    const other = state.players[target?.targetPlayerId];
    if (!other || other.id === playerId) return { ok: false, error: "Select another player." };
    if (other.hand.length === 0) return { ok: false, error: "That player has no cards." };
    const idx = Math.floor(Math.random() * other.hand.length);
    const [stolen] = other.hand.splice(idx, 1);
    state.players[playerId]?.hand.push(stolen);
    logEvent(state, "mainAbility:pixiesMain", `${playerId} used their Main Ability (steal a random card).`, { playerId, target });
    return { ok: true };
  },

  gnomesMain: (state, playerId, target: { to?: Axial; relocateFromId?: string }) => {
    if (needsRelocationFlow(state)) {
      if (!target?.relocateFromId || !target?.to) return { ok: false, error: "Toadstool maximum reached; a relocation choice is required." };
      if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
      relocateToadstool(state, target.relocateFromId, target.to);
    } else {
      if (!target?.to || !isSpaceEmpty(state, target.to)) return { ok: false, error: "That space is not empty." };
      placeNewToadstool(state, target.to);
    }
    logEvent(state, "mainAbility:gnomesMain", `${playerId} used their Main Ability (place a toadstool).`, { playerId, target });
    return { ok: true };
  },

  // --- Targeted starting abilities ----------------------------------------

  "sirens-starting": (state, playerId, target: { humanInstanceId: string; to: Axial }) => {
    const human = findHuman(state, target?.humanInstanceId);
    if (!human) return { ok: false, error: "Unknown Human." };
    if (axialDistance(human.position, target.to) !== 1) return { ok: false, error: "Destination must be exactly 1 space away." };
    if (!state.board.hexes.has(axialKey(target.to))) return { ok: false, error: "Destination is off the board." };
    if (!passableForForcedMove(state)(target.to)) return { ok: false, error: "Destination is blocked." };
    const dir = neighborDirectionIndex(human.position, target.to);
    if (dir === null || !legalPushPullDirections(state, playerId, human.position, "pull").has(dir)) {
      return { ok: false, error: "That direction doesn't move the Human toward your Domain." };
    }
    forceHumanTo(state, human.instanceId, target.to);
    logEvent(state, "startingAbility:sirens", `${playerId} resolved their starting ability.`, { playerId, target });
    return { ok: true };
  },

  "elves-starting": (state, playerId, target: { to: Axial }) => {
    if (!isSpaceEmpty(state, target?.to)) return { ok: false, error: "That space is not empty." };
    placeObstacle(state, "tree", target.to);
    logEvent(state, "startingAbility:elves", `${playerId} resolved their starting ability.`, { playerId, target });
    return { ok: true };
  },

  "djinn-starting": (state, playerId, target: { to: Axial }) => {
    if (!isSpaceEmpty(state, target?.to)) return { ok: false, error: "That space is not empty." };
    placeAccelMarker(state, target.to);
    logEvent(state, "startingAbility:djinn", `${playerId} resolved their starting ability.`, { playerId, target });
    return { ok: true };
  },

  "gnomes-starting": (state, playerId, target: { to?: Axial; relocateFromId?: string }) => {
    if (needsRelocationFlow(state)) {
      if (!target?.relocateFromId || !target?.to) return { ok: false, error: "Toadstool maximum reached; a relocation choice is required." };
      if (!isSpaceEmpty(state, target.to)) return { ok: false, error: "Destination is not empty." };
      relocateToadstool(state, target.relocateFromId, target.to);
    } else {
      if (!target?.to || !isSpaceEmpty(state, target.to)) return { ok: false, error: "That space is not empty." };
      placeNewToadstool(state, target.to);
    }
    logEvent(state, "startingAbility:gnomes", `${playerId} resolved their starting ability.`, { playerId, target });
    return { ok: true };
  },
};

export function runDomainAbility(
  state: ServerGameState,
  playerId: PlayerId,
  abilityKey: string,
  target: unknown
): AbilityResult {
  const handler = DOMAIN_ABILITY_HANDLERS[abilityKey];
  if (!handler) return { ok: false, error: "This ability has no implemented handler yet." };
  return handler(state, playerId, target);
}

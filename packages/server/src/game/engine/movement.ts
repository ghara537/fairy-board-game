import {
  Axial,
  axialAdd,
  axialDistance,
  axialKey,
  axialSubtract,
  neighbors,
  AccelerationMarker,
  HumanInstance,
  LureStack,
  Obstacle,
  ObstacleType,
  PlayerId,
  ACCELERATION_BONUS_STEPS,
  LURE_CLEAR_MODE,
} from "@fairy/shared";

// ---------------------------------------------------------------------------
// A pure, dependency-free rules module for the Human Movement Phase (spec
// sections 13-19, tested per section 30). It owns no I/O, no sockets, no
// randomness — every ambiguous decision is either resolved deterministically
// (distance -> stack height -> first-player order) or surfaced as an explicit
// pause (`pendingPathChoice`) that the caller (the room's turn engine) must
// resolve by calling `resolvePathChoice` with a player's answer. This makes
// the whole thing replayable step by step in tests with no fakes needed.
// ---------------------------------------------------------------------------

// TODO_RULE_CONFIRMATION: the spec's required test list ("a toadstool
// relocation changes path distance") implies Toadstools block Human
// movement the same way Trees/Stones do, even though section 17 only names
// Trees and Stones as blockers. Default: Toadstools also block entry.
// Flip this to exclude "toadstool" if that turns out wrong. (Note: since
// distance is now straight-line — see below — a Toadstool changes nothing
// about which lure a Human is attracted to; it only ever blocks a Human
// from actually stepping onto that specific hex.)
const BLOCKING_OBSTACLE_TYPES: ObstacleType[] = ["tree", "stone", "toadstool"];

// Confirmed by the user: exactly one Human per hex, always. Unlike
// obstacles/other-Humans blocking *entry* to a specific hex (see
// `legalDirectSteps` below), there is no rerouting — a Human whose one
// legal direct step toward its lure is occupied simply doesn't move this
// phase, the same "no legal move closer" outcome as being blocked by an
// obstacle.
const HUMANS_BLOCK_EACH_OTHER = true;

export type MovementBoard = {
  hexes: Set<string>;
  humans: HumanInstance[];
  lureStacks: LureStack[];
  obstacles: Obstacle[];
  accelMarkers: AccelerationMarker[];
  firstPlayerOrder: PlayerId[]; // priority order, index 0 = highest priority
  pendingPathChoice: PendingPathChoice | null;
  // Current round number, used only to check LureStack.inactiveUntilRound
  // (Veil of Darkness). Optional and defaults to "nothing is inactive" so
  // existing callers/tests that don't set it are unaffected.
  currentRound?: number;
  // Veil of Mist: when set, lure stacks farther than this straight-line
  // distance are ignored entirely by attraction (not just deprioritized) —
  // a Human with nothing in range is treated the same as having no lure at all.
  // Optional and defaults to "no cap" so existing callers/tests are unaffected.
  attractionRadiusCap?: number;
  // Moon's Ascendance: how many hex-steps a Human's single move-this-phase
  // covers. Optional and defaults to 1 (existing behavior). Implemented by
  // chaining the same "continue toward current lure" logic used by
  // Acceleration bonus steps, so it composes with markers/toadstools/ties
  // for free.
  movesPerHuman?: number;
  // Domain boards: hexes attached past the board's outer edge, each owned by
  // one player (see domainAttachmentHexes / DomainBoardAssignment). When
  // set, reaching one of these hexes is what collects+scores a Human for its
  // owner — reaching an ordinary lure stack elsewhere just clears the lure
  // (it's "bait" steering the Human, not a scoring event by itself). When
  // unset (every pre-existing caller/test), behavior is exactly as before:
  // reaching any lure stack scores its owner and removes the Human.
  domainHexes?: Map<string, PlayerId>;
};

export type PendingPathChoice = {
  humanInstanceId: string;
  options: Axial[];
  controllingPlayerId: PlayerId; // the lure owner who must choose
  isBonusMovement: boolean;
  bonusStepsRemaining: number;
};

export type MovementEvent =
  | { type: "confused"; humanInstanceId: string }
  | { type: "moved"; humanInstanceId: string; to: Axial }
  | { type: "lureCleared"; stackId: string; owner: PlayerId; position: Axial }
  | { type: "humanCollected"; humanInstanceId: string; definitionId: string; collectedBy: PlayerId }
  | { type: "accelerationTriggered"; humanInstanceId: string; bonusSteps: number }
  | { type: "pathChoiceRequired"; humanInstanceId: string; options: Axial[] };

export type StepResult =
  | { status: "done" }
  | { status: "waitingOnChoice"; choice: PendingPathChoice }
  | { status: "advanced" };

function obstacleBlocksAt(board: MovementBoard, pos: Axial): boolean {
  return board.obstacles.some(
    (o) => BLOCKING_OBSTACLE_TYPES.includes(o.type) && o.position.q === pos.q && o.position.r === pos.r
  );
}

function humanOccupiesAt(board: MovementBoard, pos: Axial, excludeInstanceId?: string): boolean {
  if (!HUMANS_BLOCK_EACH_OTHER) return false;
  return board.humans.some(
    (h) => h.instanceId !== excludeInstanceId && h.position.q === pos.q && h.position.r === pos.r
  );
}

function makePassable(board: MovementBoard, movingHumanId: string) {
  return (pos: Axial) => !obstacleBlocksAt(board, pos) && !humanOccupiesAt(board, pos, movingHumanId);
}

/**
 * Confirmed by the user: distance for attraction/priority is always raw
 * straight-line hex distance (`axialDistance`) — obstacles and other
 * Humans never lengthen it, they only ever block entry into a specific
 * hex. This pair of functions is the one place that geometry lives; there
 * is no BFS/pathfinding anywhere in this module anymore.
 *
 * `directStepCandidates` is pure geometry, no board/occupancy awareness at
 * all: every neighbor of `from` that is exactly 1 hex closer to `target`
 * than `from` itself (0, 1, or 2 of them — 2 only when `from`/`target`
 * aren't aligned along one of the hex grid's 3 main axes).
 */
function directStepCandidates(from: Axial, target: Axial): Axial[] {
  const distance = axialDistance(from, target);
  if (distance === 0) return [];
  return neighbors(from).filter((n) => axialDistance(n, target) === distance - 1);
}

/**
 * `directStepCandidates`, filtered to hexes that are actually on the board
 * and legally enterable right now (not blocked by an obstacle or another
 * Human). An empty result means "no legal step this tick" — the mover
 * simply doesn't advance; it never reroutes or takes a longer way around,
 * since raw distance never lengthens to accommodate a detour.
 */
function legalDirectSteps(board: MovementBoard, from: Axial, target: Axial, movingHumanId: string): Axial[] {
  const passable = makePassable(board, movingHumanId);
  return directStepCandidates(from, target).filter((n) => board.hexes.has(axialKey(n)) && passable(n));
}

function lureStackAt(board: MovementBoard, pos: Axial): LureStack | undefined {
  return board.lureStacks.find((s) => s.position.q === pos.q && s.position.r === pos.r);
}

/** Lure stacks eligible to attract a Human — excludes ones made inactive by Veil of Darkness. */
function activeLureStacks(board: MovementBoard): LureStack[] {
  if (board.currentRound === undefined) return board.lureStacks;
  const round = board.currentRound;
  return board.lureStacks.filter((s) => s.inactiveUntilRound === undefined || round > s.inactiveUntilRound);
}

/** Veil of Mist: a lure beyond the attraction radius cap doesn't exist as far as attraction is concerned. */
function withinAttractionRadius(board: MovementBoard, distance: number): boolean {
  return board.attractionRadiusCap === undefined || distance <= board.attractionRadiusCap;
}

function accelMarkerAt(board: MovementBoard, pos: Axial): AccelerationMarker | undefined {
  return board.accelMarkers.find((m) => m.position.q === pos.q && m.position.r === pos.r);
}

function firstPlayerRank(board: MovementBoard, playerId: PlayerId): number {
  const idx = board.firstPlayerOrder.indexOf(playerId);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

type AttractionResult =
  | { kind: "attracted"; stack: LureStack }
  | { kind: "confused" }
  | { kind: "blocked" };

/**
 * Resolves which single lure (if any) a Human is attracted to right now:
 * closest straight-line distance first (confirmed by the user — obstacles
 * and other Humans never factor into this, they only ever block actually
 * stepping onto a hex, handled separately in `findNextHumanToMove`/
 * `advanceMovementPhase`); if multiple lures tie on distance, the tallest
 * stack among them wins; if stack height is *also* tied, the Human is
 * Confused. (Turn order / which lure's owner goes first has no bearing
 * here — that's a separate question, resolved in `findNextHumanToMove`.)
 */
function resolveAttraction(board: MovementBoard, human: HumanInstance): AttractionResult {
  let minDistance = Infinity;
  let atMinDistance: LureStack[] = [];
  for (const stack of activeLureStacks(board)) {
    const distance = axialDistance(human.position, stack.position);
    if (!withinAttractionRadius(board, distance)) continue;
    if (distance < minDistance) {
      minDistance = distance;
      atMinDistance = [stack];
    } else if (distance === minDistance) {
      atMinDistance.push(stack);
    }
  }
  if (atMinDistance.length === 0) return { kind: "blocked" };
  if (atMinDistance.length === 1) return { kind: "attracted", stack: atMinDistance[0] };

  // Distance tie among 2+ lures: the tallest stack wins.
  const maxHeight = Math.max(...atMinDistance.map((s) => s.height));
  const tallest = atMinDistance.filter((s) => s.height === maxHeight);
  if (tallest.length === 1) return { kind: "attracted", stack: tallest[0] };

  // Still tied, even after height: Confused.
  return { kind: "confused" };
}

/**
 * Recomputes attraction/confusion for every unmoved Human. Must be called
 * whenever the board changes (a lure clears, an obstacle moves, a Human
 * moves) — callers do this by re-invoking `advance`, which always recomputes
 * before deciding the next Human to move.
 */
function recomputeAttraction(board: MovementBoard): void {
  for (const human of board.humans) {
    if (human.moved) continue;
    const result = resolveAttraction(board, human);
    if (result.kind === "blocked") {
      human.confused = false;
      human.attractedToStackId = null;
      human.blockedNoLure = true;
    } else if (result.kind === "attracted") {
      human.confused = false;
      human.attractedToStackId = result.stack.id;
      human.blockedNoLure = false;
    } else {
      human.confused = true;
      human.attractedToStackId = null;
      human.blockedNoLure = false;
    }
  }
}

type Candidate = { human: HumanInstance; stack: LureStack; distance: number };

function findNextHumanToMove(board: MovementBoard): Candidate | null {
  const candidates: Candidate[] = [];
  for (const human of board.humans) {
    if (human.moved || human.confused || !human.attractedToStackId) continue;
    const stack = board.lureStacks.find((s) => s.id === human.attractedToStackId);
    if (!stack) continue;
    const distance = axialDistance(human.position, stack.position);
    if (distance === 0) continue;
    // A Human genuinely attracted (by raw distance) to a lure it currently
    // has no legal step toward — fully boxed in by obstacles/other Humans
    // on every hex that would get it closer — simply isn't a candidate to
    // move THIS tick. It stays attracted (not confused, not blockedNoLure)
    // and just sits out; if nothing else can move either, the phase ends.
    if (legalDirectSteps(board, human.position, stack.position, human.instanceId).length === 0) continue;
    candidates.push({ human, stack, distance });
  }
  if (candidates.length === 0) return null;

  const minDistance = Math.min(...candidates.map((c) => c.distance));
  const atMinDistance = candidates.filter((c) => c.distance === minDistance);

  // Equal-distance Humans resolve in player order (first player, then
  // clockwise) — by the *owner of each Human's own target lure*, already
  // resolved per-Human in resolveAttraction. Stack height plays no part in
  // this tie-break; it only decides which lure an individual Human targets.
  // Final stable fallback: original array order, for the rare case of two
  // tied Humans both targeting lures owned by the very same player.
  atMinDistance.sort((a, b) => {
    const rankDiff = firstPlayerRank(board, a.stack.owner) - firstPlayerRank(board, b.stack.owner);
    if (rankDiff !== 0) return rankDiff;
    return board.humans.indexOf(a.human) - board.humans.indexOf(b.human);
  });
  return atMinDistance[0];
}

export type CollectHandler = (humanInstanceId: string, definitionId: string, collectedBy: PlayerId) => void;

function clearLure(board: MovementBoard, stack: LureStack, events: MovementEvent[]): void {
  events.push({ type: "lureCleared", stackId: stack.id, owner: stack.owner, position: stack.position });
  if (LURE_CLEAR_MODE === "full-stack") {
    board.lureStacks = board.lureStacks.filter((s) => s.id !== stack.id);
  } else {
    stack.height -= 1;
    if (stack.height <= 0) {
      board.lureStacks = board.lureStacks.filter((s) => s.id !== stack.id);
    }
  }
}

function collectHuman(board: MovementBoard, human: HumanInstance, collectedBy: PlayerId, events: MovementEvent[]): void {
  events.push({
    type: "humanCollected",
    humanInstanceId: human.instanceId,
    definitionId: human.definitionId,
    collectedBy,
  });
  board.humans = board.humans.filter((h) => h.instanceId !== human.instanceId);
}

function handleArrival(board: MovementBoard, human: HumanInstance, events: MovementEvent[]): void {
  const key = axialKey(human.position);
  const domainOwner = board.domainHexes?.get(key);
  const stack = lureStackAt(board, human.position);

  if (domainOwner) {
    // Reaching your own Domain's territory is what scores — a lure sitting
    // on the same hex (the common case: a lure placed inside the Domain to
    // draw a Human home) just clears along with the collection, no separate
    // score for its owner.
    if (stack) clearLure(board, stack, events);
    collectHuman(board, human, domainOwner, events);
    return;
  }

  if (!stack) return;

  if (board.domainHexes) {
    // Domain-aware board: an ordinary lure elsewhere on the board is only
    // "bait" — it clears when reached, but doesn't collect/score the Human.
    // Only arriving at a Domain hex does that (handled above).
    clearLure(board, stack, events);
    return;
  }

  // Legacy behavior (no domainHexes configured on this board): reaching any
  // lure stack scores its owner and collects the Human, exactly as before.
  const owner = stack.owner;
  clearLure(board, stack, events);
  collectHuman(board, human, owner, events);
}

/** Applies exactly one step of movement for `human` toward `destination`, including arrival/acceleration handling. */
function applyStep(
  board: MovementBoard,
  humanId: string,
  destination: Axial,
  events: MovementEvent[],
  isBonusStep: boolean
): void {
  const human = board.humans.find((h) => h.instanceId === humanId);
  if (!human) return; // may have been collected already
  const marker = accelMarkerAt(board, destination);
  // Confirmed by the user: Acceleration is a straight-line extension of the
  // step just taken, not a fresh lure-seeking move — captured here, before
  // `human.position` is overwritten, so it works identically whether this
  // step was the Human's primary move or itself a bonus step (chaining).
  const travelDirection = axialSubtract(destination, human.position);
  human.position = destination;
  human.moved = true;
  events.push({ type: "moved", humanInstanceId: human.instanceId, to: destination });

  handleArrival(board, human, events);
  const stillOnBoard = board.humans.some((h) => h.instanceId === humanId);

  if (marker && stillOnBoard) {
    events.push({ type: "accelerationTriggered", humanInstanceId: human.instanceId, bonusSteps: marker.bonusSteps });
    runAccelerationBonusMovement(board, human.instanceId, travelDirection, marker.bonusSteps, events);
  } else if (!isBonusStep) {
    // no acceleration triggered by this step
  }
}

/**
 * Acceleration bonus movement: confirmed by the user to be a straight-line
 * continuation in the same direction the Human was already traveling, never
 * a fresh path toward its lure — so unlike `runBonusMovement`, this never
 * recomputes attraction and never produces a path-choice tie (there is only
 * ever one hex "the same direction" can mean). If that hex is off the board
 * or blocked (an obstacle or another Human), the bonus simply doesn't
 * happen — the Human stays put on the marker rather than erroring.
 */
function runAccelerationBonusMovement(board: MovementBoard, humanId: string, direction: Axial, stepsRemaining: number, events: MovementEvent[]): void {
  if (stepsRemaining <= 0) return;
  const human = board.humans.find((h) => h.instanceId === humanId);
  if (!human) return;

  const next = axialAdd(human.position, direction);
  if (!board.hexes.has(axialKey(next))) return;
  const passable = makePassable(board, human.instanceId);
  if (!passable(next)) return;

  applyStep(board, humanId, next, events, true);
  const stillThere = board.humans.some((h) => h.instanceId === humanId);
  if (stillThere) runAccelerationBonusMovement(board, humanId, direction, stepsRemaining - 1, events);
}

/** Moon's Ascendance bonus movement continues toward the Human's current lure (recomputed), per spec section 19 — unlike Acceleration (see `runAccelerationBonusMovement`), this is an ordinary extra move, so it can still tie and prompt a path choice. */
function runBonusMovement(board: MovementBoard, humanId: string, stepsRemaining: number, events: MovementEvent[]): void {
  if (stepsRemaining <= 0) return;
  const human = board.humans.find((h) => h.instanceId === humanId);
  if (!human) return;

  // Recompute this Human's current attraction in isolation (board may have changed).
  const attraction = resolveAttraction(board, human);
  if (attraction.kind !== "attracted") return; // no lure, or confused/tied -> bonus movement stops
  const stack = attraction.stack;
  const distance = axialDistance(human.position, stack.position);
  if (distance === 0) return;

  const legalSteps = legalDirectSteps(board, human.position, stack.position, human.instanceId);
  if (legalSteps.length === 0) return; // fully blocked — bonus movement simply stops here, no reroute

  if (legalSteps.length > 1) {
    board.pendingPathChoice = {
      humanInstanceId: human.instanceId,
      options: legalSteps,
      controllingPlayerId: stack.owner,
      isBonusMovement: true,
      bonusStepsRemaining: stepsRemaining,
    };
    events.push({ type: "pathChoiceRequired", humanInstanceId: human.instanceId, options: legalSteps });
    return;
  }

  applyStep(board, human.instanceId, legalSteps[0], events, true);
  const stillThere = board.humans.some((h) => h.instanceId === human.instanceId);
  if (stillThere) runBonusMovement(board, human.instanceId, stepsRemaining - 1, events);
}

/** Moon's Ascendance: after a Human's primary step resolves, continue it toward its (recomputed) current lure for the remaining configured steps — reuses the exact same continuation logic as an Acceleration bonus. No-ops if nothing is configured, or if another bonus mechanism (e.g. an Acceleration marker on this same step) already left a path choice pending. */
function triggerRoundMovementBonus(board: MovementBoard, humanId: string, events: MovementEvent[]): void {
  if (!board.movesPerHuman || board.movesPerHuman <= 1) return;
  if (board.pendingPathChoice) return;
  runBonusMovement(board, humanId, board.movesPerHuman - 1, events);
}

/**
 * Advances the movement phase by exactly one unit of work: either it moves
 * one Human one step (possibly cascading into lure-clear/acceleration), or
 * it discovers the phase is finished, or it pauses on a path-choice. Callers
 * loop this until `{status: "done"}`.
 */
export function advanceMovementPhase(board: MovementBoard): { result: StepResult; events: MovementEvent[] } {
  const events: MovementEvent[] = [];

  if (board.pendingPathChoice) {
    return { result: { status: "waitingOnChoice", choice: board.pendingPathChoice }, events };
  }

  recomputeAttraction(board);

  const previouslyConfused = new Set(
    board.humans.filter((h) => !h.moved && h.confused).map((h) => h.instanceId)
  );
  for (const id of previouslyConfused) events.push({ type: "confused", humanInstanceId: id });

  const next = findNextHumanToMove(board);
  if (!next) {
    return { result: { status: "done" }, events };
  }

  const legalSteps = legalDirectSteps(board, next.human.position, next.stack.position, next.human.instanceId);
  if (legalSteps.length === 0) {
    // findNextHumanToMove already filters this out — shouldn't happen — but guard defensively.
    return { result: { status: "done" }, events };
  }

  if (legalSteps.length > 1) {
    board.pendingPathChoice = {
      humanInstanceId: next.human.instanceId,
      options: legalSteps,
      controllingPlayerId: next.stack.owner,
      isBonusMovement: false,
      bonusStepsRemaining: 0,
    };
    events.push({ type: "pathChoiceRequired", humanInstanceId: next.human.instanceId, options: legalSteps });
    return { result: { status: "waitingOnChoice", choice: board.pendingPathChoice }, events };
  }

  applyStep(board, next.human.instanceId, legalSteps[0], events, false);
  triggerRoundMovementBonus(board, next.human.instanceId, events);
  return { result: { status: "advanced" }, events };
}

/** Resolves a pending path-choice with the controlling player's chosen destination hex. */
export function resolvePathChoice(board: MovementBoard, chosen: Axial): MovementEvent[] {
  const events: MovementEvent[] = [];
  const choice = board.pendingPathChoice;
  if (!choice) return events;
  const isLegal = choice.options.some((o) => o.q === chosen.q && o.r === chosen.r);
  if (!isLegal) throw new Error("Illegal path choice: not among the legal direct-step options");
  board.pendingPathChoice = null;
  applyStep(board, choice.humanInstanceId, chosen, events, choice.isBonusMovement);
  if (choice.isBonusMovement) {
    const stillThere = board.humans.some((h) => h.instanceId === choice.humanInstanceId);
    if (stillThere && choice.bonusStepsRemaining - 1 > 0) {
      runBonusMovement(board, choice.humanInstanceId, choice.bonusStepsRemaining - 1, events);
    }
  } else {
    // This was the Human's primary step (possibly tie-resolved by the player) — Moon's Ascendance may still owe it more steps.
    triggerRoundMovementBonus(board, choice.humanInstanceId, events);
  }
  return events;
}

/** Runs the whole movement phase to completion, auto-resolving path ties with `autoChoice` (used by tests / non-interactive simulation). Returns all events. Throws if a choice arises and no resolver is given. */
export function runMovementPhaseToCompletion(
  board: MovementBoard,
  autoChoice?: (choice: PendingPathChoice) => Axial
): MovementEvent[] {
  const allEvents: MovementEvent[] = [];
  // Safety bound: at most humans*board-size iterations before something is wrong.
  const maxIterations = (board.humans.length + 1) * (board.hexes.size + 1) * 4 + 100;
  let iterations = 0;
  while (true) {
    iterations++;
    if (iterations > maxIterations) {
      throw new Error("Movement phase exceeded safety iteration bound — possible infinite loop");
    }
    const { result, events } = advanceMovementPhase(board);
    allEvents.push(...events);
    if (result.status === "done") break;
    if (result.status === "waitingOnChoice") {
      if (!autoChoice) throw new Error("Path choice required but no resolver supplied");
      const chosen = autoChoice(result.choice);
      allEvents.push(...resolvePathChoice(board, chosen));
    }
  }
  return allEvents;
}

/** Resets every Human's moved flag. Called at the start of each Human Movement Phase. */
export function resetMovedMarkers(board: MovementBoard): void {
  for (const h of board.humans) h.moved = false;
}

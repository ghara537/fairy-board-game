import {
  Axial,
  AccelerationMarker,
  DomainId,
  GamePhase,
  HumanInstance,
  LogEntry,
  LureStack,
  Obstacle,
  PlayerId,
  PortalSpawnSet,
  VictoryCondition,
} from "@fairy/shared";
import { PendingPathChoice } from "./engine/movement";

export type EffectStackItem = {
  id: string;
  sourcePlayerId: PlayerId;
  kind: "card" | "domainAbility";
  cardId?: string;
  abilityKey?: string;
  name: string;
  timing: "action" | "instant";
  target: unknown;
  status: "pending" | "resolved" | "canceled" | "redirected" | "modified";
  // Faerie Bargain: once this item resolves, its card goes to this player's
  // hand instead of the discard pile.
  redirectToHandPlayerId?: PlayerId;
  // Frozen Magic: any round-based duration this item's resolution grants
  // (Blessing of the Good Folk, Crystal Ward, etc.) is extended by this many
  // extra rounds.
  extendDurationBonus?: number;
  // Wildfire: when this item resolves, its handler also runs a second time
  // against this Human (in addition to its normal target).
  extraHumanInstanceId?: string;
};

export type PendingInteractionKind =
  | "chooseAction"
  | "chooseCard"
  | "chooseTarget"
  | "chooseBoardSpace"
  | "chooseMovementPath"
  | "chooseTieOrder"
  | "chooseInstantResponse"
  | "chooseToadstool"
  | "chooseRelocationSpace"
  | "chooseDomainAbility"
  | "mandatoryDiscard"
  | "confirmAction";

export type PendingInteraction = {
  id: string;
  kind: PendingInteractionKind;
  forPlayerIds: PlayerId[];
  prompt: string;
  legalOptions: unknown;
  deadlineAt: number | null;
  data?: Record<string, unknown>;
};

export type ServerPlayerState = {
  id: PlayerId;
  domainId: DomainId;
  hand: string[]; // card definition ids, duplicates allowed
  score: number;
  collectedHumanDefinitionIds: string[];
  abilitiesUsed: [boolean, boolean, boolean];
  startingAbilityUsed: boolean;
  extraEnchantmentPlaysThisTurn: number; // e.g. granted by Mirage
  // Passive starting-ability stat modifiers (River Nymphs / Moonlight Pixies):
  lureCap: number | null; // max total lure height this player may have on the board at once
  // Hard cap (7, or 10 for Moonlight Pixies): if a player's hand still
  // exceeds this at the end of their turn, they must discard down to it
  // before play continues — see GameEngine's "mandatoryDiscard" interaction.
  handSizeMax: number;
};

export type DomainBoardAssignment = {
  playerId: PlayerId;
  domainId: DomainId;
  side: number; // 1-6, clockwise from the upper-right edge — see DOMAIN_SIDE_ASSIGNMENTS
  hexes: Axial[]; // the 4 hexes attached past that edge, this player's scoring territory
};

export type ServerBoardState = {
  edgeLength: number;
  hexes: Set<string>;
  portalCenter: Axial;
  humans: HumanInstance[];
  lureStacks: LureStack[];
  obstacles: Obstacle[];
  accelMarkers: AccelerationMarker[];
  spawnIndicator: PortalSpawnSet;
  pendingPathChoice: PendingPathChoice | null;
  domainBoards: DomainBoardAssignment[];
};

export type ServerGameState = {
  phase: GamePhase;
  version: number;
  victoryCondition: VictoryCondition;
  // For "points" mode, the configured target. For "turns" mode, set to
  // Infinity so the points-based checkVictory() early-exit never fires —
  // ending the game is instead handled by checkTurnBasedEnd() in victory.ts.
  targetScore: number;
  firstPlayerRule: "youngest" | "previousWinner";
  responseTimerSec: number | null;
  pushPullSidewaysAllowed: boolean;

  board: ServerBoardState;
  players: Record<PlayerId, ServerPlayerState>;
  turnOrder: PlayerId[];
  firstPlayerId: PlayerId;
  activePlayerId: PlayerId;
  actionsRemaining: number;
  discardDrawUsedThisTurn: boolean;

  deck: string[];
  discardPile: string[];

  responseStack: EffectStackItem[];
  // Response-window bookkeeping: who still needs to answer, in priority order,
  // and how many players have passed consecutively (resets whenever an instant is played).
  responseWindowQueue: PlayerId[] | null;
  responseConsecutivePasses: number;

  pendingInteraction: PendingInteraction | null;

  round: number;
  winnerId: PlayerId | null;
  // Populated only when a turns-mode game ends without a resolved tiebreak
  // (see engine/victory.ts::checkTurnBasedEnd) — the players who remained
  // tied. Always null for a normal decisive win.
  drawPlayerIds: PlayerId[] | null;

  log: LogEntry[];

  // One-shot private reveals (e.g. Moonlight Vision, Glimpse Beyond) —
  // delivered to the named player's next personalized view only, then
  // cleared. Never sent to anyone else's client payload.
  ephemeralReveals: { forPlayerId: PlayerId; revealedPlayerId: PlayerId; hand: string[] }[];
  // One-shot private deck peeks (e.g. Moonlit Scrying).
  ephemeralDeckPeeks: { forPlayerId: PlayerId; cardIds: string[] }[];

  // Round-wide effects (Landscapes):
  instantsDisabledUntilRound: number | null; // Eclipse
  thickMistUntilRound: number | null; // Shrouded Hollow: Humans untargetable unless adjacent to a lure
  veilOfMistUntilRound: number | null; // Veil of Mist: Humans only attracted to lures within 1 space
  moonsAscendanceUntilRound: number | null; // Moon's Ascendance: Humans move 2 spaces instead of 1

  // Players who still need to resolve a targeted starting ability, in
  // first-player order, during the "starting-abilities" phase.
  startingAbilityQueue: PlayerId[];

  // Delayed Curse: effects removed from the normal response stack and
  // scheduled to resolve automatically at the start of a future round.
  deferredEffects: { item: EffectStackItem; resolveAtRound: number }[];

  // Threads of Fate: overrides for the next Human spawn, consumed by
  // spawnHumans() and cleared afterward.
  spawnOverrides: { position: Axial; definitionId: string }[];

  // Generalized response-window bookkeeping: which phase to restore once the
  // current response window closes (a window can be opened mid "player-turn"
  // or as a dedicated pre-spawn window during "human-spawn").
  phaseBeforeResponseWindow: GamePhase | null;
  // Whether the pre-spawn Instant window has already been offered for the
  // spawn currently in progress (guards against re-opening it once it closes).
  preSpawnWindowOffered: boolean;
};

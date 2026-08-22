import { Axial } from "./hex/coordinates";

// ---------------------------------------------------------------------------
// Players / rooms
// ---------------------------------------------------------------------------

export type PlayerId = string;
export type DomainId =
  | "ocean-sirens"
  | "forest-elves"
  | "wind-djinn"
  | "river-nymphs"
  | "moonlight-pixies"
  | "earth-gnomes"
  | "fire-sprites"
  | "frost-spirits"
  | "shadow-fae"
  | "dreamweavers";

// Matches the "game_set" column in the card/ability source spreadsheet.
export type GameSet = "basic" | "expansion_1" | "expansion_2";

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

export type PlayerRecord = {
  id: PlayerId;
  name: string;
  seat: number; // 0-based, also the turn-order index pre-shuffle
  domainId: DomainId | null;
  birthYear: number | null;
  ready: boolean;
  isHost: boolean;
  connectionStatus: ConnectionStatus;
};

// How the game decides a winner. "points": first to reach targetScore wins
// immediately. "turns": play stops after turnLimit rounds; if the top score
// is a tie, play continues (re-checking after every round) until
// tieExtensionLimit, at which point an unresolved tie goes to the
// nearest-townsfolk-distance tiebreak (see engine/victory.ts) or a draw.
export type VictoryCondition =
  | { kind: "points"; targetScore: number }
  | { kind: "turns"; turnLimit: number; tieExtensionLimit: number };

export type GamePhase =
  | "lobby"
  | "setup"
  | "starting-abilities"
  | "player-turn"
  | "response-window"
  | "human-movement"
  | "human-spawn"
  | "round-cleanup"
  | "game-over";

// ---------------------------------------------------------------------------
// Board contents
// ---------------------------------------------------------------------------

export type ObstacleType = "tree" | "stone" | "toadstool";

export type Obstacle = {
  id: string;
  type: ObstacleType;
  position: Axial;
};

export type LureColor = PlayerId; // a lure's "color" IS its owning player

export type LureStack = {
  id: string;
  position: Axial;
  owner: PlayerId;
  height: number;
  // Set by effects like Crystal Ward / Cleansing Waters. Server round number
  // (inclusive) until which this stack cannot be chosen as a target.
  untargetableUntilRound?: number;
  // Set by Veil of Darkness. Server round number (inclusive) until which
  // this stack is ignored by Human attraction calculations entirely.
  inactiveUntilRound?: number;
};

export type HumanTag =
  | "adult"
  | "child"
  | "baby"
  | "lover"
  | "mother"
  | "hazard"
  | "hunter";

export type ScoringRuleKind = "pairBonus" | "setBonus" | "flatPenalty";

export type ScoringRule = {
  kind: ScoringRuleKind;
  description: string;
  // pairBonus: awarded once per pairing with a Human carrying `withTag`
  withTag?: HumanTag;
  bonusPoints?: number;
  // setBonus: awarded when every id in `requiresHumanIds` has been collected
  // by the same player
  requiresHumanIds?: string[];
  setBonusPoints?: number;
};

export type HumanDefinition = {
  id: string;
  name: string;
  basePoints: number;
  tags: HumanTag[];
  scoringRules: ScoringRule[];
  isHazard: boolean; // Hunters etc. — negative/neutral, may block a set bonus rather than being "collected"
};

export type HumanInstance = {
  instanceId: string;
  definitionId: string;
  position: Axial;
  moved: boolean;
  confused: boolean;
  attractedToStackId: string | null;
  blockedNoLure: boolean; // true when no reachable lure exists at all
  // Set by effects like Blessing of the Good Folk / Mesmerize. Server round
  // number (inclusive) until which this Human cannot be chosen as a target.
  untargetableUntilRound?: number;
};

export type AccelerationMarker = {
  id: string;
  position: Axial;
  bonusSteps: number; // config constant, see data/config.ts accelerationBonusSteps
};

export type PortalSpawnSet = "A" | "B";

// ---------------------------------------------------------------------------
// Enchantments (cards) & Domain abilities
// ---------------------------------------------------------------------------

export type CardTiming = "action" | "instant";
export type ImplementationStatus = "implemented" | "needs-rules-text";

export type CardType = "Enchantment" | "Landscape";

export type TargetType =
  | "none"
  | "human"
  | "lureStack"
  | "boardSpace"
  | "obstacle"
  | "obstacleOrMarker"
  | "accelMarker"
  | "player"
  | "enchantmentInStack"
  | "toadstool"
  | "discardedCard"
  | "hand";

export type EnchantmentCardDefinition = {
  id: string;
  name: string;
  legacyName?: string; // prior working name, kept for traceability back to the source spreadsheet
  cardType: CardType;
  gameSet: GameSet;
  quantity: number | null; // null when the source doesn't specify a copy count
  timing: CardTiming;
  actionCost: number; // 0 for instants that don't consume a normal action
  rulesText: string;
  targetType: TargetType;
  implementationStatus: ImplementationStatus;
  cancellationRefund?: number;
  effectKey: string; // key into the server-side effect handler registry
  notes?: string; // editorial notes carried over from the source spreadsheet
};

export type DomainAbilityDefinition = {
  key: string; // handler key, e.g. "sirensCall"
  name: string;
  isStarting: boolean;
  timing: CardTiming;
  rulesText: string;
  targetType: TargetType;
  implementationStatus: ImplementationStatus;
  notes?: string;
};

// The repeatable "Main Ability" — distinct from the 3 once-per-game
// abilities: usable any number of times, gated only by its action cost.
export type MainAbilityDefinition = {
  key: string;
  name: string;
  timing: CardTiming;
  actionCost: number;
  rulesText: string;
  targetType: TargetType;
  implementationStatus: ImplementationStatus;
  notes?: string;
};

export type DomainDefinition = {
  id: DomainId;
  name: string;
  description: string;
  gameSet: GameSet;
  identity?: string; // thematic tag from the source spreadsheet (e.g. "Pulling", "Trees")
  startingAbility: DomainAbilityDefinition | null;
  abilities: [DomainAbilityDefinition, DomainAbilityDefinition, DomainAbilityDefinition];
  mainAbility: MainAbilityDefinition | null;
};

// ---------------------------------------------------------------------------
// Spawn configuration
// ---------------------------------------------------------------------------

export type SpawnHumanEntry = {
  definitionId: string;
  count: number;
};

export type PortalSpawnConfig = {
  setName: PortalSpawnSet;
  positions: Axial[]; // non-center spawn positions for this set
  hunterCenterPosition: Axial;
  humans: SpawnHumanEntry[];
};

export type SpawnDataFile = {
  initialSet: PortalSpawnSet;
  portalCenter: Axial;
  sets: Record<PortalSpawnSet, PortalSpawnConfig>;
};

// ---------------------------------------------------------------------------
// Game log
// ---------------------------------------------------------------------------

export type LogEntry = {
  id: string;
  timestamp: number;
  text: string; // human-readable
  eventType: string; // structured event tag
  data?: Record<string, unknown>;
};

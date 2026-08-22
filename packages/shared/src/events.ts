import { Axial } from "./hex/coordinates";
import {
  ConnectionStatus,
  DomainId,
  GamePhase,
  LogEntry,
  ObstacleType,
  PlayerId,
  PortalSpawnSet,
  VictoryCondition,
} from "./types";

// ---------------------------------------------------------------------------
// Socket.IO event contract, shared verbatim between client and server so a
// type change on one side is a compile error on the other.
// ---------------------------------------------------------------------------

export type RoomConfigInput = {
  victoryCondition: VictoryCondition;
  disabledCardIds: string[];
  firstPlayerRule: "youngest" | "previousWinner";
  responseTimerSec: number | null;
  // Whether push/pull abilities/cards may also move a Human "sideways"
  // relative to the acting player's Domain, not just toward (pull) or away
  // (push) from it — see hex/coordinates.ts::classifyDirections.
  pushPullSidewaysAllowed: boolean;
};

// ---- Client -> Server -------------------------------------------------

export type CreateRoomPayload = { name: string; config: RoomConfigInput };
export type JoinRoomPayload = { roomCode: string; name: string; birthYear?: number };
export type ReconnectPayload = { roomCode: string; playerId: PlayerId; reconnectToken: string };
export type SelectDomainPayload = { domainId: DomainId };
export type SetReadyPayload = { ready: boolean };

export type ActionSubmitPayload = {
  actionId: string;
  stateVersion: number;
  type: "placeLure" | "playCard" | "useDomainAbility" | "drawCard" | "discardDraw" | "endTurn";
  payload: Record<string, unknown>;
};

export type InteractionRespondPayload = {
  actionId: string;
  stateVersion: number;
  interactionId: string;
  payload: Record<string, unknown>;
};

export type HostCorrectionPayload = {
  actionId: string;
  type:
    | "moveHuman"
    | "moveLure"
    | "addObstacle"
    | "removeObstacle"
    | "adjustScore"
    | "drawCard"
    | "discardCard"
    | "releaseSeat"
    | "advancePhase"
    | "undoLast";
  payload: Record<string, unknown>;
};

export interface ClientToServerEvents {
  "room:create": (payload: CreateRoomPayload, cb: (res: CreateRoomResult) => void) => void;
  "room:join": (payload: JoinRoomPayload, cb: (res: JoinRoomResult) => void) => void;
  "room:reconnect": (payload: ReconnectPayload, cb: (res: ReconnectResult) => void) => void;
  "domain:select": (payload: SelectDomainPayload) => void;
  "lobby:setReady": (payload: SetReadyPayload) => void;
  "lobby:updateConfig": (payload: RoomConfigInput) => void;
  "lobby:start": () => void;
  "action:submit": (payload: ActionSubmitPayload) => void;
  "interaction:respond": (payload: InteractionRespondPayload) => void;
  "host:correction": (payload: HostCorrectionPayload) => void;
}

// ---- Server -> Client -------------------------------------------------

export type CreateRoomResult =
  | { ok: true; roomCode: string; playerId: PlayerId; reconnectToken: string }
  | { ok: false; error: string };

export type JoinRoomResult =
  | { ok: true; playerId: PlayerId; reconnectToken: string }
  | { ok: false; error: string };

export type ReconnectResult = { ok: true } | { ok: false; error: string };

export type PublicPlayerView = {
  id: PlayerId;
  name: string;
  seat: number;
  domainId: DomainId | null;
  ready: boolean;
  isHost: boolean;
  connectionStatus: ConnectionStatus;
  score: number;
  handCount: number;
  handSizeMax: number;
  abilitiesUsed: [boolean, boolean, boolean];
  collectedHumanIds: string[];
};

export type PublicHumanView = {
  instanceId: string;
  definitionId: string;
  position: Axial;
  moved: boolean;
  confused: boolean;
};

export type PublicLureStackView = { id: string; position: Axial; owner: PlayerId; height: number };
export type PublicObstacleView = { id: string; type: ObstacleType; position: Axial };
export type PublicAccelMarkerView = { id: string; position: Axial };
export type PublicDomainBoardView = { playerId: PlayerId; domainId: DomainId; side: number; hexes: Axial[] };

export type PublicEffectStackItem = {
  id: string;
  sourcePlayerId: PlayerId;
  name: string;
  kind: "card" | "domainAbility";
  target: unknown;
  status: "pending" | "resolved" | "canceled" | "redirected" | "modified";
};

export type PendingInteractionView = {
  id: string;
  kind: string;
  forPlayerIds: PlayerId[];
  prompt: string;
  legalOptions: unknown;
  deadlineAt: number | null;
};

export type PersonalizedGameView = {
  phase: GamePhase;
  version: number;
  roomCode: string;
  config: { victoryCondition: VictoryCondition; firstPlayerRule: string; responseTimerSec: number | null; pushPullSidewaysAllowed: boolean };
  players: PublicPlayerView[];
  hostPlayerId: PlayerId;
  yourPlayerId: PlayerId | null;
  yourHand: { id: string; name: string; timing: string; actionCost: number }[] | null;
  board: {
    edgeLength: number;
    portalCenter: Axial;
    humans: PublicHumanView[];
    lureStacks: PublicLureStackView[];
    obstacles: PublicObstacleView[];
    accelMarkers: PublicAccelMarkerView[];
    spawnIndicator: PortalSpawnSet;
    domainBoards: PublicDomainBoardView[];
  } | null;
  turnOrder: PlayerId[];
  round: number;
  firstPlayerId: PlayerId | null;
  activePlayerId: PlayerId | null;
  actionsRemaining: number | null;
  responseStack: PublicEffectStackItem[];
  availableActions: { type: string; available: boolean; reason?: string }[];
  pendingInteraction: PendingInteractionView | null;
  log: LogEntry[];
  winnerId: PlayerId | null;
  // Populated only when a turns-mode game ends without a resolved tiebreak
  // (see engine/victory.ts) — the players who remained tied. Null otherwise,
  // including for a normal decisive win (use winnerId for that case).
  drawPlayerIds: PlayerId[] | null;
  // One-shot private reveals addressed to this viewer only (e.g. Moonlight Vision).
  revealedHands: { revealedPlayerId: PlayerId; hand: string[] }[];
  // One-shot private deck peek addressed to this viewer only (e.g. Moonlit Scrying).
  deckPeek: string[] | null;
  // Discard pile is public — every played/discarded card is visible to all (spec section 26).
  discardPile: string[];
};

export interface ServerToClientEvents {
  "state:update": (view: PersonalizedGameView) => void;
  "action:rejected": (info: { actionId: string; reason: string }) => void;
  "room:error": (info: { message: string }) => void;
}

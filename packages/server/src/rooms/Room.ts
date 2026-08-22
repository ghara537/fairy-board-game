import {
  ConnectionStatus,
  DomainId,
  DOMAIN_DEFINITIONS,
  VictoryCondition,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PlayerId,
  LogEntry,
} from "@fairy/shared";
import { ServerGameState } from "../game/state";
import { buildInitialGameState, SetupPlayerInput } from "../game/engine/setup";
import { submitAction, respondToInteraction, applyHostCorrection, maybeAdvancePhase, beginGameplay } from "../game/GameEngine";
import { hashReconnectToken } from "../reconnect/tokens";

export type RoomPlayer = {
  id: PlayerId;
  name: string;
  seat: number;
  domainId: DomainId | null;
  birthYear: number | null;
  ready: boolean;
  isHost: boolean;
  connectionStatus: ConnectionStatus;
  reconnectTokenHash: string;
  socketId: string | null;
};

export type RoomConfigState = {
  victoryCondition: VictoryCondition;
  disabledCardIds: string[];
  firstPlayerRule: "youngest" | "previousWinner";
  responseTimerSec: number | null;
  pushPullSidewaysAllowed: boolean;
};

let logCounter = 0;

export class Room {
  code: string;
  hostPlayerId: PlayerId;
  config: RoomConfigState;
  players: Map<PlayerId, RoomPlayer> = new Map();
  phase: "lobby" | "in-game" = "lobby";
  game: ServerGameState | null = null;
  log: LogEntry[] = [];
  version = 1;
  createdAt: number;
  lastActivityAt: number;
  previousWinnerId: PlayerId | null = null;
  private lastSnapshot: string | null = null;

  constructor(code: string, hostPlayerId: PlayerId, config: RoomConfigState) {
    this.code = code;
    this.hostPlayerId = hostPlayerId;
    this.config = config;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
  }

  private log_(text: string, eventType: string, data?: Record<string, unknown>): void {
    logCounter += 1;
    this.log.push({ id: `room-log-${logCounter}`, timestamp: Date.now(), text, eventType, data });
  }

  touch(): void {
    this.lastActivityAt = Date.now();
    this.version += 1;
  }

  addPlayer(name: string, birthYear: number | null, reconnectTokenHash: string): RoomPlayer | { error: string } {
    if (this.phase !== "lobby") return { error: "The game has already started." };
    if (this.players.size >= MAX_PLAYERS) return { error: "This room is full." };
    const seat = this.players.size;
    const id = `player-${this.code}-${seat}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const player: RoomPlayer = {
      id,
      name,
      seat,
      domainId: null,
      birthYear,
      ready: false,
      isHost: seat === 0,
      connectionStatus: "connected",
      reconnectTokenHash,
      socketId: null,
    };
    this.players.set(id, player);
    if (seat === 0) this.hostPlayerId = id;
    this.log_(`${name} joined the room.`, "player:joined", { playerId: id, name });
    this.touch();
    return player;
  }

  reconnect(playerId: PlayerId, socketId: string): RoomPlayer | { error: string } {
    const player = this.players.get(playerId);
    if (!player) return { error: "Unknown seat." };
    player.connectionStatus = "connected";
    player.socketId = socketId;
    this.log_(`${player.name} reconnected.`, "player:reconnected", { playerId });
    this.touch();
    return player;
  }

  markDisconnected(playerId: PlayerId): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connectionStatus = "disconnected";
    player.socketId = null;
    this.log_(`${player.name} disconnected.`, "player:disconnected", { playerId });
    this.touch();
  }

  selectDomain(playerId: PlayerId, domainId: DomainId): { error?: string } {
    if (this.phase !== "lobby") return { error: "The game has already started." };
    if (!DOMAIN_DEFINITIONS.some((d) => d.id === domainId)) return { error: "Unknown Domain." };
    const taken = [...this.players.values()].some((p) => p.domainId === domainId && p.id !== playerId);
    if (taken) return { error: "That Domain is already taken." };
    const player = this.players.get(playerId);
    if (!player) return { error: "Unknown player." };
    player.domainId = domainId;
    this.log_(`${player.name} selected ${domainId}.`, "domain:selected", { playerId, domainId });
    this.touch();
    return {};
  }

  setReady(playerId: PlayerId, ready: boolean): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.ready = ready;
    this.touch();
  }

  updateConfig(config: RoomConfigState): { error?: string } {
    if (this.phase !== "lobby") return { error: "The game has already started." };
    this.config = config;
    this.touch();
    return {};
  }

  canStart(): { ok: boolean; reason?: string } {
    if (this.phase !== "lobby") return { ok: false, reason: "Already started." };
    if (this.players.size < MIN_PLAYERS) return { ok: false, reason: "Need at least 2 players." };
    const players = [...this.players.values()];
    if (players.some((p) => !p.domainId)) return { ok: false, reason: "Every player must select a Domain." };
    if (players.some((p) => !p.ready)) return { ok: false, reason: "Every player must be ready." };
    return { ok: true };
  }

  startGame(): { error?: string } {
    const check = this.canStart();
    if (!check.ok) return { error: check.reason };
    const setupPlayers: SetupPlayerInput[] = [...this.players.values()].map((p) => ({
      id: p.id,
      seat: p.seat,
      domainId: p.domainId as DomainId,
      birthYear: p.birthYear,
    }));
    this.game = buildInitialGameState(
      setupPlayers,
      this.config.victoryCondition,
      this.config.disabledCardIds,
      this.config.firstPlayerRule,
      this.config.responseTimerSec,
      this.config.pushPullSidewaysAllowed,
      this.previousWinnerId
    );
    beginGameplay(this.game);
    this.phase = "in-game";
    this.log_("The game has started.", "game:started");
    this.touch();
    return {};
  }

  submitAction(playerId: PlayerId, type: string, payload: Record<string, unknown>): { error?: string } {
    if (!this.game) return { error: "The game has not started." };
    const result = submitAction(this.game, playerId, type, payload);
    this.touch();
    if (this.game.winnerId) this.previousWinnerId = this.game.winnerId;
    return result.ok ? {} : { error: result.error };
  }

  respondToInteraction(playerId: PlayerId, interactionId: string, payload: Record<string, unknown>): { error?: string } {
    if (!this.game) return { error: "The game has not started." };
    const result = respondToInteraction(this.game, playerId, interactionId, payload);
    this.touch();
    if (this.game.winnerId) this.previousWinnerId = this.game.winnerId;
    return result.ok ? {} : { error: result.error };
  }

  snapshotForUndo(): void {
    if (this.game) this.lastSnapshot = JSON.stringify(serializeGameState(this.game));
  }

  undoLast(): { error?: string } {
    if (!this.lastSnapshot) return { error: "Nothing to undo." };
    this.game = deserializeGameState(this.lastSnapshot);
    this.lastSnapshot = null;
    this.log_("Host undid the most recent action.", "host:undo");
    this.touch();
    return {};
  }

  hostCorrection(hostPlayerId: PlayerId, type: string, payload: Record<string, unknown>): { error?: string } {
    if (this.hostPlayerId !== hostPlayerId) return { error: "Only the host may perform this correction." };
    if (type === "releaseSeat") {
      const target = this.players.get(payload.playerId as PlayerId);
      if (!target) return { error: "Unknown seat." };
      if (target.connectionStatus === "connected") return { error: "That seat is currently connected." };
      target.connectionStatus = "disconnected";
      target.socketId = null;
      this.log_(`Host released ${target.name}'s seat.`, "host:releaseSeat", { playerId: target.id });
      this.touch();
      return {};
    }
    if (type === "undoLast") {
      return this.undoLast();
    }
    if (!this.game) return { error: "The game has not started." };
    if (type !== "advancePhase") this.snapshotForUndo();
    const result = applyHostCorrection(this.game, hostPlayerId, type, payload);
    this.touch();
    return result.ok ? {} : { error: result.error };
  }
}

// Plain-object (de)serialization for the one-level undo snapshot. Sets need
// special handling since JSON has no native Set type.
function serializeGameState(state: ServerGameState): unknown {
  return { ...state, board: { ...state.board, hexes: [...state.board.hexes] } };
}
function deserializeGameState(json: string): ServerGameState {
  const parsed = JSON.parse(json);
  return { ...parsed, board: { ...parsed.board, hexes: new Set(parsed.board.hexes) } };
}

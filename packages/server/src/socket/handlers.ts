import { Server, Socket } from "socket.io";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  MIN_PLAYERS,
  DEFAULT_VICTORY_CONDITION,
  DEFAULT_RESPONSE_TIMER_SEC,
  DEFAULT_PUSH_PULL_SIDEWAYS_ALLOWED,
} from "@fairy/shared";
import { RoomManager } from "../rooms/RoomManager";
import { Room } from "../rooms/Room";
import { buildPersonalizedView, clearEphemeralReveals } from "./sanitize";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;

type Seat = { roomCode: string; playerId: string };

const RECENT_ACTION_LIMIT = 300;

export function registerSocketHandlers(io: AppServer, rooms: RoomManager): void {
  const socketToSeat = new Map<string, Seat>();
  const recentActionIds = new Map<string, Set<string>>(); // roomCode -> recent actionIds (dedupe)

  function broadcast(room: Room): void {
    for (const player of room.players.values()) {
      if (!player.socketId) continue;
      const view = buildPersonalizedView(room, player.id);
      io.to(player.socketId).emit("state:update", view);
    }
    clearEphemeralReveals(room);
  }

  function seenAction(roomCode: string, actionId: string): boolean {
    let set = recentActionIds.get(roomCode);
    if (!set) {
      set = new Set();
      recentActionIds.set(roomCode, set);
    }
    if (set.has(actionId)) return true;
    set.add(actionId);
    if (set.size > RECENT_ACTION_LIMIT) {
      const first = set.values().next().value;
      if (first !== undefined) set.delete(first);
    }
    return false;
  }

  io.on("connection", (socket: AppSocket) => {
    socket.on("room:create", (payload, cb) => {
      try {
        const name = (payload.name ?? "").trim().slice(0, 40) || "Host";
        const config = {
          victoryCondition: payload.config?.victoryCondition ?? DEFAULT_VICTORY_CONDITION,
          disabledCardIds: Array.isArray(payload.config?.disabledCardIds) ? payload.config.disabledCardIds : [],
          firstPlayerRule: payload.config?.firstPlayerRule ?? "youngest",
          responseTimerSec: payload.config?.responseTimerSec ?? DEFAULT_RESPONSE_TIMER_SEC,
          pushPullSidewaysAllowed: payload.config?.pushPullSidewaysAllowed ?? DEFAULT_PUSH_PULL_SIDEWAYS_ALLOWED,
        };
        const { room, playerId, token } = rooms.createRoom(name, config);
        const player = room.players.get(playerId)!;
        player.socketId = socket.id;
        socketToSeat.set(socket.id, { roomCode: room.code, playerId });
        socket.join(room.code);
        cb({ ok: true, roomCode: room.code, playerId, reconnectToken: token });
        broadcast(room);
      } catch (err) {
        cb({ ok: false, error: (err as Error).message });
      }
    });

    socket.on("room:join", (payload, cb) => {
      const name = (payload.name ?? "").trim().slice(0, 40) || "Player";
      const birthYear = typeof payload.birthYear === "number" ? payload.birthYear : null;
      const result = rooms.joinRoom((payload.roomCode ?? "").trim().toUpperCase(), name, birthYear);
      if ("error" in result) return cb({ ok: false, error: result.error });
      const { room, playerId, token } = result;
      const player = room.players.get(playerId)!;
      player.socketId = socket.id;
      socketToSeat.set(socket.id, { roomCode: room.code, playerId });
      socket.join(room.code);
      cb({ ok: true, playerId, reconnectToken: token });
      broadcast(room);
    });

    socket.on("room:reconnect", (payload, cb) => {
      const result = rooms.reconnect(
        (payload.roomCode ?? "").trim().toUpperCase(),
        payload.playerId,
        payload.reconnectToken,
        socket.id
      );
      if ("error" in result) return cb({ ok: false, error: result.error });
      const { room } = result;
      socketToSeat.set(socket.id, { roomCode: room.code, playerId: payload.playerId });
      socket.join(room.code);
      cb({ ok: true });
      broadcast(room);
    });

    function withSeat(handler: (room: Room, playerId: string) => void) {
      const seat = socketToSeat.get(socket.id);
      if (!seat) return;
      const room = rooms.getRoom(seat.roomCode);
      if (!room) return;
      handler(room, seat.playerId);
    }

    socket.on("domain:select", (payload) => {
      withSeat((room, playerId) => {
        const result = room.selectDomain(playerId, payload.domainId);
        if (!result.error) broadcast(room);
        else socket.emit("room:error", { message: result.error });
      });
    });

    socket.on("lobby:setReady", (payload) => {
      withSeat((room, playerId) => {
        room.setReady(playerId, payload.ready);
        broadcast(room);
      });
    });

    socket.on("lobby:updateConfig", (payload) => {
      withSeat((room, playerId) => {
        if (room.hostPlayerId !== playerId) return socket.emit("room:error", { message: "Only the host may change settings." });
        const result = room.updateConfig(payload);
        if (!result.error) broadcast(room);
      });
    });

    socket.on("lobby:start", () => {
      withSeat((room, playerId) => {
        if (room.hostPlayerId !== playerId) return socket.emit("room:error", { message: "Only the host may start the game." });
        const check = room.canStart();
        if (!check.ok) return socket.emit("room:error", { message: check.reason ?? "Cannot start yet." });
        const result = room.startGame();
        if (result.error) return socket.emit("room:error", { message: result.error });
        broadcast(room);
      });
    });

    socket.on("action:submit", (payload) => {
      withSeat((room, playerId) => {
        if (seenAction(room.code, payload.actionId)) return; // idempotent no-op on retry
        if (room.game && payload.stateVersion !== room.version) {
          return socket.emit("action:rejected", { actionId: payload.actionId, reason: "Stale state version — refresh and try again." });
        }
        const result = room.submitAction(playerId, payload.type, payload.payload);
        if (result.error) return socket.emit("action:rejected", { actionId: payload.actionId, reason: result.error });
        broadcast(room);
      });
    });

    socket.on("interaction:respond", (payload) => {
      withSeat((room, playerId) => {
        if (seenAction(room.code, payload.actionId)) return;
        if (room.game && payload.stateVersion !== room.version) {
          return socket.emit("action:rejected", { actionId: payload.actionId, reason: "Stale state version — refresh and try again." });
        }
        const result = room.respondToInteraction(playerId, payload.interactionId, payload.payload);
        if (result.error) return socket.emit("action:rejected", { actionId: payload.actionId, reason: result.error });
        broadcast(room);
      });
    });

    socket.on("host:correction", (payload) => {
      withSeat((room, playerId) => {
        if (seenAction(room.code, payload.actionId)) return;
        const result = room.hostCorrection(playerId, payload.type, payload.payload);
        if (result.error) return socket.emit("action:rejected", { actionId: payload.actionId, reason: result.error });
        broadcast(room);
      });
    });

    socket.on("disconnect", () => {
      const seat = socketToSeat.get(socket.id);
      if (!seat) return;
      socketToSeat.delete(socket.id);
      const room = rooms.getRoom(seat.roomCode);
      if (!room) return;
      const player = room.players.get(seat.playerId);
      if (player && player.socketId === socket.id) {
        room.markDisconnected(seat.playerId);
        broadcast(room);
      }
    });
  });
}

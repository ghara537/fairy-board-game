import { PlayerId, ROOM_INACTIVITY_TIMEOUT_MS } from "@fairy/shared";
import { Room, RoomConfigState } from "./Room";
import { generateReconnectToken, hashReconnectToken, verifyReconnectToken } from "../reconnect/tokens";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid ambiguity

export class RoomManager {
  private rooms = new Map<string, Room>();

  private generateRoomCode(): string {
    let code: string;
    do {
      code = Array.from({ length: 6 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  createRoom(hostName: string, config: RoomConfigState): { room: Room; playerId: PlayerId; token: string } {
    const code = this.generateRoomCode();
    const token = generateReconnectToken();
    // Host is added as the room's first player once the Room exists, so it can own itself.
    const room = new Room(code, "", config);
    const player = room.addPlayer(hostName, null, hashReconnectToken(token));
    if ("error" in player) throw new Error(player.error); // cannot happen for the very first player
    room.hostPlayerId = player.id;
    this.rooms.set(code, room);
    return { room, playerId: player.id, token };
  }

  joinRoom(
    code: string,
    name: string,
    birthYear: number | null
  ): { room: Room; playerId: PlayerId; token: string } | { error: string } {
    const room = this.getRoom(code);
    if (!room) return { error: "Room not found." };
    const token = generateReconnectToken();
    const result = room.addPlayer(name, birthYear, hashReconnectToken(token));
    if ("error" in result) return { error: result.error };
    return { room, playerId: result.id, token };
  }

  reconnect(
    code: string,
    playerId: PlayerId,
    token: string,
    socketId: string
  ): { room: Room } | { error: string } {
    const room = this.getRoom(code);
    if (!room) return { error: "Room not found." };
    const player = room.players.get(playerId);
    if (!player) return { error: "Unknown seat." };
    if (player.connectionStatus === "connected" && player.socketId && player.socketId !== socketId) {
      return { error: "That seat is already connected elsewhere." };
    }
    if (!verifyReconnectToken(token, player.reconnectTokenHash)) return { error: "Invalid reconnect token." };
    room.reconnect(playerId, socketId);
    return { room };
  }

  removeRoom(code: string): void {
    this.rooms.delete(code.toUpperCase());
  }

  sweepInactiveRooms(): number {
    const now = Date.now();
    let removed = 0;
    for (const [code, room] of this.rooms.entries()) {
      const anyoneConnected = [...room.players.values()].some((p) => p.connectionStatus === "connected");
      if (!anyoneConnected && now - room.lastActivityAt > ROOM_INACTIVITY_TIMEOUT_MS) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }
}

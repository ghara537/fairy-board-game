import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@fairy/shared";

// In dev, Vite proxies /socket.io to the server (see vite.config.ts). In
// production the client is served BY the same Express server, so a relative
// URL (empty string = same origin) is correct there too.
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "";

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
});

/** Wraps a Socket.IO ack-style emit in a Promise for cleaner call sites. */
export function emitWithAck<T>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    (socket as any).emit(event, payload, (res: T) => resolve(res));
  });
}

let counter = 0;
/** Client-generated action IDs for idempotency (spec section 31) — monotonic-enough per tab session. */
export function newActionId(): string {
  counter += 1;
  return `act-${Date.now()}-${counter}-${Math.floor(Math.random() * 1e6)}`;
}

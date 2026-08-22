import { create } from "zustand";
import type { PersonalizedGameView } from "@fairy/shared";
import { socket } from "../socket";
import { saveSeatCredentials, loadSeatCredentials, SeatCredentials } from "./session";

export type Screen = "home" | "createRoom" | "joinRoom" | "rules" | "options" | "lobby" | "game" | "endGame";

type Toast = { id: number; message: string };

type AppState = {
  screen: Screen;
  view: PersonalizedGameView | null;
  socketConnected: boolean;
  seat: SeatCredentials | null;
  toasts: Toast[];
  // Set by tryAutoReconnect when a plain invite link (?room=CODE, no
  // credentials) is opened — JoinRoom.tsx prefills its room-code field from
  // this instead of making the pasted code useless busywork to retype.
  pendingRoomCode: string | null;
  setScreen: (screen: Screen) => void;
  pushToast: (message: string) => void;
  dismissToast: (id: number) => void;
  applyView: (view: PersonalizedGameView) => void;
  setSeat: (seat: SeatCredentials) => void;
  tryAutoReconnect: () => void;
  reconnectWithSeat: (seat: SeatCredentials) => void;
};

let toastCounter = 0;

export const useAppStore = create<AppState>((set, get) => ({
  screen: "home",
  view: null,
  socketConnected: socket.connected,
  seat: null,
  toasts: [],
  pendingRoomCode: null,

  setScreen: (screen) => set({ screen }),

  pushToast: (message) => {
    toastCounter += 1;
    const id = toastCounter;
    set((s) => ({ toasts: [...s.toasts, { id, message }] }));
    setTimeout(() => get().dismissToast(id), 6000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  applyView: (view) => {
    set((s) => {
      let screen = s.screen;
      if (view.phase === "lobby") screen = "lobby";
      else if (view.phase === "game-over") screen = "endGame";
      else screen = "game";
      return { view, screen };
    });
  },

  setSeat: (seat) => {
    saveSeatCredentials(seat);
    set({ seat });
  },

  reconnectWithSeat: (seat) => {
    set({ seat });
    attemptReconnect(seat, get, set);
  },

  tryAutoReconnect: () => {
    const url = new URL(window.location.href);
    const roomFromUrl = url.searchParams.get("room");
    if (!roomFromUrl) return;
    const roomCode = roomFromUrl.toUpperCase();
    // A personal rejoin link (?room=&player=&token=) carries its own
    // credentials — it works on any device, unlike the plain invite link,
    // which only helps a new player join and relies on this browser already
    // having saved credentials from an earlier visit.
    const playerFromUrl = url.searchParams.get("player");
    const tokenFromUrl = url.searchParams.get("token");
    const fromUrl: SeatCredentials | null =
      playerFromUrl && tokenFromUrl ? { roomCode, playerId: playerFromUrl, reconnectToken: tokenFromUrl } : null;
    const saved = fromUrl ?? loadSeatCredentials(roomCode);
    if (!saved) {
      // No way to auto-reconnect (a plain invite link, or credentials this
      // browser never had) — take them straight to Join Room instead of
      // dropping the pasted code on the floor.
      set({ pendingRoomCode: roomCode, screen: "joinRoom" });
      return;
    }
    if (fromUrl) saveSeatCredentials(fromUrl); // seed this browser too, so it works next time without the link
    set({ seat: saved });
    // Unlike reconnectWithSeat (used for a mid-session network blip, where
    // we should just retry quietly), a failure on this very first attempt
    // means the saved seat is actually unusable right now — always leave
    // the player somewhere they can act, not stuck on Home with a toast.
    attemptReconnect(saved, get, set, () => {
      set({ seat: null, pendingRoomCode: roomCode, screen: "joinRoom" });
    });
  },
}));

/** Shared by reconnectWithSeat and tryAutoReconnect. `onFailure`, if given, runs in addition to the error toast. */
function attemptReconnect(
  seat: SeatCredentials,
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  onFailure?: () => void
): void {
  socket.emit(
    "room:reconnect",
    { roomCode: seat.roomCode, playerId: seat.playerId, reconnectToken: seat.reconnectToken },
    (res: any) => {
      if (!res.ok) {
        const message: string = res.error ?? "";
        get().pushToast(
          message.includes("already connected elsewhere")
            ? "This seat is already active in another tab or device — close it, then reload this page to reclaim your seat."
            : `Could not reconnect: ${message}`
        );
        onFailure?.();
      }
    }
  );
}

// True once the socket has connected at least once — distinguishes the very
// first connection (tryAutoReconnect already handles that case) from a real
// reconnection after a drop (network blip, server restart), which is the
// only time this handler itself should retry — otherwise both fire on page
// load and every failure gets reported twice.
let hasConnectedBefore = false;
socket.on("connect", () => {
  useAppStore.setState({ socketConnected: true });
  if (hasConnectedBefore) {
    const seat = useAppStore.getState().seat;
    if (seat) useAppStore.getState().reconnectWithSeat(seat);
  }
  hasConnectedBefore = true;
});
socket.on("disconnect", () => useAppStore.setState({ socketConnected: false }));
socket.on("state:update", (view) => useAppStore.getState().applyView(view));
socket.on("room:error", (info) => useAppStore.getState().pushToast(info.message));
socket.on("action:rejected", (info) => useAppStore.getState().pushToast(`Action rejected: ${info.reason}`));

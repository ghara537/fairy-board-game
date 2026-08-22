// Reconnect-credential persistence (spec section 3). A secure cookie is
// preferred; since this is a static client with no server-rendered response
// to attach a Set-Cookie header to at join time, we set a first-party,
// non-httpOnly cookie ourselves (still `Secure; SameSite=Lax` on https) and
// fall back to localStorage if cookies are unavailable (e.g. some embedded
// dev contexts). Either way the token never leaves the browser except back
// to this same server over the socket connection.

export type SeatCredentials = { roomCode: string; playerId: string; reconnectToken: string };

const COOKIE_PREFIX = "fairy_seat_";
const STORAGE_PREFIX = "fairy_seat_";

function cookiesAvailable(): boolean {
  try {
    return typeof document !== "undefined" && typeof document.cookie === "string";
  } catch {
    return false;
  }
}

export function saveSeatCredentials(creds: SeatCredentials): void {
  const value = encodeURIComponent(JSON.stringify(creds));
  if (cookiesAvailable()) {
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "Secure; " : "";
    document.cookie = `${COOKIE_PREFIX}${creds.roomCode}=${value}; Max-Age=${60 * 60 * 24 * 7}; Path=/; SameSite=Lax; ${secure}`;
  }
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${creds.roomCode}`, value);
  } catch {
    // localStorage may be unavailable (private mode) — the cookie fallback above still covers it when cookies work.
  }
}

function readCookie(roomCode: string): SeatCredentials | null {
  if (!cookiesAvailable()) return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_PREFIX}${roomCode}=([^;]*)`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function readStorage(roomCode: string): SeatCredentials | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${roomCode}`);
    return raw ? JSON.parse(decodeURIComponent(raw)) : null;
  } catch {
    return null;
  }
}

export function loadSeatCredentials(roomCode: string): SeatCredentials | null {
  return readCookie(roomCode) ?? readStorage(roomCode);
}

export function clearSeatCredentials(roomCode: string): void {
  if (cookiesAvailable()) {
    document.cookie = `${COOKIE_PREFIX}${roomCode}=; Max-Age=0; Path=/`;
  }
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${roomCode}`);
  } catch {
    /* ignore */
  }
}

/**
 * A personal, private link that reclaims exactly this seat — carries the
 * reconnect token in the URL itself, so it works even on a browser/device
 * with no saved credentials (unlike the plain `?room=CODE` invite link,
 * which only helps a NEW player join). Whoever holds this link controls
 * the seat, so it's meant for the player to save for themselves, not to
 * share — never merge it into the general invite link.
 */
export function buildRejoinUrl(creds: SeatCredentials): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("room", creds.roomCode);
  url.searchParams.set("player", creds.playerId);
  url.searchParams.set("token", creds.reconnectToken);
  return url.toString();
}

/** Scans localStorage for any saved seat (used on app load to offer "rejoin your last game"). */
export function findAnySavedSeat(): SeatCredentials | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(decodeURIComponent(raw));
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

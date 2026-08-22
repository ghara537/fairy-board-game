import React, { useEffect } from "react";
import { useAppStore } from "./state/store";
import { buildRejoinUrl } from "./state/session";
import { Home } from "./screens/Home";
import { CreateRoom } from "./screens/CreateRoom";
import { JoinRoom } from "./screens/JoinRoom";
import { Rules } from "./screens/Rules";
import { Options } from "./screens/Options";
import { Lobby } from "./screens/Lobby";
import { GameScreen } from "./screens/GameScreen";
import { EndGame } from "./screens/EndGame";

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const socketConnected = useAppStore((s) => s.socketConnected);
  const seat = useAppStore((s) => s.seat);
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const tryAutoReconnect = useAppStore((s) => s.tryAutoReconnect);
  const pushToast = useAppStore((s) => s.pushToast);

  useEffect(() => {
    tryAutoReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copyRejoinLink() {
    if (!seat) return;
    const url = buildRejoinUrl(seat);
    navigator.clipboard?.writeText(url).then(
      () => pushToast("Rejoin link copied — save it somewhere private. Anyone with it can control your seat."),
      () => pushToast(url)
    );
  }

  return (
    <div className={`app-shell${screen === "game" ? " app-shell-wide" : ""}`}>
      {!socketConnected && (
        <div className="prompt-banner" style={{ marginBottom: 12 }}>
          Connecting to server… If this persists, your connection was lost — we'll rejoin your seat automatically once
          it's back.
        </div>
      )}

      {seat && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
          <button className="secondary small" onClick={copyRejoinLink} title="A private link that reclaims this exact seat, even from another device.">
            🔗 Copy my rejoin link
          </button>
        </div>
      )}

      {screen === "home" && <Home />}
      {screen === "createRoom" && <CreateRoom />}
      {screen === "joinRoom" && <JoinRoom />}
      {screen === "rules" && <Rules />}
      {screen === "options" && <Options />}
      {screen === "lobby" && <Lobby />}
      {screen === "game" && <GameScreen />}
      {screen === "endGame" && <EndGame />}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast" onClick={() => dismissToast(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

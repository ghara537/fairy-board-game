import React, { useEffect } from "react";
import { useAppStore } from "./state/store";
import { Home } from "./screens/Home";
import { CreateRoom } from "./screens/CreateRoom";
import { JoinRoom } from "./screens/JoinRoom";
import { Rules } from "./screens/Rules";
import { Options } from "./screens/Options";
import { Lobby } from "./screens/Lobby";
import { GameScreen } from "./screens/GameScreen";
import { EndGame } from "./screens/EndGame";
import { CopyRejoinLinkButton } from "./components/CopyRejoinLinkButton";
import { useCompactLayout } from "./mobile/useCompactLayout";

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const socketConnected = useAppStore((s) => s.socketConnected);
  const seat = useAppStore((s) => s.seat);
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const tryAutoReconnect = useAppStore((s) => s.tryAutoReconnect);
  const compact = useCompactLayout();

  useEffect(() => {
    tryAutoReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The compact game screen is a fixed, full-viewport layout that supplies its
  // own chrome — the shell's padding and header row would only sit uselessly
  // underneath it. Its rejoin link moves into the dock's More sheet.
  const compactGame = compact && screen === "game";

  return (
    <div className={`app-shell${screen === "game" ? " app-shell-wide" : ""}${compactGame ? " app-shell-bare" : ""}`}>
      {!socketConnected && (
        <div className={`prompt-banner${compactGame ? " connection-banner" : ""}`} style={compactGame ? undefined : { marginBottom: 12 }}>
          Connecting to server… If this persists, your connection was lost — we'll rejoin your seat automatically once
          it's back.
        </div>
      )}

      {seat && !compactGame && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
          <CopyRejoinLinkButton />
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

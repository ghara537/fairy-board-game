import React from "react";
import { useAppStore } from "../state/store";

export function Home() {
  const setScreen = useAppStore((s) => s.setScreen);
  return (
    <div className="home-hero">
      <h1>Fairy Domains</h1>
      <p className="text-dim">A live, server-authoritative multiplayer fantasy board game. 2–6 players.</p>
      <div className="home-actions">
        <button onClick={() => setScreen("createRoom")}>Create Room</button>
        <button className="secondary" onClick={() => setScreen("joinRoom")}>
          Join Room
        </button>
        <button className="secondary" onClick={() => setScreen("rules")}>
          Rules Summary
        </button>
        <button className="secondary" onClick={() => setScreen("options")}>
          Options
        </button>
      </div>
    </div>
  );
}

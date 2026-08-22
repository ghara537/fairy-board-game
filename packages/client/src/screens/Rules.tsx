import React from "react";
import { useAppStore } from "../state/store";

export function Rules() {
  const setScreen = useAppStore((s) => s.setScreen);
  return (
    <div className="stack" style={{ maxWidth: 720, margin: "20px auto" }}>
      <div className="card-panel stack">
        <h2>Rules Summary</h2>
        <ul>
          <li>2–6 players. Each controls one unique Fairy Domain.</li>
          <li>On your turn you get 2 actions: place a lure, play an Enchantment, use a Domain ability, or discard-and-draw (once per turn).</li>
          <li>After your turn you draw one Enchantment; play passes clockwise.</li>
          <li>Once every player has acted, the Human Movement Phase runs: Humans walk one step toward their closest reachable lure (by shortest legal path, not straight-line distance).</li>
          <li>If a Human is equally close to two or more lures, it's confused and doesn't move that phase.</li>
          <li>Reaching a lure clears it and collects the Human for the lure's owner.</li>
          <li>Trees, Stones, and Toadstools block movement and pathfinding. At most 2 Toadstools may be on the board.</li>
          <li>Acceleration markers grant bonus movement only when a Human moves onto them — not if it starts there.</li>
          <li>Instants can be played in response to almost anything, in strict player-priority order — no race conditions.</li>
          <li>First to the mode's target score wins: Blitz 8, Standard 11, Endurance 14.</li>
        </ul>
        <button className="secondary" onClick={() => setScreen("home")}>
          Back
        </button>
      </div>
    </div>
  );
}

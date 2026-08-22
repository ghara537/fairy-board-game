import React from "react";
import { HUMAN_DEFINITIONS_BY_ID } from "@fairy/shared";
import { useAppStore } from "../state/store";
import { GameLog } from "../components/GameLog";
import { computePlayerColors } from "../playerColors";

export function EndGame() {
  const view = useAppStore((s) => s.view);
  const setScreen = useAppStore((s) => s.setScreen);
  if (!view) return null;
  const colors = computePlayerColors(view);
  const winner = view.players.find((p) => p.id === view.winnerId);
  const drawPlayers = view.drawPlayerIds ? view.players.filter((p) => view.drawPlayerIds!.includes(p.id)) : null;

  return (
    <div className="stack" style={{ maxWidth: 900, margin: "20px auto" }}>
      <div className="card-panel" style={{ textAlign: "center" }}>
        {drawPlayers ? (
          <>
            <h1>🤝 Tie game</h1>
            <p className="text-dim">
              {drawPlayers.map((p) => p.name).join(" and ")} finished tied — even the nearest-townsfolk tiebreak
              couldn't separate them.
            </p>
          </>
        ) : (
          <>
            <h1>🏆 {winner?.name ?? "Someone"} wins!</h1>
            <p className="text-dim">Final score: {winner?.score}</p>
          </>
        )}
      </div>

      <div className="card-panel">
        <h3>Final Scores</h3>
        <table className="score-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Domain</th>
              <th>Score</th>
              <th>Collected Humans</th>
            </tr>
          </thead>
          <tbody>
            {[...view.players]
              .sort((a, b) => b.score - a.score)
              .map((p) => (
                <tr key={p.id}>
                  <td style={{ color: colors[p.id] }}>{p.name}</td>
                  <td className="small">{p.domainId}</td>
                  <td>{p.score}</td>
                  <td className="small">
                    {p.collectedHumanIds.map((id) => HUMAN_DEFINITIONS_BY_ID[id]?.name ?? id).join(", ") || "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="card-panel">
        <h3>Complete Game Log</h3>
        <GameLog log={view.log} />
      </div>

      <div className="row">
        <button onClick={() => setScreen("home")}>Return to Home</button>
      </div>
    </div>
  );
}

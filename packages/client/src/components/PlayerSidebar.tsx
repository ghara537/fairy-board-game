import React from "react";
import type { DomainId, PersonalizedGameView, PlayerId } from "@fairy/shared";
import { describeVictoryCondition } from "../victoryConditionLabel";

export function PlayerSidebar({
  view,
  playerColors,
  onViewDomainMat,
}: {
  view: PersonalizedGameView;
  playerColors: Record<PlayerId, string>;
  onViewDomainMat?: (domainId: DomainId) => void;
}) {
  return (
    <div className="stack">
      <div className="card-panel">
        <h3>Turn Order</h3>
        <div className="turn-order-strip">
          {view.turnOrder.map((id) => {
            const p = view.players.find((pp) => pp.id === id);
            return (
              <span
                key={id}
                className={`turn-order-chip${id === view.activePlayerId ? " active" : ""}${id === view.firstPlayerId ? " first" : ""}`}
                style={{ borderColor: playerColors[id] }}
              >
                {p?.name ?? id}
                {id === view.firstPlayerId ? " ★" : ""}
              </span>
            );
          })}
        </div>
        <div className="small text-dim" style={{ marginTop: 6 }}>
          Round {view.round}
          {view.config.victoryCondition.kind === "turns" ? ` of ${view.config.victoryCondition.turnLimit}` : ""} · Human-spawn
          indicator next: <strong>{view.board?.spawnIndicator ?? "—"}</strong>
        </div>
      </div>

      <div className="card-panel">
        <h3>Scores</h3>
        <table className="score-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Domain</th>
              <th>Score</th>
              <th>Hand</th>
            </tr>
          </thead>
          <tbody>
            {[...view.players]
              .sort((a, b) => b.score - a.score)
              .map((p) => (
                <tr key={p.id}>
                  <td style={{ color: playerColors[p.id] }}>{p.name}</td>
                  <td
                    className="small"
                    style={p.domainId && onViewDomainMat ? { cursor: "pointer", textDecoration: "underline dotted" } : undefined}
                    title={p.domainId && onViewDomainMat ? "View full player mat" : undefined}
                    onClick={() => p.domainId && onViewDomainMat?.(p.domainId)}
                  >
                    {p.domainId}
                  </td>
                  <td>{p.score}</td>
                  <td className="small">{p.handCount}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="small text-dim">{describeVictoryCondition(view.config.victoryCondition)}</div>
      </div>
    </div>
  );
}

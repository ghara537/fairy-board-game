import React, { useState } from "react";
import type { DomainId, PersonalizedGameView, PlayerId } from "@fairy/shared";
import { DOMAIN_DEFINITIONS_BY_ID } from "@fairy/shared";
import { DOMAIN_ABBR, PHASE_LABELS, playerInitials } from "../abbreviations";
import { describeVictoryCondition } from "../victoryConditionLabel";
import { InfoPopup } from "./InfoPopup";

/** The whole of the compact layout's persistent chrome above the board:
 * round, phase, one chip per player, and the spawn indicator — every one of
 * them an abbreviation that taps open to its full meaning. */
export function CompactTopBar({
  view,
  playerColors,
  onViewDomainMat,
  showRotateNudge,
  actionsRemaining,
  boardZoom,
  onCycleZoom,
}: {
  view: PersonalizedGameView;
  playerColors: Record<PlayerId, string>;
  onViewDomainMat: (domainId: DomainId) => void;
  showRotateNudge: boolean;
  /** Actions left this turn, or null when it isn't your turn. */
  actionsRemaining: number | null;
  boardZoom: number;
  onCycleZoom: () => void;
}) {
  const [popup, setPopup] = useState<"status" | "spawn" | "rotate" | { player: PlayerId } | null>(null);
  const phase = PHASE_LABELS[view.phase];
  const roundLimit = view.config.victoryCondition.kind === "turns" ? view.config.victoryCondition.turnLimit : null;
  const popupPlayer = popup && typeof popup === "object" ? view.players.find((p) => p.id === popup.player) ?? null : null;

  return (
    <div className="compact-topbar">
      <button className="chip chip-strong" onClick={() => setPopup("status")} title="Round, phase and victory condition">
        R{view.round}
        {roundLimit ? `/${roundLimit}` : ""} · {phase.abbr}
      </button>

      <div className="chip-row">
        {view.turnOrder.map((id) => {
          const p = view.players.find((pp) => pp.id === id);
          if (!p) return null;
          const active = id === view.activePlayerId;
          return (
            <button
              key={id}
              className={`chip chip-player${active ? " active" : ""}${id === view.yourPlayerId ? " mine" : ""}`}
              style={{ borderColor: playerColors[id] }}
              onClick={() => setPopup({ player: id })}
              title={p.name}
            >
              <span className="chip-swatch" style={{ background: playerColors[id] }} />
              {playerInitials(p.name)}
              {id === view.firstPlayerId ? "★" : ""}
              <span className="chip-score">{p.score}</span>
            </button>
          );
        })}
      </div>

      <button className="chip" onClick={() => setPopup("spawn")} title="Which Portal spawn set arrives next">
        ⧉{view.board?.spawnIndicator ?? "—"}
      </button>

      {actionsRemaining !== null && (
        <span className="chip chip-strong" title="Actions left this turn">
          {actionsRemaining} act
        </span>
      )}

      {/* Zoom lives up here with the other board-wide status: it belongs to
          the board, not to any one control panel. */}
      <button
        className="chip chip-zoom"
        onClick={onCycleZoom}
        title="Zoom the board — the board area scrolls when it's larger than its pane"
      >
        {boardZoom}×
      </button>

      {showRotateNudge && (
        <button className="chip chip-warn" onClick={() => setPopup("rotate")} title="Turn your phone sideways">
          ⟳
        </button>
      )}

      {popup === "status" && (
        <InfoPopup title="Game status" onClose={() => setPopup(null)}>
          <dl className="kv">
            <dt>Round</dt>
            <dd>
              {view.round}
              {roundLimit ? ` of ${roundLimit}` : ""}
            </dd>
            <dt>Phase</dt>
            <dd>{phase.full}</dd>
            <dt>To win</dt>
            <dd>{describeVictoryCondition(view.config.victoryCondition)}</dd>
            <dt>Room</dt>
            <dd>{view.roomCode}</dd>
          </dl>
          <table className="score-table" style={{ marginTop: 10 }}>
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
                    <td className="small">{p.domainId ? DOMAIN_DEFINITIONS_BY_ID[p.domainId]?.name ?? p.domainId : "—"}</td>
                    <td>{p.score}</td>
                    <td className="small">{p.handCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </InfoPopup>
      )}

      {popup === "spawn" && (
        <InfoPopup title={`Spawn set ${view.board?.spawnIndicator ?? "—"}`} onClose={() => setPopup(null)}>
          <p className="small">
            The next batch of Humans steps out of the Portal onto the ring hexes marked{" "}
            <strong>{view.board?.spawnIndicator ?? "—"}</strong> on the board. The indicator alternates between sets A and
            B each round.
          </p>
        </InfoPopup>
      )}

      {popup === "rotate" && (
        <InfoPopup title="Turn your phone sideways" onClose={() => setPopup(null)}>
          <p className="small">
            The board is a wide hexagon — held sideways it renders roughly twice as large, and every hex becomes a
            comfortable tap target. Everything works upright too, just smaller.
          </p>
        </InfoPopup>
      )}

      {popupPlayer && (
        <InfoPopup title={popupPlayer.name} onClose={() => setPopup(null)}>
          <dl className="kv">
            <dt>Domain</dt>
            <dd>
              {popupPlayer.domainId
                ? `${DOMAIN_DEFINITIONS_BY_ID[popupPlayer.domainId]?.name ?? popupPlayer.domainId} (${
                    DOMAIN_ABBR[popupPlayer.domainId] ?? "—"
                  })`
                : "Not chosen"}
            </dd>
            <dt>Score</dt>
            <dd>{popupPlayer.score}</dd>
            <dt>Hand</dt>
            <dd>{popupPlayer.handCount} card(s)</dd>
            <dt>Abilities left</dt>
            <dd>{popupPlayer.abilitiesUsed.filter((u) => !u).length} of 3</dd>
            <dt>Connection</dt>
            <dd>{popupPlayer.connectionStatus}</dd>
            <dt>Turn</dt>
            <dd>
              {popupPlayer.id === view.activePlayerId ? "Active now" : "Waiting"}
              {popupPlayer.id === view.firstPlayerId ? " · first player ★" : ""}
            </dd>
          </dl>
          {popupPlayer.domainId && (
            <button
              className="secondary"
              style={{ marginTop: 10, width: "100%" }}
              onClick={() => {
                onViewDomainMat(popupPlayer.domainId!);
                setPopup(null);
              }}
            >
              View full player mat
            </button>
          )}
        </InfoPopup>
      )}
    </div>
  );
}

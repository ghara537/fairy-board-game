import React from "react";
import { DOMAIN_DEFINITIONS } from "@fairy/shared";
import { socket } from "../socket";
import { useAppStore } from "../state/store";
import { buildRejoinUrl } from "../state/session";
import { describeVictoryCondition } from "../victoryConditionLabel";

export function Lobby() {
  const view = useAppStore((s) => s.view);
  const seat = useAppStore((s) => s.seat);
  const pushToast = useAppStore((s) => s.pushToast);

  if (!view || !seat) return <div className="card-panel">Loading room…</div>;

  const me = view.players.find((p) => p.id === view.yourPlayerId);
  const isHost = view.hostPlayerId === view.yourPlayerId;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${view.roomCode}`;

  function selectDomain(domainId: string) {
    socket.emit("domain:select", { domainId: domainId as any });
  }
  function toggleReady() {
    socket.emit("lobby:setReady", { ready: !me?.ready });
  }
  function startGame() {
    socket.emit("lobby:start");
  }
  function copyInvite() {
    navigator.clipboard?.writeText(inviteUrl).then(
      () => pushToast("Invite link copied!"),
      () => pushToast(inviteUrl)
    );
  }
  function copyRejoinLink() {
    if (!seat) return;
    const url = buildRejoinUrl(seat);
    navigator.clipboard?.writeText(url).then(
      () => pushToast("Your personal rejoin link is copied — keep it private, it lets whoever has it control your seat."),
      () => pushToast(url)
    );
  }

  const canStart =
    view.players.length >= 2 && view.players.every((p) => p.domainId) && view.players.every((p) => p.ready);

  return (
    <div className="stack" style={{ maxWidth: 900, margin: "20px auto" }}>
      <div className="card-panel spread">
        <div>
          <div className="text-dim small">ROOM CODE</div>
          <div className="room-code">{view.roomCode}</div>
        </div>
        <div className="row">
          <button className="secondary" onClick={copyInvite}>
            Copy Invitation Link
          </button>
          <button className="secondary" onClick={copyRejoinLink} title="A private link that reclaims this exact seat, even from another device — different from the invite link above.">
            Copy My Rejoin Link
          </button>
        </div>
      </div>

      <div className="row" style={{ alignItems: "stretch" }}>
        <div className="card-panel stack" style={{ flex: 1, minWidth: 260 }}>
          <h3>Players</h3>
          <ul className="player-list">
            {view.players.map((p) => (
              <li key={p.id} className="player-row">
                <span className={`status-dot status-${p.connectionStatus}`} title={p.connectionStatus} />
                <span style={{ flex: 1 }}>
                  {p.name} {p.isHost && <span className="text-dim small">(host)</span>}
                </span>
                <span className="small text-dim">{p.domainId ?? "no Domain yet"}</span>
                <span className="small">{p.ready ? "✅ ready" : "…"}</span>
              </li>
            ))}
          </ul>
          <div className="row">
            <button onClick={toggleReady}>{me?.ready ? "Unready" : "I'm Ready"}</button>
            {isHost && (
              <button disabled={!canStart} onClick={startGame} title={canStart ? "" : "Need 2+ players, all with a Domain, all ready"}>
                Start Game
              </button>
            )}
          </div>
          <div className="small text-dim">
            Victory: {describeVictoryCondition(view.config.victoryCondition)} · Starting player:{" "}
            {view.config.firstPlayerRule === "youngest" ? "youngest player" : "previous winner"} · Response timer:{" "}
            {view.config.responseTimerSec ? `${view.config.responseTimerSec}s` : "none"} · Push/pull sideways:{" "}
            {view.config.pushPullSidewaysAllowed ? "allowed" : "not allowed"}
          </div>
        </div>

        <div className="card-panel stack" style={{ flex: 2, minWidth: 320 }}>
          <h3>Select your Fairy Domain</h3>
          <div className="domain-grid">
            {DOMAIN_DEFINITIONS.map((d) => {
              const owner = view.players.find((p) => p.domainId === d.id);
              const taken = Boolean(owner) && owner!.id !== view.yourPlayerId;
              const mine = owner?.id === view.yourPlayerId;
              return (
                <div
                  key={d.id}
                  className={`domain-card${taken ? " taken" : ""}${mine ? " mine" : ""}`}
                  onClick={() => !taken && selectDomain(d.id)}
                >
                  <h4>{d.name}</h4>
                  <div className="small text-dim">{d.description}</div>
                  {owner && <div className="small" style={{ marginTop: 6 }}>Selected by {owner.name}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from "react";
import type { PersonalizedGameView } from "@fairy/shared";
import { socket, newActionId } from "../socket";

export function HostPanel({ view }: { view: PersonalizedGameView }) {
  const [open, setOpen] = useState(false);
  const disconnected = view.players.filter((p) => p.connectionStatus === "disconnected");

  function send(type: string, payload: Record<string, unknown> = {}) {
    socket.emit("host:correction", { actionId: newActionId(), type: type as any, payload });
  }

  return (
    <div className="card-panel">
      <div className="spread" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
        <h3 style={{ margin: 0 }}>Host Tools</h3>
        <span className="text-dim small">{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="small text-dim">Only the host may perform these corrections. Every use is logged.</div>
          {disconnected.length > 0 ? (
            disconnected.map((p) => (
              <button key={p.id} className="secondary" onClick={() => send("releaseSeat", { playerId: p.id })}>
                Release {p.name}'s seat
              </button>
            ))
          ) : (
            <div className="small text-dim">No abandoned seats.</div>
          )}
          <button className="secondary" onClick={() => send("advancePhase")}>
            Advance a stuck phase
          </button>
          <button className="secondary" onClick={() => send("undoLast")}>
            Undo most recent action
          </button>
        </div>
      )}
    </div>
  );
}

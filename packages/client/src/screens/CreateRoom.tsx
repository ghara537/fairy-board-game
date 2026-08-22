import React, { useState } from "react";
import { socket } from "../socket";
import { useAppStore } from "../state/store";
import { loadGameOptions } from "../state/gameOptions";
import { describeVictoryCondition } from "../victoryConditionLabel";

export function CreateRoom() {
  const setScreen = useAppStore((s) => s.setScreen);
  const setSeat = useAppStore((s) => s.setSeat);
  const pushToast = useAppStore((s) => s.pushToast);
  const [name, setName] = useState("");
  const [firstPlayerRule, setFirstPlayerRule] = useState<"youngest" | "previousWinner">("youngest");
  const [responseTimerSec, setResponseTimerSec] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  const options = loadGameOptions();
  const disabledCount = options.disabledCardIds.length;

  function submit() {
    if (!name.trim()) return pushToast("Enter a display name first.");
    setBusy(true);
    socket.emit(
      "room:create",
      {
        name: name.trim(),
        config: {
          victoryCondition: options.victoryCondition,
          disabledCardIds: options.disabledCardIds,
          firstPlayerRule,
          responseTimerSec: responseTimerSec === "" ? null : Number(responseTimerSec),
          pushPullSidewaysAllowed: options.pushPullSidewaysAllowed,
        },
      },
      (res: any) => {
        setBusy(false);
        if (!res.ok) return pushToast(res.error);
        setSeat({ roomCode: res.roomCode, playerId: res.playerId, reconnectToken: res.reconnectToken });
        const url = new URL(window.location.href);
        url.searchParams.set("room", res.roomCode);
        window.history.replaceState({}, "", url.toString());
        setScreen("lobby");
      }
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 480, margin: "40px auto" }}>
      <div className="card-panel stack">
        <h2>Create a Room</h2>
        <label>
          Your display name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Robin" style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label>
          Starting player rule
          <select
            value={firstPlayerRule}
            onChange={(e) => setFirstPlayerRule(e.target.value as any)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          >
            <option value="youngest">Youngest player</option>
            <option value="previousWinner">Winner of the previous game (falls back to youngest)</option>
          </select>
        </label>
        <label>
          Instant-response timer (seconds, optional)
          <input
            type="number"
            min={0}
            value={responseTimerSec}
            onChange={(e) => setResponseTimerSec(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="No timer — wait for everyone"
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <div className="card-panel small" style={{ background: "var(--panel-2)" }}>
          <div>
            <strong>Victory condition:</strong> {describeVictoryCondition(options.victoryCondition)}
          </div>
          <div>
            <strong>Disabled cards:</strong> {disabledCount === 0 ? "none" : disabledCount}
          </div>
          <div>
            <strong>Push/pull sideways:</strong> {options.pushPullSidewaysAllowed ? "allowed" : "not allowed"}
          </div>
          <button className="link-like" onClick={() => setScreen("options")} style={{ marginTop: 4 }}>
            Change in Options
          </button>
        </div>
        <div className="row">
          <button disabled={busy} onClick={submit}>
            {busy ? "Creating…" : "Create Room"}
          </button>
          <button className="secondary" onClick={() => setScreen("home")}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

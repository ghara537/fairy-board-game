import React, { useState } from "react";
import { socket } from "../socket";
import { useAppStore } from "../state/store";

export function JoinRoom() {
  const setScreen = useAppStore((s) => s.setScreen);
  const setSeat = useAppStore((s) => s.setSeat);
  const pushToast = useAppStore((s) => s.pushToast);
  const pendingRoomCode = useAppStore((s) => s.pendingRoomCode);
  const [roomCode, setRoomCode] = useState(pendingRoomCode ?? "");
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  function submit() {
    if (!roomCode.trim()) return pushToast("Enter a room code.");
    if (!name.trim()) return pushToast("Enter a display name.");
    setBusy(true);
    socket.emit(
      "room:join",
      { roomCode: roomCode.trim().toUpperCase(), name: name.trim(), birthYear: birthYear === "" ? undefined : Number(birthYear) },
      (res: any) => {
        setBusy(false);
        if (!res.ok) return pushToast(res.error);
        const code = roomCode.trim().toUpperCase();
        setSeat({ roomCode: code, playerId: res.playerId, reconnectToken: res.reconnectToken });
        const url = new URL(window.location.href);
        url.searchParams.set("room", code);
        window.history.replaceState({}, "", url.toString());
        setScreen("lobby");
      }
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 480, margin: "40px auto" }}>
      <div className="card-panel stack">
        <h2>Join a Room</h2>
        <label>
          Room code
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="e.g. ABCDEF"
            style={{ display: "block", width: "100%", marginTop: 4, textTransform: "uppercase" }}
          />
        </label>
        <label>
          Your display name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label>
          Birth year <span className="text-dim small">(only needed if the group uses the youngest-player rule)</span>
          <input
            type="number"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="e.g. 1994"
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <div className="row">
          <button disabled={busy} onClick={submit}>
            {busy ? "Joining…" : "Join Room"}
          </button>
          <button className="secondary" onClick={() => setScreen("home")}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

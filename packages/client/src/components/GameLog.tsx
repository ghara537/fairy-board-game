import React from "react";
import type { LogEntry } from "@fairy/shared";

export function GameLog({ log }: { log: LogEntry[] }) {
  const recent = [...log].slice(-150).reverse();
  return (
    <div className="log-panel">
      {recent.map((entry) => (
        <div key={entry.id} className="log-entry">
          {entry.text}
        </div>
      ))}
      {recent.length === 0 && <div className="text-dim small">No events yet.</div>}
    </div>
  );
}

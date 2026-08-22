import React from "react";
import type { PublicEffectStackItem } from "@fairy/shared";

export function ResponseStackPanel({
  items,
  selectable,
  onSelect,
}: {
  items: PublicEffectStackItem[];
  selectable?: boolean;
  onSelect?: (id: string) => void;
}) {
  if (items.length === 0) return <div className="text-dim small">Nothing pending.</div>;
  return (
    <div>
      {[...items].reverse().map((item) => (
        <div
          key={item.id}
          className={`response-stack-item${item.status === "canceled" ? " canceled" : ""}`}
          onClick={() => selectable && item.status === "pending" && onSelect?.(item.id)}
          style={selectable && item.status === "pending" ? { cursor: "pointer", outline: "1px dashed #f2c14e" } : undefined}
        >
          <strong>{item.name}</strong> <span className="text-dim">({item.kind === "card" ? "Enchantment" : "Domain ability"})</span>
          <div className="small text-dim">by {item.sourcePlayerId} · {item.status}</div>
        </div>
      ))}
    </div>
  );
}

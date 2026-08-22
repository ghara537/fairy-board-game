import React from "react";
import { ENCHANTMENT_DEFINITIONS_BY_ID } from "@fairy/shared";

export function HandPanel({
  hand,
  mode,
  instantOnly,
  selectedCardId,
  onPick,
}: {
  hand: { id: string; name: string; timing: string; actionCost: number }[];
  mode: "disabled" | "pickAny" | "pickInstant";
  instantOnly?: boolean;
  selectedCardId?: string | null;
  onPick: (cardId: string) => void;
}) {
  if (hand.length === 0) return <div className="text-dim small">Your hand is empty.</div>;
  return (
    <div className="hand-grid">
      {hand.map((c) => {
        const def = ENCHANTMENT_DEFINITIONS_BY_ID[c.id];
        const disabledByMode = mode === "disabled" || (mode === "pickInstant" && c.timing !== "instant");
        return (
          <div
            key={c.id}
            className={`hand-card${selectedCardId === c.id ? " selected" : ""}`}
            style={disabledByMode ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            onClick={() => !disabledByMode && onPick(c.id)}
            title={def?.rulesText}
          >
            <strong>{c.name}</strong>
            <div className="small text-dim">{c.timing} · cost {c.actionCost}</div>
            <div className="small">{def?.rulesText}</div>
          </div>
        );
      })}
    </div>
  );
}

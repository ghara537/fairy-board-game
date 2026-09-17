import React, { useState } from "react";
import { ENCHANTMENT_DEFINITIONS_BY_ID } from "@fairy/shared";
import { shortName, timingGlyph } from "../abbreviations";

/** Your hand as a row of abbreviated chips — trimmed name, timing glyph,
 * action cost — with exactly one expanded at a time below them. The full
 * name and rules text live in that expansion, so a ten-card hand still fits
 * a phone-sized sheet without scrolling past a wall of card text. */
export function CompactHandPanel({
  hand,
  mode,
  actionLabel,
  selectedIds,
  onPick,
}: {
  hand: { id: string; name: string; timing: string; actionCost: number }[];
  mode: "disabled" | "pickAny" | "pickInstant";
  /** Verb on the expanded card's button — "Play" normally, "Discard" etc. when a prompt is collecting cards. */
  actionLabel?: string;
  /** Cards already chosen, for the multi-select prompts (mandatory discard). */
  selectedIds?: string[];
  onPick: (cardId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (hand.length === 0) return <div className="text-dim small">Your hand is empty.</div>;

  const expanded = hand.find((c) => c.id === expandedId) ?? null;
  const expandedDef = expanded ? ENCHANTMENT_DEFINITIONS_BY_ID[expanded.id] : null;
  const playable = (c: { timing: string }) => mode === "pickAny" || (mode === "pickInstant" && c.timing === "instant");

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chip-wrap">
        {hand.map((c) => {
          const chosen = selectedIds?.includes(c.id);
          return (
            <button
              key={c.id}
              className={`chip chip-card${expandedId === c.id ? " expanded" : ""}${chosen ? " chosen" : ""}${
                playable(c) ? "" : " dim"
              }`}
              onClick={() => setExpandedId((id) => (id === c.id ? null : c.id))}
              title={c.name}
            >
              {chosen ? "✓ " : ""}
              {timingGlyph(c.timing)} {shortName(c.name, 14)}
              {c.actionCost > 0 && <span className="chip-score">{c.actionCost}</span>}
            </button>
          );
        })}
      </div>

      {expanded ? (
        <div className="expand-detail">
          <div className="spread">
            <strong>{expanded.name}</strong>
            <span className="small text-dim">
              {expanded.timing} · cost {expanded.actionCost}
            </span>
          </div>
          <div className="small" style={{ marginTop: 4 }}>
            {expandedDef?.rulesText ?? "No rules text on file."}
          </div>
          <button
            style={{ marginTop: 8, width: "100%" }}
            disabled={!playable(expanded)}
            onClick={() => onPick(expanded.id)}
          >
            {selectedIds?.includes(expanded.id) ? "Unselect" : actionLabel ?? "Play"} {expanded.name}
          </button>
          {!playable(expanded) && (
            <div className="small text-dim" style={{ marginTop: 4 }}>
              {mode === "pickInstant" ? "Only Instants can answer this prompt." : "Not playable right now."}
            </div>
          )}
        </div>
      ) : (
        <div className="small text-dim">Tap a card for its full name and rules text.</div>
      )}
    </div>
  );
}

import React, { useState } from "react";
import { DOMAIN_DEFINITIONS_BY_ID, DomainId } from "@fairy/shared";
import { shortName } from "../abbreviations";

/** Your Domain's abilities in the compact layout, following the same
 * chip-then-expand shape as the hand: a row of short names, one open detail
 * at a time. Used abilities lose their marker and stay listed, so the
 * once-per-game budget is still readable at a glance. */
export function CompactAbilityPanel({
  domainId,
  abilitiesUsed,
  canUse,
  onUse,
  mainAbilityBlocked,
  onUseMainAbility,
  /** Only these indices may be used right now (a response window offering Instants). */
  allowedIndices,
}: {
  domainId: DomainId | null;
  abilitiesUsed: [boolean, boolean, boolean];
  canUse: boolean;
  onUse: (index: number) => void;
  mainAbilityBlocked?: boolean;
  onUseMainAbility?: () => void;
  allowedIndices?: number[];
}) {
  const [expanded, setExpanded] = useState<number | "main" | null>(null);
  if (!domainId) return null;
  const domain = DOMAIN_DEFINITIONS_BY_ID[domainId];
  if (!domain) return null;

  const mainAbility = domain.mainAbility?.implementationStatus === "implemented" ? domain.mainAbility : null;
  const expandedAbility = typeof expanded === "number" ? domain.abilities[expanded] : null;

  function usable(index: number) {
    if (abilitiesUsed[index]) return false;
    if (domain.abilities[index].implementationStatus !== "implemented") return false;
    if (allowedIndices) return allowedIndices.includes(index);
    return canUse;
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chip-wrap">
        {domain.abilities.map((a, i) => (
          <button
            key={a.key}
            className={`chip chip-card${expanded === i ? " expanded" : ""}${abilitiesUsed[i] ? " dim" : ""}`}
            onClick={() => setExpanded((e) => (e === i ? null : i))}
            title={a.name}
          >
            {abilitiesUsed[i] ? "✗ " : ""}
            {a.timing === "instant" ? "⚡ " : ""}
            {shortName(a.name, 16)}
          </button>
        ))}
        {mainAbility && (
          <button
            className={`chip chip-card${expanded === "main" ? " expanded" : ""}`}
            onClick={() => setExpanded((e) => (e === "main" ? null : "main"))}
            title={mainAbility.name}
          >
            ∞ {shortName(mainAbility.name, 16)}
          </button>
        )}
      </div>

      {domain.startingAbility && (
        <div className="small text-dim">Starting: {domain.startingAbility.rulesText}</div>
      )}

      {expandedAbility && typeof expanded === "number" ? (
        <div className="expand-detail">
          <div className="spread">
            <strong>{expandedAbility.name}</strong>
            <span className="small text-dim">
              {expandedAbility.timing}
              {abilitiesUsed[expanded] ? " · used" : " · once per game"}
            </span>
          </div>
          <div className="small" style={{ marginTop: 4 }}>
            {expandedAbility.rulesText}
          </div>
          {expandedAbility.implementationStatus !== "implemented" && (
            <div className="small text-dim" style={{ marginTop: 4 }}>
              Not yet implemented.
            </div>
          )}
          <button
            style={{ marginTop: 8, width: "100%" }}
            disabled={!usable(expanded)}
            onClick={() => onUse(expanded)}
          >
            {abilitiesUsed[expanded] ? "Already used" : `Use ${expandedAbility.name}`}
          </button>
        </div>
      ) : expanded === "main" && mainAbility ? (
        <div className="expand-detail">
          <div className="spread">
            <strong>{mainAbility.name}</strong>
            <span className="small text-dim">
              {mainAbility.actionCost} action{mainAbility.actionCost === 1 ? "" : "s"} · repeatable
            </span>
          </div>
          <div className="small" style={{ marginTop: 4 }}>
            {mainAbility.rulesText}
          </div>
          <button
            style={{ marginTop: 8, width: "100%" }}
            disabled={mainAbilityBlocked}
            onClick={() => onUseMainAbility?.()}
          >
            Use {mainAbility.name}
          </button>
        </div>
      ) : (
        <div className="small text-dim">
          Tap an ability for its rules text. ⚡ plays out of turn; ∞ is repeatable.
        </div>
      )}
    </div>
  );
}

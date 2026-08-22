import React from "react";
import { DOMAIN_DEFINITIONS_BY_ID, DomainId } from "@fairy/shared";

export function DomainAbilityPanel({
  domainId,
  abilitiesUsed,
  canUse,
  onUse,
}: {
  domainId: DomainId | null;
  abilitiesUsed: [boolean, boolean, boolean];
  canUse: boolean;
  onUse: (index: number) => void;
}) {
  if (!domainId) return null;
  const domain = DOMAIN_DEFINITIONS_BY_ID[domainId];
  if (!domain) return null;
  return (
    <div className="ability-list">
      {domain.startingAbility && (
        <div className="small text-dim" style={{ marginBottom: 6 }}>
          Starting: {domain.startingAbility.rulesText}
        </div>
      )}
      {domain.abilities.map((a, i) => {
        const used = abilitiesUsed[i];
        const disabled = used || !canUse || a.implementationStatus !== "implemented";
        return (
          <div key={a.key} className={`ability-detail${used ? " used" : ""}`}>
            <div className="spread">
              <strong>
                {a.name} {a.timing === "instant" ? "⚡" : ""}
              </strong>
              <div className="row" style={{ gap: 6 }}>
                {/* A once-per-game ability shows an empty marker until used, then the marker is simply gone. */}
                {!used && <span className="ability-unused-marker" title="Not yet used this game" aria-hidden="true" />}
                <button className="secondary" disabled={disabled} onClick={() => onUse(i)}>
                  {used ? "Used" : "Use"}
                </button>
              </div>
            </div>
            <div className="small text-dim">
              {a.timing}
              {a.implementationStatus !== "implemented" ? " · not yet implemented" : ""}
            </div>
            <div className="small">{a.rulesText}</div>
          </div>
        );
      })}
    </div>
  );
}

import React, { useEffect } from "react";
import type { DomainId } from "@fairy/shared";
import { MAT_CHECKBOX_CENTERS, MAT_NATIVE_SIZE } from "../board/matCheckboxes";

/** Full-size player mat lightbox — art + every ability's rules text, easy to read. Closes on backdrop click, the ✕ button, or Escape. */
export function DomainMatModal({
  domainId,
  abilitiesUsed,
  onClose,
}: {
  domainId: DomainId;
  abilitiesUsed?: [boolean, boolean, boolean];
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const native = MAT_NATIVE_SIZE[domainId];
  const checkboxes = MAT_CHECKBOX_CENTERS[domainId] ?? [];

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${domainId} player mat`}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="secondary modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="modal-mat-frame">
          <img src={`/board-art/mat-${domainId}.webp`} alt={`${domainId} player mat`} className="modal-mat-image" />
          {/* Ability usage isn't hidden info — mark each used checkbox with an X, same as the on-board mat everyone else sees. */}
          {native &&
            checkboxes.map((pt, i) => {
              if (!abilitiesUsed?.[i]) return null;
              const leftPct = (pt.x / native.w) * 100;
              const topPct = (pt.y / native.h) * 100;
              return (
                <svg
                  key={i}
                  className="modal-mat-used-mark"
                  style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  viewBox="0 0 100 100"
                  width={28}
                  height={28}
                >
                  <line x1="8" y1="8" x2="92" y2="92" />
                  <line x1="92" y1="8" x2="8" y2="92" />
                </svg>
              );
            })}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect } from "react";

/** What every abbreviation in the compact layout expands into: a small
 * centered card. Deliberately centered rather than anchored to its trigger —
 * an anchored popover next to a chip in a 390px-tall viewport ends up
 * clipped by the top bar or the dock about half the time. */
export function InfoPopup({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="info-popup-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="info-popup" onClick={(e) => e.stopPropagation()}>
        <div className="spread info-popup-header">
          <strong>{title}</strong>
          <button className="secondary small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="info-popup-body">{children}</div>
      </div>
    </div>
  );
}

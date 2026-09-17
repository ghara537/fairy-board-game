import React, { useEffect } from "react";

/** The compact layout's one disclosure surface: a panel that slides up over
 * the bottom of the board, leaving the board itself visible above it.
 *
 * `pinned` sheets (an interaction the game is actually waiting on) have no
 * close affordance and ignore backdrop taps — dismissing them would leave
 * the player with a prompt and no way to answer it. */
export function Sheet({
  title,
  subtitle,
  onClose,
  pinned,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  pinned?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (pinned || !onClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose!();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pinned]);

  return (
    <>
      {!pinned && <div className="sheet-backdrop" onClick={onClose} />}
      <section className={`sheet${pinned ? " sheet-pinned" : ""}`} role="dialog" aria-modal={!pinned} aria-label={title}>
        <header className="sheet-header">
          <div className="sheet-titles">
            <strong>{title}</strong>
            {subtitle && <span className="small text-dim">{subtitle}</span>}
          </div>
          {!pinned && onClose && (
            <button className="secondary sheet-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}

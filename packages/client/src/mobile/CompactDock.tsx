import React from "react";

export type SheetKey = "hand" | "abilities" | "effects" | "log" | "more" | "actions";

export type DockButton = {
  key: SheetKey;
  glyph: string;
  label: string;
  /** Small count in the corner; omitted or 0 renders nothing. */
  badge?: number;
  /** Draws the badge in the alert color — something needs attention. */
  urgent?: boolean;
};

/** The compact layout's bottom bar. Everything the desktop right rail shows
 * at once lives behind one of these buttons; turn actions sit on the right,
 * under the thumb that holds a sideways phone. */
export function CompactDock({
  buttons,
  openSheet,
  onToggleSheet,
  leading,
  actions,
}: {
  buttons: DockButton[];
  openSheet: SheetKey | null;
  onToggleSheet: (key: SheetKey | null) => void;
  /** Controls that aren't sheets (board zoom), placed ahead of the sheet buttons. */
  leading?: React.ReactNode;
  /** Turn actions rendered at the right end — already-built buttons, so the dock stays layout-only. */
  actions?: React.ReactNode;
}) {
  return (
    <nav className="compact-dock" aria-label="Game panels">
      <div className="dock-group">
        {leading}
        {buttons.map((b) => (
          <button
            key={b.key}
            className={`dock-btn${openSheet === b.key ? " active" : ""}`}
            onClick={() => onToggleSheet(openSheet === b.key ? null : b.key)}
            aria-pressed={openSheet === b.key}
            title={b.label}
          >
            <span className="dock-glyph" aria-hidden="true">
              {b.glyph}
            </span>
            <span className="dock-label">{b.label}</span>
            {b.badge ? <span className={`dock-badge${b.urgent ? " urgent" : ""}`}>{b.badge}</span> : null}
          </button>
        ))}
      </div>
      {actions && <div className="dock-group dock-actions">{actions}</div>}
    </nav>
  );
}

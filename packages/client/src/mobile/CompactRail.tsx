import React from "react";

export type TabKey = "interaction" | "actions" | "hand" | "abilities" | "effects" | "log" | "more";

export type RailTab = {
  key: TabKey;
  glyph: string;
  /** Full name of the panel — the tab's tooltip, and the header above its content. */
  label: string;
  /** Small count in the corner; omitted or 0 renders nothing. */
  badge?: number;
  /** Draws the badge in the alert color — something needs attention. */
  urgent?: boolean;
};

/**
 * The compact layout's control column: prompt, tab strip, the open panel,
 * and a footer that only appears when there's something to cancel.
 *
 * It sits *beside* the board (or under it in portrait) rather than over it —
 * confirmed by the user: you're reading the board while you decide which
 * card to play, so nothing may cover it. That's also why the board's box is
 * a fixed share of the viewport: switching tabs never resizes it, so the
 * hex you were looking at doesn't move under your thumb.
 */
export function CompactRail({
  prompt,
  onExpandPrompt,
  tabs,
  activeTab,
  onSelectTab,
  title,
  subtitle,
  footer,
  children,
}: {
  prompt: string;
  onExpandPrompt: () => void;
  tabs: RailTab[];
  activeTab: TabKey;
  onSelectTab: (key: TabKey) => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <aside className="compact-rail" aria-label="Game controls">
      <button className="rail-prompt" onClick={onExpandPrompt} title="Tap for the full prompt">
        <span className="rail-prompt-text">{prompt}</span>
        <span className="rail-prompt-more" aria-hidden="true">
          ⓘ
        </span>
      </button>

      <nav className="rail-tabs" aria-label="Panels">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`rail-tab${activeTab === t.key ? " active" : ""}`}
            onClick={() => onSelectTab(t.key)}
            aria-pressed={activeTab === t.key}
            aria-label={t.label}
            title={t.label}
          >
            <span aria-hidden="true">{t.glyph}</span>
            {t.badge ? <span className={`rail-badge${t.urgent ? " urgent" : ""}`}>{t.badge}</span> : null}
          </button>
        ))}
      </nav>

      <header className="rail-header">
        <strong>{title}</strong>
        {subtitle && <span className="small text-dim">{subtitle}</span>}
      </header>

      <div className="rail-body">{children}</div>

      {footer && <div className="rail-footer">{footer}</div>}
    </aside>
  );
}

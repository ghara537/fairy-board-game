import React from "react";
import { HUMAN_DEFINITIONS } from "@fairy/shared";
import { ACCEL_MARKER_ICON, HUMAN_ICONS, OBSTACLE_ICONS, PORTAL_ICON } from "../board/icons";

/** What every glyph on the board means. The compact board leans hard on
 * icons to stay readable at phone size, so this is the expansion for all of
 * them — reachable from the dock's "More" sheet. */
export function BoardLegend() {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div>
        <div className="small text-dim">Humans</div>
        <dl className="kv">
          {HUMAN_DEFINITIONS.map((h) => (
            <React.Fragment key={h.id}>
              <dt>
                <span className="legend-glyph">{HUMAN_ICONS[h.id] ?? "❓"}</span> {h.name}
              </dt>
              <dd className="small">
                {h.basePoints >= 0 ? `${h.basePoints} pt` : `${h.basePoints} pt`}
                {h.isHazard ? " · hazard" : ""}
                {h.tags.length > 0 ? ` · ${h.tags.join(", ")}` : ""}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
      <div>
        <div className="small text-dim">Board features</div>
        <dl className="kv">
          <dt>
            <span className="legend-glyph">{PORTAL_ICON}</span> Portal
          </dt>
          <dd className="small">Where new Humans arrive. The ring hexes are labeled A / B by spawn set.</dd>
          <dt>
            <span className="legend-glyph">{OBSTACLE_ICONS.tree}</span> Tree
          </dt>
          <dd className="small">Blocks entry.</dd>
          <dt>
            <span className="legend-glyph">{OBSTACLE_ICONS.stone}</span> Stone
          </dt>
          <dd className="small">Blocks entry.</dd>
          <dt>
            <span className="legend-glyph">{OBSTACLE_ICONS.toadstool}</span> Toadstool
          </dt>
          <dd className="small">Placed by effects; at most two on the board at once.</dd>
          <dt>
            <span className="legend-glyph">{ACCEL_MARKER_ICON}</span> Acceleration marker
          </dt>
          <dd className="small">Speeds up a Human's movement.</dd>
          <dt>
            <span className="legend-glyph legend-lure" /> Lure stack
          </dt>
          <dd className="small">Colored by owner; the number is its height.</dd>
          <dt>
            <span className="legend-glyph legend-domain" /> Domain hex
          </dt>
          <dd className="small">A player's scoring territory. The banner beside it opens their player mat.</dd>
        </dl>
      </div>
    </div>
  );
}

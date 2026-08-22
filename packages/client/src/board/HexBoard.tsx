import React, { useMemo } from "react";
import {
  Axial,
  axialKey,
  DomainId,
  generateHexagonalBoard,
  PlayerId,
  PublicAccelMarkerView,
  PublicDomainBoardView,
  PublicHumanView,
  PublicLureStackView,
  PublicObstacleView,
  SPAWN_DATA,
} from "@fairy/shared";
import { axialToPixel, hexCornerPoints, rotatePoint } from "./geometry";
import { MAT_CHECKBOX_CENTERS, MAT_NATIVE_SIZE } from "./matCheckboxes";

const DOMAIN_MAT_URLS: Record<string, string> = {
  "ocean-sirens": "/board-art/mat-ocean-sirens.webp",
  "moonlight-pixies": "/board-art/mat-moonlight-pixies.webp",
  "wind-djinn": "/board-art/mat-wind-djinn.webp",
  "earth-gnomes": "/board-art/mat-earth-gnomes.webp",
  "forest-elves": "/board-art/mat-forest-elves.webp",
  "river-nymphs": "/board-art/mat-river-nymphs.webp",
};
// Full mat card box size, in board pixel units — a fixed box sized to the
// mat art's own rough aspect ratio (≈2:1); the individual mats' actual
// aspect ratios vary slightly (they're an uneven crop off two card sheets),
// so `preserveAspectRatio="xMidYMid meet"` letterboxes rather than stretch.
const MAT_WIDTH = 32 * 8;
const MAT_HEIGHT = MAT_WIDTH / 2;

const HUMAN_ICONS: Record<string, string> = {
  adult: "🧑",
  child: "🧒",
  baby: "👶",
  lover: "💞",
  mother: "🤱",
  hunter: "🏹",
};

const OBSTACLE_ICONS: Record<string, string> = {
  tree: "🌲",
  stone: "🪨",
  toadstool: "🍄",
};

const HEX_SIZE = 32;

// Ordinary-hex terrain palette, sampled from the reference board art (moss,
// amethyst, aqua crystal, earth, stone, and a warm olive). Purely cosmetic —
// each hex's terrain is a stable hash of its own coordinates, so it doesn't
// shift between renders/reconnects.
const TERRAIN_GRADIENTS: { id: string; from: string; to: string }[] = [
  { id: "terrain-0", from: "#4d6e3f", to: "#1e2f17" }, // moss green
  { id: "terrain-1", from: "#6a4d8a", to: "#2a1c3b" }, // amethyst
  { id: "terrain-2", from: "#3d7f7d", to: "#153433" }, // aqua crystal
  { id: "terrain-3", from: "#7a5a34", to: "#33240f" }, // earth brown
  { id: "terrain-4", from: "#6b7078", to: "#2c2f34" }, // stone gray
  { id: "terrain-5", from: "#63722f", to: "#262e10" }, // olive
];

function hashAxialKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h;
}

export type HexBoardProps = {
  edgeLength: number;
  // A Human's "moved" flag only fades it while it's actually meaningful —
  // during the Human Movement Phase itself, to show who's already gone this
  // phase. It doesn't reset until the next Human Movement Phase starts, so
  // without this every Human would stay faded all the way through the next
  // round's action phase too.
  fadeMovedHumans: boolean;
  humans: PublicHumanView[];
  lureStacks: PublicLureStackView[];
  obstacles: PublicObstacleView[];
  accelMarkers: PublicAccelMarkerView[];
  domainBoards: PublicDomainBoardView[];
  portalCenter: Axial;
  // Whose view this is: the whole board is rotated so this player's own
  // Domain always renders at the bottom (confirmed by the user — makes
  // orientation immediately obvious regardless of which of the 6 sides
  // their Domain was randomly assigned). Falls back to the canonical
  // (unrotated) orientation when null/not found — e.g. no seat yet.
  yourPlayerId?: PlayerId | null;
  // Which of each player's 3 non-Main, non-Starting abilities are already
  // used this game — ability usage isn't hidden information, so every
  // player's own mat on the board marks it with an X for everyone to see,
  // not just that player privately (see DomainAbilityPanel for the private
  // sidebar copy of the same data, shown only for your own Domain).
  domainAbilitiesUsed?: Record<PlayerId, [boolean, boolean, boolean]>;
  playerColors: Record<PlayerId, string>;
  playerNames?: Record<PlayerId, string>;
  legalHexes?: Axial[];
  selectedHumanId?: string | null;
  onHexClick?: (hex: Axial) => void;
  // Each piece-click callback also gets that piece's own position: pieces
  // render on top of their hex, so a click meant for the hex underneath
  // (placing/stacking a lure, or a "boardSpace" targeting step whose legal
  // destination happens to already hold a piece) lands on the piece first.
  // Callers fall back to treating it as a hex click when the current mode
  // isn't actually picking that kind of piece — see GameScreen.tsx.
  onHumanClick?: (instanceId: string, position: Axial) => void;
  onLureClick?: (stackId: string, position: Axial) => void;
  onObstacleClick?: (obstacleId: string, position: Axial) => void;
  onAccelMarkerClick?: (markerId: string, position: Axial) => void;
  // Clicking a Domain's on-board banner opens its full player mat (art + abilities) at readable size.
  onDomainMatClick?: (domainId: DomainId) => void;
};

export function HexBoard(props: HexBoardProps) {
  const {
    edgeLength,
    fadeMovedHumans,
    humans,
    lureStacks,
    obstacles,
    accelMarkers,
    domainBoards,
    portalCenter,
    yourPlayerId,
    domainAbilitiesUsed,
    playerColors,
    playerNames,
    legalHexes,
    selectedHumanId,
    onHexClick,
    onHumanClick,
    onLureClick,
    onObstacleClick,
    onAccelMarkerClick,
    onDomainMatClick,
  } = props;

  const cells = useMemo(() => generateHexagonalBoard(edgeLength), [edgeLength]);
  const legalSet = useMemo(() => new Set((legalHexes ?? []).map(axialKey)), [legalHexes]);

  // Portal ring: the 6 hexes immediately around the Portal, alternating
  // spawn set A / B (per the reference board art) — labeled so players can
  // see where each set's Humans will arrive.
  const portalRingSet = useMemo(() => {
    const m = new Map<string, "A" | "B">();
    for (const p of SPAWN_DATA.sets.A.positions) m.set(axialKey(p), "A");
    for (const p of SPAWN_DATA.sets.B.positions) m.set(axialKey(p), "B");
    return m;
  }, []);

  // The canonical (unrotated) Portal pixel position is both the pivot every
  // rotation below turns around and the origin `toScreen` measures from.
  const portalPxCanonical = useMemo(() => axialToPixel(portalCenter, HEX_SIZE), [portalCenter]);

  // Confirmed by the user: the whole board rotates per-viewer so their own
  // Domain always renders at the bottom, regardless of which of the 6 sides
  // it was randomly assigned — figured out purely from where that Domain's
  // own hexes land in the canonical (unrotated) layout, so it works for any
  // side without a lookup table.
  const rotationDeg = useMemo(() => {
    if (!yourPlayerId) return 0;
    const mine = domainBoards.find((d) => d.playerId === yourPlayerId);
    if (!mine || mine.hexes.length === 0) return 0;
    const pts = mine.hexes.map((h) => axialToPixel(h, HEX_SIZE));
    const midX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const midY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const theta = (Math.atan2(midY - portalPxCanonical.y, midX - portalPxCanonical.x) * 180) / Math.PI;
    return 90 - theta; // 90deg = straight down in SVG's y-down space
  }, [domainBoards, yourPlayerId, portalPxCanonical]);

  const toScreen = (hex: Axial) => rotatePoint(axialToPixel(hex, HEX_SIZE), rotationDeg, portalPxCanonical);
  // Direction vectors rotate around the origin, not around the Portal.
  const rotateDir = (v: { x: number; y: number }) => rotatePoint(v, rotationDeg, { x: 0, y: 0 });

  /** Maps a point in a mat image's own native pixel space (e.g. an ability checkbox's center) to on-board screen coordinates + the effective image scale, replicating the `xMidYMid meet` scale + letterbox the `<image>` itself uses. */
  function matImagePointToScreen(domainId: DomainId, imgPoint: { x: number; y: number }, matCx: number, matCy: number) {
    const native = MAT_NATIVE_SIZE[domainId];
    if (!native) return { x: matCx, y: matCy, scale: 1 };
    const scale = Math.min(MAT_WIDTH / native.w, MAT_HEIGHT / native.h);
    const renderedW = native.w * scale;
    const renderedH = native.h * scale;
    const boxLeft = matCx - MAT_WIDTH / 2;
    const boxTop = matCy - MAT_HEIGHT / 2;
    const imgLeft = boxLeft + (MAT_WIDTH - renderedW) / 2;
    const imgTop = boxTop + (MAT_HEIGHT - renderedH) / 2;
    return { x: imgLeft + imgPoint.x * scale, y: imgTop + imgPoint.y * scale, scale };
  }

  const pixels = useMemo(() => cells.map((c) => ({ hex: c, px: toScreen(c) })), [cells, rotationDeg, portalPxCanonical]);

  // Domain boards: 4-hex extensions attached past one edge of the main
  // board (see domainAttachmentHexes). Each gets its own golden hex row plus
  // its full player mat — positioned further out along the same outward
  // ray, upright (never rotated to match the edge — confirmed by the user:
  // past attempts to flush-align it against the edge looked messy and
  // risked covering the Domain's own hexes, which must stay fully visible).
  const domainLayouts = useMemo(() => {
    return domainBoards.map((d) => {
      const hexPixels = d.hexes.map((h) => ({ hex: h, px: toScreen(h) }));
      const unrotated = d.hexes.map((h) => axialToPixel(h, HEX_SIZE));
      const midX = unrotated.reduce((s, p) => s + p.x, 0) / unrotated.length;
      const midY = unrotated.reduce((s, p) => s + p.y, 0) / unrotated.length;
      const outX = midX - portalPxCanonical.x;
      const outY = midY - portalPxCanonical.y;
      const outLen = Math.hypot(outX, outY) || 1;
      const outUnit = rotateDir({ x: outX / outLen, y: outY / outLen });
      const rotatedMid = rotatePoint({ x: midX, y: midY }, rotationDeg, portalPxCanonical);
      // Clear the Domain's own hexes (and the mat's own footprint) by the
      // mat's half-diagonal, since it's placed upright rather than rotated
      // to align with the outward ray — a safe clearance at any angle.
      const clearance = HEX_SIZE * 1.5 + Math.hypot(MAT_WIDTH, MAT_HEIGHT) / 2 + 10;
      const matCx = rotatedMid.x + outUnit.x * clearance;
      const matCy = rotatedMid.y + outUnit.y * clearance;
      const labelOffset = MAT_HEIGHT / 2 + 16;
      const labelCx = matCx + outUnit.x * labelOffset;
      const labelCy = matCy + outUnit.y * labelOffset;
      return { assignment: d, hexPixels, matCx, matCy, labelCx, labelCy };
    });
  }, [domainBoards, rotationDeg, portalPxCanonical]);

  const domainBoundsPoints = useMemo(
    () =>
      domainLayouts.flatMap((d) => {
        const half = Math.max(MAT_WIDTH, MAT_HEIGHT) / 2 + HEX_SIZE;
        return [
          { x: d.matCx - half, y: d.matCy - half },
          { x: d.matCx + half, y: d.matCy + half },
        ];
      }),
    [domainLayouts]
  );

  const allBoundPoints = [...pixels.map((p) => p.px), ...domainBoundsPoints];
  const minX = Math.min(...allBoundPoints.map((p) => p.x)) - HEX_SIZE * 1.2;
  const maxX = Math.max(...allBoundPoints.map((p) => p.x)) + HEX_SIZE * 1.2;
  const minY = Math.min(...allBoundPoints.map((p) => p.y)) - HEX_SIZE * 1.2;
  const maxY = Math.max(...allBoundPoints.map((p) => p.y)) + HEX_SIZE * 1.2;
  const width = maxX - minX;
  const height = maxY - minY;

  const lureByKey = useMemo(() => {
    const m = new Map<string, PublicLureStackView>();
    for (const s of lureStacks) m.set(axialKey(s.position), s);
    return m;
  }, [lureStacks]);
  const obstacleByKey = useMemo(() => {
    const m = new Map<string, PublicObstacleView>();
    for (const o of obstacles) m.set(axialKey(o.position), o);
    return m;
  }, [obstacles]);
  const accelByKey = useMemo(() => {
    const m = new Map<string, PublicAccelMarkerView>();
    for (const a of accelMarkers) m.set(axialKey(a.position), a);
    return m;
  }, [accelMarkers]);
  const humansByKey = useMemo(() => {
    const m = new Map<string, PublicHumanView[]>();
    for (const h of humans) {
      const k = axialKey(h.position);
      const arr = m.get(k) ?? [];
      arr.push(h);
      m.set(k, arr);
    }
    return m;
  }, [humans]);

  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      className="hex-board"
      role="group"
      aria-label="Game board"
    >
      <defs>
        {TERRAIN_GRADIENTS.map((g) => (
          <radialGradient key={g.id} id={g.id}>
            <stop offset="0%" stopColor={g.from} />
            <stop offset="100%" stopColor={g.to} />
          </radialGradient>
        ))}
        <radialGradient id="domain-hex-gradient">
          <stop offset="0%" stopColor="#f0d97a" />
          <stop offset="100%" stopColor="#c9a13b" />
        </radialGradient>
      </defs>

      {pixels.map(({ hex, px }) => {
        const key = axialKey(hex);
        const isPortal = hex.q === portalCenter.q && hex.r === portalCenter.r;
        const ringSet = portalRingSet.get(key);
        const isLegal = legalSet.has(key);
        const points = hexCornerPoints(px, HEX_SIZE - 1.5, rotationDeg);
        const ringClass = ringSet ? ` hex-portal-ring hex-portal-ring-${ringSet.toLowerCase()}` : "";
        const terrainClass = !isPortal && !ringSet ? ` hex-terrain-${hashAxialKey(key) % TERRAIN_GRADIENTS.length}` : "";
        return (
          <g key={key}>
            <polygon
              points={points}
              className={`hex-tile${isLegal ? " hex-legal" : ""}${isPortal ? " hex-portal" : ""}${ringClass}${terrainClass}`}
              onClick={() => onHexClick?.(hex)}
              tabIndex={onHexClick ? 0 : undefined}
              role={onHexClick ? "button" : undefined}
              aria-label={`Hex ${hex.q},${hex.r}${ringSet ? `, Portal set ${ringSet}` : ""}`}
            />
            {ringSet && (
              <text x={px.x} y={px.y - HEX_SIZE / 2 + 4} textAnchor="middle" className="portal-ring-label" pointerEvents="none">
                {ringSet}
              </text>
            )}
          </g>
        );
      })}

      {/* Domain boards: each player's 4-hex scoring territory, attached past one edge of the main board */}
      {domainLayouts.map((d) => {
        const color = playerColors[d.assignment.playerId] ?? "#c9a13b";
        const label = playerNames?.[d.assignment.playerId];
        return (
          <g key={`domain-${d.assignment.playerId}`}>
            {d.hexPixels.map(({ hex, px }) => {
              const key = axialKey(hex);
              const isLegal = legalSet.has(key);
              const points = hexCornerPoints(px, HEX_SIZE - 1.5, rotationDeg);
              return (
                <polygon
                  key={key}
                  points={points}
                  className={`hex-tile hex-domain${isLegal ? " hex-legal" : ""}`}
                  style={{ stroke: color }}
                  onClick={() => onHexClick?.(hex)}
                  tabIndex={onHexClick ? 0 : undefined}
                  role={onHexClick ? "button" : undefined}
                  aria-label={`Hex ${hex.q},${hex.r}, ${d.assignment.domainId} Domain`}
                />
              );
            })}
            {/* Full player mat (art + every ability's rules text) — always upright, positioned clear of the Domain's own hexes so they stay fully visible. */}
            <image
              href={DOMAIN_MAT_URLS[d.assignment.domainId]}
              x={d.matCx - MAT_WIDTH / 2}
              y={d.matCy - MAT_HEIGHT / 2}
              width={MAT_WIDTH}
              height={MAT_HEIGHT}
              preserveAspectRatio="xMidYMid meet"
              className="domain-mat-image"
              style={{ cursor: onDomainMatClick ? "pointer" : undefined }}
              onClick={() => onDomainMatClick?.(d.assignment.domainId)}
            >
              <title>Click to view the full {d.assignment.domainId} player mat</title>
            </image>
            {/* Ability usage isn't hidden info — mark each used checkbox with an X, visible to every player, not just this Domain's owner. */}
            {domainAbilitiesUsed?.[d.assignment.playerId]?.map((used, i) => {
              if (!used) return null;
              const imgPoint = MAT_CHECKBOX_CENTERS[d.assignment.domainId]?.[i];
              if (!imgPoint) return null;
              const pt = matImagePointToScreen(d.assignment.domainId, imgPoint, d.matCx, d.matCy);
              const markHalf = 21 * pt.scale;
              return (
                <g key={`used-${d.assignment.playerId}-${i}`} pointerEvents="none">
                  <line x1={pt.x - markHalf} y1={pt.y - markHalf} x2={pt.x + markHalf} y2={pt.y + markHalf} className="ability-used-mark" />
                  <line x1={pt.x + markHalf} y1={pt.y - markHalf} x2={pt.x - markHalf} y2={pt.y + markHalf} className="ability-used-mark" />
                </g>
              );
            })}
            {label && (
              <text
                x={d.labelCx}
                y={d.labelCy}
                textAnchor="middle"
                className="domain-owner-label"
                style={{ fill: color }}
                pointerEvents="none"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      {/* Toadstool ring decorating the Portal cluster's outer edge, matching the reference board art */}
      {(() => {
        const center = portalPxCanonical;
        const radius = HEX_SIZE * (Math.sqrt(3) + 0.85);
        const count = 12;
        return Array.from({ length: count }, (_, i) => {
          const angle = (Math.PI / 180) * ((360 / count) * i + rotationDeg);
          const x = center.x + radius * Math.cos(angle);
          const y = center.y + radius * Math.sin(angle);
          return (
            <text key={`toadstool-${i}`} x={x} y={y + 4} textAnchor="middle" className="toadstool-ring-icon" pointerEvents="none">
              🍄
            </text>
          );
        });
      })()}

      {/* Portal marker */}
      {(() => {
        const px = portalPxCanonical;
        return (
          <text x={px.x} y={px.y + 9} textAnchor="middle" className="piece-icon portal-icon" pointerEvents="none">
            🌀
          </text>
        );
      })()}

      {/* Obstacles */}
      {obstacles.map((o) => {
        const px = toScreen(o.position);
        return (
          <text
            key={o.id}
            x={px.x}
            y={px.y + 8}
            textAnchor="middle"
            className="piece-icon obstacle-icon"
            onClick={() => onObstacleClick?.(o.id, o.position)}
          >
            {OBSTACLE_ICONS[o.type] ?? "?"}
          </text>
        );
      })}

      {/* Acceleration markers */}
      {accelMarkers.map((m) => {
        const px = toScreen(m.position);
        return (
          <text
            key={m.id}
            x={px.x}
            y={px.y + 6}
            textAnchor="middle"
            className="piece-icon accel-icon"
            onClick={() => onAccelMarkerClick?.(m.id, m.position)}
          >
            ⚡
          </text>
        );
      })}

      {/* Lure stacks */}
      {lureStacks.map((s) => {
        const px = toScreen(s.position);
        const color = playerColors[s.owner] ?? "#888";
        return (
          <g key={s.id} onClick={() => onLureClick?.(s.id, s.position)} className="lure-stack">
            <circle cx={px.x} cy={px.y} r={13} fill={color} stroke="#222" strokeWidth={1.5} />
            <text x={px.x} y={px.y + 4} textAnchor="middle" className="lure-height">
              {s.height}
            </text>
          </g>
        );
      })}

      {/* Humans (offset if multiple share a hex) */}
      {humans.map((h, i) => {
        const sameHex = humansByKey.get(axialKey(h.position)) ?? [h];
        const idxInHex = sameHex.findIndex((x) => x.instanceId === h.instanceId);
        const px = toScreen(h.position);
        const offsetX = sameHex.length > 1 ? (idxInHex - (sameHex.length - 1) / 2) * 17 : 0;
        const classes = [
          "piece-icon",
          "human-icon",
          fadeMovedHumans && h.moved ? "human-moved" : "",
          h.confused ? "human-confused" : "",
          selectedHumanId === h.instanceId ? "piece-selected" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <text
            key={h.instanceId}
            x={px.x + offsetX}
            y={px.y + 13}
            textAnchor="middle"
            className={classes}
            onClick={() => onHumanClick?.(h.instanceId, h.position)}
          >
            {HUMAN_ICONS[h.definitionId] ?? "❓"}
          </text>
        );
      })}
    </svg>
  );
}

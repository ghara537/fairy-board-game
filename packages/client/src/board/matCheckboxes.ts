import type { DomainId } from "@fairy/shared";

// Pixel geometry of each mat image's own 3 ability checkboxes (the empty
// squares printed on `public/board-art/mat-*.webp`), in that image's own
// native pixel space — found by locating the actual square outlines in each
// source PNG (a one-off Python/PIL script, not checked into the repo) so
// the X marks below land exactly on the printed box regardless of each
// mat's slightly different crop height. Order matches each Domain's own
// `abilities` array in `data/domains.ts` (index 0-2) — the Main Ability and
// Starting Ability have no checkbox on the mat at all (Main is repeatable,
// Starting resolves once during setup, before any of this UI is relevant).

export const MAT_NATIVE_SIZE: Record<DomainId, { w: number; h: number }> = {
  "ocean-sirens": { w: 1024, h: 547 },
  "forest-elves": { w: 1024, h: 519 },
  "wind-djinn": { w: 1024, h: 470 },
  "river-nymphs": { w: 1024, h: 562 },
  "moonlight-pixies": { w: 1024, h: 516 },
  "earth-gnomes": { w: 1024, h: 458 },
} as Record<DomainId, { w: number; h: number }>;

export const MAT_CHECKBOX_CENTERS: Record<DomainId, { x: number; y: number }[]> = {
  "ocean-sirens": [
    { x: 950, y: 190 },
    { x: 950, y: 305 },
    { x: 950, y: 427 },
  ],
  "forest-elves": [
    { x: 950, y: 194 },
    { x: 950, y: 313 },
    { x: 950, y: 450 },
  ],
  "wind-djinn": [
    { x: 950, y: 196 },
    { x: 950, y: 316 },
    { x: 945, y: 401 },
  ],
  "river-nymphs": [
    { x: 955, y: 191 },
    { x: 955, y: 302 },
    { x: 956, y: 432 },
  ],
  "moonlight-pixies": [
    { x: 956, y: 225 },
    { x: 956, y: 344 },
    { x: 955, y: 458 },
  ],
  "earth-gnomes": [
    { x: 958, y: 194 },
    { x: 958, y: 320 },
    { x: 955, y: 404 },
  ],
} as Record<DomainId, { x: number; y: number }[]>;

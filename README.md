# Fairy Domains

A live, browser-based, server-authoritative multiplayer implementation of the
turn-based fantasy board game described in the project spec: 2–6 players,
room codes, private hands, a real hex board, reconnect-safe seats, and a full
turn/response/movement/scoring rules engine running on the server.

This is a **working full-stack app**, not a mock-up: create a room from one
browser tab, join from another (or another device), pick Domains, start the
game, and play it live. See `RULES_TODO.md` for every place the source spec
was underspecified and what default was chosen — nothing is silently guessed
without a label.

## Architecture

Single TypeScript monorepo (npm workspaces), one deployable service:

```
packages/
  shared/   Pure game data + logic shared by client and server:
            hex coordinate math & BFS pathfinding, Domain/Human/Card/Spawn
            data files, the Socket.IO event contract types.
  server/   Express + Socket.IO. Authoritative rules engine, in-memory room
            storage (Map<roomCode, Room>), reconnect tokens.
  client/   React + Vite. SVG hex board, lobby, in-game UI. Never trusted
            for rule enforcement — every action round-trips to the server.
```

The server is authoritative for everything: legality of actions, targets,
movement, scoring, ability availability, and win conditions. The client only
renders server-sanitized, per-player "personalized views" (`PersonalizedGameView`
in `packages/shared/src/events.ts`) — an opponent's hand is never sent to your
browser as hidden JSON, it's simply never included in your payload at all.

### Key modules

| Concern | File |
|---|---|
| Hex grid math (adjacency, BFS shortest path, rings) | `packages/shared/src/hex/` |
| Human Movement Phase (the core rules engine — pure, independently tested) | `packages/server/src/game/engine/movement.ts` |
| Turn/phase state machine, response windows, victory | `packages/server/src/game/GameEngine.ts`, `engine/responseWindow.ts`, `engine/victory.ts` |
| Domain ability effect handlers | `packages/server/src/game/engine/domainAbilities.ts` |
| Domain *board* placement/scoring lookup (the physical 4-hex territory, distinct from Domain abilities) | `packages/server/src/game/engine/domains.ts` |
| Enchantment card effect handlers | `packages/server/src/game/engine/cards.ts` |
| Shared low-level effect mechanics (forced movement, push/pull, swaps) | `packages/server/src/game/engine/effectPrimitives.ts` |
| Temporary un-targetability + round-wide targeting restrictions | `packages/server/src/game/engine/targetability.ts` |
| Acceleration marker placement/movement | `packages/server/src/game/engine/accelMarkers.ts` |
| Rooms, reconnect tokens, host corrections | `packages/server/src/rooms/`, `packages/server/src/reconnect/` |
| Per-player state sanitization (the privacy boundary) | `packages/server/src/socket/sanitize.ts` |
| Hex board rendering (SVG); Portal A/B ring labels + toadstool border art; per-viewer rotation so your own Domain always renders at the bottom | `packages/client/src/board/HexBoard.tsx`, pixel math in `board/geometry.ts` |
| Domain player-mat art: the full mat (art + every ability's rules text) rendered directly on the board next to its Domain, and the same image at full size in a click-to-expand modal (`board-art/mat-*.webp`, `packages/client/src/components/DomainMatModal.tsx`) — cropped from the source sheets in `board-art-source/kingdoms/`; used abilities get a red X overlaid on the mat's own printed checkbox (pixel positions in `packages/client/src/board/matCheckboxes.ts`), visible to every player | `packages/client/public/board-art/`, `packages/client/board-art-source/kingdoms/` |
| Declarative multi-step targeting scripts (what to ask for, in what order, and — for a destination-space step — the occupancy rule and geometric constraint relative to an earlier pick) for every card/ability | `packages/client/src/targetingScripts.ts`, consumed generically by `packages/client/src/screens/GameScreen.tsx`; legal-space computation lives in `packages/client/src/legality.ts` |
| Options screen (per-card enable/disable, Victory Condition) + its local persistence | `packages/client/src/screens/Options.tsx`, `state/gameOptions.ts` |

## Setup

Requires Node 18+ (tested on Node 21) and npm 10+.

```bash
npm install
```

## Development

Run both server and client with one command (proxied together via Vite):

```bash
npm run dev
```

Or in two terminals:

```bash
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173  <- open this in your browser
```

Open `http://localhost:5173` in multiple tabs/devices to play as multiple
seats.

## Tests

```bash
npm test
```

Runs the server's Vitest suite:
- `packages/server/test/movement.test.ts` — the Human Movement Phase engine,
  covering every case listed in the spec (confusion, distance always being
  raw straight-line hex distance rather than obstacle-aware pathfinding — an
  obstacle or Toadstool sitting directly on the line to one of two
  equal-distance lures no longer breaks that tie, since it only ever blocks
  actually entering that hex, never the reported distance behind it —
  per-Human stack-height priority when a single Human's two closest lures
  are tied on distance, turn-order priority between different Humans purely
  by player order (never by stack height), lure clearing freeing a confused
  Human mid-phase, acceleration on entry vs. starting on the marker,
  acceleration continuing straight in the Human's own direction of travel
  rather than re-seeking its lure (a case built specifically so the two
  would produce different destinations), a genuine two-equal-steps tie
  requiring a player choice, reconnect-safety of a pending path choice,
  Veil of Mist's attraction-radius cap excluding an out-of-range lure
  entirely, Moon's Ascendance covering 2 spaces per move — including
  composing with an Acceleration marker in the same tick — and Domain-hex
  arrival scoring its owner regardless of who owns the lure that drew a
  Human there, vs. an ordinary lure elsewhere just clearing without scoring),
  plus a Hunter moving, getting Confused, and tiebreaking by lure height
  exactly like any other Human (the engine never special-cases it there),
  and — Humans block each other, exactly one per hex — a Human routing
  around another Human via a genuine equally-short alternate step, and a
  Human that walks right up to a wall of obstacles or other Humans and then
  is permanently unable to get any closer, remaining genuinely attracted
  (never "blockedNoLure") the whole time since its raw distance to the
  walled-in lure never changes.
- `packages/server/test/integration.test.ts` — room creation/joining, unique
  Domain selection, start-game gating, turn rotation and legality checks, a
  full round through Human Movement back to the next round, the instant
  response-window flow, reconnection (valid/invalid tokens, seats surviving
  disconnect, host seat-release), and the "Draw a Card" basic action (costs
  1 action, adds exactly 1 card, usable repeatedly in the same turn, and
  rejected with no actions remaining).
- `packages/server/test/newContent.test.ts` — the real card/ability content:
  lure caps and hand-size stat modifiers from passive starting abilities,
  obstacle/marker placement and movement, obstacle placement being rejected
  onto a hex a Human currently occupies (a Human and an obstacle can never
  share a space either), the Toadstool max-2 relocation flow, reclaiming a
  specific card from the discard pile, redirecting a resolving card to a
  different player's hand (Faerie Bargain), a Landscape disabling Instants
  for the round (Eclipse), a multi-space pull toward a chosen lure (Siren's
  Call), a full-table hand rotation (The Queen's Banquet), and push/pull
  abilities/cards being restricted to directions relative to the acting
  player's own Domain — a pull (Ocean Sirens' starting ability) rejected
  moving away from it and accepted moving toward it, a push (Zephyr's Kiss)
  rejected moving toward it and accepted moving away from it, and the
  sideways-direction room toggle rejecting/accepting the same sideways move
  accordingly; and Discard & Draw discarding a player's entire hand and
  drawing exactly 4 cards back, rejected as a second use in the same turn.
- `packages/server/test/advancedContent.test.ts` — the interactive
  starting-abilities queue (all 4 targeted base Domains, in order), a
  repeatable Main Ability, Delayed Curse deferring a card's resolution to
  the next round (played reactively during a live response window), Frozen
  Magic extending a duration, retargeting a pending effect before it
  resolves (Impish Interference), cloning a pending effect (Shadow Copy),
  an inactive lure being ignored by Human attraction (Veil of Darkness),
  Threads of Fate overriding a specific upcoming spawn, Veil of Mist blocking
  attraction to an out-of-range lure for the round, and Moon's Ascendance
  moving a Human 2 spaces in a single Movement Phase tick — both played as
  real cards through `GameEngine`, not just at the pure-engine level — plus
  spawning: never doubling two Humans onto the same hex, an occupied
  designated hex spawning nothing there rather than relocating, and
  population plateauing (not growing forever) once every designated hex
  across both spawn sets is permanently occupied.
- `packages/server/test/domainBoards.test.ts` — Domain boards (the physical
  4-hex territories attached past one edge of the main board): correct side-
  number assignment for every player count from 2 to 6, every assigned hex
  genuinely sitting outside the main hexagon, and full `GameEngine`-level
  scoring — a Human reaching a player's Domain scores that player even when
  a rival owns the lure that drew it there, scoring works via forced
  movement onto a Domain hex with no lure involved anywhere on the board at
  all, and an ordinary lure away from any Domain just clears without
  scoring anyone; a lone Hunter reaching a Domain scores exactly -2.
- `packages/server/test/victoryConditions.test.ts` — the configurable
  Victory Condition system: a custom points target ending the game the
  instant it's reached, turns-mode timing (no early end before the turn
  limit, a unique leader ending it right at the limit, a tie extending play
  instead of ending immediately, resolution before the tie-extension round),
  the full nearest-townsfolk tiebreak (both a first-position resolution and
  a second-position one requiring a non-opposite 3-player Domain layout), a
  declared draw when no townsfolk remain to break a tie, and disabled cards
  never appearing in the deck or a starting hand.
- `packages/server/test/handSize.test.ts` — hand size limits: starting hand
  (5, or 8 for Moonlight Pixies) and the hard max (7, or 10 for Moonlight
  Pixies); no prompt when at or under the max; a mandatory discard prompt
  with the exact required count when over it, pausing the turn until
  resolved; rejecting a wrong discard count; a full discard-and-continue
  cycle; and Moonlight Pixies' own higher threshold specifically (not
  triggered at 9, triggered at 12).

## Production build

```bash
npm run build      # builds shared (typecheck) + server (tsc) + client (vite build)
npm start          # runs the server, which also serves the client's built assets
```

`npm start` runs the server via `tsx` (not the `tsc`-compiled `dist/`) so
relative ESM imports resolve without needing `.js`-extension rewriting —
simpler and just as fast to boot as compiled output for a Node process. The
`build` step still exists so `tsc` is exercised in CI/build pipelines as a
type-check gate.

## Environment variables

| Var | Where | Meaning |
|---|---|---|
| `PORT` | server | Port to listen on (default `4000`) |
| `CLIENT_ORIGIN` | server | Allowed CORS origin for the client (default `http://localhost:5173`; set to your deployed URL in production) |
| `CLIENT_DIST_PATH` | server | Override for where the built client lives (default `../client/dist` relative to the server) |
| `VITE_SERVER_URL` | client | Socket.IO server base URL; leave unset for same-origin (dev proxy or single-service prod deploy) |

See `packages/server/.env.example` and `packages/client/.env.example`.

## Deployment (single full-stack host)

The server serves the client's static build itself (see `packages/server/src/index.ts`),
so this deploys as **one service** on any Node host (Render, Railway, Fly.io,
a plain VM, etc.):

1. `npm install && npm run build`
2. Start command: `npm start` (equivalently `npm run start -w @fairy/server`)
3. Set `PORT` (most hosts inject this automatically) and `CLIENT_ORIGIN` to
   your public URL.
4. Persistent disk is **not** required — all game state is in-memory by
   design (spec: no database, games don't survive a restart). Just make sure
   your host doesn't idle/sleep mid-game if you want long play sessions.

## Editing game content

Card and Domain data reflects the real, author-confirmed content from the
"Fairy_Tale_Boardgame_card_Database_v2" spreadsheet (45 cards, 6 base + 4
Expansion Domains — note "Garden Gnomes" from earlier drafts is now **Earth
Gnomes**, matching that source). See `RULES_TODO.md` for exactly which
cards/abilities are implemented vs. pending a missing engine primitive, and
why.

Everything a rules-editor should touch lives in data files, not engine code:

- **Humans & scoring** — `packages/shared/src/data/humans.ts`
- **Domains & abilities** (wording/cost/targeting) — `packages/shared/src/data/domains.ts`.
  The actual *behavior* of each ability is a separate handler in
  `packages/server/src/game/engine/domainAbilities.ts`, keyed by the
  ability's `key` field — so a wording edit never requires touching logic,
  and a logic fix never requires touching the data file.
- **Enchantment cards** — `packages/shared/src/data/cards.ts` (same
  data/behavior split, via `effectKey` into `packages/server/src/game/engine/cards.ts`).
  A card only enters the playable deck when `implementationStatus: "implemented"`
  *and* isn't in the host's `disabledCardIds` (set on the client's Options
  screen, `packages/client/src/screens/Options.tsx` — see below).
- **Portal spawn positions/roster** — `packages/shared/src/data/spawns.ts`
- **Domain board placement** (which side of the board each player count
  uses, and the 4-hex attachment geometry itself) —
  `DOMAIN_SIDE_ASSIGNMENTS` in `packages/shared/src/data/config.ts` and
  `domainAttachmentHexes` in `packages/shared/src/hex/coordinates.ts`. This
  is a *board* concept, separate from the Domain *ability* data above — a
  Domain is both a kit of abilities and a physical piece of the board.
- **Named rule constants** (acceleration bonus, lure-clear mode, Toadstool
  max, action count, default Victory Condition, etc.) —
  `packages/shared/src/data/config.ts`
- **Victory conditions** (points target, turns-mode limits, the
  nearest-townsfolk tiebreak) — chosen per-room on the Options screen;
  engine logic lives in `packages/server/src/game/engine/victory.ts`.
- **Push/pull direction restriction** (whether "sideways" — neither toward
  nor away from the acting player's own Domain — is legal for push/pull
  abilities/cards) — chosen per-room on the Options screen
  (`pushPullSidewaysAllowed`, default: allowed); the underlying geometry is
  `classifyDirections` in `packages/shared/src/hex/coordinates.ts`, and the
  legality gate is `legalPushPullDirections` in
  `packages/server/src/game/engine/effectPrimitives.ts`.

Any value that was a guess rather than a confirmed rule is flagged with a
`TODO_RULE_CONFIRMATION` comment right next to it, and indexed in
`RULES_TODO.md`.

## What's intentionally out of scope (per the spec)

User accounts, pass-and-play, bots/matchmaking, a database, saved games
across server restarts, and spectators.

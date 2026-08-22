# RULES_TODO

Updated 2026-08-21 (twenty-first pass): Human Movement Phase distance is now
straight-line hex distance (`axialDistance`), not obstacle-aware BFS
pathfinding — the single root rule change everything else in `movement.ts`
follows from. Obstacles and other Humans still block *entering* a specific
hex, but never lengthen the distance used for attraction/priority. See
below.

Updated 2026-08-15 (twentieth pass): Discard & Draw is confirmed to discard
the player's entire hand (no selection) and draw exactly 4 cards back, flat
— replacing the old "discard any number you choose, refill to a target
size (5, or 10 for Moonlight Pixies)" behavior. See below.

Updated 2026-08-12 (nineteenth pass): confirmed a new basic action —
draw 1 card for 1 action, usable any number of times a turn, gated only by
actions remaining — and every used Domain ability is now marked with a
visible X on its mat's own printed checkbox, on the board and in the
expanded view, for every player to see (not just the ability's owner).

Updated 2026-08-12 (eighteenth pass): the board is now pointy-top-hex/
flat-overall-silhouette instead of the reverse, rotates per-viewer so your
own Domain always renders at the bottom, and each Domain's full player mat
(not just its art) sits clear of its own hexes at a fixed upright position
— see below for all three.

Updated 2026-08-12 (seventeenth pass): real per-Domain player-mat artwork
replaces the old text-only board banners, once-per-game Domain abilities now
show a visible unused/used marker, and clicking a Domain's banner (or its
name in the Scores table, or a "View full mat" button) opens the full mat
at readable size. Also confirmed: Domain abilities (the 3 non-Main,
non-starting ones) are once-per-game; the Main Ability is repeatable all
game, gated only by its action cost — this was already exactly how the
engine worked, just newly confirmed by the user rather than assumed. This
file tracks what's a documented simplification and what's still a guess vs.
confirmed.

## Twenty-first pass: movement distance is straight-line, not pathfinding

The user specified a foundational rules change to the Human Movement Phase
engine (`packages/server/src/game/engine/movement.ts`): distance — for both
which lure a Human is attracted to, and which Human gets priority to move
next when several are tied — is now raw straight-line hex distance
(`axialDistance`), never obstacle-aware BFS pathfinding (`shortestPath`,
previously imported from `hex/pathfinding.ts`). `shortestPath` is no longer
imported by `movement.ts` at all — every distance/direction question in
this file is now answered by two new pure-geometry helpers:

- `directStepCandidates(from, target)` — pure geometry, no board/occupancy
  awareness: every neighbor of `from` that is exactly 1 hex closer to
  `target` than `from` itself (always 0, 1, or 2 of them — 2 only when
  `from`/`target` aren't aligned along one of the hex grid's 3 main axes,
  e.g. the classic "genuine tie" geometry already covered by tests 17/18).
- `legalDirectSteps(board, from, target, movingHumanId)` — the above,
  filtered to hexes that are on the board and not currently blocked by an
  obstacle or another Human. An empty result means "no legal step this
  tick" — critically, the mover does NOT reroute or take a longer way
  around (raw distance never lengthens to accommodate a detour); it simply
  makes no progress this tick.

**What this changes in practice**: obstacles and other Humans still block
*entering* a specific hex exactly as before (`makePassable`, unchanged) —
but they no longer affect which lure looks closest, nor whether a lure
"counts" as reachable at all. A lure boxed in by a solid ring of obstacles
still attracts a Human from across the board (finite raw distance always
exists); the Human will walk right up to the wall's edge over successive
Movement Phases and then simply stop making progress forever once its one
straight-line approach is blocked — it never was, and never becomes,
"unreachable" in the distance sense. This also means an obstacle or
Toadstool sitting exactly on the straight line between a Human and a lure
no longer breaks a distance tie in favor of the other lure (previously,
routing around the obstacle added path length, which could tip a tie) —
the tie now survives untouched, since the obstacle only blocks entry to
that one hex, never the reported distance to what's behind it.

**Unaffected**: `resolvePathChoice`, `applyStep`, `runAccelerationBonusMovement`
(Acceleration was already pure straight-line continuation, no pathfinding,
since the thirteenth pass), `triggerRoundMovementBonus`, `clearLure`,
`collectHuman`, `handleArrival`, `resetMovedMarkers`,
`runMovementPhaseToCompletion` — none of these referenced `shortestPath` and
none needed to change. `runBonusMovement` (Moon's Ascendance) still can
produce a path-choice tie exactly as before, just computed via
`legalDirectSteps` now instead of BFS `firstSteps`.

**Tests** (`movement.test.ts`): rewrote the 4 tests whose entire premise was
BFS-specific and no longer holds:
- Test 4 (previously "equal geometric distance, unequal path distance due
  to an obstacle: attracted to the path-closer lure") — now demonstrates
  the *opposite*: the obstacle no longer breaks the tie at all; the Human
  becomes Confused exactly as it would with no obstacle present.
- Test 14 (previously "a toadstool changes path distance and can resolve a
  prior tie") — same inversion: the toadstool no longer changes anything;
  both boards now end up identically Confused.
- Test 16 and the "boxed in entirely by other Humans" test (previously
  asserting instant, permanent unreachability from the very first tick) —
  rewritten as 2-round simulations: round 1, the Human takes its one clear
  straight-line step same as normal; round 2 (after resetting only the
  Human's own `moved` flag, not the whole board, so the static wall of
  blockers doesn't get a chance to wander off itself mid-test), it's now
  adjacent to the wall and permanently stuck — `blockedNoLure` stays
  `false` throughout (it's genuinely attracted the whole time; this is a
  movement block, not a "no lure at all" state) — demonstrating the new
  "always finite distance, sometimes permanently blocked entry" behavior
  precisely.

All other 29 pre-existing tests needed zero changes — they were all set on
open boards with no obstacle placed where it would have changed a BFS path
length, so raw distance and BFS distance were always identical for them
regardless of which the engine used. Full suite: 108/108 passing.

## Twentieth pass: Discard & Draw now discards the whole hand and draws exactly 4

The user corrected the Discard & Draw action's rule: it discards the
player's ENTIRE hand and draws exactly 4 cards back — not the prior
"discard any number you choose, then refill up to a target size" behavior
(target was 5, or 10 for Moonlight Pixies, via the now-removed
`HAND_SIZE_AFTER_DISCARD_DRAW`/`handSizeAfterDiscardDraw`). The new count
(4) is flat, with no Domain-specific exception — Moonlight Pixies' larger
hand only affects their opening hand size and hard max, both untouched.

Server (`GameEngine.ts`'s `"discardDraw"` case): discards every card
currently in the player's hand (via `discardCard`, iterating a snapshotted
copy of the hand array since `discardCard` mutates it in place), then draws
up to `DISCARD_DRAW_COUNT` (4, `data/config.ts`) cards — stopping early only
if the deck+discard pile together run out, exactly like every other draw
call site. Still once-per-turn (`discardDrawUsedThisTurn`, unchanged) and
still costs 1 action. Removed the now-meaningless `cardIds` payload field
and the per-player `handSizeAfterDiscardDraw` state (it was never exposed
to the client — purely a server-internal target that no longer exists).

Client: the old "Discard & Draw" flow opened a card-selection UI (pick any
number of cards from `HandPanel`, then confirm) — no longer meaningful
since there's nothing left to choose. Replaced with a plain inline confirm/
cancel prompt ("Discard your entire hand (N cards) and draw 4 new ones?")
before submitting, since silently discarding a player's whole hand on a
single click seemed too easy to trigger by accident.

New tests (`newContent.test.ts`): discarding a known 3-card hand nets
exactly 4 new cards, the 3 original cards land in the discard pile, and the
deck shrinks by exactly 4; still rejected as a second use in the same turn.
Updated the pre-existing Moonlight Pixies test, which asserted the
now-removed field, to assert `handSizeMax` (their actual, unchanged, still-
relevant stat) instead. Full suite: 108/108 passing.

## Nineteenth pass: a "draw 1 card" basic action; used Domain abilities marked with an X visible to everyone

Two more confirmations from the user:

- **"Draw a Card" — a new basic action, 1 card for 1 action.** Added
  `GameEngine.ts`'s `"drawCard"` case, right alongside the other basic
  actions (`placeLure`, `playCard`, `useDomainAbility`, `discardDraw`) —
  spends 1 action, draws exactly 1 card via the existing `drawCard()`
  helper (which already handles reshuffling the discard pile back into an
  empty deck), then `maybeAdvancePhase` as usual. Deliberately *not*
  gated to once-per-turn (unlike `discardDraw`) or blocked by hand size —
  neither restriction was asked for, and both would've been inconsistent
  with how every other hand-growing action in this engine already works
  (hand-size-max is only ever enforced reactively, at the natural end of a
  turn, via the existing mandatory-discard interaction). Not to be confused
  with the *existing*, unrelated "draw 1 card automatically when your turn
  ends" mechanic in `maybeAdvancePhase` — that one is passive and
  unconditional; this new action is an explicit, action-costed player
  choice mid-turn. New client button ("Draw a Card") in the "Choose your
  action" panel, and `"drawCard"` added to `availableActions`
  (`engine/turns.ts`) so it gets the same enabled/disabled + reason
  treatment as the others. New tests in `integration.test.ts`.
- **Used Domain abilities marked with an X, visible to every player.** The
  seventeenth pass's "Used" state was only visible in `DomainAbilityPanel`
  — the private sidebar that only renders for *your own* Domain, so
  opponents had no way to see which of your abilities were already spent
  without asking. Since ability usage was never actually hidden information
  (`abilitiesUsed` is already sent to every player for every player, per
  `sanitize.ts`), this was a presentation gap, not a legality one. Fixed by
  overlaying a red X directly on the ability's own printed checkbox on the
  mat art itself — visible on the shared board and in the expand-to-full-
  size view, for anyone looking at that player's mat. The checkbox pixel
  positions had to be found per Domain (`board/matCheckboxes.ts`): the 6
  mat crops aren't identically sized, so a one-off Python/PIL script
  located each checkbox's actual printed square (connected-component
  detection on the dark outline pixels; 2 of the 18 needed a manual
  pixel-grid look since their checkbox sits close enough to the mat's own
  crop edge that the automated pass merged it with the corner scrollwork)
  — then every mark was verified by rendering an X onto each real mat image
  and inspecting it, not just trusting the coordinates. The on-board SVG
  version (`HexBoard.tsx`) has to additionally replicate the `<image>`
  element's own `xMidYMid meet` letterbox scaling to land the mark
  correctly regardless of the mat's on-screen size; the modal version
  (`DomainMatModal.tsx`) uses plain CSS percentage positioning against the
  image's own rendered box, which needs no such replication since a bare
  `<img>` has no separate box to letterbox within.

Full server suite: 106/106 passing (2 new tests for the draw action; the
mat-marking change is presentation-only, no server-side behavior changed).

## Eighteenth pass: flat-top-overall board orientation, per-viewer "your Domain is always at the bottom" rotation, full mats repositioned clear of their hexes

Three related requests from the user, all about board orientation/legibility:

- **Flat edge at top/bottom instead of a single hex-point** —
  `board/geometry.ts` paired flat-top individual hex tiles with a
  column-based axial-to-pixel formula, which (deliberately, per the prior
  comment) produced an overall board silhouette that comes to a single-hex
  point at the very top and bottom. The user wants a flat 2-hex-wide edge at
  top and bottom instead. Hex-grid math has a well-known duality here:
  swapping to pointy-top individual hex tiles (rotate `hexCornerPoints`'
  corner-angle start by 30°) *and* the matching row-based axial-to-pixel
  formula together flips the overall silhouette from pointy to flat —
  verified by rendering both orientations (a small Python/PIL script, not
  checked into the repo) and comparing side by side before touching the
  actual component, since this is pure client rendering with no live
  preview available. Zero effect on game logic — `hex/coordinates.ts` (the
  actual board-logic module) is untouched; this is presentation-only pixel
  math, exactly the separation the module's own header comment calls for.
- **Board rotates per-viewer so your own Domain is always at the bottom** —
  confirmed by the user: this makes orientation immediately obvious
  regardless of which of the 6 sides a player's Domain was randomly
  assigned to (`DOMAIN_SIDE_ASSIGNMENTS` shuffles this per game). `HexBoard`
  now takes a `yourPlayerId` prop; `rotationDeg` is computed once via
  `useMemo` — find the viewer's own `domainBoards` entry, compute its
  outward direction from the Portal in the canonical (unrotated) layout
  exactly like before, then solve for the rotation that points that
  direction straight down (`90 - angleOfOutwardVector`). Every pixel
  position used for rendering (hex tile corners *and* centers, pieces,
  Domain hexes, the mat's anchor point) routes through one `toScreen()`
  helper that applies this same rotation around the Portal's canonical
  pixel position — a rigid rotation of the whole layout, so adjacency/
  tiling between hexes is unaffected (confirmed in the same Python
  prototype: rotating hex *centers* without also rotating each tile's own
  corner-angle by the identical amount would leave gaps between neighbors,
  so `hexCornerPoints` gained an `extraRotationDeg` parameter specifically
  for this). Text and emoji glyphs (human/obstacle/lure icons, labels)
  render at the rotated *position* but are never individually rotated, so
  they stay upright at any board angle — only geometry (tile shapes, piece
  positions) turns. Verified for 2, 3, and 6-player tables, and for more
  than one viewer within the same 2-player game (i.e. confirmed each
  player genuinely sees themselves at the bottom, not just one hardcoded
  case) via the same offline rendering check.
- **Full mats repositioned so they never cover their own Domain's hexes** —
  the seventeenth pass's mats sat close enough to their edge that they
  could overlap the very hexes they were labeling (visible in a screenshot
  the user shared). Now: mats never rotate to align with their edge at all
  (upright at any board angle — simpler, and per the user, this whole
  "flush against a tilted edge" approach was part of what looked messy),
  and sit far enough out along the outward ray to clear both the Domain's
  4 hexes and the mat's own footprint at any angle (clearance = hex-row
  depth + the mat box's own half-diagonal, not just half-width, since an
  upright box's corner can swing closer to the board than its edge
  depending on the angle). A nice side effect of "upright, offset along the
  outward ray, after the per-viewer rotation": for the 4 domains whose
  outward direction ends up diagonal, the mat naturally lands near one of
  the 4 corners of the board's bounding square; the other 2 (dead ahead/
  behind the viewer) land centered above and below — which is exactly the
  "corners of the box" placement the user asked for, without needing any
  special-case corner-assignment logic.

Full server suite unaffected (104/104) — this is 100% client rendering; no
game-state or legality logic reads pixel space.

## Seventeenth pass: real player-mat art, once-per-game ability markers, expandable full-size mat view

The user provided real card-sheet artwork for all 6 base Domains (two
1024x1536 PNGs, 3 Domains stacked per sheet: Ocean Sirens/Forest Elves/Wind
Djinn, and River Nymphs/Moonlight Pixies/Earth Gnomes) and asked for it to
replace the placeholder board banners, plus two related UI asks bundled in
the same message.

- **Cropping**: the 3 cards per sheet aren't evenly spaced (heights 547/519/
  470px and 562/516/458px, not a clean 512px thirds split) — found the true
  boundaries by detecting the sharpest row-to-row color-difference spikes
  near the expected seams (a Python/PIL script, not a reusable tool checked
  into the repo) rather than assuming equal thirds, then verified each of
  the 6 crops visually for text/art bleed before saving anything. Two
  derived assets per Domain: `public/board-art/mat-{domain}.webp` (the
  full card — art + every ability's full rules text, for the new expanded
  view) and `public/board-art/domain-{domain}.webp` (just the art + title
  + Starting Ability corner, a fixed 490x430px crop applied identically to
  all 6 so they share one aspect ratio — replaces the old banner at the
  exact same filenames, so no code path needed renaming). Source PNGs kept
  at `board-art-source/kingdoms/` for provenance, matching the existing
  `board-art-source/` convention.
- **On-board banner**: `HexBoard.tsx`'s `DOMAIN_BANNER_ASPECT` changed from
  `700/273` (a wide 2.56:1 text pennant) to `490/430` (≈1.14:1, near-square,
  matching the new art crop) — `bannerHeight`, the label offset, and the
  SVG viewBox bounds all already derived from this one constant, so nothing
  else needed to change for the new (much taller) banner to lay out and
  fit correctly.
- **Once-per-game marker**: `DomainAbilityPanel.tsx`'s 3 repeatable-until-
  used abilities each show a small empty square marker (`.ability-unused-
  marker`) next to their "Use" button while `abilitiesUsed[i]` is false;
  once used, the marker is simply not rendered at all (matching the user's
  own wording — "the marker is removed" — rather than switching to a
  checked/crossed-out state). The Main Ability has no marker at all, since
  it isn't once-per-game.
- **Expand-to-full-size mat view**: new `DomainMatModal.tsx` — a simple
  backdrop-click/Escape/✕-to-close lightbox showing `mat-{domain}.webp` at
  up to 95vw/95vh. Wired to three separate entry points, all opening the
  same modal: clicking a Domain's on-board banner (any player's, not just
  your own — `HexBoard`'s `onDomainMatClick`, the banner `<image>` is no
  longer `pointerEvents: none`), clicking a player's Domain name in the
  Scores table (`PlayerSidebar`'s `onViewDomainMat`), and a dedicated "View
  full mat" button next to your own "Domain Abilities" heading.

No server-side changes at all this pass (art/UI-only); full suite still
104/104 passing.

## Sixteenth pass: clicking an occupied hex now reaches the hex, not just whatever's drawn on top of it

The user reported lure stacking (placing a second lure of your own on a hex
that already has one, growing its height) as broken. The server-side rule
was actually already fully correct and already tested (`lures.ts`'s
`isLegalLurePlacement`/`placeLure` already allow same-owner stacking and
reject a different owner's) — this was a pure client bug. `HexBoard.tsx`
renders each piece (lure, obstacle, Acceleration marker, Human) as its own
clickable SVG element layered on top of the hex polygon underneath it, each
wired to its own `on*Click` callback. Those callbacks only ever handled the
specific "pick this exact piece" targeting modes (e.g. `onLureClick` only
handled `picks: "lureStack"` steps) — they had no fallback, so a click
landing on a piece during any OTHER mode (`placingLure`, or a `boardSpace`
targeting step whose legal destination happens to already hold a piece) was
just silently swallowed; the hex polygon's own `onHexClick` never fired
because the piece intercepted the click first. Fixed generally rather than
just for lures, since the same interception affects e.g. pushing a Human
onto a hex with an Acceleration marker on it (explicitly a legal
destination — Humans and markers are meant to share a hex) or onto a lure
(also explicitly legal — that's how a lure clears): every piece-click
callback (`onHumanClick`/`onLureClick`/`onObstacleClick`/
`onAccelMarkerClick`) now also receives that piece's own position, and
falls back to calling `onHexClick` with it whenever the current mode isn't
actually picking that kind of piece. New test
(`integration.test.ts`): placing a lure twice on the same hex keeps it as
one stack and grows its height to 2 (the existing test suite already
covered the rejection of stacking on an *opponent's* lure, just not the
success case for your own). Full suite: 104/104 passing.

## Fifteenth pass: 3 actions per turn; game screen fills the viewport; Domain ability details always visible

The user confirmed a player gets **3** actions per turn, not 2 —
`ACTIONS_PER_TURN` in `packages/shared/src/data/config.ts`. Also fixed a
latent inconsistency this uncovered: `engine/setup.ts` set a new game's
initial `actionsRemaining` to a hardcoded `2` instead of referencing
`ACTIONS_PER_TURN` — harmless while the two values happened to match, but
exactly the kind of drift a named constant is supposed to prevent. Updated
the one test that asserted the literal turn allotment
(`integration.test.ts`); the handful of other tests that set
`actionsRemaining` to a specific number do so to stage a controlled
"exactly enough actions for this N-cost ability" scenario, not to assert the
default, so they were unaffected.

Two client-only UI fixes reported in the same message:

- **Game screen not using the full browser width** — `.app-shell` (wrapping
  every screen) has always capped at `max-width: 1400px`, which reads fine
  as a centered column for menu-style screens (Home, Lobby, Options) but
  wastes a lot of a wide monitor's width on the actual board. `App.tsx` now
  adds an `app-shell-wide` modifier class specifically when
  `screen === "game"`, which drops the cap (`styles.css`) — every other
  screen is unaffected.
- **Domain ability details not visible** — `DomainAbilityPanel.tsx`'s 3
  repeatable/instant abilities (the ones populating `domain.abilities`, e.g.
  Irresistible Song, Mesmerize) rendered as a bare button with the
  description only reachable via the HTML `title` hover tooltip — invisible
  on touch devices and easy to miss even on desktop, unlike every other
  card/ability surface in the app (`HandPanel`'s Enchantment cards, and this
  same panel's own Starting/Main Ability lines, which already show rules
  text as plain visible text). Rewrote each ability as a small detail card
  (name, timing, rules text all visible, `Use` as its own button) matching
  that established pattern; new `.ability-list`/`.ability-detail` styles
  replace the old tooltip-only `.ability-btn`.

## Fourteenth pass: push/pull abilities are restricted to directions relative to the acting player's own Domain

The user corrected another rule this project had been implementing as free
player choice: push/pull abilities and cards may only move a Human relative
to the ACTING player's own Domain, never in an arbitrary direction. Pull
(Ocean Sirens' starting ability, Siren's Call, Siren's Lure, Nymph's Embrace,
Ocean Sirens' Main Ability) may only move a Human toward the caster's own
Domain, optionally also sideways. Push (Wild Gale, Zephyr's Kiss, Gust, Wind
Djinn's Main Ability) may only move a Human away from the caster's own
Domain, optionally also sideways. Whether "sideways" (the 2 of the 6 hex
directions that neither approach nor retreat from the Domain) counts as
legal is a new per-room toggle (default: allowed) — see Options screen.

Scoped to exactly the abilities/cards whose own rules text says "push" or
"pull" (`sirens-starting`, `sirensMain`, `sirensCall`, `nymphsEmbrace`,
`sirensLureCard`, `gust`, `djinnMain`, `wildGale`, `zephyrsKiss`) — not
"move a Human" effects with different flavor text (Will-o'-the-Wisp, Secret
Trail, Hidden Burrow, Twisted Fate, Fairy Ring, Tailwind, The Gate Beckons),
which are unaffected.

**Geometry**: `hex/coordinates.ts::classifyDirections(pos, targetHexes)` — a
new pure primitive shared by client and server — classifies each of `pos`'s
6 neighbor directions by whether stepping that way strictly decreases
("toward"), leaves unchanged ("sideways"), or strictly increases ("away")
plain hex distance to the nearest hex in `targetHexes` (here, the acting
player's own 4-hex Domain board). This is a genuine, well-known hex-grid
property, not always a clean 2/2/2 split — a position exactly axis-aligned
with its target instead splits 1/2/3 — but "toward" and "away" are always
both non-empty for any position that isn't literally on the Domain itself,
so the restriction is never vacuously impossible to satisfy.

**Server** (`effectPrimitives.ts`): `legalPushPullDirections(state, playerId,
pos, kind)` wraps `classifyDirections` with the room's
`pushPullSidewaysAllowed` toggle. `pushHumanStraightLine` and
`pullTowardLure` (and, through it, `pullTowardOwnNearestLure`) now take a
`playerId` and reject/stop on an illegal direction; the `sirens-starting`
handler in `domainAbilities.ts` gained the same check directly (it has no
lure to path toward at setup, so it was implemented as free-choice movement
before this pass — see the first pass's note on this, now superseded).
`pullTowardLure`'s per-step re-pathing simply stops early (rather than
erroring) if a step's direction would be illegal, same as the existing
"lure reached" / "lure unreachable" early-stop reasons; if literally zero
steps could be taken, `pullTowardOwnNearestLure`/`sirensCall` now return an
explicit error instead of silently consuming the card/ability for no effect.

**New config**: `RoomConfigInput.pushPullSidewaysAllowed` (default `true`,
`DEFAULT_PUSH_PULL_SIDEWAYS_ALLOWED` in `data/config.ts`), threaded through
`Room`/`ServerGameState`/`PersonalizedGameView.config` exactly like
`victoryCondition`; persisted client-side in `state/gameOptions.ts` alongside
the other Options-screen choices, with its own toggle there.

**Client**: the same "don't offer a destination the server will reject"
principle from the twelfth pass applies again here — `targetingScripts.ts`'s
`BoardSpaceConstraint` gained an optional `pushPull: "push" | "pull"` tag on
the 5 steps that are genuine player-chosen destinations (`wildGale`,
`zephyrsKiss`, `gust`, `djinnMain`, `sirens-starting`'s `to` field);
`legality.ts` gained a `legalPushPullDirections` mirroring the server's, used
to further filter `legalBoardSpacesForStep`'s candidates. The other 4
pull cards/abilities (`sirensCall`, `sirensMain`, `nymphsEmbrace`,
`sirensLureCard`) have no player-chosen destination at all (automatic
pathfinding toward the caster's nearest own lure) so needed no client
targeting change — the server-side partial-stop/explicit-error handling
covers them.

New tests (`newContent.test.ts`): Ocean Sirens' starting ability rejects a
pull away from the caster's Domain and accepts one toward it; Zephyr's Kiss
rejects a push toward the caster's Domain and accepts one away from it;
sideways pull is rejected with the toggle off and accepted with it on —
using `classifyDirections` directly in the tests (rather than hardcoded
board coordinates) so they stay correct regardless of the random per-game
Domain-side shuffle; verified stable across 15+ repeated runs. Also fixed
two existing tests (`testUtils.ts::resolveStartingAbilities`, and one inline
loop in `advancedContent.test.ts`) that picked Ocean Sirens' starting pull
direction with a hardcoded/naive neighbor search — now direction- and
occupancy-aware. Full suite: 103/103 passing, stable across 10+ repeated
full-suite runs (domain-side assignment is randomized per game).

## Thirteenth pass: Acceleration is a straight continuation, not a lure re-seek; board rendering/UX fixes

The user corrected a rule this project had been guessing at: landing on an
Acceleration marker continues the Human exactly one more space in the same
direction it was already traveling — never a fresh lure-seeking move, and
therefore never a second path-choice tie. The previous implementation (see
the third pass) reused `runBonusMovement` — the exact same "recompute
attraction, pathfind toward the current lure" logic Moon's Ascendance uses —
for both mechanisms, which was a reasonable-looking default but wrong for
Acceleration specifically. Fixed in `movement.ts`: `applyStep` now captures
the direction of the step just taken (`destination - human.position`,
captured before position is overwritten, so it works identically whether
the step was primary or itself a chained bonus step) and a new
`runAccelerationBonusMovement` extends straight in that direction — no
attraction recompute, no path choice, ever. If the next hex is off-board or
blocked (obstacle or another Human), the bonus simply doesn't happen; the
Human stays on the marker. Moon's Ascendance is unaffected — it still calls
the original lure-seeking `runBonusMovement` via `triggerRoundMovementBonus`,
including when *its* steps cross a marker (which now correctly triggers the
new straight-line bonus on top, composing exactly as before). Every existing
Acceleration test happened to use a lure placed directly in line with the
marker, so old vs. new behavior was indistinguishable and all passed
unchanged; added a new test (`movement.test.ts` 13b) with the lure placed
off that line specifically to prove the two behaviors diverge and the
straight-line one wins. Full suite: 100/100 passing.

Also fixed three client-only rendering/UX issues reported by the user in the
same message, none touching server logic or requiring new server tests:

- **Moved-Human fade lingering into the next turn** — `human.moved` doesn't
  reset until the *next* Human Movement Phase starts (`resetMovedMarkers`),
  so a Human faded correctly during the movement phase itself but stayed
  faded all through the following action phase too, since the client had no
  way to know the flag was now stale rather than current. `HexBoard` gained
  a `fadeMovedHumans` prop that `GameScreen` sets to
  `view.phase === "human-movement"` — the fade only ever shows while it's
  actually live information.
- **Lure/Acceleration-marker icons drawn at a hex corner** — both were
  offset toward a corner (`+14/-13` for lures, `-17/-13` for markers),
  apparently to dodge overlapping a Human/obstacle icon on a shared hex.
  Recentered both on the hex (matching the obstacle icon's own convention)
  per the user's explicit request.
- **A square focus-ring around a clicked hex** — every hex `<polygon>` is
  `tabIndex={0}` (for keyboard/a11y), so clicking one gave it browser-default
  focus styling — a rectangle around the polygon's bounding box, reading as
  an ugly square over a hex. `.hex-tile:focus { outline: none; }` in
  `styles.css`; hex selection already reads correctly through `.hex-legal`'s
  own fill-color change (untouched).

## Twelfth pass: 2-step targeting flows now offer only server-legal destinations

The user reported an error using Ocean Sirens' starting ability (pick a
Human, then pick where to pull it 1 space) — clicking almost any hex during
the second step got rejected by the server. Root cause was entirely
client-side: `GameScreen.tsx`'s `legalHexes` computation for a `"boardSpace"`
targeting step was context-free — `emptySpaces(view)`, the whole board minus
obstacle/lure hexes — regardless of what was picked in an earlier step of
the same flow (here, the selected Human's position, which the destination
must be adjacent to). The server was correctly rejecting the illegal
destinations the UI was offering; nothing was wrong server-side.

This pattern — pick an entity, then pick a destination constrained relative
to it (adjacent, exactly N spaces in a straight line, within N spaces,
adjacent to an obstacle/the Portal, etc.) — is used by roughly 20 cards/
abilities, not just Ocean Sirens, so the fix is general rather than a narrow
patch: `targetingScripts.ts`'s `TargetStep` gained two optional declarative
fields, `boardSpaceConstraint` (mirrors the specific geometric check the
server handler performs — `adjacent`, `straightLine`, `within`,
`adjacentToObstacle`, `adjacentToPortal`, `noAdjacentHuman`) and
`boardSpaceOccupancy` (`"empty"` — no obstacle/lure/Human, for placement
effects; `"emptyExceptLure"` — no obstacle/Human but landing on a lure is
fine, since that's how forced Human movement clears one; `"unrestricted"` —
the server performs no occupancy check on this field at all, e.g. Wrong
Turn/Impish Interference's effect-redirect destination, or lure moves like
Dance of Mischief/Nymph's Main/Flowing Stream that the server never gates on
`isSpaceEmpty`). `legality.ts` gained `legalBoardSpacesForStep`, which reads
those two fields plus the step's own `collected` values (resolving a prior
pick — Human/lure/obstacle/marker id — back to a board position by looking
up which `picks` kind collected it) to compute the actual legal set,
replacing the old context-free `emptySpaces`. Every affected card/ability
was checked individually against its real server handler in `cards.ts`/
`domainAbilities.ts` to make sure the client constraint matches exactly
(right down to quirks like Giant's Stride/Whirlwind's "up to N spaces, no
occupancy check on the *source* hex" or Dance of Mischief/Nymph's Main
having no destination-occupancy check server-side at all). `emptySpaces`
also had its own smaller version of the same class of gap — it excluded
obstacle/lure hexes but not Human-occupied ones — folded into the new
function's `"empty"` occupancy case rather than left as a separate,
still-broken helper. No server-side change of any kind; full suite still
99/99 (this was purely a client legality-hint bug, unreachable from
server-side tests since they submit already-known-legal targets directly,
bypassing the UI). Verified via a full `npm run build` (typecheck across all
three packages) and careful manual review of every rewritten `TargetStep`
against its handler — the project has no client-side automated test runner.

## Eleventh pass: obstacle placement respects Human occupancy too

The user confirmed a Human whose only route to a lure runs through an
obstacle simply won't move — which `movement.ts` already did correctly
(`obstacleBlocksAt`/`makePassable`, proven by the pre-existing "an obstacle
can make a lure completely unreachable" test). But that's only one direction
of "a Human and an obstacle can never share a space." The other direction —
placing or relocating an obstacle *onto* a hex a Human currently occupies —
had no check at all: `obstacles.ts::isSpaceEmpty` tested only for existing
obstacles and lure stacks, never Humans, and literally every obstacle/
Toadstool placement or relocation call site across `cards.ts` and
`domainAbilities.ts` (starting abilities included) gates through that one
function. Fixed by adding a Human-occupancy check to `isSpaceEmpty` itself —
one change, correct everywhere, same "single choke point" pattern as the
tenth pass's `passableForForcedMove` fix. Acceleration markers were
deliberately left untouched: unlike obstacles, a Human is *supposed* to
share a hex with one (that's literally how a Human triggers its bonus-step
effect on arrival), so excluding them there would break that mechanic.
New test: `newContent.test.ts` — playing Seeds of the Elder Grove (a Tree)
targeted at a hex a Human occupies resolves with no obstacle placed there.
Full suite: 99/99 passing.

## Tenth pass: one Human per hex — movement, spawning, and forced movement

The user asked why two Humans could start on the same space and confirmed
the real rule: Humans never share a hex. A blocked Human routes around if an
equally-short alternate path exists, or simply doesn't move this phase if it
doesn't — it never pushes through.

- **Movement Phase** (`movement.ts`) — `HUMANS_BLOCK_EACH_OTHER` flips from
  `false` to `true`. This isn't new plumbing: `makePassable()` already
  excluded Human-occupied hexes from pathfinding behind this flag (the
  mechanism was built and dormant, presumably in case the rule went the
  other way) — flipping it means `shortestPath` naturally routes around an
  occupied hex when a same-cost detour exists, or returns no path (the same
  "no legal move closer" fallback obstacles already produce) when it
  doesn't. Verified against all 30 pre-existing `movement.test.ts` cases
  with zero changes needed — none of them had Humans anywhere near each
  other's paths.
- **Spawning was the actual bug the user saw** (`setup.ts::spawnHumans`) —
  each Portal spawn set only has 3 designated ring positions (see the fifth
  pass) but spawns 4 Humans, so the 4th was landing squarely on the 1st's
  hex every time; a leftover Human from a previous round sitting on a
  designated position had the same effect. First fix attempt relocated the
  overflow to the nearest empty hex — the user then corrected that: an
  occupied designated hex (a Human's own, or the Hunter's Portal-center
  position) spawns **nothing** there at all, no relocation. One fewer Human
  that round, full stop; if every designated hex across both spawn sets is
  occupied, nothing spawns at all. Confirmed by
  `advancedContent.test.ts`'s plateau test: population grows through the
  initial spawn (set A, 4 pieces incl. Hunter) and the first alternation to
  set B (+3, Hunter skipped — the Portal center is still taken), then stays
  completely flat forever once both sets' hexes are all occupied, with
  nobody ever moving away to free one up.
- **Forced-movement abilities/cards** — the same rule needed to hold here
  too, or it would just resurface via Gust, Siren's Call, Twisted Fate,
  Traveler's Fire, etc. `effectPrimitives.ts::passableForForcedMove` (used
  by nearly every forced-movement pathfinding call) now excludes
  Human-occupied hexes alongside blocking obstacles — one change,
  automatically correct everywhere it's already used for pathfinding
  (pulls, Tailwind, Pixie's Prank, Fairy Ring, The Gate Beckons, Twisted
  Fate's farthest-neighbor search). `pushHumanStraightLine` bypassed that
  helper (it checked obstacles directly), so it got its own explicit
  occupancy check. Traveler's Fire moves several Humans off one pre-move
  snapshot by design ("so a Human's own move can't pull it into or out of
  range mid-resolution") — added a re-check immediately before each
  individual move, since an earlier Human in that same resolution could by
  then have landed on a later one's snapshotted first step; skip (don't
  move) rather than ever double up.
- New tests: `movement.test.ts` — a Human routing around a blocker via a
  genuine equally-short alternate (reusing the same tie geometry as tests
  17/18), and a Human fully boxed in by other Humans simply not moving
  (mirrors the existing obstacle-boxed-in test, swapping trees for Humans).
  `advancedContent.test.ts` — the initial spawn never doubles up; an
  occupied designated hex spawns nothing there instead of relocating
  (asserted directly on the Human count, not just non-overlap); and the
  population-plateau test above. Full suite: 98/98 passing.

## Ninth pass: Hunter penalty corrected to -2; movement confirmed unaffected

The user asked to confirm two things about the Hunter: that it moves during
the Human Movement Phase like any other Human, and that reaching a Domain
scores -2. Checked both:

- **Movement — already correct, now locked in by tests.** `movement.ts`
  never special-cases `definitionId` anywhere in attraction, path-choice, or
  arrival logic — a Hunter is just another `HumanInstance` and moves,
  gets Confused, ties on lure height, and gets collected exactly like an
  Adult/Child/Baby/Lover/Mother. New tests in `movement.test.ts` (a Hunter
  walking a 2-step approach to a lure across two Movement Phases; a Hunter
  Confused-then-resolved by lure height) exist specifically to pin this
  down, since nothing previously exercised a "hunter"-typed
  `HumanInstance` through the pure movement engine directly.
- **Domain scoring value — a real correction.** `humans.ts`'s Hunter
  `basePoints` was `-3`; the user confirmed it should be `-2`. Fixed at the
  single source of truth (`packages/shared/src/data/humans.ts`) — scoring
  (`engine/scoring.ts::computeScoreBreakdown`) reads `basePoints` generically
  for every Human type, so nothing else needed to change. New test in
  `domainBoards.test.ts` collects a lone Hunter into a Domain and asserts
  the resulting score is exactly -2.
- **Note:** the "townsfolk" concept used by the turns-mode nearest-townsfolk
  tiebreak (`engine/victory.ts::breakTieByNearestTownsfolk`, added in the
  seventh pass) deliberately excludes Hunters (`!isHazard`) — that's
  unrelated to this pass and unchanged: it's specifically about which
  Humans count toward *that* endgame tiebreak, not about movement or Domain
  scoring, where a Hunter behaves like any other Human.

## Eighth pass: hand size max + forced end-of-turn discard

The user asked "did we implement a hand start size of 5 / max of 7 (8 / 10
for Moonlight Pixies), discard down to max at end of turn" — the honest
answer was *partially*. Starting hand sizes already matched. But the "max"
numbers only existed as `handSizeAfterDiscardDraw`, the refill target for
the optional, voluntary, once-per-turn `discardDraw` action — nothing
anywhere compared a hand's size to a cap, and nothing forced a discard. This
was a real functional gap, not a wording one; it's now implemented as its
own, separate mechanic:

- **`packages/shared/src/data/config.ts`** — `HAND_SIZE_START` (5),
  `HAND_SIZE_MAX` (7), `MOONLIGHT_PIXIES_HAND_SIZE_START` (8),
  `MOONLIGHT_PIXIES_HAND_SIZE_MAX` (10). `HAND_SIZE_AFTER_DISCARD_DRAW`
  (5, or 10 for Moonlight Pixies) is untouched and still governs only the
  unrelated `discardDraw` action's refill target.
- **`ServerPlayerState.handSizeMax`** (`state.ts`) — set at setup
  (`setup.ts`) from the constants above per Domain.
- **Enforcement** (`GameEngine.ts`, `maybeAdvancePhase`'s `player-turn`
  branch) — right after a turn's automatic end-of-turn draw (the one that
  already happened on every turn end), if the ending player's hand still
  exceeds `handSizeMax`, a new `"mandatoryDiscard"` pending interaction
  opens for them (`openMandatoryDiscardInteraction`), and the turn does
  **not** advance to the next player (or into the Human Movement Phase, if
  they were last in turn order) until they respond. The turn-advancement
  logic itself was factored out into `finishPlayerTurn()` so both the normal
  path and the discard-resolution response handler call the same code.
  Response handling requires discarding *exactly* the required count (not
  "at least") — validated card-by-card against their actual hand before
  anything is moved to the discard pile.
- **Client** (`GameScreen.tsx`) — a dedicated prompt (reusing `HandPanel`'s
  multi-select mode, the same one the voluntary discard-and-draw action
  already uses) appears whenever this interaction targets you, showing
  exactly how many cards you must pick; the Confirm button stays disabled
  until the count matches.
- Exposed to the client for display via `PublicPlayerView.handSizeMax`
  (`events.ts`/`sanitize.ts`), e.g. so the UI could show "7/7" or a
  Moonlight Pixies player's "10" cap if desired.
- **Test note**: an early version of the Moonlight Pixies test for this was
  genuinely flaky — forcing a player to be `activePlayerId` and ending their
  turn can, if they land as "last in turn order," roll the engine all the
  way into real Human Movement Phase processing as a side effect, which can
  independently open an unrelated pending interaction (a genuine movement
  path-choice tie) depending on where starting abilities happened to place
  things. Fixed by pinning `firstPlayerId` so "end this turn" always just
  hands off to the other player in these tests, isolating the hand-size
  check from unrelated movement-phase randomness. New tests:
  `packages/server/test/handSize.test.ts` (8 cases) — starting sizes for
  both normal and Moonlight Pixies Domains, no prompt at/under the max,
  a prompt with the exact discard count when over it, rejecting the wrong
  discard count, a full resolve-and-continue cycle, and Moonlight Pixies'
  own 10-card threshold (not triggered at 9, triggered at 12). Full suite:
  89/89 passing.

## Seventh pass: Options screen + configurable Victory Conditions

The user specified this precisely, so almost nothing here is a guess — it's
recorded mainly so the exact mapping from their words to the code is
traceable.

- **Card on/off toggling** — the old fixed "blitz/standard/endurance" `mode`
  enum is gone entirely (it was never a confirmed rule, just an earlier
  placeholder). A new client screen, `packages/client/src/screens/Options.tsx`,
  lists every implemented Enchantment/Landscape card with a checkbox; the
  chosen `disabledCardIds` list is saved to this browser's `localStorage`
  (`state/gameOptions.ts`) and applied the next time this browser creates a
  room. `playableDeckDefinitions(disabledCardIds)` in
  `shared/data/cards.ts` filters them out of the actual shuffled deck
  (`setup.ts::buildDeck`) — a disabled card never enters the deck or anyone's
  starting hand. Domain abilities are untouched — "cards" means the
  Enchantment/Landscape deck only, not a player's chosen Domain kit.
- **`VictoryCondition`** (`packages/shared/src/types.ts`) — a tagged union:
  `{ kind: "points", targetScore }` or `{ kind: "turns", turnLimit,
  tieExtensionLimit }`. Chosen per-room on the Options screen (defaults:
  points/8) and threaded through `RoomConfigInput` → `RoomConfigState` →
  `buildInitialGameState`, same pipeline every other lobby setting already
  used.
- **Points mode** — unchanged mechanically from the old system, just with a
  freely configurable target instead of 3 fixed presets; `targetScore`
  defaults to 8. `checkVictory` (unchanged) still fires the instant anyone
  reaches it.
- **Turns mode** (`engine/victory.ts::checkTurnBasedEnd`, called from
  `GameEngine`'s `round-cleanup` transition, once per completed round,
  before the round counter advances):
  - Play runs `turnLimit` rounds (default 10). Once that round finishes, the
    single highest score wins outright.
  - A tie at that point does **not** end the game — play simply continues,
    re-checked at the end of every subsequent round, until `tieExtensionLimit`
    (default 12).
  - Still tied at `tieExtensionLimit`: **nearest-townsfolk tiebreak.** For
    each tied player, every remaining non-Hunter Human on the board
    ("townsfolk" — a Hunter is a hazard, not a townsfolk, so it's excluded)
    is sorted by shortest-path distance from the *closest* of that player's
    own 4 Domain hexes. The tied players' sorted distance lists are compared
    position by position — nearest vs. nearest first, then next-nearest vs.
    next-nearest, and so on — narrowing the tied set at the first point of
    difference. If every position ties, or there are no townsfolk left on
    the board at all, the game ends in a declared draw
    (`ServerGameState.drawPlayerIds`, surfaced to the client for the End
    Game screen) rather than picking an arbitrary winner.
  - `targetScore` is set to `Infinity` internally for turns-mode games so
    the existing points-based `checkVictory` early-exit simply never fires
    — turns mode has its own, separate end condition, not a hybrid of both.
  - Verified with a 3-player scenario (not 2) for the "second-nearest breaks
    a first-nearest tie" case: two players on *diametrically opposite* board
    edges (the only layout a 2-player game ever uses) can never both be
    farther from a second townsfolk than they are from a tied-nearest one —
    moving away from one opposite Domain always moves toward the other. This
    was caught empirically (a flaky-looking test), not assumed.
- New tests: `packages/server/test/victoryConditions.test.ts` — configurable
  points target, turns-mode timing (before/at/after the turn limit), tie
  extension continuing play, resolution before the extension limit, the full
  nearest-townsfolk tiebreak (both a first-position resolution and a
  second-position one, the latter across a non-opposite 3-player Domain
  layout), a declared draw when no townsfolk remain, and disabled cards
  never appearing in the deck or a starting hand.

## Sixth pass: movement priority bug fix — height vs. player-order were swapped

The user supplied the full, exact priority algorithm for the Human Movement
Phase. Comparing it line by line against `movement.ts` surfaced a real bug,
not a wording gap: the engine was using **stack height** to decide *whose
turn resolves next* when two different Humans (each already unambiguously
attracted to their own single nearest lure) tied on distance — but per the
confirmed rule, that tie is broken by **player order alone**. Stack height
only belongs in a completely different decision: which lure a *single*
Human targets when it has two-or-more lures tied at its own closest
distance. That per-Human height tiebreak didn't exist at all before this
pass — any such tie went straight to Confused, even when one of the tied
lures was taller.

- **`resolveAttraction(board, human)`** (new, `movement.ts`) — the single
  source of truth for "which lure (if any) is this Human attracted to right
  now": closest path distance wins; a distance tie is broken by the tallest
  stack among the tied lures; if height is *also* tied, the Human is
  Confused. Both `recomputeAttraction` (the per-round pass over every
  Human) and `runBonusMovement` (Acceleration / Moon's Ascendance
  continuation steps, which had their own duplicate — and equally buggy —
  copy of this logic) now call this one function instead of each
  reimplementing it slightly differently.
- **`findNextHumanToMove`** — the *turn-order* tie-break (which Human, among
  several simultaneously eligible at the same minimum distance, moves this
  tick) no longer looks at stack height at all. It sorts strictly by
  `firstPlayerOrder` rank of each Human's own (already-resolved) target
  lure's owner, with a final stable fallback (original array order) only
  for the edge case of two tied Humans both targeting lures owned by the
  same player.
- **Test fixed, not just added**: `movement.test.ts`'s test 6 previously
  asserted the *old, incorrect* behavior directly (a taller-but-later-turn-
  order stack's Human moved first) — it was rewritten to assert the
  corrected rule, and a new test 6b was added for the previously-uncovered
  per-Human height tiebreak (two lures, same distance, different heights →
  attracted to the taller one, not Confused). Every other existing test
  used equal-height tied lures, so this fix didn't disturb the rest of the
  suite: 71/71 passing.
- Everything else in the algorithm — closest-first (rule 1), the path-choice
  interaction going to the target lure's owner when multiple shortest paths
  exist, no-legal-move Humans simply not moving while others still resolve,
  a Human moving/being laid down exactly once per Movement Phase (Domain-
  ownership and per-round bonus mechanics like Acceleration and Moon's
  Ascendance are separate, already-confirmed exceptions layered on top of
  this same base rule, not a contradiction of it), and immediately
  rechecking standing Confused Humans whenever a lure clears (already
  structurally guaranteed: every `advanceMovementPhase` tick starts with a
  full `recomputeAttraction` over every unmoved Human, confused or not) —
  was already correct and needed no change.

## Fifth pass: Domains are physical 4-hex boards, and that's what scores

The user supplied reference art (`domain_markers_4hexes_5x5grid.pdf`)
revealing that a "Domain" isn't just an ability kit (as every earlier pass
assumed) — physically, it's a 4-hex board that attaches past one of the main
board's 6 edges, and **reaching a player's own Domain hexes is what scores a
Human for them**, not merely reaching a lure stack. This was a real
architecture gap, not a wording gap: scoring previously fired the instant any
lure stack was reached, crediting whichever player owned that stack, with no
board-position concept for Domains at all (`cards.ts`'s Traveler's Fire note
had already flagged this: *"no board-zone concept exists to check against"*).

- **Side numbering and per-player-count layout** — confirmed by the user: the
  board's 6 edges are numbered 1-6 clockwise from the upper-right edge.
  `DOMAIN_SIDE_ASSIGNMENTS` (`packages/shared/src/data/config.ts`) maps
  player count to which sides get a Domain: 2P→[1,4], 3P→[2,4,6],
  4P→[2,3,5,6], 5P→[1,2,3,5,6], 6P→ all six. Players are randomly assigned to
  those side numbers at setup (`buildInitialGameState`, `setup.ts`).
- **Attachment geometry** — `domainAttachmentHexes(side, edgeLength)`
  (`packages/shared/src/hex/coordinates.ts`) derives the 4 hexes for a given
  side from `hexRing(center, edgeLength - 1)`, sliced into 6 equal per-side
  segments, each stepped one hex outward in a single fixed direction per
  side. Verified computationally (not just by inspection) for edgeLength
  3 through 6 before being wired in.
- **Scoring trigger, confirmed** — reaching a Domain hex is the *only* thing
  that scores a Human, and it always scores to that Domain's owner (same
  per-Human-type point table as before — positive or negative — nothing
  changed there). Lures are pure navigation: which lure a Human follows, and
  who owns that lure, has no bearing on who gets the points. Touching an
  ordinary lure that ISN'T on anyone's Domain hex does nothing but clear
  that lure — the Human is neither collected nor scored, and stays on the
  board to be attracted elsewhere. This is implemented as an **optional**
  `MovementBoard.domainHexes` field in `movement.ts::handleArrival`,
  defaulting to the pre-existing lure-scores-directly behavior when unset —
  so, per the pattern used for every prior movement.ts extension this
  project, the full pre-existing `movement.test.ts` suite needed zero
  changes. `effectPrimitives.ts::forceHumanTo` (forced-movement abilities
  like Gust, Siren's Call) got the equivalent change directly, since it
  always operates on a real, domain-populated `ServerGameState` — no
  "legacy" branch needed there; a new `engine/domains.ts` helper
  (`domainOwnerAt` / `buildDomainHexMap`) keeps the two call sites in sync.
  `domainBoards.test.ts` has a dedicated case proving this with **no lure
  anywhere on the board at all** — `forceHumanTo` straight onto a Domain hex
  still scores its owner, confirming the domain check never depends on a
  co-located lure.
- **Lure placement itself is unchanged** — a lure can still be placed
  anywhere `legalLurePlacementSpaces` already allowed, including on hexes
  inside *any* player's Domain, not just your own (domain hexes were simply
  added to `state.board.hexes`). Since scoring only ever credits the
  Domain's owner — never the lure's owner — a lure sitting in a rival's
  Domain is a real, usable sabotage play: dump an unwanted Human (e.g. the
  Hunter, which scores negative) into an opponent's territory with your own
  lure and *they* take the hit.
- **Client rendering** (`packages/client/src/board/HexBoard.tsx`) — each
  Domain's 4 hexes render in gold, and the actual banner artwork from the
  reference PDF (cropped per-Domain into `public/board-art/domain-*.webp`)
  is placed and rotated to sit flush against the correct edge. The rotation
  angle is derived from the Domain's own hex-row direction, then normalized
  to never render upside-down — this was caught and fixed by rendering an
  actual 4-player layout to a rasterized PNG and inspecting it, not just by
  inspecting the math.
- New tests: `movement.test.ts` gained 2 pure-engine cases (Domain-hex
  arrival scores its owner even when a rival's lure sits there; an ordinary
  non-Domain lure clears without scoring). New `domainBoards.test.ts` covers
  per-player-count side assignment (2 through 6 players, asserting the exact
  side-number set and that every assigned hex is genuinely outside the main
  hexagon) plus two full `GameEngine`-level scoring scenarios. Full suite:
  69/69 passing.

## Third pass: the last two Landscapes

Veil of Mist and Moon's Ascendance were previously deferred because
implementing them meant modifying `packages/server/src/game/engine/movement.ts`
— the one module with an independently tested rules suite
(`movement.test.ts`) — in ways deep enough to risk regressing it. Both are
now implemented as small, strictly additive `MovementBoard` fields that
default to "no effect" when unset, so every pre-existing test in
`movement.test.ts` keeps passing unchanged:

- **Veil of Mist** — `MovementBoard.attractionRadiusCap?: number`. A new
  `withinAttractionRadius()` filter is applied everywhere a Human's
  candidate lures are scored (`recomputeAttraction`, `runBonusMovement`): a
  lure farther than the cap doesn't just lose priority, it's excluded
  entirely — a Human with nothing in range is `blockedNoLure`, same as
  having no lure on the board at all. Card handler sets
  `ServerGameState.veilOfMistUntilRound = state.round`;
  `GameEngine.asMovementBoard` turns that into
  `VEIL_OF_MIST_ATTRACTION_RADIUS` (1, `TODO_RULE_CONFIRMATION` — the card
  text doesn't give an exact number) for the rest of the round it's played.
- **Moon's Ascendance** — `MovementBoard.movesPerHuman?: number`. A new
  `triggerRoundMovementBonus()` helper runs immediately after a Human's
  primary step (in both the direct-step path in `advanceMovementPhase` and
  the tie-resolved path in `resolvePathChoice`) and chains
  `runBonusMovement` for the remaining steps — reusing the exact same
  continuation logic Acceleration markers use, so it composes with markers,
  Toadstools, and ties for free. Card handler sets
  `moonsAscendanceUntilRound = state.round`; `asMovementBoard` turns that
  into `MOONS_ASCENDANCE_MOVES_PER_HUMAN` (2) for the rest of the round.

New tests: 7 pure-engine cases in `movement.test.ts` (radius cap
exclusion/inclusion, regression guards for both fields unset, 2-space
movement, reaching-and-clearing a lure exactly 2 spaces away, composing with
an Acceleration marker) plus 2 end-to-end cases in `newContent.test.ts` that
play the actual card through `GameEngine` and verify the resulting board
state.

## Fourth pass: board size and Portal spawn positions confirmed

The user supplied the actual reference board art (`5x5_Hexboard_V2.pdf`),
resolving two previously-guessed values:

- **Board size** — `BOARD_EDGE_LENGTH` changed from 6 (91 hexes) to **5** (61
  hexes), matching the art. `packages/shared/src/data/config.ts`.
- **Portal A/B spawn positions** — previously guessed as "all 6 of ring 1 for
  set A, 6 alternating hexes of ring 2 for set B" (an admitted placeholder,
  since the source spec gave no coordinates). The reference art shows the
  correct pattern: ring 1's 6 hexes (the Portal's immediate neighbors)
  **alternate** set A / set B / set A / ... around the ring, 3 hexes each.
  Corrected in `packages/shared/src/data/spawns.ts`
  (`RING1_A`/`RING1_B`, filtering `hexRing(portalCenter, 1)` by index parity).
  Each set still spawns 4 Humans (2 Adults, 1 Child, 1 Baby) onto only 3
  positions, so one of the three now receives 2 Humans at spawn — cycling
  via `positions[posIdx % positions.length]` in `spawnHumans()`, unchanged
  logic, just fewer positions to cycle through than before.
- **Client rendering** (`packages/client/src/board/HexBoard.tsx`) — the
  Portal-ring hexes are now colored and labeled "A"/"B" per their spawn set,
  and a decorative toadstool ring (🍄, non-interactive) surrounds the
  7-hex Portal cluster, matching the reference art's mushroom border. Purely
  visual — no gameplay logic reads these classes/labels.
- Any test coordinate that was valid under the old radius-5 board but fell
  outside the new radius-4 board was updated (only one:
  `advancedContent.test.ts`'s Forest Elves Main Ability target, `{q:5,r:-5}`
  → `{q:4,r:-4}`). Full suite re-verified: 60/60 passing.

Everything else called out as deferred in the previous passes — Threads of
Fate, Impish Interference, Traveler's Fire, The Wild Hunt's Gale, Clockwork
Contraption, Wrong Turn, Moonlight Vision, Frozen Magic, Delayed Curse, Veil
of Darkness, Shadow Copy, Dream Surge, Wildfire, Twisted Fate, all 6 Main
Abilities, and all 4 targeted starting abilities — was already implemented
in the second pass. See below for the engine primitives that made that
possible and where each uses a documented simplification.

## New engine primitives (this pass)

- **Deferred effects** (`ServerGameState.deferredEffects`) — Delayed Curse
  pulls a pending effect off the response stack and schedules it to resolve
  automatically at the start of a future round, processed in the
  `round-cleanup` phase transition.
- **Duration extension** (`EffectStackItem.extendDurationBonus`) — Frozen
  Magic tags a pending effect; when it resolves, the `__extendRounds`
  context is folded into its target so Blessing of the Good Folk / Crystal
  Ward / Cleansing Waters can add the bonus round. Mesmerize/Faerie Slumber
  use a simpler "this phase only" flag, not a round counter, so Frozen Magic
  has no effect on those.
- **Clone-and-requeue** (`effectPrimitives.cloneAndRequeueEffect`) — Shadow
  Copy and Dream Surge duplicate a pending effect (optionally with a new
  target) and push the clone back onto the stack to resolve independently.
- **Retargeting** (`effectPrimitives.retargetPendingEffect`) — Impish
  Interference / Wrong Turn override just the destination hex (`to` field)
  of a pending effect; Clockwork Contraption replaces its entire target
  object, restricted to another player's card.
- **Pre-spawn response window** (`GameEngine.maybeAdvancePhase`'s
  `human-spawn` branch, `responseWindow.openSystemResponseWindow`) — reuses
  the normal response-window machinery around a no-op synthetic item to give
  everyone one turn-order pass at reactive Instants "right before Humans
  arrive," specifically for Threads of Fate. Skipped when nobody could
  possibly play it, to avoid a no-op prompt every round.
- **Spawn overrides** (`ServerGameState.spawnOverrides`) — Threads of Fate
  writes a `{position, definitionId}` override consumed and cleared by
  `spawnHumans()`.
- **Inactive lures** (`LureStack.inactiveUntilRound`) — Veil of Darkness.
  `movement.ts` gained an *additive* `activeLureStacks()` filter (only
  applied when `MovementBoard.currentRound` is supplied) so existing tests
  that never set it are provably unaffected — verified by re-running the
  full `movement.test.ts` suite unchanged after this addition.
- **Main Ability pathway** (`useMainAbility` action) — repeatable, gated
  only by its action cost, not a once-per-game flag.
- **Interactive starting-abilities phase** — `ServerGameState.
  startingAbilityQueue` + `GameEngine.beginGameplay`/`promptNextStartingAbility`
  resolve Ocean Sirens/Forest Elves/Wind Djinn/Earth Gnomes's targeted
  starting abilities one at a time, in turn order, via a `chooseDomainAbility`
  interaction, before the first `player-turn` begins. The two passive ones
  (River Nymphs' lure cap, Moonlight Pixies' opening hand) are still applied
  automatically with no queue entry.
- **Reactive instant Domain abilities** — a real functional gap found while
  building the above: instant-timing Domain abilities (Mesmerize, Blocking
  Vines, Purifying-Waters-equivalents, and now Wrong Turn/Clockwork
  Contraption/Shadow Copy/Frozen Magic/Delayed Curse/Wildfire/Dream Surge)
  were previously **unreachable** during another player's response window —
  only hand-card Instants were wired into `chooseInstantResponse`. Fixed via
  `responseWindow.respondWithInstantAbility` and a corresponding UI section
  in `GameScreen.tsx`.

## Documented simplifications on the newly implemented content

- **Threads of Fate** — "choose the type of human... in one spot" targets
  one upcoming spawn position per play; no restriction beyond the Human type
  existing in `HUMAN_DEFINITIONS`.
- **Impish Interference / Wrong Turn** — "choose the movement direction(s)"
  implemented as overriding the pending effect's destination hex, not a
  literal direction/heading.
- **Traveler's Fire** — "outside the Fairy Ring and all Domains" isn't
  enforced (no board-zone concept exists to check against). Per-Human ties
  when several would enter the same space are auto-resolved instead of
  prompting the caster.
- **The Wild Hunt's Gale** — when an obstacle has more than one legal empty
  adjacent space, the first one found is auto-picked.
- **Clockwork Contraption** — implemented as picking a new target for
  another player's pending card (the same mechanic as Fickle Fate) — the
  closest real mechanical reading of "you choose targets instead of the
  original controller," since this engine resolves every effect from a
  single pre-chosen target with no separate downstream "resolution choices"
  to intercept.
- **Twisted Fate** — "reverse the movement direction" implemented as moving
  the Human one space toward whichever of its 6 neighbors is *farthest* (by
  path distance) from its current lure, since the engine doesn't persist a
  Human's last-step direction vector.
- **Veil of Darkness** — "this turn" implemented as "until the start of the
  next round," matching every other round-scoped duration in this data set.
- **Wildfire** — only works for effects whose target has a
  `humanInstanceId` field.
- **TODO_RULE_CONFIRMATION: timing corrections.** Frozen Magic, Delayed
  Curse, Wildfire, and Dream Surge all target a *pending* effect but had no
  `(Instant)` tag in the source spreadsheet (unlike, say, Ocean Sirens'
  abilities, which do mark Instants explicitly). Since a pending effect only
  exists during an open response window — reachable only via Instant timing
  — these four were corrected from `action` to `instant`. Without this
  correction they would be technically "implemented" but permanently
  unreachable in real play, which seemed worse than a labeled correction.
- **Ocean Sirens' Main Ability costs 3 actions**, but a turn only grants 2
  — as specified, it can never actually be used in a single turn. Left as
  literally specified (not "fixed" to 2) since this may be intentional data
  the rules author should confirm, not an engine bug; flagged here rather
  than silently altered.
- **Starting abilities with no lure to reference at setup** (Ocean Sirens'
  "pull target human 1 space") are implemented as moving the Human to an
  adjacent hex of the player's choice, since no lures exist yet during
  setup.

## Everything from the first pass (still accurate, unaffected by this pass)

- **Lover pair-bonus, Mother+Child bonus, Mother+Baby bonus point values** —
  placeholders (3 / 2 / 3), not confirmed. `packages/shared/src/data/humans.ts`
- **The "Hazard set" bonus** has no defined roster or point value; left
  `null` (disabled). `humans.ts` (`HAZARD_SET_BONUS`)
- **Starting Human roster per spawn** (2 Adults, 1 Child, 1 Baby) — still a
  placeholder, exact counts not confirmed. Portal A/B *positions* are now
  confirmed (see the fourth pass, above); only the roster quantities remain
  a guess. `packages/shared/src/data/spawns.ts`
- **Full-stack vs. single-lure removal** on reaching a lure — default:
  remove the whole stack. `data/config.ts` (`LURE_CLEAR_MODE`)
- **Acceleration bonus-step count** — default: 1 step. `data/config.ts`
  (`ACCELERATION_BONUS_STEPS`)
- **Deck copy count for cards with no "Copies" column in the source**
  (mostly Landscapes) — defaults to 1 copy. `engine/setup.ts` (`buildDeck`)
- **Ancient Spellbook** ("Draw 3, keep 2, discard other 1") auto-discards
  the third card drawn rather than a genuine player choice — net card count
  matches the intended power level.
- **The Gate Beckons** — ties among equally-short paths toward the Portal
  are auto-resolved (first option) instead of prompting the caster per Human.
- **The Queen's Banquet** — "pass to the player on their right" implemented
  as "your hand moves to the next player in turn order."
- **Gust** (Wind Djinn) — real text is "push up to 3 humans 1 space each";
  implemented as pushing exactly one targeted Human. Multi-Human
  single-ability targeting isn't wired up.
- **Portal in Bloom** — spawns an Adult by default (Human type unspecified).
- **Redirect-on-cancel simplified to a straight cancellation** for Blessing
  of the Good Folk / Faerie Slumber / Crystal Ward / Mesmerize / Cleansing
  Waters, rather than letting the original controller pick a new target.

## Domains renamed / added (unchanged from the first pass)

"Garden Gnomes" → **Earth Gnomes**. Four Expansion domains (Fire Sprites,
Frost Spirits — Expansion 1; Shadow Fae, Dreamweavers — Expansion 2) exist
in the data (`gameSet` field) but aren't surfaced in the lobby's Domain
picker, which only lists `gameSet: "basic"` — see `baseGameSetDomains()` in
`data/domains.ts`.

// Declarative "what to ask for, in what order" scripts for every implemented
// card/ability effect. Field names match exactly what the corresponding
// server-side handler destructures from `target` (see server/game/engine
// cards.ts / domainAbilities.ts), so the accumulated selection object can be
// submitted as-is. The server re-validates everything regardless.

export type PickKind =
  | "human"
  | "lureStack"
  | "ownLureStack"
  | "boardSpace"
  | "obstacle"
  | "discardedCard"
  | "responseStackItem"
  | "direction"
  | "humanType"
  | "otherPlayer"
  | "upcomingSpawnSpace";

// Declarative legality hints for a "boardSpace" step, mirroring the specific
// checks the corresponding server handler performs (see cards.ts /
// domainAbilities.ts) so the UI doesn't offer destinations the server will
// reject as illegal. `of` names the field(s) holding a previously-collected
// pick to measure distance from — the first one present in `collected` wins
// (used for obstacle/marker-toggle steps like Giant's Stride).
// `pushPull`, on "adjacent"/"straightLine" constraints only: confirmed by
// the user — a push/pull-flavored ability or card may only move a Human
// relative to the ACTING player's own Domain. "pull" further restricts to
// directions toward it (plus sideways, if the room allows); "push" to
// directions away from it (plus sideways). See legality.ts's
// legalPushPullDirections (mirrors the server's copy in effectPrimitives.ts).
export type BoardSpaceConstraint =
  | { kind: "adjacent"; of: string[]; pushPull?: "push" | "pull" }
  | { kind: "straightLine"; of: string[]; distance: number; pushPull?: "push" | "pull" }
  | { kind: "within"; of: string[]; max: number }
  | { kind: "adjacentToObstacle"; types: ("tree" | "stone" | "toadstool")[] }
  | { kind: "adjacentToPortal" }
  | { kind: "noAdjacentHuman" };

export type TargetStep = {
  field: string;
  picks: PickKind;
  prompt: string;
  // For obstacle/marker-flexible effects: an alternate field+picks the
  // player can switch to via a small toggle in the UI (see GameScreen).
  alt?: { field: string; prompt: string };
  // For "boardSpace" picks only. Geometric restriction beyond plain
  // occupancy (adjacency/distance/straight-line relative to an earlier
  // pick, or a board-feature-relative check). Omit for "anywhere legal".
  boardSpaceConstraint?: BoardSpaceConstraint;
  // For "boardSpace" picks only. What may already occupy the destination:
  // "empty" (default) — no obstacle, lure, or Human, for placement effects;
  // "emptyExceptLure" — no obstacle or Human, but landing on a lure is fine
  // (that's how forced Human movement clears one); "unrestricted" — the
  // server performs no occupancy check at all for this field.
  boardSpaceOccupancy?: "empty" | "emptyExceptLure" | "unrestricted";
};

export const CARD_TARGETING: Record<string, TargetStep[]> = {
  pixiesPrank: [{ field: "humanInstanceId", picks: "human", prompt: "Select a Human that has already moved this phase." }],
  blessingOfTheGoodFolk: [{ field: "humanInstanceId", picks: "human", prompt: "Select a target Human." }],
  faerieSlumber: [{ field: "humanInstanceId", picks: "human", prompt: "Select a target Human." }],
  moonlitScrying: [],
  brokenGlamour: [{ field: "effectId", picks: "responseStackItem", prompt: "Select another player's unresolved Enchantment to cancel." }],
  faerieBargain: [{ field: "effectId", picks: "responseStackItem", prompt: "Select an unresolved Enchantment to claim." }],
  glimpseBeyond: [{ field: "direction", picks: "direction", prompt: "Choose which neighbor to peek at." }],
  crystalWard: [{ field: "stackId", picks: "lureStack", prompt: "Select a lure stack to protect." }],
  fickleFate: [
    { field: "effectId", picks: "responseStackItem", prompt: "Select an unresolved Enchantment to redirect." },
    { field: "newTarget", picks: "human", prompt: "Select its new target Human." },
  ],
  lanternOfLostSouls: [
    { field: "stackId", picks: "ownLureStack", prompt: "Select one of your lure stacks." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select a destination up to 2 spaces away.",
      boardSpaceOccupancy: "unrestricted",
      boardSpaceConstraint: { kind: "within", of: ["stackId"], max: 2 },
    },
  ],
  toadstoolCard: [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space for the Toadstool." }],
  toadstoolCard_relocate: [
    { field: "relocateFromId", picks: "obstacle", prompt: "Select a Toadstool to relocate." },
    { field: "to", picks: "boardSpace", prompt: "Select a new empty space for the Toadstool." },
  ],
  fairyRing: [{ field: "humanInstanceId", picks: "human", prompt: "Select a target Human." }],
  ancientMenhir: [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space." }],
  seedsOfTheElderGrove: [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space." }],
  giantsStride: [
    { field: "obstacleId", picks: "obstacle", prompt: "Select an obstacle to move.", alt: { field: "markerId", prompt: "Select a marker to move." } },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select a destination up to 2 spaces away.",
      boardSpaceConstraint: { kind: "within", of: ["obstacleId", "markerId"], max: 2 },
    },
  ],
  theEarthStirs: [
    { field: "obstacleId", picks: "obstacle", prompt: "Select an obstacle to remove.", alt: { field: "markerId", prompt: "Select a marker to remove." } },
  ],
  hiddenBurrow: [
    { field: "humanInstanceId", picks: "human", prompt: "Select a Human adjacent to an obstacle." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select an empty space adjacent to an obstacle.",
      boardSpaceConstraint: { kind: "adjacentToObstacle", types: ["tree", "stone", "toadstool"] },
    },
  ],
  nymphsEmbrace: [{ field: "humanInstanceId", picks: "human", prompt: "Select a target Human." }],
  riversReflection: [
    { field: "stackIdA", picks: "lureStack", prompt: "Select the first lure stack." },
    { field: "stackIdB", picks: "lureStack", prompt: "Select the second lure stack." },
  ],
  spritesSwitch: [
    { field: "humanIdA", picks: "human", prompt: "Select the first Human." },
    { field: "humanIdB", picks: "human", prompt: "Select the second Human." },
  ],
  wildGale: [
    { field: "humanInstanceId", picks: "human", prompt: "Select a target Human." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select a space exactly 2 spaces away in a straight line.",
      boardSpaceOccupancy: "emptyExceptLure",
      boardSpaceConstraint: { kind: "straightLine", of: ["humanInstanceId"], distance: 2, pushPull: "push" },
    },
  ],
  ancientSpellbook: [],
  phoenixAshes: [{ field: "cardId", picks: "discardedCard", prompt: "Select a card from the discard pile." }],
  pixiePilfering: [{ field: "direction", picks: "direction", prompt: "Choose which neighbor to steal from." }],
  willOTheWisp: [
    { field: "humanInstanceId", picks: "human", prompt: "Select a target Human." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select an adjacent space.",
      boardSpaceOccupancy: "emptyExceptLure",
      boardSpaceConstraint: { kind: "adjacent", of: ["humanInstanceId"] },
    },
  ],
  zephyrsKiss: [
    { field: "humanInstanceId", picks: "human", prompt: "Select a target Human." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select a space exactly 1 space away in a straight line.",
      boardSpaceOccupancy: "emptyExceptLure",
      boardSpaceConstraint: { kind: "straightLine", of: ["humanInstanceId"], distance: 1, pushPull: "push" },
    },
  ],
  banishedBeyondTheVeil: [{ field: "humanInstanceId", picks: "human", prompt: "Select a Human to remove from the board." }],
  sirensLureCard: [{ field: "humanInstanceId", picks: "human", prompt: "Select a target Adult." }],
  ogreMarket: [],
  danceOfMischief: [
    { field: "stackId", picks: "lureStack", prompt: "Select any lure stack." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select an adjacent space.",
      boardSpaceOccupancy: "unrestricted",
      boardSpaceConstraint: { kind: "adjacent", of: ["stackId"] },
    },
  ],
  shatteredTrance: [{ field: "stackId", picks: "lureStack", prompt: "Select a lure stack." }],
  whisperwindCard: [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space." }],
  portalInBloom: [
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select an empty space adjacent to the Portal.",
      boardSpaceConstraint: { kind: "adjacentToPortal" },
    },
  ],
  theGateBeckons: [],
  eclipseCard: [],
  morningRevel: [],
  shroudedHollow: [],
  veilOfMist: [],
  moonsAscendance: [],
  theQueensBanquet: [],
  theWildHuntsGale: [],
  threadsOfFate: [
    { field: "to", picks: "upcomingSpawnSpace", prompt: "Select an upcoming spawn position." },
    { field: "definitionId", picks: "humanType", prompt: "Select the Human type to place there." },
  ],
  impishInterference: [
    { field: "effectId", picks: "responseStackItem", prompt: "Select a pending effect to redirect." },
    { field: "to", picks: "boardSpace", prompt: "Select its new destination.", boardSpaceOccupancy: "unrestricted" },
  ],
  travelersFire: [
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select an empty space with no adjacent Humans.",
      boardSpaceConstraint: { kind: "noAdjacentHuman" },
    },
  ],
};

export const ABILITY_TARGETING: Record<string, TargetStep[]> = {
  sirensCall: [
    { field: "lureStackId", picks: "ownLureStack", prompt: "Select one of your lures." },
    { field: "humanInstanceId", picks: "human", prompt: "Select a target Human." },
  ],
  mesmerize: [{ field: "humanInstanceId", picks: "human", prompt: "Select a target Human." }],
  irresistibleSong: [{ field: "stackId", picks: "ownLureStack", prompt: "Select one of your lure stacks to add a lure to." }],
  blockingVines: [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space." }],
  secretTrail: [
    { field: "humanInstanceId", picks: "human", prompt: "Select a Human adjacent to a Tree." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select an empty space adjacent to a Tree.",
      boardSpaceConstraint: { kind: "adjacentToObstacle", types: ["tree"] },
    },
  ],
  tailwind: [{ field: "humanInstanceId", picks: "human", prompt: "Select the Human to push further." }],
  whirlwind: [
    { field: "obstacleId", picks: "obstacle", prompt: "Select an obstacle to move.", alt: { field: "markerId", prompt: "Select a marker to move." } },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select its destination (up to 3 spaces away).",
      boardSpaceConstraint: { kind: "within", of: ["obstacleId", "markerId"], max: 3 },
    },
  ],
  gust: [
    { field: "humanInstanceId", picks: "human", prompt: "Select a target Human." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select a space exactly 1 space away in a straight line.",
      boardSpaceOccupancy: "emptyExceptLure",
      boardSpaceConstraint: { kind: "straightLine", of: ["humanInstanceId"], distance: 1, pushPull: "push" },
    },
  ],
  gatheringCurrent: [{ field: "to", picks: "boardSpace", prompt: "Select an empty space for a new 3-lure stack." }],
  flowingStream: [
    { field: "stackIdA", picks: "lureStack", prompt: "Select the first lure to relocate." },
    {
      field: "toA",
      picks: "boardSpace",
      prompt: "Select its destination (up to 2 spaces away).",
      boardSpaceOccupancy: "unrestricted",
      boardSpaceConstraint: { kind: "within", of: ["stackIdA"], max: 2 },
    },
    { field: "stackIdB", picks: "lureStack", prompt: "Select the second lure to relocate." },
    {
      field: "toB",
      picks: "boardSpace",
      prompt: "Select its destination (up to 2 spaces away).",
      boardSpaceOccupancy: "unrestricted",
      boardSpaceConstraint: { kind: "within", of: ["stackIdB"], max: 2 },
    },
  ],
  cleansingWaters: [],
  starlightProphecy: [],
  mirage: [],
  lucidDream: [],
  tricksterSwap: [
    { field: "humanIdA", picks: "human", prompt: "Select the first Human." },
    { field: "humanIdB", picks: "human", prompt: "Select the second Human." },
  ],
  kindling: [{ field: "obstacleId", picks: "obstacle", prompt: "Select an obstacle to remove." }],
  phoenixAshesAbility: [{ field: "cardId", picks: "discardedCard", prompt: "Select a card from the discard pile." }],
  deepFreeze: [{ field: "humanInstanceId", picks: "human", prompt: "Select a target Human." }],
  shadowStep: [
    { field: "stackId", picks: "lureStack", prompt: "Select a lure to move." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select an adjacent empty space.",
      boardSpaceConstraint: { kind: "adjacent", of: ["stackId"] },
    },
  ],

  // --- Newly implemented reactive/meta abilities --------------------------
  wrongTurn: [
    { field: "effectId", picks: "responseStackItem", prompt: "Select a pending effect to redirect." },
    { field: "to", picks: "boardSpace", prompt: "Select its new destination.", boardSpaceOccupancy: "unrestricted" },
  ],
  clockworkContraption: [
    { field: "effectId", picks: "responseStackItem", prompt: "Select another player's pending Enchantment." },
    { field: "newTarget", picks: "human", prompt: "Select its new target Human." },
  ],
  moonlightVision: [],
  wildfire: [
    { field: "effectId", picks: "responseStackItem", prompt: "Select a pending effect targeting a Human." },
    { field: "extraHumanInstanceId", picks: "human", prompt: "Select an adjacent Human to also affect." },
  ],
  frozenMagic: [{ field: "effectId", picks: "responseStackItem", prompt: "Select a pending effect to extend." }],
  delayedCurse: [{ field: "effectId", picks: "responseStackItem", prompt: "Select a pending effect to delay." }],
  veilOfDarkness: [{ field: "stackId", picks: "lureStack", prompt: "Select a lure to make inactive." }],
  shadowCopy: [{ field: "effectId", picks: "responseStackItem", prompt: "Select a pending effect to copy." }],
  dreamSurge: [{ field: "effectId", picks: "responseStackItem", prompt: "Select a pending effect to resolve twice." }],
  twistedFate: [{ field: "humanInstanceId", picks: "human", prompt: "Select a target Human." }],

  // --- Main Abilities (repeatable) ----------------------------------------
  sirensMain: [{ field: "humanInstanceId", picks: "human", prompt: "Select a target Human." }],
  elvesMain: [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space." }],
  djinnMain: [
    { field: "humanInstanceId", picks: "human", prompt: "Select a target Human." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select a space exactly 2 spaces away in a straight line.",
      boardSpaceOccupancy: "emptyExceptLure",
      boardSpaceConstraint: { kind: "straightLine", of: ["humanInstanceId"], distance: 2, pushPull: "push" },
    },
  ],
  nymphsMain: [
    { field: "stackId", picks: "lureStack", prompt: "Select any lure stack." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select an adjacent space.",
      boardSpaceOccupancy: "unrestricted",
      boardSpaceConstraint: { kind: "adjacent", of: ["stackId"] },
    },
  ],
  pixiesMain: [{ field: "targetPlayerId", picks: "otherPlayer", prompt: "Choose a player to steal from." }],
  gnomesMain: [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space for the Toadstool." }],
  gnomesMain_relocate: [
    { field: "relocateFromId", picks: "obstacle", prompt: "Select a Toadstool to relocate." },
    { field: "to", picks: "boardSpace", prompt: "Select a new empty space for the Toadstool." },
  ],

  // --- Targeted starting abilities -----------------------------------------
  "sirens-starting": [
    { field: "humanInstanceId", picks: "human", prompt: "Select a Human." },
    {
      field: "to",
      picks: "boardSpace",
      prompt: "Select an adjacent space to move it to.",
      boardSpaceOccupancy: "emptyExceptLure",
      boardSpaceConstraint: { kind: "adjacent", of: ["humanInstanceId"], pushPull: "pull" },
    },
  ],
  "elves-starting": [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space for the Tree." }],
  "djinn-starting": [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space for the Acceleration Marker." }],
  "gnomes-starting": [{ field: "to", picks: "boardSpace", prompt: "Select a legal empty space for the Toadstool." }],
};

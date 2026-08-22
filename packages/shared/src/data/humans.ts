import { HumanDefinition } from "../types";

// Human scoring & tags, per spec section 22. Values here are the concrete
// numbers given in the spec (Adult 2 / Child 3 / Baby 4, Hunter negative).
// Pair/set bonus amounts are TODO_RULE_CONFIRMATION placeholders — the spec
// says these bonuses exist but doesn't give exact figures, so a conservative
// default is used and clearly labeled so it's trivial to retune.

export const HUMAN_DEFINITIONS: HumanDefinition[] = [
  {
    id: "adult",
    name: "Adult",
    basePoints: 2,
    tags: ["adult"],
    isHazard: false,
    scoringRules: [],
  },
  {
    id: "child",
    name: "Child",
    basePoints: 3,
    tags: ["child"],
    isHazard: false,
    scoringRules: [],
  },
  {
    id: "baby",
    name: "Baby",
    basePoints: 4,
    tags: ["baby"],
    isHazard: false,
    scoringRules: [],
  },
  {
    id: "lover",
    name: "Lover",
    basePoints: 2,
    tags: ["adult", "lover"],
    isHazard: false,
    scoringRules: [
      {
        kind: "pairBonus",
        description: "Bonus for collecting a pair of Lovers.",
        withTag: "lover",
        // TODO_RULE_CONFIRMATION: exact Lover pair bonus value unconfirmed.
        bonusPoints: 3,
      },
    ],
  },
  {
    id: "mother",
    name: "Mother",
    basePoints: 2,
    tags: ["adult", "mother"],
    isHazard: false,
    scoringRules: [
      {
        kind: "pairBonus",
        description: "Bonus when paired with a Child.",
        withTag: "child",
        // TODO_RULE_CONFIRMATION: exact Mother+Child bonus value unconfirmed.
        bonusPoints: 2,
      },
      {
        kind: "pairBonus",
        description: "Bonus when paired with a Baby.",
        withTag: "baby",
        // TODO_RULE_CONFIRMATION: exact Mother+Baby bonus value unconfirmed.
        bonusPoints: 3,
      },
    ],
  },
  {
    id: "hunter",
    name: "Hunter",
    // Confirmed by the user: -2, not the earlier placeholder of -3. Moves
    // during the Human Movement Phase exactly like every other Human (the
    // engine never special-cases it there) — only scoring treats it
    // differently, via isHazard below.
    basePoints: -2,
    tags: ["hazard", "hunter"],
    isHazard: true,
    scoringRules: [],
  },
];

export const HUMAN_DEFINITIONS_BY_ID: Record<string, HumanDefinition> =
  Object.fromEntries(HUMAN_DEFINITIONS.map((h) => [h.id, h]));

// TODO_RULE_CONFIRMATION: the "Hazard set" bonus references a specific,
// currently-unspecified set of hazard Humans. Left empty (disabled) until
// the exact Hazard roster + bonus is confirmed; scoring code treats an empty
// array as "no hazard set bonus configured" rather than guessing.
export const HAZARD_SET_BONUS: { requiresHumanIds: string[]; bonusPoints: number } | null = null;

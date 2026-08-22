import { describe, it, expect } from "vitest";
import {
  generateHexagonalBoard,
  axialKey,
  Axial,
  HumanInstance,
  LureStack,
  Obstacle,
  AccelerationMarker,
} from "@fairy/shared";
import {
  MovementBoard,
  advanceMovementPhase,
  resolvePathChoice,
  runMovementPhaseToCompletion,
  resetMovedMarkers,
} from "../src/game/engine/movement";

function hexSet(edgeLength = 6): Set<string> {
  return new Set(generateHexagonalBoard(edgeLength).map(axialKey));
}

function human(id: string, pos: Axial): HumanInstance {
  return {
    instanceId: id,
    definitionId: "adult",
    position: pos,
    moved: false,
    confused: false,
    attractedToStackId: null,
    blockedNoLure: false,
  };
}

function lure(id: string, pos: Axial, owner: string, height = 1): LureStack {
  return { id, position: pos, owner, height };
}

function board(overrides: Partial<MovementBoard> = {}): MovementBoard {
  return {
    hexes: hexSet(),
    humans: [],
    lureStacks: [],
    obstacles: [],
    accelMarkers: [],
    firstPlayerOrder: ["p1", "p2", "p3"],
    pendingPathChoice: null,
    ...overrides,
  };
}

describe("Human Movement Phase", () => {
  it("1. one Human, one unobstructed lure: gradually approaches it one hex per phase, across phases, and is eventually collected", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 2, r: 0 }, "p1")],
    });
    // Phase 1: a Human moves only once per Human Movement Phase (spec section 14),
    // so from distance 2 it should take exactly one step, not teleport to the lure.
    let events = runMovementPhaseToCompletion(b);
    expect(events.some((e) => e.type === "humanCollected")).toBe(false);
    expect(b.humans[0].position).toEqual({ q: 1, r: 0 });
    expect(b.lureStacks.length).toBe(1);

    // Next Human Movement Phase: reset moved markers, human is now adjacent and reaches the lure.
    resetMovedMarkers(b);
    events = runMovementPhaseToCompletion(b);
    expect(events.some((e) => e.type === "humanCollected")).toBe(true);
    expect(b.lureStacks.length).toBe(0);
    expect(b.humans.length).toBe(0); // collected
  });

  it("2. two lures at unequal distances: attracted to the closer one", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("near", { q: 1, r: 0 }, "p1"), lure("far", { q: 0, r: 3 }, "p2")],
    });
    advanceMovementPhase(b); // one tick recomputes + moves
    const h = b.humans.find((h) => h.instanceId === "h1")! ?? null;
    // human should have reached "near" lure (distance 1) and been collected already
    expect(b.lureStacks.find((s) => s.id === "near")).toBeUndefined();
    expect(b.lureStacks.find((s) => s.id === "far")).toBeDefined();
  });

  it("3. two closest lures equidistant: Human is confused and does not move", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("a", { q: 1, r: 0 }, "p1"), lure("b", { q: 0, r: 1 }, "p2")],
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("done"); // no eligible (non-confused) human to move
    const h = b.humans[0];
    expect(h.confused).toBe(true);
    expect(h.moved).toBe(false);
  });

  it("4. an obstacle sitting on the direct line to one of two equal-distance lures does NOT break the tie — distance is straight-line, confirmed by the user", () => {
    const obstacles: Obstacle[] = [{ id: "t1", type: "tree", position: { q: 0, r: -1 } }];
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [
        lure("behindTree", { q: 0, r: -2 }, "p1"), // straight-line distance 2 — the tree only ever blocks entry, it never lengthens this
        lure("open", { q: 2, r: 0 }, "p2"), // straight-line distance 2
      ],
      obstacles,
    });
    const { result } = advanceMovementPhase(b);
    // Both lures remain genuinely tied on raw distance — the human is Confused, exactly as it would be with no obstacle at all.
    expect(result.status).toBe("done");
    const h = b.humans.find((h) => h.instanceId === "h1")!;
    expect(h.confused).toBe(true);
    expect(h.position).toEqual({ q: 0, r: 0 }); // never moved
  });

  it("5. Humans one space away resolve before Humans two spaces away", () => {
    const b = board({
      hexes: hexSet(15),
      humans: [human("near", { q: 0, r: 0 }), human("far", { q: -10, r: 10 })],
      lureStacks: [lure("l1", { q: 1, r: 0 }, "p1"), lure("l2", { q: -10, r: 8 }, "p2")],
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("advanced");
    const near = b.humans.find((h) => h.instanceId === "near");
    const far = b.humans.find((h) => h.instanceId === "far");
    expect(near).toBeUndefined(); // reached its adjacent lure and was collected
    expect(far).toBeDefined();
    expect(far!.moved).toBe(false);
  });

  it("6. two Humans tied on distance but targeting different lures resolve by player order, NOT by which target is taller", () => {
    const b = board({
      hexes: hexSet(15),
      humans: [human("h1", { q: 0, r: 0 }), human("h2", { q: -10, r: 10 })],
      lureStacks: [
        lure("short", { q: 1, r: 0 }, "p1", 1), // h1's only reachable lure — shorter stack, but owned by p1 (first-player rank 0)
        lure("tall", { q: -10, r: 9 }, "p2", 3), // h2's only reachable lure — taller stack, but owned by p2 (rank 1)
      ],
      firstPlayerOrder: ["p1", "p2", "p3"],
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("advanced");
    // Both Humans are unambiguously attracted to their own single nearest lure — no per-Human tie, so
    // stack height never enters into it. The tie in *whose turn is next* is broken by player order alone:
    // p1 outranks p2, so h1 (targeting p1's stack) moves first, even though p2's stack is taller.
    const h1 = b.humans.find((h) => h.instanceId === "h1");
    const h2 = b.humans.find((h) => h.instanceId === "h2");
    expect(h1).toBeUndefined(); // moved onto "short" and was collected (adjacent)
    expect(h2).toBeDefined();
    expect(h2!.moved).toBe(false);
  });

  it("6b. a single Human with two equally-close lures is attracted to the taller stack instead of becoming Confused", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [
        lure("short", { q: 1, r: 0 }, "p1", 1), // distance 1
        lure("tall", { q: 0, r: 1 }, "p2", 3), // also distance 1, but taller
      ],
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("advanced");
    // Height breaks the tie in the Human's own attraction — it should never have been Confused at all.
    const h1 = b.humans.find((h) => h.instanceId === "h1");
    expect(h1).toBeUndefined(); // moved directly onto "tall" (adjacent) and was collected
    const collectedLure = b.lureStacks.find((s) => s.id === "tall");
    expect(collectedLure).toBeUndefined();
    expect(b.lureStacks.find((s) => s.id === "short")).toBeDefined(); // untouched
  });

  it("7. equal-height stacks at the same distance resolve by first-player order", () => {
    const b = board({
      hexes: hexSet(15),
      humans: [human("h1", { q: 0, r: 0 }), human("h2", { q: -10, r: 10 })],
      lureStacks: [
        lure("owned-by-p2", { q: 1, r: 0 }, "p2", 2),
        lure("owned-by-p1", { q: -10, r: 9 }, "p1", 2),
      ],
      firstPlayerOrder: ["p1", "p2", "p3"],
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("advanced");
    // p1's stack has priority over p2's stack at equal height, so h2 (adjacent to p1's stack) resolves first.
    expect(b.humans.find((h) => h.instanceId === "h2")).toBeUndefined();
    expect(b.humans.find((h) => h.instanceId === "h1")).toBeDefined();
  });

  it("8. a Human reaching a lure clears it (full-stack default) and is collected", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 1, r: 0 }, "p1", 3)],
    });
    const { events } = advanceMovementPhase(b);
    expect(events.some((e) => e.type === "lureCleared")).toBe(true);
    expect(events.some((e) => e.type === "humanCollected")).toBe(true);
    expect(b.lureStacks.length).toBe(0);
  });

  it("9 & 10. clearing a lure frees a previously-confused Human, which then moves later in the same phase", () => {
    const b = board({
      humans: [
        human("confused-one", { q: 0, r: 0 }), // tied between l1 (p1) and l2 (p2), both distance 1
        human("clearer", { q: 2, r: 0 }), // only attracted to l1, distance 1
      ],
      lureStacks: [lure("l1", { q: 1, r: 0 }, "p1"), lure("l2", { q: -1, r: 0 }, "p2")],
    });
    const events = runMovementPhaseToCompletion(b);
    // Both humans should eventually be collected: "clearer" clears l1, freeing "confused-one" to go to l2.
    expect(b.humans.length).toBe(0);
    expect(b.lureStacks.length).toBe(0);
    const confusedEvents = events.filter((e) => e.type === "confused");
    expect(confusedEvents.length).toBeGreaterThan(0);
  });

  it("11. a Human already marked as moved does not move again this phase", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 0, r: 3 }, "p1")], // distance 3, won't be reached in one tick
    });
    advanceMovementPhase(b); // moves one step
    const posAfterFirst = { ...b.humans[0].position };
    expect(b.humans[0].moved).toBe(true);
    const { result } = advanceMovementPhase(b); // should find nothing else to move (h1 already moved)
    expect(result.status).toBe("done");
    expect(b.humans[0].position).toEqual(posAfterFirst);
  });

  it("12. a Human landing on an acceleration marker receives bonus movement toward its lure", () => {
    const accelMarkers: AccelerationMarker[] = [{ id: "a1", position: { q: 0, r: -1 }, bonusSteps: 1 }];
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 0, r: -3 }, "p1")],
      accelMarkers,
    });
    const { events } = advanceMovementPhase(b);
    expect(events.some((e) => e.type === "accelerationTriggered")).toBe(true);
    const h = b.humans.find((h) => h.instanceId === "h1")!;
    expect(h.position).toEqual({ q: 0, r: -2 }); // one normal step + one bonus step
  });

  it("13. a Human beginning the phase on an acceleration marker gets no automatic bonus", () => {
    const accelMarkers: AccelerationMarker[] = [{ id: "a1", position: { q: 0, r: 0 }, bonusSteps: 1 }];
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 3, r: 0 }, "p1")],
      accelMarkers,
    });
    const { events } = advanceMovementPhase(b);
    expect(events.some((e) => e.type === "accelerationTriggered")).toBe(false);
    const h = b.humans.find((h) => h.instanceId === "h1")!;
    expect(h.position).toEqual({ q: 1, r: 0 }); // exactly one normal step, no bonus
  });

  it("13b. Acceleration bonus continues straight in the direction just traveled, not toward the lure (confirmed by the user)", () => {
    const accelMarkers: AccelerationMarker[] = [{ id: "a1", position: { q: 1, r: 0 }, bonusSteps: 1 }];
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      // Placed so the two equally-short primary steps tie (NE vs. SE) and,
      // crucially, so "continue toward the lure" from the marker (SE, at
      // {1,0}) would reach the lure directly at {2,-1} — a genuinely
      // different destination than "one more step SE", {2,0}.
      lureStacks: [lure("l1", { q: 2, r: -1 }, "p1")],
      accelMarkers,
    });
    const first = advanceMovementPhase(b);
    expect(first.result.status).toBe("waitingOnChoice");
    const moreEvents = resolvePathChoice(b, { q: 1, r: 0 }); // player picks the SE step, landing on the marker
    expect(moreEvents.some((e) => e.type === "accelerationTriggered")).toBe(true);
    const h = b.humans.find((h) => h.instanceId === "h1")!;
    // Same-direction continuation: (0,0) -[SE]-> (1,0) [marker] -[SE]-> (2,0).
    // NOT (2,-1) (the lure) — that would only happen if acceleration re-sought the lure.
    expect(h.position).toEqual({ q: 2, r: 0 });
    expect(b.lureStacks.length).toBe(1); // the lure was never reached
  });

  it("14. a toadstool on the direct line to one lure does NOT resolve a prior tie — distance is straight-line, confirmed by the user", () => {
    // "a" and "b" are both straight-line distance 2 from the human, so they tie either way.
    const withoutToadstool = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("a", { q: 0, r: -2 }, "p1"), lure("b", { q: 2, r: 0 }, "p2")],
    });
    advanceMovementPhase(withoutToadstool);
    expect(withoutToadstool.humans[0].confused).toBe(true); // tied at distance 2

    const withToadstool = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("a", { q: 0, r: -2 }, "p1"), lure("b", { q: 2, r: 0 }, "p2")],
      obstacles: [{ id: "toad1", type: "toadstool", position: { q: 0, r: -1 } }],
    });
    advanceMovementPhase(withToadstool);
    // A Toadstool right on "a"'s direct line still doesn't change "a"'s raw
    // distance at all — the tie survives exactly as it would with no
    // Toadstool there (it would only ever block the human from actually
    // entering that specific hex, a separate question from attraction).
    const h = withToadstool.humans.find((h) => h.instanceId === "h1")!;
    expect(h.confused).toBe(true);
    expect(h.attractedToStackId).toBeNull();
  });

  it("15. the phase ends when no eligible unmoved Human remains", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("a", { q: 1, r: 0 }, "p1"), lure("b", { q: 0, r: 1 }, "p2")],
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("done"); // permanently confused, nothing else to do
  });

  it("16. a wall of obstacles blocks a Human's approach forever, but never changes its raw distance/attraction to the walled-in lure", () => {
    const center: Axial = { q: 3, r: 0 };
    const surrounding: Obstacle[] = [
      { q: 3, r: -1 }, { q: 4, r: -1 }, { q: 4, r: 0 }, { q: 3, r: 1 }, { q: 2, r: 1 }, { q: 2, r: 0 },
    ].map((p, i) => ({ id: `wall${i}`, type: "tree", position: p }));
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("trapped", center, "p1")], // straight-line distance 3 — always finite, never "unreachable"
      obstacles: surrounding,
    });

    // Round 1: the human's one straight-line step (0,0) -> (1,0) is clear (not part of the wall), so it takes it.
    const first = advanceMovementPhase(b);
    expect(first.result.status).toBe("advanced");
    expect(b.humans[0].position).toEqual({ q: 1, r: 0 });
    expect(b.humans[0].blockedNoLure).toBe(false); // still genuinely attracted — raw distance always exists
    expect(b.humans[0].attractedToStackId).toBe("trapped");

    // Round 2: now adjacent to the wall — its only straight-line step, (2,0), is part of the wall.
    // No detour is attempted; it simply can't move any closer, forever.
    resetMovedMarkers(b);
    const second = advanceMovementPhase(b);
    expect(second.result.status).toBe("done");
    expect(b.humans[0].position).toEqual({ q: 1, r: 0 }); // stuck — never got any closer
    expect(b.humans[0].moved).toBe(false); // didn't move this phase — blocked, not "arrived"
    expect(b.humans[0].blockedNoLure).toBe(false); // still attracted; it's a movement block, not a "no lure" state
  });

  it("17. two equally short next steps require a player (lure-owner) choice", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 2, r: -1 }, "p1")],
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("waitingOnChoice");
    if (result.status === "waitingOnChoice") {
      expect(result.choice.options.length).toBe(2);
      expect(result.choice.controllingPlayerId).toBe("p1");
    }
  });

  it("18. a pending path choice survives a serialize/deserialize round trip (models a reconnect)", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 2, r: -1 }, "p1")],
    });
    advanceMovementPhase(b);
    expect(b.pendingPathChoice).not.toBeNull();
    const serialized = JSON.stringify(b.pendingPathChoice);
    const restored = JSON.parse(serialized);
    b.pendingPathChoice = restored;
    const chosen = restored.options[0];
    const events = resolvePathChoice(b, chosen);
    expect(events.some((e) => e.type === "moved")).toBe(true);
    expect(b.pendingPathChoice).toBeNull();
  });

  it("resetMovedMarkers clears moved flags between phases", () => {
    const b = board({ humans: [human("h1", { q: 0, r: 0 })] });
    b.humans[0].moved = true;
    resetMovedMarkers(b);
    expect(b.humans[0].moved).toBe(false);
  });
});

describe("Veil of Mist (attractionRadiusCap)", () => {
  it("a lure beyond the cap is ignored entirely — the Human is treated as having no reachable lure", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 0, r: -2 }, "p1")], // distance 2
      attractionRadiusCap: 1,
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("done");
    expect(b.humans[0].moved).toBe(false);
    expect(b.humans[0].blockedNoLure).toBe(true);
  });

  it("a lure within the cap still attracts normally", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 1, r: 0 }, "p1")], // distance 1
      attractionRadiusCap: 1,
    });
    const { events } = advanceMovementPhase(b);
    expect(events.some((e) => e.type === "humanCollected")).toBe(true);
  });

  it("without a cap configured, behavior is unaffected (regression guard)", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 0, r: -2 }, "p1")], // distance 2, no cap set
    });
    advanceMovementPhase(b);
    expect(b.humans[0].position).toEqual({ q: 0, r: -1 }); // took its one normal step
  });
});

describe("Moon's Ascendance (movesPerHuman)", () => {
  it("a Human covers 2 spaces in a single movement-phase move instead of 1", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 0, r: -3 }, "p1")], // distance 3, unique straight-line path
      movesPerHuman: 2,
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("advanced");
    expect(b.humans[0].position).toEqual({ q: 0, r: -2 }); // 2 steps, not 1
    expect(b.humans[0].moved).toBe(true);
  });

  it("a Human 2 spaces from its lure reaches and clears it within one move under Moon's Ascendance", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 0, r: -2 }, "p1")], // distance 2
      movesPerHuman: 2,
    });
    const { events } = advanceMovementPhase(b);
    expect(events.some((e) => e.type === "humanCollected")).toBe(true);
    expect(b.lureStacks.length).toBe(0);
  });

  it("without movesPerHuman configured, behavior is unaffected (regression guard)", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 0, r: -3 }, "p1")],
    });
    advanceMovementPhase(b);
    expect(b.humans[0].position).toEqual({ q: 0, r: -1 }); // still just 1 step
  });

  it("composes with Acceleration: a Human on Moon's Ascendance that also crosses a marker gets both bonuses", () => {
    const accelMarkers: AccelerationMarker[] = [{ id: "a1", position: { q: 0, r: -1 }, bonusSteps: 1 }];
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 0, r: -5 }, "p1")], // far away, unique straight-line path
      accelMarkers,
      movesPerHuman: 2,
    });
    const { events } = advanceMovementPhase(b);
    // Step 1 (primary, lands on the marker) triggers the marker's own +1 bonus step (-> r=-2),
    // then Moon's Ascendance's own remaining 1 step continues on top of that (-> r=-3).
    expect(events.some((e) => e.type === "accelerationTriggered")).toBe(true);
    expect(b.humans[0].position).toEqual({ q: 0, r: -3 });
  });
});

describe("Domain boards (domainHexes)", () => {
  it("a Human reaching a Domain hex is collected and scored to the Domain's owner, not the lure's owner", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 0, r: -1 }, "p2")], // owned by p2, but sits on p1's Domain hex
      domainHexes: new Map([["0,-1", "p1"]]),
    });
    const { events } = advanceMovementPhase(b);
    const collected = events.find((e) => e.type === "humanCollected");
    expect(collected).toBeTruthy();
    expect((collected as any).collectedBy).toBe("p1"); // the Domain's owner, not p2
    expect(b.humans.length).toBe(0);
    expect(b.lureStacks.length).toBe(0); // the co-located lure clears too, with no separate score
  });

  it("reaching an ordinary lure that isn't on a Domain hex just clears it — the Human stays on the board", () => {
    const b = board({
      humans: [human("h1", { q: 0, r: 0 })],
      lureStacks: [lure("l1", { q: 1, r: 0 }, "p1")], // distance 1, not a Domain hex
      domainHexes: new Map(), // domain-aware board, but this hex isn't anyone's Domain
    });
    const { events } = advanceMovementPhase(b);
    expect(events.some((e) => e.type === "lureCleared")).toBe(true);
    expect(events.some((e) => e.type === "humanCollected")).toBe(false);
    expect(b.lureStacks.length).toBe(0);
    expect(b.humans.length).toBe(1); // still on the board — the lure was just bait
    expect(b.humans[0].position).toEqual({ q: 1, r: 0 });
  });
});

describe("Hunters move like any other Human", () => {
  it("a Hunter is attracted to, steps toward, and is collected at a lure exactly like an ordinary Human", () => {
    const b = board({
      humans: [{ ...human("hunter-1", { q: 0, r: 0 }), definitionId: "hunter" }],
      lureStacks: [lure("l1", { q: 2, r: 0 }, "p1")], // distance 2 — needs 2 phases, same as any other Human would
    });
    const first = advanceMovementPhase(b);
    expect(first.result.status).toBe("advanced");
    expect(b.humans[0].position).toEqual({ q: 1, r: 0 }); // took its one step this phase, same rule as everyone else
    expect(b.humans[0].definitionId).toBe("hunter");

    resetMovedMarkers(b); // a new Movement Phase (next round) — same as every other Human gets between phases
    const second = advanceMovementPhase(b);
    expect(second.events.some((e) => e.type === "humanCollected" && e.definitionId === "hunter")).toBe(true);
    expect(b.humans.length).toBe(0);
  });

  it("a Hunter can be Confused and tiebreak by lure height exactly like an ordinary Human", () => {
    const b = board({
      // distance 2 from both lures, so the tie/attraction is observable before arrival resolves it
      humans: [{ ...human("hunter-1", { q: 0, r: 0 }), definitionId: "hunter" }],
      lureStacks: [lure("a", { q: 2, r: 0 }, "p1", 1), lure("b", { q: 0, r: 2 }, "p2", 3)],
    });
    advanceMovementPhase(b);
    expect(b.humans[0].confused).toBe(false); // height broke the tie, same rule as any other Human
    expect(b.humans[0].attractedToStackId).toBe("b");
  });
});

describe("Humans never share a hex — one Human per space", () => {
  it("a Human routes around another Human blocking its shortest path, via the equally-short alternate", () => {
    // Lure at (2,-1) from origin is the exact "genuine tie" geometry used by
    // tests 17/18 — its two equally-short first steps are (1,-1) and (1,0).
    // Occupying one of them should silently resolve what would otherwise be
    // a path-choice tie, no interactive choice needed, since only one step
    // remains passable at all.
    const b = board({
      humans: [human("mover", { q: 0, r: 0 }), { ...human("blocker", { q: 1, r: 0 }), moved: true }],
      lureStacks: [lure("l1", { q: 2, r: -1 }, "p1")],
    });
    const { result } = advanceMovementPhase(b);
    expect(result.status).toBe("advanced"); // not "waitingOnChoice" — the blocked option was never a real option
    const mover = b.humans.find((h) => h.instanceId === "mover")!;
    expect(mover.position).toEqual({ q: 1, r: -1 });
    const blocker = b.humans.find((h) => h.instanceId === "blocker")!;
    expect(blocker.position).toEqual({ q: 1, r: 0 }); // untouched — nothing ever steps onto an occupied hex
  });

  it("a Human boxed in entirely by other Humans simply doesn't move once it reaches the wall — it never pushes through, and its raw distance/attraction to the walled-in lure never changes", () => {
    const center: Axial = { q: 3, r: 0 };
    const wallPositions: Axial[] = [{ q: 3, r: -1 }, { q: 4, r: -1 }, { q: 4, r: 0 }, { q: 3, r: 1 }, { q: 2, r: 1 }, { q: 2, r: 0 }];
    const wall = wallPositions.map((p, i) => ({ ...human(`wall${i}`, p), moved: true }));
    const b = board({
      humans: [human("h1", { q: 0, r: 0 }), ...wall],
      lureStacks: [lure("trapped", center, "p1")], // straight-line distance 3 — always finite, never "unreachable"
    });

    // Round 1: the human's one straight-line step (0,0) -> (1,0) is clear (not part of the wall), so it takes it.
    const first = advanceMovementPhase(b);
    expect(first.result.status).toBe("advanced");
    const h1AfterRound1 = b.humans.find((h) => h.instanceId === "h1")!;
    expect(h1AfterRound1.position).toEqual({ q: 1, r: 0 });
    expect(h1AfterRound1.blockedNoLure).toBe(false); // still genuinely attracted — raw distance always exists

    // Round 2: now adjacent to the wall — its only straight-line step, (2,0), is occupied by another Human.
    // No routing around it is attempted; it simply can't get any closer, forever. Reset only h1's own
    // flag (not the shared resetMovedMarkers) — the wall Humans are meant to stay frozen in place as
    // static blockers across both simulated rounds, not get a fresh chance to wander off themselves.
    h1AfterRound1.moved = false;
    const second = advanceMovementPhase(b);
    expect(second.result.status).toBe("done");
    const h1 = b.humans.find((h) => h.instanceId === "h1")!;
    expect(h1.blockedNoLure).toBe(false); // still attracted; it's a movement block, not a "no lure" state
    expect(h1.moved).toBe(false); // didn't move this phase — blocked, not "arrived"
    expect(h1.position).toEqual({ q: 1, r: 0 }); // stuck — never got any closer
  });
});

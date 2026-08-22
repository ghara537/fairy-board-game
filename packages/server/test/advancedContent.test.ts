import { describe, it, expect } from "vitest";
import { SPAWN_DATA } from "@fairy/shared";
import { RoomManager } from "../src/rooms/RoomManager";
import { passResponseWindowToClose, resolveStartingAbilities } from "./testUtils";
import { runCardEffect } from "../src/game/engine/cards";
import { cloneAndRequeueEffect } from "../src/game/engine/effectPrimitives";
import { advanceMovementPhase } from "../src/game/engine/movement";
import { spawnHumans } from "../src/game/engine/setup";

function fourPlayerGame() {
  const rooms = new RoomManager();
  const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 14 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
  const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
  const carol = rooms.joinRoom(host.room.code, "Carol", 1985);
  const dave = rooms.joinRoom(host.room.code, "Dave", 1995);
  if ("error" in bob || "error" in carol || "error" in dave) throw new Error("setup failed");
  host.room.selectDomain(host.playerId, "ocean-sirens");
  host.room.selectDomain(bob.playerId, "forest-elves");
  host.room.selectDomain(carol.playerId, "wind-djinn");
  host.room.selectDomain(dave.playerId, "earth-gnomes");
  for (const p of [host.playerId, bob.playerId, carol.playerId, dave.playerId]) host.room.setReady(p, true);
  host.room.startGame();
  return { rooms, host, ids: { bob: bob.playerId, carol: carol.playerId, dave: dave.playerId } };
}

describe("Interactive starting abilities", () => {
  it("queues all 4 targeted domains in first-player order and returns to player-turn once resolved", () => {
    const { host, ids } = fourPlayerGame();
    const game = host.room.game!;
    expect(game.phase).toBe("starting-abilities");
    expect(game.startingAbilityQueue.length).toBe(4); // ocean-sirens, forest-elves, wind-djinn, earth-gnomes all need a target

    resolveStartingAbilities(host.room); // fast-forward with trivial (but legal) targets
    expect(game.phase).toBe("player-turn");
    expect(game.startingAbilityQueue.length).toBe(0);
    // Forest Elves' and Wind Djinn's and Earth Gnomes' placements actually landed on the board.
    expect(game.board.obstacles.some((o) => o.type === "tree")).toBe(true);
    expect(game.board.accelMarkers.length).toBe(1);
    expect(game.board.obstacles.some((o) => o.type === "toadstool")).toBe(true);
  });
});

describe("Main Abilities", () => {
  it("Forest Elves' Main Ability places a Tree, costs 2 actions, and is not gated by a once-per-game flag", () => {
    const { host } = fourPlayerGame();
    const game = host.room.game!;
    resolveStartingAbilities(host.room); // fast-forward with trivial (but legal) targets
    expect(game.phase).toBe("player-turn");

    const elvesId = Object.keys(game.players).find((id) => game.players[id].domainId === "forest-elves")!;
    // Make it Forest Elves' turn directly for a clean test of the Main Ability itself.
    game.activePlayerId = elvesId;
    game.actionsRemaining = 2;
    const result = host.room.submitAction(elvesId, "useMainAbility", { target: { to: { q: 4, r: -4 } } });
    expect(result.error).toBeUndefined();
    // Cost is deducted immediately, before the response window (and any
    // resulting turn rollover) resolves.
    expect(game.actionsRemaining).toBe(0); // cost 2, had 2
    passResponseWindowToClose(host.room);
    expect(game.board.obstacles.some((o) => o.type === "tree" && o.position.q === 4 && o.position.r === -4)).toBe(true);
  });
});

describe("Delayed Curse and Frozen Magic", () => {
  function twoPlayerReady() {
    const rooms = new RoomManager();
    // Note: the host (created via createRoom) always has a null birth year,
    // so a joined player with a real birth year is always "youngest" and
    // therefore always the first/active player. Give Frost Spirits (which
    // needs to respond, not act) to the host so it ends up as "other".
    const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
    const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "frost-spirits" as any); // expansion domain, no starting ability at all
    host.room.selectDomain(bob.playerId, "river-nymphs"); // passive starting ability only, no queue
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    return { host, bobId: bob.playerId };
  }

  it("Delayed Curse, used reactively during the response window, defers a pending card's resolution to the start of next round", () => {
    const { host, bobId } = twoPlayerReady();
    const game = host.room.game!;
    expect(game.phase).toBe("player-turn"); // no queue: river-nymphs is passive, frost-spirits has no starting ability
    expect(game.players[host.playerId].domainId).toBe("frost-spirits");

    const active = game.activePlayerId;
    const other = active === bobId ? host.playerId : bobId;
    expect(active).toBe(bobId); // Bob (River Nymphs, real birth year) is always youngest/first here
    expect(other).toBe(host.playerId); // Alice (Frost Spirits) responds
    game.players[active].hand.push("ancient-menhir");
    host.room.submitAction(active, "playCard", { cardId: "ancient-menhir", target: { to: { q: 2, r: 2 } } });
    const pendingId = game.responseStack[0].id;
    expect(game.board.obstacles.length).toBe(0); // not resolved yet
    expect(game.phase).toBe("response-window");
    expect(game.pendingInteraction?.forPlayerIds).toEqual([other]);
    // Delayed Curse is Frost Spirits' 3rd ability (index 2).
    expect((game.pendingInteraction!.legalOptions as any).instantAbilityIndices).toContain(2);

    const result = host.room.respondToInteraction(other, game.pendingInteraction!.id, {
      abilityIndex: 2,
      target: { effectId: pendingId },
    });
    expect(result.error).toBeUndefined();
    expect(game.players[other].abilitiesUsed[2]).toBe(true);
    // Delayed Curse is now itself just a pending item on the stack (playing
    // it reactively doesn't resolve it immediately) — deferral happens when
    // *it* resolves, once the window closes.
    expect(game.deferredEffects.length).toBe(0);
    expect(game.responseStack.length).toBe(2); // ancient-menhir + the Delayed Curse item, both still pending

    // Both players pass the remaining window closed, which resolves the stack top-down.
    passResponseWindowToClose(host.room);
    expect(game.deferredEffects.length).toBe(1);
    expect(game.responseStack.length).toBe(0);
    expect(game.board.obstacles.length).toBe(0); // still not resolved — deferred to next round

    // Advance to next round; the deferred effect should resolve automatically.
    host.room.submitAction(active, "endTurn", {});
    host.room.submitAction(other, "endTurn", {});
    passResponseWindowToClose(host.room); // in case Threads of Fate got dealt
    expect(game.round).toBeGreaterThan(1);
    expect(game.deferredEffects.length).toBe(0);
    expect(game.board.obstacles.some((o) => o.type === "stone")).toBe(true);
  });

  it("Frozen Magic extends Crystal Ward's protection by an extra round (engine-level check)", () => {
    const { host } = twoPlayerReady();
    const game = host.room.game!;
    const active = game.activePlayerId;
    game.board.lureStacks.push({ id: "target-stack", position: { q: 1, r: 1 }, owner: active, height: 1 });

    // Simulate Frozen Magic having tagged the pending Crystal Ward item, then resolve it directly.
    const result = runCardEffect(game, active, "crystalWard", { stackId: "target-stack", __extendRounds: 1 });
    expect(result.ok).toBe(true);
    const stack = game.board.lureStacks.find((s: any) => s.id === "target-stack")!;
    expect(stack.untargetableUntilRound).toBe(game.round + 2); // 1 base + 1 extension
  });
});

describe("Retargeting and cloning primitives", () => {
  function twoPlayerNoQueue() {
    const rooms = new RoomManager();
    const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
    const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "moonlight-pixies"); // passive
    host.room.selectDomain(bob.playerId, "shadow-fae" as any); // expansion, no starting ability
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    return { host, bobId: bob.playerId };
  }

  it("Impish Interference redirects a pending effect's destination hex before it resolves", () => {
    const { host, bobId } = twoPlayerNoQueue();
    const game = host.room.game!;
    const active = game.activePlayerId;
    const other = active === bobId ? host.playerId : bobId;
    game.players[active].hand.push("seeds-of-the-elder-grove");
    host.room.submitAction(active, "playCard", { cardId: "seeds-of-the-elder-grove", target: { to: { q: 2, r: 2 } } });
    const pendingId = game.responseStack[0].id;

    game.players[other].hand.push("impish-interference");
    const result = host.room.respondToInteraction(other, game.pendingInteraction!.id, {
      cardId: "impish-interference",
      target: { effectId: pendingId, to: { q: -3, r: 3 } },
    });
    expect(result.error).toBeUndefined();
    passResponseWindowToClose(host.room);
    expect(game.board.obstacles.some((o) => o.position.q === -3 && o.position.r === 3)).toBe(true);
    expect(game.board.obstacles.some((o) => o.position.q === 2 && o.position.r === 2)).toBe(false);
  });

  it("Shadow Copy clones a pending effect so it resolves twice", () => {
    const { host, bobId } = twoPlayerNoQueue();
    const game = host.room.game!;
    const active = game.activePlayerId;
    const other = active === bobId ? host.playerId : bobId;
    game.players[active].hand.push("ancient-menhir");
    host.room.submitAction(active, "playCard", { cardId: "ancient-menhir", target: { to: { q: 2, r: 2 } } });
    const pendingId = game.responseStack[0].id;

    const cloneResult = cloneAndRequeueEffect(game, pendingId);
    expect(cloneResult.ok).toBe(true);
    expect(game.responseStack.length).toBe(2);
    passResponseWindowToClose(host.room);
    // Both the original and the clone tried to place a Stone at (2,2); only one can occupy the space,
    // so at least one obstacle exists and the response stack fully drained without error.
    expect(game.board.obstacles.length).toBeGreaterThanOrEqual(1);
    expect(game.responseStack.length).toBe(0);
  });
});

describe("Veil of Darkness (inactive lures)", () => {
  it("an inactive lure is ignored by Human attraction during movement", () => {
    const rooms = new RoomManager();
    const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
    const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "river-nymphs");
    host.room.selectDomain(bob.playerId, "shadow-fae" as any);
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    const game = host.room.game!;

    game.board.humans = [game.board.humans[0]];
    game.board.humans[0].position = { q: 0, r: 0 };
    game.board.humans[0].moved = false;
    game.board.lureStacks = [
      { id: "near-but-inactive", position: { q: 1, r: 0 }, owner: host.playerId, height: 1, inactiveUntilRound: game.round + 1 },
      { id: "far-but-active", position: { q: 0, r: 3 }, owner: host.playerId, height: 1 },
    ];

    const movBoard = {
      hexes: game.board.hexes,
      humans: game.board.humans,
      lureStacks: game.board.lureStacks,
      obstacles: game.board.obstacles,
      accelMarkers: game.board.accelMarkers,
      firstPlayerOrder: game.turnOrder,
      pendingPathChoice: null,
      currentRound: game.round,
    };
    const { result } = advanceMovementPhase(movBoard);
    expect(result.status).toBe("advanced");
    // The Human should have stepped toward the far-but-active lure (away from the inactive near one).
    expect(movBoard.humans[0].position).toEqual({ q: 0, r: 1 });
  });
});

describe("Threads of Fate", () => {
  it("overrides which Human type spawns at a specific upcoming Portal position", () => {
    const rooms = new RoomManager();
    const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
    const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "river-nymphs");
    host.room.selectDomain(bob.playerId, "moonlight-pixies");
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    const game = host.room.game!;
    expect(game.phase).toBe("player-turn");

    const upcomingSet = SPAWN_DATA.sets[game.board.spawnIndicator];
    const targetPosition = upcomingSet.positions[0];

    const result = runCardEffect(game, game.activePlayerId, "threadsOfFate", { to: targetPosition, definitionId: "hunter" });
    expect(result.ok).toBe(true);
    expect(game.spawnOverrides).toEqual([{ position: targetPosition, definitionId: "hunter" }]);

    const beforeCount = game.board.humans.length;
    spawnHumans(game, game.board.spawnIndicator, false);
    const spawnedAtPosition = game.board.humans.find(
      (h: any) => h.position.q === targetPosition.q && h.position.r === targetPosition.r
    );
    expect(spawnedAtPosition?.definitionId).toBe("hunter");
    expect(game.board.humans.length).toBeGreaterThan(beforeCount);
    expect(game.spawnOverrides).toEqual([]); // consumed
  });
});

describe("Spawning never stacks two Humans on the same hex", () => {
  function assertNoOverlap(game: any) {
    const seen = new Set<string>();
    for (const h of game.board.humans) {
      const key = `${h.position.q},${h.position.r}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  }

  function startedTwoPlayerGame() {
    const rooms = new RoomManager();
    const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
    const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "river-nymphs");
    host.room.selectDomain(bob.playerId, "moonlight-pixies");
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    return { host, game: host.room.game! };
  }

  it("the initial spawn (3 designated ring positions, 4 Humans + a Hunter) never doubles up", () => {
    const { game } = startedTwoPlayerGame();
    assertNoOverlap(game);
  });

  it("repeated spawns with nobody moving away in between still never double up", () => {
    const { game } = startedTwoPlayerGame();
    for (let i = 0; i < 5; i++) {
      spawnHumans(game, game.board.spawnIndicator, false);
      assertNoOverlap(game);
    }
  });

  it("an occupied designated hex spawns nothing there — one fewer Human, not a relocation", () => {
    const { game } = startedTwoPlayerGame();
    // Initial setup already spawned onto every one of set A's 3 ring hexes
    // (and the Hunter onto the Portal center) with nobody having moved away.
    // Spawning set A again should place NO new Humans at all — every
    // designated hex, including the Hunter's, is still occupied.
    const before = game.board.humans.length;
    spawnHumans(game, "A", false);
    expect(game.board.humans.length).toBe(before); // not relocated elsewhere — just skipped
    assertNoOverlap(game);
  });

  it("population plateaus once every designated hex across both spawn sets is permanently occupied", () => {
    const { game } = startedTwoPlayerGame();
    const countAfterInitialSpawn = game.board.humans.length; // set A + Hunter, from buildInitialGameState
    expect(countAfterInitialSpawn).toBe(4); // 2 adults + 1 child + 1 baby (posIdx 3 already collided onto posIdx 0's hex) + 1 Hunter

    // Next call flips to set B — different, still-empty hexes — so 3 more
    // Humans spawn (its own 4th human collides the same way set A's did);
    // the Hunter is skipped this time since the Portal center is still
    // occupied by set A's Hunter from the initial spawn.
    spawnHumans(game, game.board.spawnIndicator, false);
    expect(game.board.humans.length).toBe(countAfterInitialSpawn + 3);
    const plateau = game.board.humans.length;

    // From here on, every designated hex (both sets' 3 ring positions, and
    // the shared Hunter center) is permanently occupied — further spawns,
    // with nobody ever moving away, place nothing at all, forever.
    for (let i = 0; i < 6; i++) {
      spawnHumans(game, game.board.spawnIndicator, false);
      expect(game.board.humans.length).toBe(plateau);
    }
    assertNoOverlap(game);
  });
});

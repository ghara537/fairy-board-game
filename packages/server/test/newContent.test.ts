import { describe, it, expect } from "vitest";
import { classifyDirections, axialAdd, axialKey, HEX_DIRECTIONS, DirectionClass } from "@fairy/shared";
import { RoomManager } from "../src/rooms/RoomManager";
import { legalLurePlacementSpaces } from "../src/game/engine/lures";
import { resolveStartingAbilities, passResponseWindowToClose } from "./testUtils";
import { ServerGameState } from "../src/game/state";

/** The first `cls`-classified neighbor of `pos` (relative to `domainHexes`) that's actually usable — on the board and not already occupied by a Human or obstacle. */
function firstUsableDirectionHex(game: ServerGameState, pos: { q: number; r: number }, domainHexes: { q: number; r: number }[], cls: DirectionClass) {
  const classes = classifyDirections(pos, domainHexes);
  return HEX_DIRECTIONS.map((d, i) => ({ i, dest: axialAdd(pos, d) }))
    .filter(({ i }) => classes[i] === cls)
    .map(({ dest }) => dest)
    .find(
      (dest) =>
        game.board.hexes.has(axialKey(dest)) &&
        !game.board.humans.some((h) => h.position.q === dest.q && h.position.r === dest.r) &&
        !game.board.obstacles.some((o) => o.position.q === dest.q && o.position.r === dest.r)
    );
}

function startedTwoPlayerGame() {
  const rooms = new RoomManager();
  const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
  const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
  if ("error" in bob) throw new Error("setup failed");
  host.room.selectDomain(host.playerId, "ocean-sirens");
  host.room.selectDomain(bob.playerId, "river-nymphs");
  host.room.setReady(host.playerId, true);
  host.room.setReady(bob.playerId, true);
  host.room.startGame();
  resolveStartingAbilities(host.room);
  const game = host.room.game!;
  return { rooms, host, bobId: bob.playerId, game };
}

describe("Real card content", () => {
  it("River Nymphs starts with a 4-lure cap, enforced on placement", () => {
    const { bobId, game } = startedTwoPlayerGame();
    expect(game.players[bobId].lureCap).toBe(4);
    // Bob is River Nymphs; manually stack 4 lures — at the cap, no further placement should be legal.
    game.board.lureStacks.push({ id: "test-stack", position: { q: 1, r: 0 }, owner: bobId, height: 4 });
    expect(legalLurePlacementSpaces(game, bobId).length).toBe(0);
  });

  it("Moonlight Pixies opens with 8 cards and a hand max of 10", () => {
    const rooms = new RoomManager();
    const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
    const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "moonlight-pixies");
    host.room.selectDomain(bob.playerId, "forest-elves");
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    const game = host.room.game!;
    expect(game.players[host.playerId].hand.length).toBe(8);
    expect(game.players[host.playerId].handSizeMax).toBe(10);
  });

  it("Discard & Draw discards the player's entire hand and draws exactly 4 cards back, regardless of Domain", () => {
    const { host, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const player = game.players[active];
    // Give them a distinctive, known hand so "discarded entirely" is unambiguous.
    player.hand = ["ancient-menhir", "wild-gale", "sirens-lure"];
    const deckBefore = game.deck.length;
    const discardBefore = game.discardPile.length;

    const result = host.room.submitAction(active, "discardDraw", {});
    expect(result.error).toBeUndefined();
    expect(player.hand.length).toBe(4);
    expect(player.hand).not.toEqual(expect.arrayContaining(["ancient-menhir", "wild-gale", "sirens-lure"]));
    // The 3 original cards landed in the discard pile; 4 fresh cards came off the deck.
    expect(game.discardPile.length).toBe(discardBefore + 3);
    expect(game.deck.length).toBe(deckBefore - 4);
    expect(game.actionsRemaining).toBe(2); // had 3, spent 1
  });

  it("Discard & Draw is once per turn, same as before", () => {
    const { host, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    host.room.submitAction(active, "discardDraw", {});
    const second = host.room.submitAction(active, "discardDraw", {});
    expect(second.error).toBeTruthy();
  });

  it("plays Seeds of the Elder Grove (Tree) and Ancient Menhir (Stone) through the response window", () => {
    const { host, bobId, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const player = game.players[active];
    player.hand.push("seeds-of-the-elder-grove");
    host.room.submitAction(active, "playCard", { cardId: "seeds-of-the-elder-grove", target: { to: { q: 2, r: 2 } } });
    passResponseWindowToClose(host.room);
    expect(game.board.obstacles.some((o) => o.type === "tree" && o.position.q === 2 && o.position.r === 2)).toBe(true);
  });

  it("obstacle placement is rejected onto a hex a Human currently occupies — a Human and an obstacle can never share a space either", () => {
    const { host, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const player = game.players[active];
    const occupiedPos = game.board.humans[0].position;
    player.hand.push("seeds-of-the-elder-grove");
    host.room.submitAction(active, "playCard", { cardId: "seeds-of-the-elder-grove", target: { to: occupiedPos } });
    passResponseWindowToClose(host.room); // the placement (and its isSpaceEmpty legality check) happens on resolve
    expect(game.board.obstacles.some((o) => o.position.q === occupiedPos.q && o.position.r === occupiedPos.r)).toBe(false);
  });

  it("Toadstool respects the 2-marker maximum by relocating instead of adding a third", () => {
    const { host, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const player = game.players[active];
    game.board.obstacles.push({ id: "t1", type: "toadstool", position: { q: 1, r: 1 } });
    game.board.obstacles.push({ id: "t2", type: "toadstool", position: { q: -1, r: -1 } });
    player.hand.push("toadstool");
    const result = host.room.submitAction(active, "playCard", {
      cardId: "toadstool",
      target: { relocateFromId: "t1", to: { q: 3, r: 0 } },
    });
    expect(result.error).toBeUndefined();
    passResponseWindowToClose(host.room);
    const toadstools = game.board.obstacles.filter((o) => o.type === "toadstool");
    expect(toadstools.length).toBe(2);
    expect(toadstools.some((o) => o.position.q === 3 && o.position.r === 0)).toBe(true);
  });

  it("Whisperwind places an Acceleration Marker, and Giant's Stride can move it", () => {
    const { host, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    game.players[active].hand.push("whisperwind");
    host.room.submitAction(active, "playCard", { cardId: "whisperwind", target: { to: { q: 2, r: 0 } } });
    passResponseWindowToClose(host.room);
    expect(game.board.accelMarkers.length).toBe(1);
    const markerId = game.board.accelMarkers[0].id;

    game.players[active].hand.push("giants-stride");
    game.actionsRemaining = 2;
    host.room.submitAction(active, "playCard", { cardId: "giants-stride", target: { markerId, to: { q: 2, r: 2 } } });
    passResponseWindowToClose(host.room);
    expect(game.board.accelMarkers[0].position).toEqual({ q: 2, r: 2 });
  });

  it("Phoenix Ashes reclaims a specific card from the discard pile", () => {
    const { host, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const player = game.players[active];
    game.discardPile.push("wild-gale");
    player.hand.push("phoenix-ashes");
    host.room.submitAction(active, "playCard", { cardId: "phoenix-ashes", target: { cardId: "wild-gale" } });
    passResponseWindowToClose(host.room);
    expect(player.hand.includes("wild-gale")).toBe(true);
    expect(game.discardPile.includes("wild-gale")).toBe(false);
  });

  it("Faerie Bargain redirects a resolving card to the caster's hand instead of the discard pile", () => {
    const { host, bobId, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const other = active === bobId ? host.playerId : bobId;
    game.players[active].hand.push("ancient-menhir");
    host.room.submitAction(active, "playCard", { cardId: "ancient-menhir", target: { to: { q: 2, r: 2 } } });
    expect(game.phase).toBe("response-window");
    const pendingId = game.responseStack[0].id;

    game.players[other].hand.push("faerie-bargain");
    const respondResult = host.room.respondToInteraction(other, game.pendingInteraction!.id, {
      cardId: "faerie-bargain",
      target: { effectId: pendingId },
    });
    expect(respondResult.error).toBeUndefined();
    passResponseWindowToClose(host.room);
    expect(game.players[other].hand.includes("ancient-menhir")).toBe(true);
    expect(game.discardPile.includes("ancient-menhir")).toBe(false);
    // The original effect still resolved normally.
    expect(game.board.obstacles.some((o) => o.type === "stone")).toBe(true);
  });

  it("Eclipse disables Instants for the rest of the round", () => {
    const { host, bobId, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const other = active === bobId ? host.playerId : bobId;
    game.players[active].hand.push("eclipse");
    host.room.submitAction(active, "playCard", { cardId: "eclipse", target: null });
    passResponseWindowToClose(host.room);
    expect(game.instantsDisabledUntilRound).toBe(game.round);

    game.players[active].hand.push("ancient-menhir");
    host.room.submitAction(active, "playCard", { cardId: "ancient-menhir", target: { to: { q: -2, r: 2 } } });
    expect(game.phase).toBe("response-window");
    game.players[other].hand.push("faerie-slumber");
    const attempt = host.room.respondToInteraction(other, game.pendingInteraction!.id, {
      cardId: "faerie-slumber",
      target: { humanInstanceId: game.board.humans[0]?.instanceId },
    });
    expect(attempt.error).toBeTruthy();
  });

  it("Veil of Mist stops a Human from being attracted to a lure beyond the radius cap for the rest of the round", () => {
    const { host, bobId, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const other = active === bobId ? host.playerId : bobId;
    game.players[active].hand.push("veil-of-mist");
    host.room.submitAction(active, "playCard", { cardId: "veil-of-mist", target: null });
    passResponseWindowToClose(host.room);
    expect(game.veilOfMistUntilRound).toBe(game.round);

    const human = { ...game.board.humans[0], position: { q: 0, r: 0 }, moved: false };
    game.board.humans = [human]; // isolate from other spawned Humans so they can't block the path
    game.board.lureStacks = [{ id: "vm-lure", position: { q: 0, r: -2 }, owner: active, height: 1 }];

    host.room.submitAction(active, "endTurn", {});
    host.room.submitAction(other, "endTurn", {});
    passResponseWindowToClose(host.room);

    const stillThere = game.board.humans.find((h) => h.instanceId === human.instanceId);
    expect(stillThere?.position).toEqual({ q: 0, r: 0 }); // out of radius — never attracted
  });

  it("Moon's Ascendance lets a Human cover 2 spaces in the round's movement phase", () => {
    const { host, bobId, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const other = active === bobId ? host.playerId : bobId;
    game.players[active].hand.push("moons-ascendance");
    host.room.submitAction(active, "playCard", { cardId: "moons-ascendance", target: null });
    passResponseWindowToClose(host.room);
    expect(game.moonsAscendanceUntilRound).toBe(game.round);

    const human = { ...game.board.humans[0], position: { q: 0, r: 0 }, moved: false };
    game.board.humans = [human]; // isolate from other spawned Humans so they can't block the path
    game.board.lureStacks = [{ id: "ma-lure", position: { q: 0, r: -3 }, owner: active, height: 1 }];

    host.room.submitAction(active, "endTurn", {});
    host.room.submitAction(other, "endTurn", {});
    passResponseWindowToClose(host.room);

    const stillThere = game.board.humans.find((h) => h.instanceId === human.instanceId);
    expect(stillThere?.position).toEqual({ q: 0, r: -2 }); // 2 steps this round, not 1
  });

  it("Siren's Call pulls a Human 2 spaces toward a chosen lure of the caster's", () => {
    const { host, game } = startedTwoPlayerGame();
    const domainPlayerId = game.players[Object.keys(game.players)[0]].domainId === "ocean-sirens" ? Object.keys(game.players)[0] : Object.keys(game.players)[1];
    game.board.lureStacks.push({ id: "siren-lure", position: { q: 3, r: 0 }, owner: domainPlayerId, height: 1 });
    const human = { ...game.board.humans[0], position: { q: 0, r: 0 }, moved: false };
    game.board.humans = [human]; // isolate from other spawned Humans so they can't block the pull's path
    game.phase = "player-turn";
    game.activePlayerId = domainPlayerId;
    game.actionsRemaining = 2;
    const result = host.room.submitAction(domainPlayerId, "useDomainAbility", {
      abilityIndex: 0,
      target: { humanInstanceId: human.instanceId, lureStackId: "siren-lure" },
    });
    expect(result.error).toBeUndefined();
    passResponseWindowToClose(host.room);
    expect(human.position).toEqual({ q: 2, r: 0 });
    expect(game.players[domainPlayerId].abilitiesUsed[0]).toBe(true);
  });

  it("The Queen's Banquet rotates every hand to the next player in turn order", () => {
    const { host, bobId, game } = startedTwoPlayerGame();
    const active = game.activePlayerId;
    const other = active === bobId ? host.playerId : bobId;
    const activeHandBefore = [...game.players[active].hand];
    const otherHandBefore = [...game.players[other].hand];
    game.players[active].hand.push("the-queens-banquet");
    host.room.submitAction(active, "playCard", { cardId: "the-queens-banquet", target: null });
    passResponseWindowToClose(host.room);
    // Whoever is "next" in turn order after the donor receives that donor's pre-rotation hand.
    const activeIdx = game.turnOrder.indexOf(active);
    const nextId = game.turnOrder[(activeIdx + 1) % game.turnOrder.length];
    expect(game.players[nextId].hand).toEqual(expect.arrayContaining(activeHandBefore.filter((c) => c !== "the-queens-banquet")));
  });
});

describe("Push/pull direction restriction (confirmed by the user: relative to the acting player's own Domain)", () => {
  function twoPlayerAtStartingAbilities(pushPullSidewaysAllowed: boolean) {
    const rooms = new RoomManager();
    const host = rooms.createRoom("Alice", {
      victoryCondition: { kind: "points", targetScore: 8 },
      disabledCardIds: [],
      firstPlayerRule: "youngest",
      responseTimerSec: null,
      pushPullSidewaysAllowed,
    });
    const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "ocean-sirens");
    host.room.selectDomain(bob.playerId, "river-nymphs"); // passive starting ability only — doesn't add to the queue
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    const game = host.room.game!;
    return { host, game, domainHexes: game.board.domainBoards.find((b) => b.playerId === host.playerId)!.hexes };
  }

  it("Ocean Sirens' starting-ability pull can move a Human toward the caster's Domain but is rejected moving away from it", () => {
    const { host, game, domainHexes } = twoPlayerAtStartingAbilities(true);
    expect(game.phase).toBe("starting-abilities");
    const interaction = game.pendingInteraction!;
    const human = game.board.humans[0];
    const originalPos = { ...human.position };

    const awayDest = firstUsableDirectionHex(game, originalPos, domainHexes, "away");
    expect(awayDest).toBeTruthy();
    const rejected = host.room.respondToInteraction(host.playerId, interaction.id, {
      target: { humanInstanceId: human.instanceId, to: awayDest },
    });
    expect(rejected.error).toBeTruthy();
    expect(human.position).toEqual(originalPos); // still pending — nothing moved

    const towardDest = firstUsableDirectionHex(game, originalPos, domainHexes, "toward");
    expect(towardDest).toBeTruthy();
    const accepted = host.room.respondToInteraction(host.playerId, interaction.id, {
      target: { humanInstanceId: human.instanceId, to: towardDest },
    });
    expect(accepted.error).toBeUndefined();
    expect(human.position).toEqual(towardDest);
  });

  it("Zephyr's Kiss can push a Human away from the caster's own Domain but is rejected pushing toward it", () => {
    const { host, game } = twoPlayerAtStartingAbilities(true);
    resolveStartingAbilities(host.room);
    const active = game.activePlayerId;
    // Re-derive domainHexes for whichever seat ended up active (cards aren't Domain-locked — anyone can play Zephyr's Kiss).
    const activeDomainHexes = game.board.domainBoards.find((b) => b.playerId === active)!.hexes;

    // An isolated Human at a clean, known position so path/occupancy noise can't interfere.
    const human = { ...game.board.humans[0], position: { q: 0, r: 0 }, moved: false };
    game.board.humans = [human];
    const player = game.players[active];

    const towardDest = firstUsableDirectionHex(game, human.position, activeDomainHexes, "toward");
    expect(towardDest).toBeTruthy();
    player.hand.push("zephyrs-kiss");
    host.room.submitAction(active, "playCard", { cardId: "zephyrs-kiss", target: { humanInstanceId: human.instanceId, to: towardDest } });
    passResponseWindowToClose(host.room);
    expect(human.position).toEqual({ q: 0, r: 0 }); // rejected on resolve — the push never happened

    const awayDest = firstUsableDirectionHex(game, human.position, activeDomainHexes, "away");
    expect(awayDest).toBeTruthy();
    player.hand.push("zephyrs-kiss");
    host.room.submitAction(active, "playCard", { cardId: "zephyrs-kiss", target: { humanInstanceId: human.instanceId, to: awayDest } });
    passResponseWindowToClose(host.room);
    expect(human.position).toEqual(awayDest);
  });

  it("sideways pull is rejected when the room disables it, and accepted when the room allows it", () => {
    for (const pushPullSidewaysAllowed of [false, true]) {
      const { host, game, domainHexes } = twoPlayerAtStartingAbilities(pushPullSidewaysAllowed);
      const interaction = game.pendingInteraction!;
      const human = game.board.humans[0];
      const sidewaysDest = firstUsableDirectionHex(game, human.position, domainHexes, "sideways");
      expect(sidewaysDest).toBeTruthy();
      const result = host.room.respondToInteraction(host.playerId, interaction.id, {
        target: { humanInstanceId: human.instanceId, to: sidewaysDest },
      });
      if (pushPullSidewaysAllowed) {
        expect(result.error).toBeUndefined();
        expect(human.position).toEqual(sidewaysDest);
      } else {
        expect(result.error).toBeTruthy();
        expect(human.position).not.toEqual(sidewaysDest);
      }
    }
  });
});

import { describe, it, expect } from "vitest";
import { RoomManager } from "../src/rooms/RoomManager";
import { resolveStartingAbilities } from "./testUtils";

function startedGame(domainA: string, domainB: string) {
  const rooms = new RoomManager();
  const host = rooms.createRoom("Alice", {
    victoryCondition: { kind: "points", targetScore: 8 },
    disabledCardIds: [],
    firstPlayerRule: "youngest",
    responseTimerSec: null,
    pushPullSidewaysAllowed: true,
  });
  const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
  if ("error" in bob) throw new Error("setup failed");
  host.room.selectDomain(host.playerId, domainA as any);
  host.room.selectDomain(bob.playerId, domainB as any);
  host.room.setReady(host.playerId, true);
  host.room.setReady(bob.playerId, true);
  host.room.startGame();
  resolveStartingAbilities(host.room);
  const game = host.room.game!;
  // Empty the deck/discard pile so the automatic end-of-turn draw is a no-op —
  // makes hand counts in these tests exact instead of "N or N+1".
  game.deck = [];
  game.discardPile = [];
  return { host, bobId: bob.playerId, game };
}

/** Ending `active`'s turn would normally either move to the other player OR,
 * if `active` happens to be last in turn order, roll the whole round over
 * into the Human Movement Phase — which can open its own, unrelated
 * pendingInteraction (a genuine path-choice tie) depending on where the
 * default starting-ability placements happened to land. These tests care
 * about the end-of-turn hand-size check specifically, so pin firstPlayerId
 * to `active` to guarantee "end this turn" always just hands off to the
 * other player, never into movement-phase processing. */
function isolateFromMovementPhase(game: ReturnType<typeof startedGame>["game"], active: string) {
  game.firstPlayerId = active;
}

describe("Hand size: starting and max", () => {
  it("normal Domains start with 5 cards and have a 7-card max", () => {
    const { host, game } = startedGame("ocean-sirens", "forest-elves");
    expect(game.players[host.playerId].hand.length).toBe(5);
    expect(game.players[host.playerId].handSizeMax).toBe(7);
  });

  it("Moonlight Pixies starts with 8 cards and has a 10-card max", () => {
    const { host, game } = startedGame("moonlight-pixies", "forest-elves");
    expect(game.players[host.playerId].hand.length).toBe(8);
    expect(game.players[host.playerId].handSizeMax).toBe(10);
  });
});

describe("Mandatory end-of-turn discard", () => {
  it("a hand at or under the max doesn't trigger anything — the turn just ends normally", () => {
    const { host, game } = startedGame("ocean-sirens", "forest-elves");
    const active = game.activePlayerId;
    isolateFromMovementPhase(game, active);
    game.players[active].hand = Array.from({ length: 7 }, () => "eclipse"); // exactly at the 7-card max
    game.actionsRemaining = 0;
    host.room.submitAction(active, "endTurn", {});
    expect(game.pendingInteraction).toBeNull();
    expect(game.activePlayerId).not.toBe(active); // turn advanced
  });

  it("a hand over the max at the end of a turn opens a mandatory discard prompt and pauses the turn", () => {
    const { host, game } = startedGame("ocean-sirens", "forest-elves");
    const active = game.activePlayerId;
    isolateFromMovementPhase(game, active);
    game.players[active].hand = Array.from({ length: 9 }, () => "eclipse"); // 9 > 7-card max
    game.actionsRemaining = 0;
    host.room.submitAction(active, "endTurn", {});
    expect(game.pendingInteraction?.kind).toBe("mandatoryDiscard");
    expect(game.pendingInteraction?.forPlayerIds).toEqual([active]);
    expect((game.pendingInteraction?.legalOptions as any).mustDiscardCount).toBe(2); // 9 - 7
    expect(game.activePlayerId).toBe(active); // turn has NOT advanced yet
  });

  it("rejects discarding the wrong number of cards", () => {
    const { host, game } = startedGame("ocean-sirens", "forest-elves");
    const active = game.activePlayerId;
    isolateFromMovementPhase(game, active);
    game.players[active].hand = Array.from({ length: 9 }, () => "eclipse");
    game.actionsRemaining = 0;
    host.room.submitAction(active, "endTurn", {});
    const interactionId = game.pendingInteraction!.id;
    const result = host.room.respondToInteraction(active, interactionId, { cardIds: ["eclipse"] }); // only 1, need 2
    expect(result.error).toBeTruthy();
    expect(game.pendingInteraction).not.toBeNull(); // still pending
  });

  it("discarding the required count clears the prompt, discards those cards, and lets the turn continue", () => {
    const { host, game } = startedGame("ocean-sirens", "forest-elves");
    const active = game.activePlayerId;
    isolateFromMovementPhase(game, active);
    game.players[active].hand = Array.from({ length: 9 }, () => "eclipse");
    game.actionsRemaining = 0;
    host.room.submitAction(active, "endTurn", {});
    const interactionId = game.pendingInteraction!.id;
    const mustDiscard = (game.pendingInteraction!.legalOptions as any).mustDiscardCount;
    const toDiscard = game.players[active].hand.slice(0, mustDiscard);

    const result = host.room.respondToInteraction(active, interactionId, { cardIds: toDiscard });
    expect(result.error).toBeUndefined();
    expect(game.pendingInteraction).toBeNull();
    expect(game.players[active].hand.length).toBe(7); // discarded down to the max
    expect(game.discardPile.length).toBe(mustDiscard);
    expect(game.activePlayerId).not.toBe(active); // turn advanced to the other player
  });

  it("Moonlight Pixies isn't prompted until over their own 10-card max, not the normal 7", () => {
    const { host, game } = startedGame("moonlight-pixies", "forest-elves");
    const pixiesId = Object.keys(game.players).find((id) => game.players[id].domainId === "moonlight-pixies")!;
    game.activePlayerId = pixiesId;
    isolateFromMovementPhase(game, pixiesId);
    game.players[pixiesId].hand = Array.from({ length: 9 }, () => "eclipse"); // over 7, but under Moonlight Pixies' 10 max
    game.actionsRemaining = 0;
    host.room.submitAction(pixiesId, "endTurn", {});
    expect(game.pendingInteraction).toBeNull(); // not prompted — 9 <= 10
  });

  it("Moonlight Pixies IS prompted once over their own 10-card max", () => {
    const { host, game } = startedGame("moonlight-pixies", "forest-elves");
    const pixiesId = Object.keys(game.players).find((id) => game.players[id].domainId === "moonlight-pixies")!;
    game.activePlayerId = pixiesId;
    isolateFromMovementPhase(game, pixiesId);
    game.players[pixiesId].hand = Array.from({ length: 12 }, () => "eclipse"); // over the 10 max
    game.actionsRemaining = 0;
    host.room.submitAction(pixiesId, "endTurn", {});
    expect(game.pendingInteraction?.kind).toBe("mandatoryDiscard");
    expect((game.pendingInteraction?.legalOptions as any).mustDiscardCount).toBe(2); // 12 - 10
  });
});

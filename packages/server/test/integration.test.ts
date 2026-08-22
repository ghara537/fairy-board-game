import { describe, it, expect } from "vitest";
import { RoomManager } from "../src/rooms/RoomManager";
import { verifyReconnectToken } from "../src/reconnect/tokens";
import { resolveStartingAbilities, passResponseWindowToClose } from "./testUtils";

function makeRoom() {
  const rooms = new RoomManager();
  const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
  return { rooms, host };
}

describe("Room creation and joining", () => {
  it("creates a room with a 6-character code and seats the host", () => {
    const { host } = makeRoom();
    expect(host.room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(host.room.players.size).toBe(1);
    expect(host.room.hostPlayerId).toBe(host.playerId);
  });

  it("lets a second player join by code and assigns a distinct seat", () => {
    const { rooms, host } = makeRoom();
    const result = rooms.joinRoom(host.room.code, "Bob", 2000);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.room.players.size).toBe(2);
    expect(result.playerId).not.toBe(host.playerId);
  });

  it("rejects joining an unknown room code", () => {
    const { rooms } = makeRoom();
    const result = rooms.joinRoom("ZZZZZZ", "Bob", null);
    expect("error" in result).toBe(true);
  });

  it("does not allow two players to select the same Domain", () => {
    const { rooms, host } = makeRoom();
    const bob = rooms.joinRoom(host.room.code, "Bob", 2000);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "ocean-sirens");
    const result = host.room.selectDomain(bob.playerId, "ocean-sirens");
    expect(result.error).toBeTruthy();
  });

  it("refuses to start until every player has a Domain and is ready", () => {
    const { rooms, host } = makeRoom();
    const bob = rooms.joinRoom(host.room.code, "Bob", 2000);
    if ("error" in bob) throw new Error("setup failed");
    expect(host.room.canStart().ok).toBe(false);
    host.room.selectDomain(host.playerId, "ocean-sirens");
    host.room.selectDomain(bob.playerId, "forest-elves");
    expect(host.room.canStart().ok).toBe(false); // not ready yet
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    expect(host.room.canStart().ok).toBe(true);
  });

  it("does not allow a new player to join after the game has started", () => {
    const { rooms, host } = makeRoom();
    const bob = rooms.joinRoom(host.room.code, "Bob", 2000);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "ocean-sirens");
    host.room.selectDomain(bob.playerId, "forest-elves");
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    const late = rooms.joinRoom(host.room.code, "Carol", 1999);
    expect("error" in late).toBe(true);
  });
});

describe("Turns", () => {
  function startedGame() {
    const { rooms, host } = makeRoom();
    const bob = rooms.joinRoom(host.room.code, "Bob", 1990); // older, so Alice (no birth year) or Bob's youngest logic applies
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "ocean-sirens");
    host.room.selectDomain(bob.playerId, "forest-elves");
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    resolveStartingAbilities(host.room);
    return { rooms, host, bobId: bob.playerId };
  }

  it("gives the active player exactly three actions and rotates turn order after they're used", () => {
    const { host, bobId } = startedGame();
    const game = host.room.game!;
    expect(game.actionsRemaining).toBe(3);
    const active = game.activePlayerId;
    const other = active === host.playerId ? bobId : host.playerId;

    const r1 = host.room.submitAction(active, "endTurn", {});
    expect(r1.error).toBeUndefined();
    expect(host.room.game!.activePlayerId).toBe(other);
    expect(host.room.game!.actionsRemaining).toBe(3);
  });

  it("'Draw a Card' costs 1 action and adds exactly 1 card to hand", () => {
    const { host } = startedGame();
    const game = host.room.game!;
    const active = game.activePlayerId;
    const player = game.players[active];
    const handBefore = player.hand.length;
    const deckBefore = game.deck.length;

    const result = host.room.submitAction(active, "drawCard", {});
    expect(result.error).toBeUndefined();
    expect(player.hand.length).toBe(handBefore + 1);
    expect(game.deck.length).toBe(deckBefore - 1);
    expect(game.actionsRemaining).toBe(2); // had 3, spent 1

    // A second draw in the same turn works too — gated only by actions remaining, not once-per-turn.
    const result2 = host.room.submitAction(active, "drawCard", {});
    expect(result2.error).toBeUndefined();
    expect(player.hand.length).toBe(handBefore + 2);
    expect(game.actionsRemaining).toBe(1);
  });

  it("rejects 'Draw a Card' with no actions remaining", () => {
    const { host } = startedGame();
    const game = host.room.game!;
    const active = game.activePlayerId;
    game.actionsRemaining = 0;
    const result = host.room.submitAction(active, "drawCard", {});
    expect(result.error).toBeTruthy();
  });

  it("rejects an action submitted by a player who is not the active player", () => {
    const { host, bobId } = startedGame();
    const game = host.room.game!;
    const notActive = game.activePlayerId === host.playerId ? bobId : host.playerId;
    const result = host.room.submitAction(notActive, "placeLure", { position: { q: 0, r: 0 } });
    expect(result.error).toBeTruthy();
  });

  it("rejects an illegal lure placement (stacking on an opponent's lure)", () => {
    const { host, bobId } = startedGame();
    const game = host.room.game!;
    const active = game.activePlayerId;
    const other = active === host.playerId ? bobId : host.playerId;
    host.room.submitAction(active, "placeLure", { position: { q: 2, r: 2 } });
    // End active player's turn, then have the other player try to stack on the first player's lure.
    host.room.submitAction(active, "endTurn", {});
    const result = host.room.submitAction(other, "placeLure", { position: { q: 2, r: 2 } });
    expect(result.error).toBeTruthy();
  });

  it("allows stacking a second lure of your own on the same hex, growing that stack's height", () => {
    const { host } = startedGame();
    const game = host.room.game!;
    const active = game.activePlayerId;
    host.room.submitAction(active, "placeLure", { position: { q: 2, r: 2 } });
    expect(game.board.lureStacks.length).toBe(1);
    expect(game.board.lureStacks[0].height).toBe(1);
    const result = host.room.submitAction(active, "placeLure", { position: { q: 2, r: 2 } });
    expect(result.error).toBeUndefined();
    // Still one stack (not a second one at the same hex), now height 2.
    expect(game.board.lureStacks.length).toBe(1);
    expect(game.board.lureStacks[0].height).toBe(2);
    expect(game.board.lureStacks[0].owner).toBe(active);
  });

  it("runs a full round through Human Movement and back to player-turn", () => {
    const { host, bobId } = startedGame();
    const game = host.room.game!;
    const active = game.activePlayerId;
    const other = active === host.playerId ? bobId : host.playerId;
    const startRound = game.round;
    host.room.submitAction(active, "endTurn", {});
    host.room.submitAction(other, "endTurn", {});
    // Someone may have been dealt "Threads of Fate", which opens a pre-spawn
    // response window — pass it closed if so (this test isn't about that card).
    passResponseWindowToClose(host.room);
    expect(host.room.game!.round).toBe(startRound + 1);
    expect(host.room.game!.phase).toBe("player-turn");
  });
});

describe("Responses", () => {
  it("opens a response window when an action-cost card is played, and resolves it once all players pass", () => {
    const rooms = new RoomManager();
    const host = rooms.createRoom("Alice", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
    const bob = rooms.joinRoom(host.room.code, "Bob", 1990);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "ocean-sirens");
    host.room.selectDomain(bob.playerId, "forest-elves");
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();
    resolveStartingAbilities(host.room);
    const game = host.room.game!;
    const active = game.activePlayerId;
    const other = active === host.playerId ? bob.playerId : host.playerId;

    const player = game.players[active];
    player.hand = ["seeds-of-the-elder-grove", ...player.hand];

    host.room.submitAction(active, "playCard", { cardId: "seeds-of-the-elder-grove", target: { to: { q: -2, r: 1 } } });
    expect(game.phase).toBe("response-window");
    expect(game.pendingInteraction?.forPlayerIds).toEqual([other]);

    host.room.respondToInteraction(other, game.pendingInteraction!.id, { pass: true });
    // The source player also gets a final chance to respond before resolution.
    if (game.phase === "response-window") {
      host.room.respondToInteraction(active, game.pendingInteraction!.id, { pass: true });
    }
    expect(game.phase).toBe("player-turn");
    expect(game.board.obstacles.some((o) => o.position.q === -2 && o.position.r === 1 && o.type === "tree")).toBe(true);
  });
});

describe("Reconnection", () => {
  it("issues a working reconnect token and restores the same seat", () => {
    const { rooms, host } = makeRoom();
    const stored = host.room.players.get(host.playerId)!.reconnectTokenHash;
    expect(verifyReconnectToken(host.token, stored)).toBe(true);

    const result = rooms.reconnect(host.room.code, host.playerId, host.token, "socket-2");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.room.players.get(host.playerId)!.connectionStatus).toBe("connected");
    expect(result.room.players.get(host.playerId)!.socketId).toBe("socket-2");
  });

  it("rejects reconnection with an invalid token", () => {
    const { rooms, host } = makeRoom();
    const result = rooms.reconnect(host.room.code, host.playerId, "not-the-real-token", "socket-2");
    expect("error" in result).toBe(true);
  });

  it("marks a player disconnected without freeing their seat, and the host can release it", () => {
    const { rooms, host } = makeRoom();
    const bob = rooms.joinRoom(host.room.code, "Bob", 2000);
    if ("error" in bob) throw new Error("setup failed");
    host.room.markDisconnected(bob.playerId);
    expect(host.room.players.get(bob.playerId)!.connectionStatus).toBe("disconnected");
    expect(host.room.players.size).toBe(2); // seat still exists, not removed

    // A non-host cannot release the seat.
    const denied = host.room.hostCorrection(bob.playerId, "releaseSeat", { playerId: bob.playerId });
    expect(denied.error).toBeTruthy();

    // The host can.
    const released = host.room.hostCorrection(host.playerId, "releaseSeat", { playerId: bob.playerId });
    expect(released.error).toBeUndefined();
  });

  it("a reconnected player receives the full current personalized state (their hand is populated once the game has started)", () => {
    const { rooms, host } = makeRoom();
    const bob = rooms.joinRoom(host.room.code, "Bob", 2000);
    if ("error" in bob) throw new Error("setup failed");
    host.room.selectDomain(host.playerId, "ocean-sirens");
    host.room.selectDomain(bob.playerId, "forest-elves");
    host.room.setReady(host.playerId, true);
    host.room.setReady(bob.playerId, true);
    host.room.startGame();

    host.room.markDisconnected(host.playerId);
    const result = rooms.reconnect(host.room.code, host.playerId, host.token, "socket-new");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.room.game!.players[host.playerId].hand.length).toBeGreaterThan(0);
  });
});

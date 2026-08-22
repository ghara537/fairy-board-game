import { describe, it, expect } from "vitest";
import { DomainId, VictoryCondition, generateHexagonalBoard, shortestPath, Axial } from "@fairy/shared";
import { RoomManager } from "../src/rooms/RoomManager";
import { resolveStartingAbilities, passResponseWindowToClose } from "./testUtils";
import { checkTurnBasedEnd, checkVictory } from "../src/game/engine/victory";
import { ServerGameState } from "../src/game/state";

/** Same distance rule the engine's tiebreak uses: shortest path from the closest of a Domain's 4 hexes to `pos`, respecting the same blocking obstacles (starting abilities can place a Tree/Toadstool before we get here). */
function domainDistance(game: ServerGameState, domainHexes: Axial[], pos: Axial): number {
  const passable = (p: Axial) =>
    !game.board.obstacles.some((o) => (o.type === "tree" || o.type === "stone" || o.type === "toadstool") && o.position.q === p.q && o.position.r === p.r);
  let min = Infinity;
  for (const dh of domainHexes) {
    const path = shortestPath(dh, pos, passable, game.board.hexes);
    if (path && path.distance < min) min = path.distance;
  }
  return min;
}

const BASE_DOMAINS: DomainId[] = ["ocean-sirens", "forest-elves", "wind-djinn", "river-nymphs", "moonlight-pixies", "earth-gnomes"];

function startedGame(count: number, victoryCondition: VictoryCondition, disabledCardIds: string[] = []) {
  const rooms = new RoomManager();
  const host = rooms.createRoom("P0", { victoryCondition, disabledCardIds, firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
  const playerIds = [host.playerId];
  for (let i = 1; i < count; i++) {
    const joined = rooms.joinRoom(host.room.code, `P${i}`, 2000 - i);
    if ("error" in joined) throw new Error("setup failed");
    playerIds.push(joined.playerId);
  }
  playerIds.forEach((id, i) => host.room.selectDomain(id, BASE_DOMAINS[i]));
  playerIds.forEach((id) => host.room.setReady(id, true));
  host.room.startGame();
  resolveStartingAbilities(host.room);
  const game = host.room.game!;
  return { rooms, host, playerIds, game };
}

describe("Points-mode victory condition", () => {
  it("defaults to 8 points when not otherwise specified", () => {
    const { game } = startedGame(2, { kind: "points", targetScore: 8 });
    expect(game.targetScore).toBe(8);
  });

  it("is fully configurable — a custom target score ends the game as soon as it's reached", () => {
    const { game, playerIds } = startedGame(2, { kind: "points", targetScore: 5 });
    expect(game.targetScore).toBe(5);
    game.players[playerIds[0]].score = 5;
    checkVictory(game);
    expect(game.winnerId).toBe(playerIds[0]);
    expect(game.phase).toBe("game-over");
  });
});

describe("Turns-mode victory condition", () => {
  it("declares the unique high scorer once the turn limit round completes", () => {
    const { game, playerIds } = startedGame(2, { kind: "turns", turnLimit: 10, tieExtensionLimit: 12 });
    const [p0, p1] = playerIds;
    game.round = 10;
    game.players[p0].score = 7;
    game.players[p1].score = 5;
    checkTurnBasedEnd(game);
    expect(game.winnerId).toBe(p0);
    expect(game.phase).toBe("game-over");
    expect(game.drawPlayerIds).toBeNull();
  });

  it("does nothing before the turn limit is reached, even with a clear leader", () => {
    const { game, playerIds } = startedGame(2, { kind: "turns", turnLimit: 10, tieExtensionLimit: 12 });
    const [p0, p1] = playerIds;
    game.round = 9;
    game.players[p0].score = 7;
    game.players[p1].score = 1;
    checkTurnBasedEnd(game);
    expect(game.winnerId).toBeNull();
    expect(game.phase).not.toBe("game-over");
  });

  it("a tie at the turn limit lets play continue instead of ending immediately", () => {
    const { game, playerIds } = startedGame(2, { kind: "turns", turnLimit: 10, tieExtensionLimit: 12 });
    const [p0, p1] = playerIds;
    game.round = 10;
    game.players[p0].score = 6;
    game.players[p1].score = 6;
    checkTurnBasedEnd(game);
    expect(game.winnerId).toBeNull();
    expect(game.drawPlayerIds).toBeNull();
    expect(game.phase).not.toBe("game-over"); // play continues toward round 12
  });

  it("a tie that resolves before round 12 (e.g. round 11) ends the game there", () => {
    const { game, playerIds } = startedGame(2, { kind: "turns", turnLimit: 10, tieExtensionLimit: 12 });
    const [p0, p1] = playerIds;
    game.round = 11;
    game.players[p0].score = 6;
    game.players[p1].score = 9;
    checkTurnBasedEnd(game);
    expect(game.winnerId).toBe(p1);
  });

  it("still tied at round 12: the Domain closest to the nearest remaining townsfolk wins", () => {
    const { game, playerIds } = startedGame(2, { kind: "turns", turnLimit: 10, tieExtensionLimit: 12 });
    const [p0, p1] = playerIds;
    game.round = 12;
    game.players[p0].score = 6;
    game.players[p1].score = 6;

    const p0Domain = game.board.domainBoards.find((d) => d.playerId === p0)!;
    const p1Domain = game.board.domainBoards.find((d) => d.playerId === p1)!;
    // One townsfolk Human, placed exactly on one of p0's own Domain hexes —
    // distance 0 for p0, guaranteed > 0 for p1 (a different edge of the board).
    game.board.humans = [{ ...game.board.humans[0], position: p0Domain.hexes[0] }];

    checkTurnBasedEnd(game);
    expect(game.winnerId).toBe(p0);
    expect(game.drawPlayerIds).toBeNull();
    void p1Domain;
  });

  it("first-nearest townsfolk ties: the second-nearest breaks it", () => {
    // A 3-player table (sides 2/4/6) so the two tied Domains aren't diametrically
    // opposite — on an opposite pair, a position can never be farther from BOTH
    // than the tie point (moving away from one always moves toward the other),
    // so there'd be no valid spot for a second, tie-breaking townsfolk at all.
    const { game, playerIds } = startedGame(3, { kind: "turns", turnLimit: 10, tieExtensionLimit: 12 });
    const [p0, p1, p2] = playerIds;
    game.round = 12;
    game.players[p0].score = 6;
    game.players[p1].score = 6;
    game.players[p2].score = 1; // not part of the tie

    const p0Domain = game.board.domainBoards.find((d) => d.playerId === p0)!.hexes;
    const p1Domain = game.board.domainBoards.find((d) => d.playerId === p1)!.hexes;

    // Search the real board for a position equidistant from both Domains (for
    // Human A — the tied "nearest townsfolk") and a second position that is
    // farther from both but NOT equally so (for Human B — the tiebreaker).
    // Built from actual computed distances, not assumed board symmetry.
    const boardHexes = generateHexagonalBoard(5);
    const byDistance = boardHexes.map((pos) => ({
      pos,
      d0: domainDistance(game, p0Domain, pos),
      d1: domainDistance(game, p1Domain, pos),
    }));
    const tiedCandidates = byDistance.filter((c) => c.d0 === c.d1 && c.d0 > 0 && c.d0 < Infinity).sort((a, b) => a.d0 - b.d0);
    const tiedSpot = tiedCandidates[0];
    expect(tiedSpot).toBeTruthy();
    const tieValue = tiedSpot.d0;
    const tiebreakSpot = byDistance.find((c) => c.d0 > tieValue && c.d1 > tieValue && c.d0 !== c.d1);
    expect(tiebreakSpot).toBeTruthy();

    const template = game.board.humans[0];
    game.board.humans = [
      { ...template, instanceId: "h-tied", position: tiedSpot!.pos },
      { ...template, instanceId: "h-tiebreak", position: tiebreakSpot!.pos },
    ];

    const expectedWinner = tiebreakSpot!.d0 < tiebreakSpot!.d1 ? p0 : p1;
    checkTurnBasedEnd(game);
    expect(game.winnerId).toBe(expectedWinner);
  });

  it("declares a draw when no townsfolk remain on the board to break the tie", () => {
    const { game, playerIds } = startedGame(2, { kind: "turns", turnLimit: 10, tieExtensionLimit: 12 });
    const [p0, p1] = playerIds;
    game.round = 12;
    game.players[p0].score = 6;
    game.players[p1].score = 6;
    game.board.humans = game.board.humans.filter((h) => h.definitionId === "hunter"); // no townsfolk left

    checkTurnBasedEnd(game);
    expect(game.winnerId).toBeNull();
    expect(game.drawPlayerIds).toEqual(expect.arrayContaining([p0, p1]));
    expect(game.phase).toBe("game-over");
  });
});

describe("Disabled cards", () => {
  it("a disabled card never appears in the deck or in any starting hand", () => {
    const { game } = startedGame(2, { kind: "points", targetScore: 8 }, ["eclipse", "sirens-lure"]);
    expect(game.deck).not.toContain("eclipse");
    expect(game.deck).not.toContain("sirens-lure");
    for (const p of Object.values(game.players)) {
      expect(p.hand).not.toContain("eclipse");
      expect(p.hand).not.toContain("sirens-lure");
    }
  });
});

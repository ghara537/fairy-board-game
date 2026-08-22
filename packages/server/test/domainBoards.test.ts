import { describe, it, expect } from "vitest";
import { DOMAIN_SIDE_ASSIGNMENTS, BOARD_EDGE_LENGTH, generateHexagonalBoard, axialKey, neighbors, DomainId } from "@fairy/shared";
import { RoomManager } from "../src/rooms/RoomManager";
import { resolveStartingAbilities, passResponseWindowToClose } from "./testUtils";
import { forceHumanTo } from "../src/game/engine/effectPrimitives";

const BASE_DOMAINS: DomainId[] = ["ocean-sirens", "forest-elves", "wind-djinn", "river-nymphs", "moonlight-pixies", "earth-gnomes"];

function startedGameWithPlayers(count: number) {
  const rooms = new RoomManager();
  const host = rooms.createRoom("P0", { victoryCondition: { kind: "points", targetScore: 8 }, disabledCardIds: [], firstPlayerRule: "youngest", responseTimerSec: null, pushPullSidewaysAllowed: true });
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

describe("Domain boards", () => {
  for (const count of [2, 3, 4, 5, 6]) {
    it(`assigns exactly the right side numbers for a ${count}-player game`, () => {
      const { game, playerIds } = startedGameWithPlayers(count);
      expect(game.board.domainBoards.length).toBe(count);

      const usedSides = game.board.domainBoards.map((d) => d.side).sort((a, b) => a - b);
      const expectedSides = [...DOMAIN_SIDE_ASSIGNMENTS[count]].sort((a, b) => a - b);
      expect(usedSides).toEqual(expectedSides);

      const byPlayer = new Map(game.board.domainBoards.map((d) => [d.playerId, d]));
      for (const id of playerIds) {
        const assignment = byPlayer.get(id);
        expect(assignment).toBeTruthy();
        expect(assignment!.domainId).toBe(game.players[id].domainId);
        expect(assignment!.hexes.length).toBe(4);
        for (const hex of assignment!.hexes) {
          expect(game.board.hexes.has(axialKey(hex))).toBe(true);
        }
      }

      // Domain hexes are genuinely attached OUTSIDE the main hexagon, not reused interior hexes.
      const mainHexes = new Set(generateHexagonalBoard(BOARD_EDGE_LENGTH).map(axialKey));
      for (const d of game.board.domainBoards) {
        for (const hex of d.hexes) {
          expect(mainHexes.has(axialKey(hex))).toBe(false);
        }
      }
    });
  }

  it("a Human reaching a player's Domain scores that player, even if a rival's lure drew it there", () => {
    const { host, game, playerIds } = startedGameWithPlayers(2);
    const [p0, p1] = playerIds;
    const active = game.activePlayerId;
    const other = active === p0 ? p1 : p0;

    const p0Domain = game.board.domainBoards.find((d) => d.playerId === p0)!;
    const domainHex = p0Domain.hexes[0];
    const allDomainHexKeys = new Set(game.board.domainBoards.flatMap((d) => d.hexes.map(axialKey)));
    const entryHex = neighbors(domainHex).find((n) => game.board.hexes.has(axialKey(n)) && !allDomainHexKeys.has(axialKey(n)));
    expect(entryHex).toBeTruthy();

    const human = { ...game.board.humans[0], position: entryHex!, moved: false };
    game.board.humans = [human];
    game.board.lureStacks = [{ id: "rival-lure", position: domainHex, owner: p1, height: 1 }];

    const p0ScoreBefore = game.players[p0].score;
    const p1ScoreBefore = game.players[p1].score;

    host.room.submitAction(active, "endTurn", {});
    host.room.submitAction(other, "endTurn", {});
    passResponseWindowToClose(host.room);

    expect(game.board.humans.find((h) => h.instanceId === human.instanceId)).toBeUndefined();
    expect(game.players[p0].collectedHumanDefinitionIds).toContain(human.definitionId);
    expect(game.players[p1].collectedHumanDefinitionIds).not.toContain(human.definitionId);
    expect(game.players[p0].score).not.toBe(p0ScoreBefore);
    expect(game.players[p1].score).toBe(p1ScoreBefore); // p1 owned the lure but gets no credit
  });

  it("scoring depends only on reaching a Domain hex — no lure needs to be involved at all", () => {
    const { game, playerIds } = startedGameWithPlayers(2);
    const [p0, p1] = playerIds;
    const p1Domain = game.board.domainBoards.find((d) => d.playerId === p1)!;
    const domainHex = p1Domain.hexes[2];

    const human = game.board.humans[0];
    game.board.lureStacks = []; // no lure anywhere on the board, let alone at domainHex

    const p1ScoreBefore = game.players[p1].score;
    const ok = forceHumanTo(game, human.instanceId, domainHex);

    expect(ok).toBe(true);
    expect(game.board.humans.find((h) => h.instanceId === human.instanceId)).toBeUndefined();
    expect(game.players[p1].collectedHumanDefinitionIds).toContain(human.definitionId);
    expect(game.players[p1].score).not.toBe(p1ScoreBefore);
  });

  it("a Hunter reaching a Domain is worth -2, same domain-arrival trigger as any other Human", () => {
    const { game, playerIds } = startedGameWithPlayers(2);
    const [p0, p1] = playerIds;
    const p1Domain = game.board.domainBoards.find((d) => d.playerId === p1)!;
    const domainHex = p1Domain.hexes[0];

    const hunter = game.board.humans.find((h) => h.definitionId === "hunter")!;
    expect(hunter).toBeTruthy();

    const ok = forceHumanTo(game, hunter.instanceId, domainHex);

    expect(ok).toBe(true);
    expect(game.board.humans.find((h) => h.instanceId === hunter.instanceId)).toBeUndefined();
    expect(game.players[p1].collectedHumanDefinitionIds).toContain("hunter");
    // Score is fully recomputed from collectedHumanDefinitionIds each time
    // (not incremented) — a lone Hunter collection is worth exactly -2.
    expect(game.players[p1].score).toBe(-2);
  });

  it("reaching an ordinary lure away from any Domain doesn't score — it just clears the lure", () => {
    const { host, game, playerIds } = startedGameWithPlayers(2);
    const [p0, p1] = playerIds;
    const active = game.activePlayerId;
    const other = active === p0 ? p1 : p0;

    const human = { ...game.board.humans[0], position: { q: 0, r: 0 }, moved: false };
    game.board.humans = [human];
    game.board.lureStacks = [{ id: "bait", position: { q: 1, r: 0 }, owner: p0, height: 1 }];

    const p0ScoreBefore = game.players[p0].score;

    host.room.submitAction(active, "endTurn", {});
    host.room.submitAction(other, "endTurn", {});
    passResponseWindowToClose(host.room);

    const stillThere = game.board.humans.find((h) => h.instanceId === human.instanceId);
    expect(stillThere).toBeTruthy(); // not collected — the lure was just bait
    expect(stillThere?.position).toEqual({ q: 1, r: 0 });
    expect(game.players[p0].score).toBe(p0ScoreBefore);
  });
});

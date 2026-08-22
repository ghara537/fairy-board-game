import { neighbors, axialKey, neighborDirectionIndex } from "@fairy/shared";
import { Room } from "../src/rooms/Room";
import { legalPushPullDirections } from "../src/game/engine/effectPrimitives";

/** Auto-resolves every queued targeted starting ability with a simple, always-legal default target, so tests that aren't specifically about starting abilities can get straight to "player-turn". */
export function resolveStartingAbilities(room: Room): void {
  const game = room.game!;
  let guard = 0;
  while (game.phase === "starting-abilities" && guard < 10) {
    guard++;
    const interaction = game.pendingInteraction;
    if (!interaction) break;
    const playerId = interaction.forPlayerIds[0];
    const domainId = game.players[playerId].domainId;
    const occupied = new Set([
      ...game.board.obstacles.map((o) => axialKey(o.position)),
      ...game.board.lureStacks.map((s) => axialKey(s.position)),
      ...game.board.humans.map((h) => axialKey(h.position)),
    ]);
    const emptyHex = [...game.board.hexes].map((k) => {
      const [q, r] = k.split(",").map(Number);
      return { q, r };
    }).find((h) => !occupied.has(axialKey(h)) && !(h.q === 0 && h.r === 0));

    let target: unknown;
    if (domainId === "ocean-sirens") {
      const human = game.board.humans[0];
      const legalDirs = legalPushPullDirections(game, playerId, human.position, "pull");
      const dest = neighbors(human.position).find(
        (n) =>
          game.board.hexes.has(axialKey(n)) &&
          !occupied.has(axialKey(n)) &&
          legalDirs.has(neighborDirectionIndex(human.position, n)!)
      );
      target = { humanInstanceId: human.instanceId, to: dest };
    } else {
      target = { to: emptyHex };
    }
    const result = room.respondToInteraction(playerId, interaction.id, { target });
    if (result.error) throw new Error(`resolveStartingAbilities failed: ${result.error}`);
  }
}

/** Auto-passes every player in an open response window until it resolves and closes. */
export function passResponseWindowToClose(room: Room): void {
  const game = room.game!;
  let guard = 0;
  while (game.phase === "response-window" && guard < 20) {
    guard++;
    const forId = game.pendingInteraction!.forPlayerIds[0];
    room.respondToInteraction(forId, game.pendingInteraction!.id, { pass: true });
  }
}

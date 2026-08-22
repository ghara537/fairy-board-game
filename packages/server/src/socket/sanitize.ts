import {
  ENCHANTMENT_DEFINITIONS_BY_ID,
  PersonalizedGameView,
  PlayerId,
  PublicPlayerView,
  BOARD_EDGE_LENGTH,
  HAND_SIZE_MAX,
  SPAWN_DATA,
} from "@fairy/shared";
import { Room } from "../rooms/Room";
import { availableActions } from "../game/engine/turns";

/**
 * Builds the view for exactly one player. This is the ONLY place hidden
 * information (hands, response-window instant options, etc.) is decided —
 * everything else in the server operates on the full ServerGameState, and
 * the client never receives more than what this function returns for it.
 */
export function buildPersonalizedView(room: Room, viewerPlayerId: PlayerId | null): PersonalizedGameView {
  const game = room.game;

  const players: PublicPlayerView[] = [...room.players.values()]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const gp = game?.players[p.id];
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        domainId: p.domainId,
        ready: p.ready,
        isHost: p.isHost,
        connectionStatus: p.connectionStatus,
        score: gp?.score ?? 0,
        handCount: gp?.hand.length ?? 0,
        handSizeMax: gp?.handSizeMax ?? HAND_SIZE_MAX,
        abilitiesUsed: gp?.abilitiesUsed ?? [false, false, false],
        collectedHumanIds: gp?.collectedHumanDefinitionIds ?? [],
      };
    });

  const yourHand =
    viewerPlayerId && game?.players[viewerPlayerId]
      ? game.players[viewerPlayerId].hand.map((cardId) => {
          const def = ENCHANTMENT_DEFINITIONS_BY_ID[cardId];
          return { id: cardId, name: def?.name ?? cardId, timing: def?.timing ?? "action", actionCost: def?.actionCost ?? 1 };
        })
      : null;

  const combinedLog = [...room.log, ...(game?.log ?? [])].sort((a, b) => a.timestamp - b.timestamp);

  let pendingInteractionView: PersonalizedGameView["pendingInteraction"] = null;
  if (game?.pendingInteraction) {
    const pi = game.pendingInteraction;
    const isForViewer = viewerPlayerId !== null && pi.forPlayerIds.includes(viewerPlayerId);
    pendingInteractionView = {
      id: pi.id,
      kind: pi.kind,
      forPlayerIds: pi.forPlayerIds,
      prompt: isForViewer
        ? pi.prompt
        : `Waiting for ${pi.forPlayerIds.map((id) => room.players.get(id)?.name ?? id).join(", ")}.`,
      legalOptions: isForViewer ? pi.legalOptions : null,
      deadlineAt: pi.deadlineAt,
    };
  }

  const revealedHands = viewerPlayerId
    ? (game?.ephemeralReveals ?? [])
        .filter((r) => r.forPlayerId === viewerPlayerId)
        .map((r) => ({ revealedPlayerId: r.revealedPlayerId, hand: r.hand }))
    : [];

  const deckPeek = viewerPlayerId
    ? (game?.ephemeralDeckPeeks ?? []).find((p) => p.forPlayerId === viewerPlayerId)?.cardIds ?? null
    : null;

  return {
    phase: game?.phase ?? "lobby",
    version: room.version,
    roomCode: room.code,
    config: {
      victoryCondition: game?.victoryCondition ?? room.config.victoryCondition,
      firstPlayerRule: game?.firstPlayerRule ?? room.config.firstPlayerRule,
      responseTimerSec: game?.responseTimerSec ?? room.config.responseTimerSec,
      pushPullSidewaysAllowed: game?.pushPullSidewaysAllowed ?? room.config.pushPullSidewaysAllowed,
    },
    players,
    hostPlayerId: room.hostPlayerId,
    yourPlayerId: viewerPlayerId,
    yourHand,
    board: game
      ? {
          edgeLength: BOARD_EDGE_LENGTH,
          portalCenter: SPAWN_DATA.portalCenter,
          humans: game.board.humans.map((h) => ({
            instanceId: h.instanceId,
            definitionId: h.definitionId,
            position: h.position,
            moved: h.moved,
            confused: h.confused,
          })),
          lureStacks: game.board.lureStacks.map((s) => ({ id: s.id, position: s.position, owner: s.owner, height: s.height })),
          obstacles: game.board.obstacles.map((o) => ({ id: o.id, type: o.type, position: o.position })),
          accelMarkers: game.board.accelMarkers.map((m) => ({ id: m.id, position: m.position })),
          spawnIndicator: game.board.spawnIndicator,
          domainBoards: game.board.domainBoards.map((d) => ({ playerId: d.playerId, domainId: d.domainId, side: d.side, hexes: d.hexes })),
        }
      : null,
    turnOrder: game?.turnOrder ?? [],
    round: game?.round ?? 0,
    firstPlayerId: game?.firstPlayerId ?? null,
    activePlayerId: game?.activePlayerId ?? null,
    actionsRemaining: game?.actionsRemaining ?? null,
    availableActions: game && viewerPlayerId ? availableActions(game, viewerPlayerId) : [],
    responseStack: (game?.responseStack ?? []).map((item) => ({
      id: item.id,
      sourcePlayerId: item.sourcePlayerId,
      name: item.name,
      kind: item.kind,
      target: item.target,
      status: item.status,
    })),
    pendingInteraction: pendingInteractionView,
    log: combinedLog,
    winnerId: game?.winnerId ?? null,
    drawPlayerIds: game?.drawPlayerIds ?? null,
    revealedHands,
    deckPeek,
    discardPile: game?.discardPile ?? [],
  };
}

/** Call once per broadcast cycle after every viewer's view has been built, to make ephemeral reveals truly one-shot. */
export function clearEphemeralReveals(room: Room): void {
  if (room.game) {
    room.game.ephemeralReveals = [];
    room.game.ephemeralDeckPeeks = [];
  }
}

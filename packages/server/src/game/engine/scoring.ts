import { HUMAN_DEFINITIONS_BY_ID, HAZARD_SET_BONUS, HumanDefinition, PlayerId } from "@fairy/shared";
import { ServerGameState } from "../state";
import { logEvent } from "./log";

export type ScoreBreakdown = {
  base: number;
  pairBonuses: { description: string; points: number }[];
  setBonuses: { description: string; points: number }[];
  penalties: { description: string; points: number }[];
  total: number;
};

/** Full recalculation of a player's score from their collected Humans, per spec section 22. */
export function computeScoreBreakdown(collectedDefinitionIds: string[]): ScoreBreakdown {
  const collected = collectedDefinitionIds
    .map((id) => HUMAN_DEFINITIONS_BY_ID[id])
    .filter((d): d is HumanDefinition => Boolean(d));

  let base = 0;
  const penalties: { description: string; points: number }[] = [];
  for (const def of collected) {
    if (def.isHazard) {
      penalties.push({ description: `${def.name} penalty`, points: def.basePoints });
    } else {
      base += def.basePoints;
    }
  }

  const pairBonuses: { description: string; points: number }[] = [];
  for (const def of collected) {
    for (const rule of def.scoringRules) {
      if (rule.kind === "pairBonus" && rule.withTag && rule.bonusPoints) {
        const pairedCount = collected.filter((d) => d.id !== def.id && d.tags.includes(rule.withTag!)).length;
        if (pairedCount > 0) {
          pairBonuses.push({
            description: `${def.name} paired with ${rule.withTag}`,
            points: rule.bonusPoints,
          });
        }
      }
    }
  }

  const setBonuses: { description: string; points: number }[] = [];
  if (HAZARD_SET_BONUS) {
    const have = new Set(collected.map((d) => d.id));
    const complete = HAZARD_SET_BONUS.requiresHumanIds.every((id) => have.has(id));
    if (complete) {
      setBonuses.push({ description: "Hazard set complete", points: HAZARD_SET_BONUS.bonusPoints });
    }
  }

  const total =
    base +
    pairBonuses.reduce((s, b) => s + b.points, 0) +
    setBonuses.reduce((s, b) => s + b.points, 0) +
    penalties.reduce((s, b) => s + b.points, 0);

  return { base, pairBonuses, setBonuses, penalties, total };
}

/** Records a collected Human for a player and recalculates + logs their new score. Call this, then checkVictory. */
export function collectHumanForPlayer(state: ServerGameState, playerId: PlayerId, humanDefinitionId: string): void {
  const player = state.players[playerId];
  if (!player) return;
  player.collectedHumanDefinitionIds.push(humanDefinitionId);
  const breakdown = computeScoreBreakdown(player.collectedHumanDefinitionIds);
  const previousScore = player.score;
  player.score = breakdown.total;
  logEvent(
    state,
    "score:changed",
    `${playerId} collected ${humanDefinitionId} — score ${previousScore} -> ${player.score}.`,
    { playerId, humanDefinitionId, breakdown }
  );
}

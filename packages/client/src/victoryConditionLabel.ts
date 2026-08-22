import type { VictoryCondition } from "@fairy/shared";

export function describeVictoryCondition(vc: VictoryCondition): string {
  if (vc.kind === "points") return `First to ${vc.targetScore} points`;
  return `${vc.turnLimit} rounds (tied games extend to round ${vc.tieExtensionLimit})`;
}

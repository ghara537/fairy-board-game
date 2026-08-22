import { Axial, ACCELERATION_BONUS_STEPS } from "@fairy/shared";
import { ServerGameState } from "../state";
import { logEvent } from "./log";

let markerCounter = 0;

export function placeAccelMarker(state: ServerGameState, pos: Axial): string {
  markerCounter += 1;
  const id = `accel-${markerCounter}`;
  state.board.accelMarkers.push({ id, position: pos, bonusSteps: ACCELERATION_BONUS_STEPS });
  logEvent(state, "accelMarker:placed", `An Acceleration Marker was placed at (${pos.q},${pos.r}).`, { id, pos });
  return id;
}

export function moveAccelMarker(state: ServerGameState, id: string, to: Axial): void {
  const marker = state.board.accelMarkers.find((m) => m.id === id);
  if (!marker) return;
  const from = marker.position;
  marker.position = to;
  logEvent(state, "accelMarker:moved", `An Acceleration Marker moved from (${from.q},${from.r}) to (${to.q},${to.r}).`, {
    id,
    from,
    to,
  });
}

export function removeAccelMarker(state: ServerGameState, id: string): void {
  const marker = state.board.accelMarkers.find((m) => m.id === id);
  if (!marker) return;
  state.board.accelMarkers = state.board.accelMarkers.filter((m) => m.id !== id);
  logEvent(state, "accelMarker:removed", `An Acceleration Marker was removed from (${marker.position.q},${marker.position.r}).`, {
    id,
  });
}

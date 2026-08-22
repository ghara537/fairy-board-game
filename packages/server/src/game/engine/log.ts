import { ServerGameState } from "../state";

let counter = 0;
function nextLogId(): string {
  counter += 1;
  return `log-${counter}-${Math.floor(Math.random() * 1e9)}`;
}

export function logEvent(
  state: ServerGameState,
  eventType: string,
  text: string,
  data?: Record<string, unknown>
): void {
  state.log.push({
    id: nextLogId(),
    timestamp: Date.now(),
    text,
    eventType,
    data,
  });
}

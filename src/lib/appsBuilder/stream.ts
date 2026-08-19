import type { Event } from "@opencode-ai/sdk/v2/client";

/** True when a session stream event carries assistant text deltas. */
function isTextDelta(
  event: Event,
  sessionID: string,
): event is Event & {
  type: "session.next.text.delta";
  properties: { sessionID: string; delta: string };
} {
  if (event.type !== "session.next.text.delta") return false;
  const props = event.properties as { sessionID?: string };
  return props.sessionID === sessionID;
}

/**
 * Drain the assistant text deltas out of a temp session's stream, joining them
 * so callers can drive a live "typing" bubble while the model streams. Returns
 * immediately with a stop callback; errors are swallowed (streaming is
 * best-effort and must never fail the underlying turn).
 */
export function startStreamingDeltas(
  subscribe: () => Promise<{ stream?: AsyncIterable<Event> } | undefined>,
  sessionID: string,
  onDelta: (accumulated: string) => void,
  signal: AbortSignal,
): { stop: () => Promise<void> } {
  let done = false;
  let accumulated = "";
  const subscriptionPromise = subscribe();
  const run = (async () => {
    try {
      const subscription = await subscriptionPromise;
      if (!subscription?.stream) return;
      for await (const event of subscription.stream) {
        if (signal.aborted || done) break;
        if (isTextDelta(event, sessionID)) {
          accumulated += event.properties.delta;
          onDelta(accumulated);
        }
      }
    } catch {
      // Streaming is best-effort; never fail the underlying turn on a stream error.
    }
  })();
  return {
    stop: async () => {
      done = true;
      await run.catch(() => undefined);
    },
  };
}

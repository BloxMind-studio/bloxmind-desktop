import { usePreferences } from "@/providers/PreferencesProvider";

export function ConnectionTab() {
  const { sseReconnectDelay, setSseReconnectDelay, sseHeartbeatTimeout, setSseHeartbeatTimeout } =
    usePreferences();

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Connection</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Configure SSE connection parameters for the OpenCode engine.
      </p>

      {/* Reconnect delay */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Reconnect Delay (ms)
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <input
            type="number"
            min={1_000}
            max={60_000}
            step={500}
            value={sseReconnectDelay}
            onChange={(e) =>
              setSseReconnectDelay(
                Math.min(60_000, Math.max(1_000, parseInt(e.target.value) || 1_000)),
              )
            }
            className="h-8 w-full rounded border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Base delay between reconnection attempts (1,000–60,000 ms). Uses exponential backoff.
          </div>
        </div>
      </div>

      {/* Heartbeat timeout */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Heartbeat Timeout (ms)
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <input
            type="number"
            min={5_000}
            max={120_000}
            step={1_000}
            value={sseHeartbeatTimeout}
            onChange={(e) =>
              setSseHeartbeatTimeout(
                Math.min(120_000, Math.max(5_000, parseInt(e.target.value) || 5_000)),
              )
            }
            className="h-8 w-full rounded border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Max time without events before forcing a reconnect (5,000–120,000 ms).
          </div>
        </div>
      </div>
    </div>
  );
}

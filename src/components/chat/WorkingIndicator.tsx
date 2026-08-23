import type { Part } from "@opencode-ai/sdk/v2/client";
import { useEffect, useRef, useState } from "react";

import { latestActivity } from "@/lib/activity";

/** How long (ms) the agent can stay silent before we surface a subtle note. */
const STALL_THRESHOLD_MS = 45_000;

/**
 * A live "still working" strip shown while the agent is generating. It proves
 * the app is alive during long, quiet Roblox builds by showing:
 *  - how long it has been working (ticks every second),
 *  - the newest thinking/tool line extracted from the streaming parts,
 *  - a subtle note when nothing has changed for a while (so a real hang is
 *    distinguishable from normal slow phase work).
 */
export function WorkingIndicator({
  parts,
  active,
}: {
  parts: readonly Part[] | undefined;
  active: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRef(Date.now());
  const activity = latestActivity(parts);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  const elapsedMs = Math.max(0, now - startedAt.current);
  const seconds = Math.floor(elapsedMs / 1000);
  const stamp = `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  const stalled =
    activity.epoch === 0
      ? elapsedMs > STALL_THRESHOLD_MS
      : now - activity.epoch > STALL_THRESHOLD_MS;

  return (
    <div className="my-1 flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-2.5 py-1.5 text-[12px] text-muted-foreground">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span className="shrink-0 font-medium tabular-nums text-foreground/80">
        Working for {stamp}
      </span>
      {activity.line ? (
        <span className="min-w-0 flex-1 truncate" title={activity.line}>
          <span className="text-[11px] font-medium text-muted-foreground/70">Now: </span>
          {activity.line}
        </span>
      ) : (
        <span className="flex-1 text-[11px] italic text-muted-foreground/70">
          Carrying the plan out phase by phase…
        </span>
      )}
      {stalled && (
        <span
          className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600/90"
          title="No new events in a while - likely one long Studio call rather than a crash"
        >
          Still running - long Studio call in progress
        </span>
      )}
    </div>
  );
}

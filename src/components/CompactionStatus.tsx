import { memo } from "react";

import { useCompactionState } from "@/hooks/useCompactionState";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

/**
 * Live status row shown above the composer while OpenCode rewrites the
 * conversation. Automatic compaction can start on its own mid-turn, so this is
 * the only signal that the message list is being replaced by a summary.
 */
const CompactionStatus = memo(function CompactionStatus() {
  const { activeSessionId } = useActiveSession();
  const compaction = useCompactionState(activeSessionId);

  if (!compaction?.active) return null;

  const automatic = compaction.reason === "auto";

  return (
    <div role="status" aria-live="polite" className="shrink-0 px-4 pt-1">
      <div className="animate-fade-in-up mx-auto flex max-w-2xl items-center gap-2 rounded-lg border bg-card px-3 py-1.5 shadow-sm">
        <span
          className="h-3 w-3 shrink-0 animate-spin rounded-full border border-amber-500 border-t-transparent"
          aria-hidden="true"
        />
        <span className="text-[11px] font-medium text-foreground/80">
          Compacting conversation...
        </span>
        <span className="ml-auto truncate text-[10px] text-muted-foreground">
          {automatic ? "Context window is nearly full" : "Summarizing older messages"}
        </span>
      </div>
    </div>
  );
});

export default CompactionStatus;

import { memo } from "react";

import { useCompactionState } from "@/hooks/useCompactionState";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

/**
 * Slim marker at the top of the feed shown while OpenCode rewrites the
 * conversation. Automatic compaction can start on its own mid-turn, so this is
 * the only signal that the message list is being replaced by a summary — the
 * summary itself and the synthetic continuation prompt stay out of the feed.
 */
const CompactionStatus = memo(function CompactionStatus() {
  const { activeSessionId } = useActiveSession();
  const compaction = useCompactionState(activeSessionId);

  if (!compaction?.active) return null;

  const automatic = compaction.reason === "auto";

  return (
    <div role="status" aria-live="polite" className="shrink-0 px-4 pb-1">
      <div className="animate-fade-in-up mx-auto flex max-w-2xl items-center gap-2 px-3 py-1 text-[11px] text-muted-foreground">
        <span
          className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/70 border-t-transparent"
          aria-hidden="true"
        />
        <span className="font-medium text-foreground/80">Compacting conversation...</span>
        <span className="truncate opacity-70">
          {automatic ? "Context window is nearly full" : "Summarizing older messages"}
        </span>
      </div>
    </div>
  );
});

export default CompactionStatus;

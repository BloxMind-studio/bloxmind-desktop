import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { MessagesCache } from "@/lib/sseDispatch";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

interface ContextUsageIndicatorProps {
  className?: string;
}

const ContextUsageIndicator = memo(function ContextUsageIndicator({
  className = "",
}: ContextUsageIndicatorProps) {
  const { activeSessionId } = useActiveSession();

  const { data: messagesCache } = useQuery<MessagesCache | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : ["no-session"],
    queryFn: async () => undefined,
    enabled: !!activeSessionId,
  });

  const usage = useMemo(() => {
    if (!messagesCache) return { pct: 0, total: 0, max: 128_000 };

    let total = 0;
    for (const msgId of messagesCache.messageIds) {
      const msg = messagesCache.messagesById[msgId];
      if (!msg) continue;
      const t = (msg.info as unknown as { tokens?: { input?: number; total?: number } }).tokens;
      if (!t) continue;
      total += t.input ?? t.total ?? 0;
    }

    return { pct: Math.min(100, Math.round((total / 128_000) * 100)), total, max: 128_000 };
  }, [messagesCache]);

  const tone = usage.pct >= 90 ? "text-red-500" : usage.pct >= 70 ? "text-amber-500" : "text-muted-foreground";
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  return (
    <div className={`group relative inline-flex items-center ${className}`}>
      <div className={`inline-flex items-center gap-1.5 text-[10px] ${tone}`} title={`Context: ${usage.pct}% used`}>
        <span className="font-mono tabular-nums">{fmt(usage.total)} / {fmt(usage.max)}</span>
        <span className="opacity-60">({usage.pct}%)</span>
      </div>
      <div
        className="animate-fade-in-up absolute bottom-full left-1/2 z-50 hidden min-w-[220px] -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-3 py-2 text-[10px] text-popover-foreground shadow-lg group-hover:flex flex-col gap-1"
      >
        <div className="font-medium border-b pb-1">Context Usage</div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Total:</span>
          <span className="font-mono tabular-nums">{fmt(usage.total)} / {fmt(usage.max)}</span>
        </div>
      </div>
    </div>
  );
});

export { ContextUsageIndicator };
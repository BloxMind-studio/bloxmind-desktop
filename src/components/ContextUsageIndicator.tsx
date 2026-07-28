import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { MessagesCache } from "@/lib/sseDispatch";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

interface ContextUsageIndicatorProps {
  className?: string;
}

function fmt(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function contextWindowForModel(modelId?: string) {
  const id = (modelId || "").toLowerCase();
  if (id.includes("8k")) return 8_000;
  if (id.includes("16k")) return 16_000;
  if (id.includes("32k")) return 32_000;
  if (id.includes("128k") || id.includes("128000")) return 128_000;
  if (id.includes("200k") || id.includes("200000")) return 200_000;
  if (id.includes("256k") || id.includes("256000")) return 256_000;
  if (id.includes("1m")) return 1_048_576;
  if (id.includes("gpt-4o")) return 128_000;
  if (id.includes("claude-sonnet-4")) return 200_000;
  if (id.includes("claude-opus-4")) return 200_000;
  if (id.includes("gemini-2.5")) return 1_048_576;
  return 128_000;
}

const ContextUsageIndicator = memo(function ContextUsageIndicator({
  className = "",
}: ContextUsageIndicatorProps) {
  const { activeSessionId } = useActiveSession();
  const { selectedModel } = usePreferences();

  const { data: messagesCache } = useQuery<MessagesCache | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : ["no-session"],
    queryFn: async () => undefined,
    enabled: !!activeSessionId,
  });

  const usage = useMemo(() => {
    const max = contextWindowForModel(selectedModel ?? undefined);
    if (!messagesCache) return { pct: 0, total: 0, max };

    let total = 0;
    for (const msgId of messagesCache.messageIds) {
      const msg = messagesCache.messagesById[msgId];
      if (!msg) continue;
      const t = (msg.info as unknown as { tokens?: { input?: number; total?: number } }).tokens;
      if (!t) continue;
      total += t.input ?? t.total ?? 0;
    }

    return { pct: Math.min(100, Math.round((total / max) * 100)), total, max };
  }, [messagesCache, selectedModel]);

  const tone =
    usage.pct >= 90
      ? "text-red-500"
      : usage.pct >= 70
        ? "text-amber-500"
        : "text-muted-foreground";

  const ring =
    usage.pct >= 90
      ? "#ef4444"
      : usage.pct >= 70
        ? "#f59e0b"
        : "#10b981";

  const r = 14;
  const circ = 2 * Math.PI * r;
  const offset = circ - (usage.pct / 100) * circ;

  return (
    <div className={`group relative inline-flex items-center ${className}`}>
      {/* Default state: compact text */}
      <div className="group-hover:hidden">
        <span className={`text-[10px] font-mono tabular-nums ${tone}`}>
          {fmt(usage.total)} / {fmt(usage.max)}
        </span>
      </div>

      {/* Hover state: circular gauge */}
      <div className="hidden group-hover:block">
        <svg width="18" height="18" viewBox="0 0 36 36" className="-ml-0.5">
          <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="3" opacity="0.15" />
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            stroke={ring}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            className="transition-all duration-500"
            transform="rotate(-90 18 18)"
          />
          <text x="18" y="18.5" textAnchor="middle" dominantBaseline="middle" className="fill-current" fontSize="8" fontWeight="600">
            {usage.pct}%
          </text>
        </svg>
      </div>
    </div>
  );
});

export { ContextUsageIndicator };
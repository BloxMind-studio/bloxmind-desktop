import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { MessagesCache } from "@/lib/sseDispatch";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import { useAllModels } from "@/hooks/useProviders";
import type { ModelInfo } from "@/types";

interface ContextUsageIndicatorProps {
  className?: string;
}

function fmt(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function parseContextWindowFromId(modelId?: string): number {
  const id = (modelId || "").toLowerCase();
  const m = id.match(/(\d+)\s*([km])/);
  if (!m) return 128_000;
  const num = Number(m[1]);
  const unit = m[2];
  if (unit === "m") return num * 1_048_576;
  if (unit === "k") return num * 1024;
  return num;
}

function contextWindowForModel(modelId?: string, allModels?: ModelInfo[]) {
  if (modelId && allModels) {
    const match = allModels.find(
      (m: ModelInfo) => m.id === modelId || `${m.providerId}/${m.id}` === modelId,
    );
    if (match) {
      const meta = match as unknown as Record<string, unknown>;
      const raw =
        (meta.contextWindow as number | undefined) ??
        (meta.context_length as number | undefined) ??
        (meta.max_context_tokens as number | undefined) ??
        (meta.maxTokens as number | undefined);
      if (typeof raw === "number" && raw > 0) return raw;
    }
  }
  return parseContextWindowFromId(modelId);
}

const ContextUsageIndicator = memo(function ContextUsageIndicator({
  className = "",
}: ContextUsageIndicatorProps) {
  const { activeSessionId } = useActiveSession();
  const { selectedModel } = usePreferences();
  const allModels = useAllModels();

  const { data: messagesCache } = useQuery<MessagesCache | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : ["no-session"],
    queryFn: async () => undefined,
    enabled: !!activeSessionId,
  });

  const usage = useMemo(() => {
    const max = contextWindowForModel(selectedModel ?? undefined, allModels);
    if (!messagesCache) return { pct: 0, total: 0, max };

    let total = 0;
    for (const msgId of messagesCache.messageIds) {
      const msg = messagesCache.messagesById[msgId];
      if (!msg) continue;
      const info = msg.info as unknown as { tokens?: { input?: number; total?: number } };
      const t = info.tokens;
      if (!t) continue;
      total += t.input ?? t.total ?? 0;
    }

    return { pct: Math.min(100, Math.round((total / max) * 100)), total, max };
  }, [messagesCache, selectedModel, allModels]);

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

  const r = 18;
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

      {/* Hover state: larger circular gauge */}
      <div className="hidden group-hover:block">
        <svg width="28" height="28" viewBox="0 0 48 48" className="-ml-0.5">
          <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="4" opacity="0.15" />
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            stroke={ring}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            className="transition-all duration-500"
            transform="rotate(-90 24 24)"
          />
          <text
            x="24"
            y="24.5"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-current"
            fontSize="10"
            fontWeight="700"
          >
            {usage.pct}%
          </text>
        </svg>
      </div>
    </div>
  );
});

export { ContextUsageIndicator };
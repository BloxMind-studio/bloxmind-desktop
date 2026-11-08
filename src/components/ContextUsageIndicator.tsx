import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useMemo, useRef } from "react";
import { EMPTY_CACHE, fetchMessages } from "@/hooks/useMessages";
import { useAllModels } from "@/hooks/useProviders";
import {
  findModelInfo,
  formatTokens,
  modelSpecs,
  reasoningLabel,
  resolveContextWindow,
} from "@/lib/modelSpecs";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

// ── Types ────────────────────────────────────────────────────────────────

interface ContextUsageIndicatorProps {
  className?: string;
}

// ── Number formatting ────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Component ────────────────────────────────────────────────────────────

const ContextUsageIndicator = memo(function ContextUsageIndicator({
  className = "",
}: ContextUsageIndicatorProps) {
  const { selectedModel } = usePreferences();
  const { activeSessionId } = useActiveSession();
  const allModels = useAllModels();
  const queryClient = useQueryClient();
  const { client, ready } = useOpenCodeClient();

  const { data: messagesCache } = useQuery<MessagesCache, Error, MessagesCache | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : ["no-session"],
    queryFn: () =>
      client && activeSessionId
        ? fetchMessages(client, queryClient, activeSessionId)
        : Promise.resolve(EMPTY_CACHE),
    enabled: ready && !!client && !!activeSessionId,
  });

  // Retain the last known token total across turns so the indicator does
  // not reset to 0 while a new turn is generating. Reset when switching
  // sessions; doing it during render avoids showing a stale total for one
  // frame, which a post-render effect would.
  const previousTotalRef = useRef(0);
  const lastSessionIdRef = useRef(activeSessionId);
  if (lastSessionIdRef.current !== activeSessionId) {
    lastSessionIdRef.current = activeSessionId;
    previousTotalRef.current = 0;
  }

  interface UsageResult {
    pct: number;
    total: number;
    max: number;
  }

  const usage = useMemo<UsageResult>(() => {
    const max = resolveContextWindow(selectedModel ?? undefined, allModels);
    if (!messagesCache) return { pct: 0, total: 0, max };

    let hasTokens = false;
    let total = 0;

    // Iterate backwards to find the most recent assistant message that has
    // actual token data. Skip messages whose tokens object is empty/zero
    // (e.g. a newly created assistant message during generation).
    for (let i = messagesCache.messageIds.length - 1; i >= 0; i--) {
      const msg = messagesCache.messagesById[messagesCache.messageIds[i]];
      if (!msg) continue;
      if (msg.info.role !== "assistant") continue;

      const tokens = msg.info.tokens as
        | {
            input?: number;
            output?: number;
            reasoning?: number;
            cache?: { read?: number; write?: number };
            total?: number;
          }
        | undefined;

      if (!tokens) continue;

      const input = tokens.input ?? 0;
      const cacheRead = tokens.cache?.read ?? 0;

      // Skip messages where tokens exist but all values are zero/undefined
      // (happens when a new assistant message is created mid-generation).
      if (input === 0 && cacheRead === 0 && !tokens.total) continue;

      hasTokens = true;
      // Context window usage = prompt tokens only (input + cached).
      // Output/reasoning are generated tokens and don't occupy context.
      total = input + cacheRead;
      previousTotalRef.current = total;
      break;
    }

    // If no assistant message with real token data was found, retain the
    // previous total so the indicator does not flash to 0 during generation.
    if (!hasTokens) {
      total = previousTotalRef.current;
    }

    return {
      pct: Math.min(100, Math.round((total / max) * 100)),
      total,
      max,
    };
  }, [messagesCache, selectedModel, allModels]);

  const tone =
    usage.pct >= 90 ? "text-red-500" : usage.pct >= 70 ? "text-amber-500" : "text-muted-foreground";

  const ring = usage.pct >= 90 ? "#ef4444" : usage.pct >= 70 ? "#f59e0b" : "#10b981";

  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - (usage.pct / 100) * circ;

  // Spec sheet of the active model, surfaced on hover so the numbers behind
  // the indicator (context window, reasoning, inputs) are one glance away.
  const specs = useMemo(
    () => modelSpecs(findModelInfo(selectedModel ?? undefined, allModels)),
    [allModels, selectedModel],
  );
  const contextLabel = specs ? formatTokens(specs.contextWindow) : undefined;
  const specsTitle = specs
    ? [
        `${specs.model} (${specs.provider})`,
        `Inputs: ${specs.inputs.join(", ")}`,
        `Reasoning: ${reasoningLabel(specs.reasoning)}`,
        `Context: ${contextLabel ? `${contextLabel} tokens` : "Unknown"}`,
      ].join("\n")
    : undefined;

  return (
    <div
      className={`group relative inline-flex items-center gap-1.5 ${className}`}
      title={specsTitle}
    >
      {/* The text stays in the layout (invisible on hover rather than removed) so the
          hover target never changes size — swapping the two views used to collapse the
          width and make the tooltip/ring flicker on and off. */}
      <span className="inline-flex items-center gap-1 transition-opacity duration-150 group-hover:opacity-0">
        <span className={`text-[10px] font-mono tabular-nums ${tone}`}>
          {fmt(usage.total)} / {fmt(usage.max)}
        </span>
      </span>

      {/* Hover view: circular progress ring, overlaid so it cannot shift the layout */}
      <div className="pointer-events-none absolute inset-0 hidden items-center justify-center group-hover:flex">
        <svg width="28" height="28" viewBox="0 0 48 48">
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            opacity="0.15"
          />
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

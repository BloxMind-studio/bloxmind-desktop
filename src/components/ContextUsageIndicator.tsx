import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef } from "react";
import { EMPTY_CACHE, fetchMessages } from "@/hooks/useMessages";
import { useAllModels } from "@/hooks/useProviders";
import { useSessionStatus } from "@/hooks/useSessionStatuses";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";
import type { ModelInfo } from "@/types";

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

// ── Known model capacity lookup (highest priority) ───────────────────────

const KNOWN_CAPACITIES: Record<string, number> = {
  "gpt-5.4-mini": 400_000,
  "gpt-5.4": 400_000,
  "deepseek-v4": 1_000_000,
  fable: 1_000_000,
  "nemotron-3-ultra": 1_000_000,
  "haiku-4.5": 200_000,
  laguna: 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3.5-sonnet": 200_000,
  "claude-3": 200_000,
  "claude-3.5": 200_000,
  claude: 200_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-2.0": 1_000_000,
};

function lookupKnownModel(modelId: string, modelName: string): number | undefined {
  const text = `${modelId.toLowerCase()} ${modelName.toLowerCase()}`;
  for (const [key, capacity] of Object.entries(KNOWN_CAPACITIES)) {
    if (text.includes(key)) return capacity;
  }
  const baseId = modelId.split("/").pop()?.toLowerCase();
  if (baseId && KNOWN_CAPACITIES[baseId]) return KNOWN_CAPACITIES[baseId];
  return undefined;
}

// ── Strict regex parser (boundary-aware) ─────────────────────────────────

function parseContextWindowFromId(modelId?: string): number | undefined {
  if (!modelId) return undefined;
  const lower = modelId.toLowerCase();

  const kMatch = lower.match(/\b(\d+)\s*k\b/);
  if (kMatch) {
    const num = Number.parseInt(kMatch[1], 10);
    if (!Number.isNaN(num) && num > 0) return num * 1_000;
  }

  const mMatch = lower.match(/\b(\d+)\s*m\b/);
  if (mMatch) {
    const num = Number.parseInt(mMatch[1], 10);
    if (!Number.isNaN(num) && num > 0) return num * 1_000_000;
  }

  return undefined;
}

// ── Resolver ─────────────────────────────────────────────────────────────

function resolveContextWindow(modelId: string | undefined, allModels: ModelInfo[]): number {
  if (!modelId) return 128_000;

  const match = allModels.find((m) => `${m.providerId}/${m.id}` === modelId || m.id === modelId);

  if (match) {
    const known = lookupKnownModel(match.id, match.name);
    if (known !== undefined) return known;

    const fromId = parseContextWindowFromId(match.id);
    if (fromId !== undefined) return fromId;

    const fromName = parseContextWindowFromId(match.name);
    if (fromName !== undefined) return fromName;
  }

  const fromRaw = parseContextWindowFromId(modelId);
  if (fromRaw !== undefined) return fromRaw;

  return 128_000;
}

// ── Component ────────────────────────────────────────────────────────────

const ContextUsageIndicator = memo(function ContextUsageIndicator({
  className = "",
}: ContextUsageIndicatorProps) {
  const { selectedModel } = useModelPreferences();
  const { activeSessionId } = useActiveSession();
  const allModels = useAllModels();
  const queryClient = useQueryClient();
  const { client, ready } = useOpenCodeClient();

  // Session status tells us if the agent is actively generating.
  const sessionStatus = useSessionStatus(activeSessionId ?? "");
  const isGenerating = activeSessionId ? sessionStatus?.type !== "idle" : false;

  const { data: messagesCache } = useQuery<MessagesCache, Error, MessagesCache | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : ["no-session"],
    queryFn: () =>
      client && activeSessionId
        ? fetchMessages(client, queryClient, activeSessionId)
        : Promise.resolve(EMPTY_CACHE),
    enabled: ready && !!client && !!activeSessionId,
  });

  // Retain the last known token total across turns so the indicator does
  // not reset to 0 while a new turn is generating.
  const previousTotalRef = useRef(0);

  // Reset retained total when switching sessions.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeSessionId is the intentional trigger — refs are stable but the reset must re-run on session change
  useEffect(() => {
    previousTotalRef.current = 0;
  }, [activeSessionId]);

  interface UsageResult {
    pct: number;
    total: number;
    max: number;
    loading: boolean;
  }

  const usage = useMemo<UsageResult>(() => {
    const max = resolveContextWindow(selectedModel ?? undefined, allModels);
    if (!messagesCache) return { pct: 0, total: 0, max, loading: false };

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

    const loading = isGenerating && !hasTokens;

    return {
      pct: Math.min(100, Math.round((total / max) * 100)),
      total,
      max,
      loading,
    };
  }, [messagesCache, selectedModel, allModels, isGenerating]);

  const tone =
    usage.pct >= 90 ? "text-red-500" : usage.pct >= 70 ? "text-amber-500" : "text-muted-foreground";

  const ring = usage.pct >= 90 ? "#ef4444" : usage.pct >= 70 ? "#f59e0b" : "#10b981";

  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - (usage.pct / 100) * circ;

  return (
    <div className={`group relative inline-flex items-center gap-1.5 ${className}`}>
      {/* Default text view (hidden on hover) */}
      <div className="group-hover:hidden inline-flex items-center gap-1">
        {usage.loading && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-spin text-muted-foreground"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        )}
        <span className={`text-[10px] font-mono tabular-nums ${tone}`}>
          {fmt(usage.total)} / {fmt(usage.max)}
        </span>
      </div>

      {/* Hover view: circular progress ring */}
      <div className="hidden group-hover:block">
        <svg width="28" height="28" viewBox="0 0 48 48" className="-ml-0.5">
          <title>{`${usage.pct}% of context window used`}</title>
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

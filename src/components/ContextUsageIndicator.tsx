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

/**
 * Deep-inspect a model object for any known context-window property.
 * Returns the numeric value or undefined.
 */
function extractContextFromModel(model: ModelInfo): number | undefined {
  const obj = model as unknown as Record<string, unknown>;

  // Direct top-level properties
  const direct =
    obj.contextWindow ??
    obj.context_length ??
    obj.max_context_tokens ??
    obj.maxTokens;
  if (typeof direct === "number" && direct > 0) return direct;

  // Nested paths
  const limits = obj.limits as Record<string, unknown> | undefined;
  if (limits) {
    const fromLimits = limits.context ?? limits.contextWindow ?? limits.maxTokens;
    if (typeof fromLimits === "number" && fromLimits > 0) return fromLimits;
  }

  const info = obj.info as Record<string, unknown> | undefined;
  if (info) {
    const fromInfo = info.contextLength ?? info.contextWindow ?? info.maxTokens;
    if (typeof fromInfo === "number" && fromInfo > 0) return fromInfo;
  }

  return undefined;
}

/**
 * Parse a model ID or name string for context-window patterns.
 * Handles: 1m, 2m, 1.5m → N * 1_000_000
 *          200k, 128k, 32k → N * 1_000
 */
function parseContextFromString(text?: string): number | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();

  // Match patterns like "1m", "2m", "1.5m"
  const mMatch = lower.match(/(\d+(?:\.\d+)?)\s*m/);
  if (mMatch) {
    const num = Number.parseFloat(mMatch[1]);
    if (!Number.isNaN(num) && num > 0) return Math.round(num * 1_000_000);
  }

  // Match patterns like "200k", "128k", "32k"
  const kMatch = lower.match(/(\d+(?:\.\d+)?)\s*k/);
  if (kMatch) {
    const num = Number.parseFloat(kMatch[1]);
    if (!Number.isNaN(num) && num > 0) return Math.round(num * 1_000);
  }

  return undefined;
}

/**
 * Resolve the max context window for a given model.
 * 1. Deep-inspect the model object for known metadata properties.
 * 2. Fall back to regex parsing of model.id and model.name.
 * 3. Default to 128_000.
 */
function resolveContextWindow(
  modelId: string | undefined,
  allModels: ModelInfo[],
): number {
  if (!modelId) return 128_000;

  // Find the matching model object
  const match = allModels.find(
    (m) => `${m.providerId}/${m.id}` === modelId || m.id === modelId,
  );

  if (match) {
    // Step 1: deep object inspection
    const fromMeta = extractContextFromModel(match);
    if (fromMeta !== undefined) {
      console.log("[ContextIndicator] Active Model:", {
        id: match.id,
        providerId: match.providerId,
        resolvedLimit: fromMeta,
        source: "metadata",
      });
      return fromMeta;
    }

    // Step 2: regex fallback on model.id and model.name
    const fromId = parseContextFromString(match.id);
    if (fromId !== undefined) {
      console.log("[ContextIndicator] Active Model:", {
        id: match.id,
        providerId: match.providerId,
        resolvedLimit: fromId,
        source: "id-parse",
      });
      return fromId;
    }

    const fromName = parseContextFromString(match.name);
    if (fromName !== undefined) {
      console.log("[ContextIndicator] Active Model:", {
        id: match.id,
        providerId: match.providerId,
        resolvedLimit: fromName,
        source: "name-parse",
      });
      return fromName;
    }
  }

  // Step 3: fallback regex on the raw modelId string
  const fromRaw = parseContextFromString(modelId);
  if (fromRaw !== undefined) {
    console.log("[ContextIndicator] Active Model:", {
      id: modelId,
      resolvedLimit: fromRaw,
      source: "raw-parse",
    });
    return fromRaw;
  }

  console.log("[ContextIndicator] Active Model:", {
    id: modelId,
    resolvedLimit: 128_000,
    source: "default",
  });
  return 128_000;
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
    const max = resolveContextWindow(selectedModel ?? undefined, allModels);
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
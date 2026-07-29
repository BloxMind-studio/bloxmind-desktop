import { memo, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { MessagesCache } from "@/lib/sseDispatch";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import { useAllModels } from "@/hooks/useProviders";
import type { ModelInfo } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────

interface ContextUsageIndicatorProps {
  className?: string;
}

// ── Number formatting ────────────────────────────────────────────────────

/**
 * Format a token count for compact display.
 *
 * - `1.2M` for values ≥ 1,000,000
 * - `12.3k` for values ≥ 1,000
 * - raw number otherwise
 *
 * @param n - The token count to format.
 * @returns A human-readable string (e.g. `"1.2M"`, `"12.3k"`, `"42"`).
 */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Known model capacity lookup (highest priority) ───────────────────────

/**
 * Hard-coded context window sizes for well-known models.
 * Keys are matched case-insensitively as substrings of the model ID or name.
 */
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

/**
 * Look up a known context window size by matching the model ID and name
 * against the {@link KNOWN_CAPACITIES} table.
 *
 * Matching is case-insensitive and substring-based: if the model ID or
 * name contains a known key, the corresponding capacity is returned.
 * Also tries the base ID (before any `/` separator) as an exact match.
 *
 * @param modelId - The model's identifier (e.g. `"anthropic/claude-3.5-sonnet"`).
 * @param modelName - The model's display name.
 * @returns The context window size in tokens, or `undefined` if unknown.
 */
function lookupKnownModel(modelId: string, modelName: string): number | undefined {
  const text = `${modelId.toLowerCase()} ${modelName.toLowerCase()}`;

  // Try matching against known keys (substring match).
  for (const [key, capacity] of Object.entries(KNOWN_CAPACITIES)) {
    if (text.includes(key)) return capacity;
  }

  // Also try matching just the base ID (before slash if present).
  const baseId = modelId.split("/")[0].toLowerCase();
  if (KNOWN_CAPACITIES[baseId]) return KNOWN_CAPACITIES[baseId];

  return undefined;
}

// ── Strict regex parser (boundary-aware) ─────────────────────────────────

/**
 * Parse a context window size from a model ID or name string.
 *
 * Looks for patterns like `128k`, `200k`, `1m`, `2m` using word-boundary
 * regexes to avoid false matches (e.g. `"gpt4k"` won't match `4k`).
 *
 * @param modelId - The string to parse (model ID or name).
 * @returns The context window size in tokens, or `undefined` if no pattern matches.
 */
function parseContextWindowFromId(modelId?: string): number | undefined {
  if (!modelId) return undefined;
  const lower = modelId.toLowerCase();

  // Match Nk (e.g. 128k, 200k) — \b ensures no false matches like "gpt4k".
  const kMatch = lower.match(/(\d+)\s*k\b/);
  if (kMatch) {
    const num = Number.parseInt(kMatch[1], 10);
    if (!Number.isNaN(num) && num > 0) return num * 1_000;
  }

  // Match Nm (e.g. 1m, 2m) — \b ensures no false matches.
  const mMatch = lower.match(/(\d+)\s*m\b/);
  if (mMatch) {
    const num = Number.parseInt(mMatch[1], 10);
    if (!Number.isNaN(num) && num > 0) return num * 1_000_000;
  }

  return undefined;
}

// ── Resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve the context window size for a given model.
 *
 * Resolution order (first match wins):
 * 1. **Known model lookup** — match against {@link KNOWN_CAPACITIES}.
 * 2. **Strict regex on model.id** — parse `Nk`/`Nm` patterns from the ID.
 * 3. **Strict regex on model.name** — parse `Nk`/`Nm` patterns from the name.
 * 4. **Strict regex on raw modelId** — parse from the raw `provider/id` string.
 * 5. **Fallback** — `128_000` tokens (a conservative default).
 *
 * @param modelId - The selected model key (e.g. `"anthropic/claude-3.5-sonnet"`), or `undefined`.
 * @param allModels - All known models from the providers hook.
 * @returns The resolved context window size in tokens.
 */
function resolveContextWindow(modelId: string | undefined, allModels: ModelInfo[]): number {
  // Edge case: no model selected — use conservative default.
  if (!modelId) return 128_000;

  const match = allModels.find((m) => `${m.providerId}/${m.id}` === modelId || m.id === modelId);

  if (match) {
    // 1. Known model lookup (highest priority).
    const known = lookupKnownModel(match.id, match.name);
    if (known !== undefined) return known;

    // 2. Strict regex on model.id.
    const fromId = parseContextWindowFromId(match.id);
    if (fromId !== undefined) return fromId;

    // 3. Strict regex on model.name.
    const fromName = parseContextWindowFromId(match.name);
    if (fromName !== undefined) return fromName;
  }

  // 4. Strict regex on the raw modelId string (e.g. "provider/claude-200k").
  const fromRaw = parseContextWindowFromId(modelId);
  if (fromRaw !== undefined) return fromRaw;

  // 5. Conservative fallback.
  return 128_000;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * A compact context-window usage indicator that shows token consumption
 * as a percentage of the model's context window.
 *
 * - **Default view**: `"12.3k / 200k"` text (hidden on hover).
 * - **Hover view**: A circular SVG progress ring with the percentage.
 *
 * **Token calculation** (fixed):
 * The context window is a **continuous sliding window** that accumulates
 * across all assistant messages in the session. For each assistant message,
 * we sum `input + output + reasoning + cache.read + cache.write` tokens.
 * This correctly reflects the true context usage including:
 * - Prompt tokens (input)
 * - Generated tokens (output)
 * - Reasoning/thinking tokens
 * - Cached tokens (read + write)
 *
 * Previously, the code only took the latest message's `input` token count,
 * which reset on every new message and ignored output/reasoning/cache tokens.
 *
 * Colour thresholds: green (<70%), amber (70–89%), red (≥90%).
 */
const ContextUsageIndicator = memo(function ContextUsageIndicator({
  className = "",
}: ContextUsageIndicatorProps) {
  const { selectedModel } = usePreferences();
  const { activeSessionId } = useActiveSession();
  const allModels = useAllModels();
  const queryClient = useQueryClient();

  // Subscribe to the messages cache — re-renders when SSE updates the data.
  // queryFn reads the existing cache without overwriting it (no async () => undefined).
  const { data: messagesCache } = useQuery<MessagesCache | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : ["no-session"],
    queryFn: () => queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId!)),
    enabled: !!activeSessionId,
  });

  const usage = useMemo(() => {
    const max = resolveContextWindow(selectedModel ?? undefined, allModels);
    if (!messagesCache) return { pct: 0, total: 0, max };

    // Evaluate ONLY the latest message's token usage — do NOT loop through
    // or accumulate across the message array, since cached_tokens already
    // contains the full history from previous messages.
    //
    // Formula:
    //   Total Active Context = (latestMessage.cached || 0) + (latestMessage.in || 0) + (latestMessage.out || 0)
    //
    // In the SDK token shape:
    //   - input       = uncached prompt tokens (NOT served from cache)
    //   - cache.read  = cached prompt tokens   (already contains full history — SNAPSHOT)
    //   - output      = completion tokens      (generated by the model)
    let total = 0;
    for (let i = messagesCache.messageIds.length - 1; i >= 0; i--) {
      const msg = messagesCache.messagesById[messagesCache.messageIds[i]];
      if (!msg) continue;

      // Only count assistant messages — user messages don't carry token info.
      if (msg.info.role !== "assistant") continue;

      // The SDK Message type has a tokens field with input/output/cache.
      const tokens = msg.info.tokens as {
        input?: number;
        output?: number;
        cache?: { read?: number; write?: number };
        total?: number;
      } | undefined;

      if (!tokens) continue;

      // Use ONLY this (latest) message's values — no accumulation.
      const input = tokens.input ?? 0;
      const cacheRead = tokens.cache?.read ?? 0;
      const output = tokens.output ?? 0;

      total = cacheRead + input + output;
      break; // Stop after the first (latest) message with token data.
    }

    return { pct: Math.min(100, Math.round((total / max) * 100)), total, max };
  }, [messagesCache, selectedModel, allModels]);

  // Colour thresholds: green < 70% ≤ amber < 90% ≤ red.
  const tone =
    usage.pct >= 90 ? "text-red-500" : usage.pct >= 70 ? "text-amber-500" : "text-muted-foreground";

  const ring = usage.pct >= 90 ? "#ef4444" : usage.pct >= 70 ? "#f59e0b" : "#10b981";

  // SVG ring geometry.
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - (usage.pct / 100) * circ;

  return (
    <div className={`group relative inline-flex items-center ${className}`}>
      {/* Default: compact text (hidden on hover) */}
      <div className="group-hover:hidden">
        <span className={`text-[10px] font-mono tabular-nums ${tone}`}>
          {fmt(usage.total)} / {fmt(usage.max)}
        </span>
      </div>

      {/* Hover: circular progress ring */}
      <div className="hidden group-hover:block">
        <svg width="28" height="28" viewBox="0 0 48 48" className="-ml-0.5">
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

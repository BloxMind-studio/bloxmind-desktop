import { TOOL_BY_ID } from "./tools";
import type { WorkflowNode } from "./types";

export type Payload = Record<string, unknown>;

/** A callable AI step (summarize/classify) backed by the OpenCode engine. */
export interface AiRunRequest {
  prompt: string;
  system?: string;
  signal: AbortSignal;
}

export type AiRunner = (request: AiRunRequest) => Promise<string>;

export interface ExecuteNodeOptions {
  signal: AbortSignal;
  /** When undefined, AI process steps fail with an honest error. */
  ai?: AiRunner | null;
}

export interface NodeResult {
  message: string;
  payload: Payload;
  /** When true the pipeline stops and the remaining steps are skipped. */
  filtered?: boolean;
}

/** Sleep that rejects with an AbortError as soon as `signal` fires. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function json(payload: Payload): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function textOf(payload: Payload): string {
  const data = payload.data;
  if (typeof data === "string") return data;
  if (
    data &&
    typeof data === "object" &&
    "text" in data &&
    typeof (data as { text: unknown }).text === "string"
  ) {
    return (data as { text: string }).text;
  }
  return json(payload);
}

function parseMaybeJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function truncate(value: string, max = 200): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Execute a single workflow node against the current payload. Real tools do
 * real work (network fetches, filters, delays, webhooks, AI steps). Steps that
 * cannot run standalone (Roblox DataStore reads, web search) fail honestly
 * instead of pretending to succeed.
 */
export async function executeNode(
  node: WorkflowNode,
  payload: Payload,
  options: ExecuteNodeOptions,
): Promise<NodeResult> {
  const { signal, ai } = options;
  const config = node.config;
  const tool = TOOL_BY_ID.get(node.toolId);
  const label = tool?.name ?? node.label;

  switch (node.toolId) {
    // ── Triggers ────────────────────────────────────────────────────────
    case "trigger.schedule":
      return {
        message: `Triggered on schedule (${config.schedule ?? "every hour"})`,
        payload: { ...payload, trigger: config.schedule ?? "every hour" },
      };
    case "trigger.webhook":
      return {
        message: `Triggered by webhook (${config.path ?? "/"})`,
        payload: { ...payload, trigger: config.path ?? "/" },
      };
    case "trigger.robloxEvent":
      return {
        message: `Triggered by Roblox event (${config.event ?? "PlayerJoined"})`,
        payload: { ...payload, trigger: config.event ?? "PlayerJoined" },
      };

    // ── Fetch ───────────────────────────────────────────────────────────
    case "fetch.httpRequest": {
      const url = config.url?.trim();
      if (!url) throw new Error(`${label} needs a URL.`);
      const method = (config.method?.trim() || "GET").toUpperCase();
      const response = await fetch(url, { method, signal });
      const text = await response.text();
      payload.data = { status: response.status, body: parseMaybeJson(text) };
      return {
        message: `Fetched ${url} → HTTP ${response.status}`,
        payload,
      };
    }
    case "fetch.robloxData":
      throw new Error(
        `${label} reads a Roblox DataStore and requires a live Roblox Studio session — it can't run standalone. Remove or replace this step.`,
      );
    case "fetch.webSearch":
      throw new Error(
        `${label} needs a web-search backend that isn't configured in this build. Remove or replace this step.`,
      );

    // ── Process ─────────────────────────────────────────────────────────
    case "process.aiSummarize": {
      if (!ai) throw new Error(`${label} needs a connected AI engine.`);
      const instructions =
        config.instructions?.trim() ??
        "Summarize the key points in under 3 sentences. Return only the summary.";
      const result = await ai({
        system: `You are a concise summarizer. ${instructions}`,
        prompt: `Summarize this workflow payload:\n${textOf(payload)}`,
        signal,
      });
      payload.processed = result;
      return { message: `Summarized (${result.length} chars)`, payload };
    }
    case "process.aiClassify": {
      if (!ai) throw new Error(`${label} needs a connected AI engine.`);
      const labels =
        config.labels
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? [];
      const classifierResult = await ai({
        system: `You are a classifier. Choose exactly one label. Only these labels are allowed: ${JSON.stringify(
          labels,
        )}. Reply with just the label.`,
        prompt: `Classify this workflow payload:\n${textOf(payload)}`,
        signal,
      });
      const classified = classifierResult.trim();
      payload.processed = classified;
      return { message: `Classified as "${truncate(classified, 40)}"`, payload };
    }
    case "process.filter": {
      const field = config.field?.trim() ?? "";
      const equals = config.equals ?? "";
      const value = payload[field];
      if (equals !== "" && String(value) !== equals) {
        return {
          message: `Filtered out (${field} ${JSON.stringify(value)} !== ${JSON.stringify(equals)})`,
          payload,
          filtered: true,
        };
      }
      return { message: `Filter passed (${field})`, payload };
    }

    // ── Action ──────────────────────────────────────────────────────────
    case "action.discordPost": {
      const url = config.webhookUrl?.trim();
      if (!url) throw new Error(`${label} needs a Discord webhook URL.`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: textOf(payload) }),
        signal,
      });
      return { message: `Posted to Discord → HTTP ${response.status}`, payload };
    }
    case "action.delay": {
      const seconds = Number(config.seconds ?? "10") || 10;
      await abortableSleep(seconds * 1000, signal);
      return { message: `Delayed ${seconds}s`, payload };
    }
    case "action.log":
      return { message: `Payload: ${truncate(textOf(payload))}`, payload };

    default:
      throw new Error(`${label} (${node.toolId}) has no local executor.`);
  }
}

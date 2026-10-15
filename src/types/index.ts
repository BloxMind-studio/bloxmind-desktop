import type { Message, Part } from "@opencode-ai/sdk/v2/client";

// ── Chat types ──────────────────────────────────────────────────────────

export interface MessageWithParts {
  info: Message;
  parts: Part[];
}

/** Token limits as reported by the provider (context window, max output). */
export interface ModelLimit {
  context?: number;
  input?: number;
  output?: number;
}

/** What a model accepts and can do, as reported by the provider. */
export interface ModelCapabilities {
  reasoning?: boolean;
  attachment?: boolean;
  input?: Partial<Record<"text" | "image" | "audio" | "video" | "pdf", boolean>>;
  output?: Partial<Record<"text" | "image" | "audio" | "video" | "pdf", boolean>>;
}

/** Model info as returned by provider.list() */
export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  status?: "alpha" | "beta" | "deprecated" | "active";
  variants?: Record<string, Record<string, unknown>>;
  /** Provider-reported token limits; `context` is the model's context window. */
  limit?: ModelLimit;
  /** Provider-reported capabilities, such as reasoning and image inputs. */
  capabilities?: ModelCapabilities;
  family?: string;
}

/** Provider info from the API */
export interface ProviderInfo {
  id: string;
  name: string;
  env: string[];
  /** "api" when a key or sign-in is stored; OpenCode Zen's free tier reports "custom". */
  source?: "env" | "config" | "custom" | "api";
}

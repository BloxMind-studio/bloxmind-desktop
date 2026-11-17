// OC2 wire-shape normalization shared by the SSE dispatcher and the client adapter.
// Kept dependency-free so it can be imported from anywhere (and unit-tested).
import type { ModelError } from "@/lib/modelError";
import type { PermissionRequest } from "./opencode/types";

const SYSTEM_CONTEXT_PREFIX = "[System context for this request]";
const USER_REQUEST_MARKER = "\n[User request]\n";

/**
 * Strip the injected system-context wrapper that `translateOc1Prompt` may prepend
 * to a user message when the OC2 engine has no native system field (and synthetic
 * injection is unavailable). The wrapper — and any `[Structured output required]`
 * block — is for the engine only; the person should never see it in their own bubble.
 * Legacy messages that were stored with the wrapper are cleaned when read.
 */
export function stripInjectedSystemContext(text: string): string {
  if (typeof text !== "string" || !text.startsWith(SYSTEM_CONTEXT_PREFIX)) return text;
  const index = text.indexOf(USER_REQUEST_MARKER);
  if (index === -1) return text;
  return text.slice(index + USER_REQUEST_MARKER.length);
}

export function normalizePermissionRequest(data: Record<string, unknown>): PermissionRequest {
  // OC1: {id, sessionID, permission, patterns, metadata, tool?}. OC2 permission.asked data:
  // {id, sessionID, action, resources, save?, metadata?, source?, message?}
  return {
    ...data,
    id: data.id,
    sessionID: data.sessionID,
    permission: data.permission ?? data.action ?? "unknown",
    patterns: data.patterns ?? data.resources ?? [],
    metadata: data.metadata ?? {},
  } as PermissionRequest;
}

export function normalizeExecutionError(data: unknown): ModelError | null {
  const dataObj = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
  const err = dataObj?.error ?? data;
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  if (typeof e.name === "string" && "data" in e) return err as ModelError;
  // OC2 SessionStructuredError: {type, message, status?, response?:{body}, retryAfterMs?}
  const type = typeof e.type === "string" ? e.type : "UnknownError";
  const message = typeof e.message === "string" ? e.message : "The model could not respond.";
  const response =
    e.response && typeof e.response === "object"
      ? (e.response as Record<string, unknown>)
      : undefined;
  return {
    name: type,
    data: {
      message,
      responseBody: response?.body,
      statusCode: e.status,
      isRetryable: e.retryAfterMs !== undefined && e.retryAfterMs !== null,
    },
  } as unknown as ModelError;
}

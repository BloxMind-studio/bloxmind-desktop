// OC2 wire-shape normalization shared by the SSE dispatcher and the client adapter.
// Kept dependency-free so it can be imported from anywhere (and unit-tested).
import type { ModelError } from "@/lib/modelError";
import type { PermissionRequest } from "./opencode/types";

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

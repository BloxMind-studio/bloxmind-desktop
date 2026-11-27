import type { AssistantMessage } from "@/lib/opencode";

export type ModelError = NonNullable<AssistantMessage["error"]>;

export interface ModelErrorPresentation {
  kind: "context" | "auth" | "aborted" | "image" | "usage" | "region" | "unavailable" | "generic";
  title: string;
  description: string;
  detail?: string;
}

/** The provider's own words about a model error: its message, else its response body. */
export function modelErrorDetail(error: ModelError): string | undefined {
  // Decoded from server JSON, so `data` can be missing despite the SDK type.
  const data =
    error.data && typeof error.data === "object"
      ? (error.data as { message?: unknown; responseBody?: unknown })
      : undefined;
  const detail = [data?.message, data?.responseBody].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  return detail?.trim();
}

/** OpenCode puts the reason in the message or the response body, depending on where it failed. */
function errorSays(error: ModelError, pattern: RegExp): boolean {
  const data =
    error.data && typeof error.data === "object"
      ? (error.data as { message?: unknown; responseBody?: unknown })
      : {};
  return [data.message, data.responseBody].some(
    (value) => typeof value === "string" && pattern.test(value),
  );
}

/**
 * OpenCode's free tier refusing a prompt because the free messages are used up
 * for now. Limits are rolling windows, and some models still have free usage of
 * their own, so another model is worth trying while the first one recovers.
 */
export function isFreeUsageLimit(error: ModelError): boolean {
  const data =
    error.data && typeof error.data === "object"
      ? (error.data as { message?: unknown; responseBody?: unknown; type?: unknown })
      : {};
  return (
    data.type === "provider.free-limit" ||
    (typeof data.responseBody === "string" && data.responseBody.includes("FreeUsageLimitError")) ||
    (typeof data.message === "string" && /free usage (limit|exceeded)/i.test(data.message))
  );
}

/** A model its provider won't serve where the user is. */
export function isRegionLocked(error: ModelError): boolean {
  return errorSays(error, /not available in your (country|region)/i);
}

/** A model OpenCode no longer serves, usually because it was retired. */
export function isModelUnavailable(error: ModelError): boolean {
  return errorSays(error, /model is (no longer )?unavailable/i);
}

function retryAfter(error: ModelError): number | undefined {
  const { retryAfterMs } = (error.data ?? {}) as { retryAfterMs?: unknown };
  return typeof retryAfterMs === "number" && retryAfterMs > 0 ? retryAfterMs : undefined;
}

/**
 * How long to treat a free limit as current when OpenCode gives no delay. Chat
 * turns carry Zen's Retry-After, which was about 3 hours when measured on
 * 2026-11-06; OpenCode 2.2.5 drops it from helper prompts, so those fall back to
 * this.
 */
export const FREE_LIMIT_FALLBACK_MS = 3 * 60 * 60 * 1000;

/** Free usage isn't always shared, so another model can still answer right now. */
export const TRY_ANOTHER_MODEL = "Try another model — free usage can be separate for each model.";

/**
 * When a free limit lifts: after OpenCode's retry delay, or a few hours if it
 * gave none. The error stays on its message for good, so this tells a current
 * limit from an old one.
 */
export function freeLimitEndsAt(error: ModelError, hitAt: number): number {
  return hitAt + (retryAfter(error) ?? FREE_LIMIT_FALLBACK_MS);
}

function freeLimitReturn(error: ModelError, hitAt: number | undefined, now: number): string {
  const wait = retryAfter(error);
  if (wait === undefined) return "Free messages come back after a few hours.";
  const hours = Math.round((hitAt === undefined ? wait : hitAt + wait - now) / (60 * 60 * 1000));
  if (hours < 1) return "Free messages come back in less than an hour.";
  return `Free messages come back in about ${hours} ${hours === 1 ? "hour" : "hours"}.`;
}

/** Broader wording some providers use when a model is retired or region-locked. */
function looksModelUnavailable(detail: string | undefined): boolean {
  if (!detail) return false;
  return (
    /model (?:is )?(?:retired|deprecated|no longer (?:available|supported)|disabled)/i.test(
      detail,
    ) ||
    /(?:not available|unavailable|unsupported|blocked) (?:in|for) (?:your )?(?:region|country|location)/i.test(
      detail,
    ) ||
    /region.?lock|geo.?restrict/i.test(detail)
  );
}

export function isImageInputError(error: ModelError): boolean {
  const detail = modelErrorDetail(error);
  if (!detail) return false;
  return /image input is not available|image input (?:is )?not supported|does not support image input/i.test(
    detail,
  );
}

export function presentModelError(
  error: ModelError,
  hitAt?: number,
  now: number = Date.now(),
): ModelErrorPresentation {
  const detail = modelErrorDetail(error);

  if (isFreeUsageLimit(error)) {
    return {
      kind: "usage",
      title: "You've used the free messages for now",
      description: `${freeLimitReturn(error, hitAt, now)} ${TRY_ANOTHER_MODEL} To keep going now, connect your own AI account, like ChatGPT or Claude, in Settings under Providers, or subscribe to OpenCode Go.`,
    };
  }

  if (isRegionLocked(error)) {
    return {
      kind: "region",
      title: "This model isn't offered in your region",
      description: "Switch to another model to keep going.",
      detail,
    };
  }

  if (isModelUnavailable(error)) {
    return {
      kind: "unavailable",
      title: "This model is no longer available",
      description: "It may have been removed. Switch to another model to keep going.",
      detail,
    };
  }

  if (error.name === "ContextOverflowError") {
    return {
      kind: "context",
      title: "This conversation is too large",
      description:
        "OpenCode could not reduce the conversation enough to fit this model. Start a new session or choose a model with a larger context window.",
      detail,
    };
  }

  if (error.name === "ProviderAuthError") {
    return {
      kind: "auth",
      title: "Provider connection needs attention",
      description: "Reconnect this provider or update its API key in Settings, then retry.",
      detail,
    };
  }

  if (error.name === "MessageAbortedError") {
    return {
      kind: "aborted",
      title: "Response stopped",
      description: detail ?? "The response was stopped before it finished.",
    };
  }

  // A screenshot or attached image reached a model that only accepts text.
  // Recognize it here so the UI can offer to remove the image instead of
  // showing raw provider jargon that looks like an unrecoverable failure.
  if (isImageInputError(error)) {
    return {
      kind: "image",
      title: "This model can't read images",
      description:
        "A screenshot or image reached a model that only accepts text. Remove the image from this conversation and retry, or switch to a vision-capable model.",
      detail,
    };
  }

  if (looksModelUnavailable(detail)) {
    return {
      kind: "unavailable",
      title: "This model isn't available",
      description:
        "The selected model may be retired, region-locked, or temporarily unavailable. Choose another model in the picker and retry.",
      detail,
    };
  }

  return {
    kind: "generic",
    title: "The model could not respond",
    description:
      detail ?? "The provider returned an unexpected error. Try again or choose another model.",
  };
}

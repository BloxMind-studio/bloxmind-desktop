import type { AssistantMessage } from "@/lib/opencode";

export type ModelError = NonNullable<AssistantMessage["error"]>;

export interface ModelErrorPresentation {
  kind: "context" | "auth" | "aborted" | "image" | "usage" | "unavailable" | "generic";
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

/** OpenCode's free tier refusing a prompt because free messages are used up. */
export function isFreeUsageLimit(error: ModelError): boolean {
  const data =
    error.data && typeof error.data === "object" ? (error.data as Record<string, unknown>) : {};
  return (
    (typeof data.responseBody === "string" && data.responseBody.includes("FreeUsageLimitError")) ||
    (typeof data.message === "string" && /free usage (limit|exceeded)/i.test(data.message))
  );
}

function isModelUnavailable(detail: string | undefined): boolean {
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

export function presentModelError(error: ModelError): ModelErrorPresentation {
  const detail = modelErrorDetail(error);

  if (isFreeUsageLimit(error)) {
    return {
      kind: "usage",
      title: "You've used today's free messages",
      description:
        "Free messages reset daily. To keep going now, connect a provider in Settings or use OpenCode Go.",
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

  if (isModelUnavailable(detail)) {
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

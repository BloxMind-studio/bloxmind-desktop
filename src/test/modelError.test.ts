import { describe, expect, it } from "vitest";
import { isFreeUsageLimit, presentModelError } from "@/lib/modelError";
import type { AssistantMessage } from "@/lib/opencode";

type ModelError = NonNullable<AssistantMessage["error"]>;

describe("model error presentation", () => {
  it("does not infer error categories from provider message text", () => {
    const error: ModelError = {
      name: "APIError",
      data: {
        message: "You exceeded your current quota",
        statusCode: 429,
        isRetryable: false,
      },
    };

    expect(presentModelError(error)).toMatchObject({
      kind: "generic",
      title: "The model could not respond",
    });
  });

  it("gives context overflow errors a specific recovery path", () => {
    const error: ModelError = {
      name: "ContextOverflowError",
      data: { message: "Input exceeds the context window" },
    };

    expect(presentModelError(error)).toMatchObject({
      kind: "context",
      title: "This conversation is too large",
    });
  });

  it("recognizes a screenshot sent to a text-only model", () => {
    const error: ModelError = {
      name: "APIError",
      data: {
        message:
          "Upstream request failed: [invalid_request_error] image input is not available on this engine",
        statusCode: 400,
        isRetryable: false,
      },
    };

    expect(presentModelError(error)).toMatchObject({
      kind: "image",
      title: "This model can't read images",
    });
  });

  it("recognizes the OpenCode free-usage limit", () => {
    const error: ModelError = {
      name: "APIError",
      data: {
        message: "Free usage limit exceeded for today",
        responseBody: "FreeUsageLimitError",
        statusCode: 429,
        isRetryable: true,
      },
    };
    expect(isFreeUsageLimit(error)).toBe(true);
    expect(presentModelError(error)).toMatchObject({
      kind: "usage",
      title: "You've used today's free messages",
    });
  });

  it("recognizes retired or region-locked models", () => {
    const retired: ModelError = {
      name: "APIError",
      data: {
        message: "This model is retired and no longer available",
        statusCode: 400,
        isRetryable: false,
      },
    };
    expect(presentModelError(retired)).toMatchObject({ kind: "unavailable" });

    const locked: ModelError = {
      name: "APIError",
      data: {
        message: "Model is not available in your region",
        statusCode: 403,
        isRetryable: false,
      },
    };
    expect(presentModelError(locked)).toMatchObject({ kind: "unavailable" });
  });
});

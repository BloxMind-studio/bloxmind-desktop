import { describe, expect, it } from "vitest";

import {
  findImageParts,
  IMAGE_INPUT_UNAVAILABLE_NOTE,
  isImageInputError,
  modelAcceptsImages,
} from "@/lib/imageSupport";
import type { ModelInfo } from "@/types";

function model(capabilities?: ModelInfo["capabilities"]): ModelInfo {
  return { id: "m", name: "M", providerId: "p", providerName: "P", capabilities };
}

describe("model image support", () => {
  it("trusts an explicit image input flag", () => {
    expect(modelAcceptsImages(model({ input: { text: true, image: false } }))).toBe(false);
    expect(modelAcceptsImages(model({ input: { text: true, image: true } }))).toBe(true);
  });

  it("falls back to the attachment flag when modalities are missing", () => {
    expect(modelAcceptsImages(model({ attachment: false }))).toBe(false);
    expect(modelAcceptsImages(model({ attachment: true }))).toBe(true);
  });

  it("stays permissive when the provider reports nothing", () => {
    expect(modelAcceptsImages(model())).toBeUndefined();
    expect(modelAcceptsImages(null)).toBeUndefined();
  });

  it("recognizes the upstream image rejection", () => {
    expect(
      isImageInputError({
        name: "APIError",
        data: {
          message:
            "Upstream request failed: [invalid_request_error] image input is not available on this engine",
        },
      } as never),
    ).toBe(true);
    expect(
      isImageInputError({
        name: "APIError",
        data: { message: "You exceeded your current quota" },
      } as never),
    ).toBe(false);
  });

  it("keeps the text-only instruction explicit about screenshots", () => {
    expect(IMAGE_INPUT_UNAVAILABLE_NOTE).toContain("cannot accept image input");
    expect(IMAGE_INPUT_UNAVAILABLE_NOTE).toContain("screen-capture");
  });
});

describe("image parts in a conversation", () => {
  it("finds user attachments and tool screenshots", () => {
    const found = findImageParts([
      {
        info: { id: "user-1" },
        parts: [
          { id: "p1", type: "file", mime: "image/png", url: "data:image/png;base64,x" },
          { id: "p2", type: "text", text: "look" },
        ],
      },
      {
        info: { id: "assistant-1" },
        parts: [
          {
            id: "p3",
            type: "tool",
            tool: "roblox-studio_screen_capture",
            state: {
              status: "completed",
              attachments: [
                { id: "a1", mime: "image/png", url: "data:image/png;base64,x" },
                { id: "a2", mime: "text/plain", url: "data:text/plain,x" },
              ],
            },
          },
        ],
      },
    ] as never);

    expect(found.map((entry) => [entry.messageID, entry.part.id, entry.imageCount])).toEqual([
      ["user-1", "p1", 1],
      ["assistant-1", "p3", 1],
    ]);
  });
});

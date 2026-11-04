import type { Part } from "@opencode-ai/sdk/v2/client";

import type { ModelInfo } from "@/types";

/**
 * Whether a model can accept image input, based only on what the provider
 * reports. `undefined` means "not reported", so callers should stay permissive
 * instead of blocking a model that may actually support images.
 */
export function modelAcceptsImages(model?: ModelInfo | null): boolean | undefined {
  const capabilities = model?.capabilities;
  if (!capabilities) return undefined;
  if (capabilities.input) return capabilities.input.image === true;
  if (typeof capabilities.attachment === "boolean") return capabilities.attachment;
  return undefined;
}

/** System instruction added on every send to a model without image input. */
export const IMAGE_INPUT_UNAVAILABLE_NOTE =
  "The selected model cannot accept image input. Never call screen-capture, screenshot, or other image-output tools, and do not ask for image attachments; inspect the place with text-based Studio tools and report findings in text.";

/** The provider's rejection for image content on a text-only model. */
export { isImageInputError } from "@/lib/modelError";

export interface ImagePartRef {
  messageID: string;
  part: Part;
  /** How many image payloads this part carries. */
  imageCount: number;
}

function isImageMime(mime: string | undefined): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

/**
 * Every part that would send image bytes to the model: user file attachments
 * and completed tool results that captured a screenshot.
 */
export function findImageParts(
  messages: ReadonlyArray<{ info: { id: string }; parts: readonly Part[] }>,
): ImagePartRef[] {
  const found: ImagePartRef[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "file" && isImageMime(part.mime)) {
        found.push({ messageID: message.info.id, part, imageCount: 1 });
      } else if (part.type === "tool" && part.state.status === "completed") {
        const images = (part.state.attachments ?? []).filter((file) => isImageMime(file.mime));
        if (images.length > 0) {
          found.push({ messageID: message.info.id, part, imageCount: images.length });
        }
      }
    }
  }
  return found;
}

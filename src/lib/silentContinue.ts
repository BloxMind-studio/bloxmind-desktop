/**
 * Silent-continue marker utilities.
 *
 * After an interruption, the renderer can auto-resume the agent by sending a
 * continuation prompt. That prompt must reach the engine but must never appear
 * as a visible chat bubble — these helpers let the message cache and the feed
 * recognize (and drop) the marker message, including while it is still being
 * assembled from streaming deltas.
 */

/**
 * The exact prompt text sent for silent continuation. Callers compare cached
 * message text against this constant, so it must stay in sync everywhere.
 */
export const SILENT_CONTINUE_PROMPT = "Continue generating from where you stopped.";

import type { MessageWithParts } from "@/types";

/** Extract the concatenated text of a message's text parts (best effort). */
function messageText(message: MessageWithParts): string {
  return message.parts
    .map((part) => (part.type === "text" ? ((part as { text?: string }).text ?? "") : ""))
    .join("");
}

/**
 * True when the message is the completed silent-continue marker: a user
 * message whose text is exactly the continuation prompt.
 */
export function isSilentContinueMessage(message: MessageWithParts): boolean {
  if (message.info.role !== "user") return false;
  return messageText(message) === SILENT_CONTINUE_PROMPT;
}

/**
 * True when the message is a user message that is still materializing into the
 * silent-continue marker: an empty shell (no parts yet) or one whose streamed
 * text is still a strict prefix of the marker prompt. Feed rendering uses this
 * to hide the gap while deltas assemble.
 */
export function isSilentContinueInProgress(message: MessageWithParts): boolean {
  if (message.info.role !== "user") return false;
  if (message.parts.length === 0) return true;
  return messageText(message).startsWith(SILENT_CONTINUE_PROMPT.slice(0, 10));
}

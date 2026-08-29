import type { Part } from "@opencode-ai/sdk/v2/client";
import { memo, useCallback, useState } from "react";
import { ModelErrorCard } from "@/components/chat/ErrorViews";
import { SmartPartsRenderer } from "@/components/chat/partViews";
import { BloxMindThinking } from "@/components/chat/ThinkingIndicator";
import { UserPartsView } from "@/components/chat/UserPartsView";
import { WorkingIndicator } from "@/components/chat/WorkingIndicator";
import { useRetryMessage } from "@/hooks/mutations/useRetryMessage";
import { useMessage } from "@/hooks/useMessages";
import { useSessionStatus } from "@/hooks/useSessionStatuses";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

// ── Message bubble ─────────────────────────────────────────────────────

export const MessageBubble = memo(function MessageBubble({
  messageId,
  showControls = false,
  isLastIndex = false,
  interrupted: interruptedProp = false,
}: {
  messageId: string;
  showControls?: boolean;
  isLastIndex?: boolean;
  interrupted?: boolean;
}) {
  const msg = useMessage(messageId);
  const [copied, setCopied] = useState(false);
  const retry = useRetryMessage();
  const { activeSessionId } = useActiveSession();
  const sessionStatus = useSessionStatus(activeSessionId);
  const isBusy = sessionStatus !== undefined && sessionStatus.type !== "idle";

  const handleRetry = useCallback(() => {
    if (retry.isPending) return;
    retry.mutate({ assistantMessageId: messageId });
  }, [retry, messageId]);

  const handleCopy = useCallback(() => {
    if (!msg) return;
    const textParts = msg.parts.filter((p) => p.type === "text");
    const lastText = textParts[textParts.length - 1];
    if (!lastText) return;
    const text = (lastText as Extract<Part, { type: "text" }>).text.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [msg]);

  if (!msg) return null;

  const isUser = msg.info.role === "user";
  const hasTextContent = msg.parts.some((p) => p.type === "text");
  const hasOnlyThinkingParts = msg.parts.every(
    (p) =>
      p.type === "reasoning" ||
      p.type === "tool" ||
      p.type === "step-start" ||
      p.type === "step-finish" ||
      p.type === "retry" ||
      p.type === "compaction",
  );

  const shouldShowCopyButton =
    hasTextContent && !hasOnlyThinkingParts && !isUser;

  // The "Thinking..." placeholder should stay visible for as long as the agent
  // is still generating this assistant message — i.e. until it has produced a
  // final text answer (or errored). Showing it only while `parts.length === 0`
  // was wrong: the engine commits reasoning/tool parts mid-think, which cleared
  // the indicator even though the actual response wasn't ready yet.
  const hasFinalText = msg.parts.some(
    (p) =>
      p.type === "text" &&
      typeof p.text === "string" &&
      p.text.trim().length > 0,
  );
  const hasError =
    "error" in msg.info &&
    msg.info.error &&
    msg.info.error.name !== "MessageAbortedError";
  const hasCompleted =
    !!(msg.info as { time?: { completed?: unknown } })?.time?.completed;
  // Strict interrupted check: only when the parent explicitly marks the
  // session as interrupted (persisted flag). Do NOT derive interrupted from
  // unfinished text — normal completions must never show the paused note or
  // count as interrupted.
  const interrupted = !isBusy && interruptedProp;
  const isComplete =
    hasFinalText || hasCompleted || hasError || sessionStatus?.type === "idle" || interrupted;
  const showThinking = !isUser && !isComplete && isLastIndex;
  // Static note shown instead of the live indicators for the abandoned turn
  // (the Continue button rendered below the feed resumes the agent).
  // Requires no natural completion signal (final text OR completed time) —
  // otherwise a tool-only natural completion would incorrectly show the
  // "you left" block for one frame before the flag is cleared.
  const showPausedNote =
    !isUser && interrupted && isLastIndex && !hasFinalText && !hasCompleted && !hasError;

  return (
    <div
      className={`animate-fade-in-up flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`relative max-w-[85%] ${
          isUser
            ? "rounded-2xl rounded-br-sm bg-foreground px-4 py-2.5 text-background shadow-sm"
            : "w-full"
        }`}
      >
        {isUser ? (
          <UserPartsView parts={msg.parts} />
        ) : (
          <div className="space-y-2">
            {showThinking && <BloxMindThinking />}
            {showThinking && (
              <WorkingIndicator parts={msg.parts} active={showThinking} />
            )}
            {showPausedNote && (
              <div className="my-1 flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-2.5 py-1.5 text-[12px] text-muted-foreground">
                <span className="shrink-0 font-medium text-foreground/80">
                  You left while the agent was working
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] italic text-muted-foreground/70">
                  Press Continue to resume from where it stopped.
                </span>
              </div>
            )}
            <SmartPartsRenderer parts={msg.parts} hideThinking={showThinking} />
            {"error" in msg.info &&
              msg.info.error &&
              msg.info.error.name !== "MessageAbortedError" && (
                <ModelErrorCard error={msg.info.error} />
              )}
            {!isBusy && showControls && (
              <div className="flex select-none items-center justify-end gap-1 pt-1">
                {/* Retry button: shown on errored assistant messages. */}
                {!isUser &&
                  "error" in msg.info &&
                  msg.info.error &&
                  msg.info.error.name !== "MessageAbortedError" && (
                    <button
                      type="button"
                      onClick={handleRetry}
                      disabled={retry.isPending}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-amber-500/80 transition-colors hover:bg-amber-500/10 disabled:pointer-events-none disabled:opacity-50"
                      title="Retry this message"
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      <span>{retry.isPending ? "Retrying…" : "Retry"}</span>
                    </button>
                  )}
                {/* Copy button: always visible on finished messages with text */}
                {shouldShowCopyButton && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/40 transition-colors hover:bg-hover/50"
                    title="Copy message"
                  >
                    {copied ? (
                      <>
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-emerald-500"
                          aria-hidden="true"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="text-emerald-500">Copied</span>
                      </>
                    ) : (
                      <>
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <rect
                            x="9"
                            y="9"
                            width="13"
                            height="13"
                            rx="2"
                            ry="2"
                          />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

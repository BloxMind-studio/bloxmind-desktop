import type { Part } from "@opencode-ai/sdk/v2/client";
import { memo, useCallback, useState } from "react";
import {
  type CheckpointHistory,
  CheckpointStatusBadge,
  RestoreCheckpointButton,
} from "@/components/chat/CheckpointControls";
import { ModelErrorCard } from "@/components/chat/ErrorViews";
import { SmartPartsRenderer } from "@/components/chat/partViews";
import { BloxMindThinking } from "@/components/chat/ThinkingIndicator";
import { UserPartsView } from "@/components/chat/UserPartsView";
import { useRegenerateResponse } from "@/hooks/mutations/useRegenerateResponse";
import { useMessage } from "@/hooks/useMessages";
import { useSessionStatus } from "@/hooks/useSessionStatuses";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

// ── Message bubble ─────────────────────────────────────────────────────

export const MessageBubble = memo(function MessageBubble({
  messageId,
  showControls = false,
  checkpoint,
  showRestore = true,
  isLastIndex = false,
}: {
  messageId: string;
  showControls?: boolean;
  checkpoint: CheckpointHistory;
  showRestore?: boolean;
  isLastIndex?: boolean;
}) {
  const msg = useMessage(messageId);
  const [copied, setCopied] = useState(false);
  const { activeSessionId } = useActiveSession();
  const sessionStatus = useSessionStatus(activeSessionId);
  const isBusy = sessionStatus?.type === "busy";
  const regenerate = useRegenerateResponse();

  const handleRegenerate = useCallback(() => {
    if (regenerate.isPending) return;
    regenerate.mutate({ assistantMessageId: messageId });
  }, [regenerate, messageId]);

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

  const shouldShowCopyButton = hasTextContent && !hasOnlyThinkingParts && !isUser;

  return (
    <div className={`animate-fade-in-up flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`group relative max-w-[85%] ${
          isUser
            ? "rounded-2xl rounded-br-sm bg-gradient-to-br from-foreground to-foreground/95 px-4 py-2.5 text-background shadow-lg shadow-foreground/20"
            : "w-full"
        }`}
      >
        {/* Subtle glow effect for user messages */}
        {isUser && (
          <div className="absolute -inset-0.5 rounded-2xl rounded-br-sm bg-gradient-to-br from-accent/30 to-accent/10 blur-sm -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        )}
        {isUser ? (
          <UserPartsView parts={msg.parts} />
        ) : (
          <div className="space-y-2">
            {msg.parts.length === 0 && <BloxMindThinking />}
            <SmartPartsRenderer parts={msg.parts} />
            {"error" in msg.info &&
              msg.info.error &&
              msg.info.error.name !== "MessageAbortedError" && (
                <ModelErrorCard error={msg.info.error} />
              )}
            {!isBusy && showControls && (
              <div className="flex select-none items-center justify-end gap-1 pt-1">
                {checkpoint.canUndo && (
                  <button
                    type="button"
                    onClick={checkpoint.undo}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/40 transition-all duration-200 hover:scale-105 hover:text-muted-foreground hover:bg-accent/50 active:scale-95"
                    title="Undo last change"
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
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    <span>Undo</span>
                  </button>
                )}
                {checkpoint.canRedo && (
                  <button
                    type="button"
                    onClick={checkpoint.redo}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/40 transition-all duration-200 hover:scale-105 hover:text-muted-foreground hover:bg-accent/50 active:scale-95"
                    title="Redo last change"
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
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                    <span>Redo</span>
                  </button>
                )}
                {/* Checkpoint badge: show if there's ever been a checkpoint (cached) */}
                {checkpoint.cachedFsCheckpointCount > 0 && (
                  <CheckpointStatusBadge checkpoint={checkpoint} />
                )}
                {/* Restore button: only on non-last turns when a checkpoint exists */}
                {showRestore && !isLastIndex && checkpoint.fsCheckpointCount > 0 && (
                  <RestoreCheckpointButton
                    checkpoint={checkpoint}
                    isBusy={isBusy}
                    messageId={messageId}
                  />
                )}
                {/* Regenerate button: latest assistant message only. Once the
                    re-run starts, the session turns busy and this whole
                    toolbar hides, which doubles as the disabled state. */}
                {!isUser && isLastIndex && (
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={regenerate.isPending}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/40 transition-all duration-200 hover:scale-105 hover:text-muted-foreground hover:bg-accent/50 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                    title="Regenerate this response"
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
                    <span>{regenerate.isPending ? "Regenerating…" : "Regenerate"}</span>
                  </button>
                )}
                {/* Copy button: always visible on finished messages with text */}
                {shouldShowCopyButton && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/40 transition-all duration-200 hover:scale-105 hover:text-muted-foreground hover:bg-accent/50 active:scale-95"
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
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
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

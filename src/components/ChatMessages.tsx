import type { QuestionAnswer } from "@opencode-ai/sdk/v2/client";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelErrorCard, UsageLimitDialog } from "@/components/chat/ErrorViews";
import { LightboxProvider } from "@/components/chat/Lightbox";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { PermissionPrompt, QuestionPrompt } from "@/components/chat/Prompts";
import { BusyThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { TodoPanel } from "@/components/chat/TodoPanel";
import { useAnswerQuestion, useRejectQuestion } from "@/hooks/mutations/useAnswerQuestion";
import { useReplyPermission } from "@/hooks/mutations/useReplyPermission";
import { useSendMessage } from "@/hooks/mutations/useSendMessage";
import { useMessage, useMessageIds } from "@/hooks/useMessages";
import { useActivePermission } from "@/hooks/usePermissions";
import { useActiveQuestion } from "@/hooks/useQuestions";
import { useSessionError } from "@/hooks/useSessionError";
import { useSessionStatus } from "@/hooks/useSessionStatuses";
import { useTodos } from "@/hooks/useTodos";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { getOpenCodeUsageAction } from "@/lib/usageLimit";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

// ── Main component ─────────────────────────────────────────────────────

/** Show the jump-to-bottom button when the user has scrolled this far up. */
const SCROLL_UP_THRESHOLD_PX = 220;

function ChatMessages() {
  const messageIds = useMessageIds();
  const lastMessage = useMessage(messageIds[messageIds.length - 1] ?? "");
  const sessionError = useSessionError();
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();
  const sessionStatus = useSessionStatus(activeSessionId);
  const isBusy = sessionStatus !== undefined && sessionStatus.type !== "idle";
  const usageAction = getOpenCodeUsageAction(sessionStatus);
  const todos = useTodos();
  const activeQuestion = useActiveQuestion();
  const activePermission = useActivePermission();
  const lastMessageHasError =
    lastMessage?.info.role === "assistant" && Boolean(lastMessage.info.error);
  const answerQuestion = useAnswerQuestion();
  const rejectQuestion = useRejectQuestion();
  const replyPermission = useReplyPermission();

  // ── Continue handling for interrupted generations ──────────
  // When the agent is stopped (abort) or crashes, we persist an "interrupted" marker
  // and show a Continue button that resumes with a follow-up prompt.
  const sendMessageForContinue = useSendMessage();
  const [hasInterruptedFlag, setHasInterruptedFlag] = useState(false);
  useEffect(() => {
    if (!activeSessionId) {
      setHasInterruptedFlag(false);
      return;
    }
    const check = () => {
      try {
        const flag = localStorage.getItem(`BloxMind:interrupted:${activeSessionId}`);
        setHasInterruptedFlag(!!flag);
      } catch {
        setHasInterruptedFlag(false);
      }
    };
    check();
    const interval = setInterval(check, 1000);
    const handleStorage = (e: StorageEvent) => {
      if (e.key === `BloxMind:interrupted:${activeSessionId}`) check();
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
    };
  }, [activeSessionId]);
  const isLastMessageAborted =
    (lastMessage?.info as { error?: { name?: string } })?.error?.name === "MessageAbortedError";
  const showContinue = !isBusy && !!activeSessionId && (hasInterruptedFlag || isLastMessageAborted);
  const handleContinue = useCallback(() => {
    if (!activeSessionId || isBusy) return;
    try {
      localStorage.removeItem(`BloxMind:interrupted:${activeSessionId}`);
    } catch {
      // ignore
    }
    setHasInterruptedFlag(false);
    void sendMessageForContinue
      .mutateAsync({
        text: "Continue generating from where you left off based on the previous code/plan.",
      })
      .catch(() => undefined);
  }, [activeSessionId, isBusy, sendMessageForContinue]);
  // Clear the interrupted marker when a new generation starts or a fresh assistant
  // message with final text arrives — the interruption is now resolved.
  useEffect(() => {
    if (!hasInterruptedFlag || !activeSessionId) return;
    if (isBusy) {
      try {
        localStorage.removeItem(`BloxMind:interrupted:${activeSessionId}`);
      } catch {
        // ignore
      }
      setHasInterruptedFlag(false);
      return;
    }
    if (lastMessage?.info.role === "assistant") {
      const hasFinal = lastMessage.parts.some(
        (p) => p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0,
      );
      if (hasFinal && !isLastMessageAborted) {
        try {
          localStorage.removeItem(`BloxMind:interrupted:${activeSessionId}`);
        } catch {
          // ignore
        }
        setHasInterruptedFlag(false);
      }
    }
  }, [hasInterruptedFlag, activeSessionId, isBusy, lastMessage, isLastMessageAborted]);

  // ── Authoritative message sync while the agent is generating ──────────
  // The OpenCode engine (anomalyco/opencode >= 1.14.42) drops SyncEvent
  // publishes — including `message.part.updated` — from the `/event` SSE
  // stream. Message bubbles still appear (their shells arrive), but their
  // parts never do, so they render as "..." / "Thinking..." and the assistant
  // response never shows. The persisted store (`session.messages()`) stays
  // authoritative, so we poll it whenever there's an active session.
  // We also poll a bit faster while the status says "busy" or "retry",
  // and fall back to a slower poll otherwise (covers the case where the
  // engine doesn't emit session.status events at all).
  useEffect(() => {
    if (!activeSessionId) return;
    const isActivelyGenerating = sessionStatus?.type === "busy" || sessionStatus?.type === "retry";
    const POLL_MS = isActivelyGenerating ? 1200 : 3000;
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: qk.messages(activeSessionId),
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: qk.todos(activeSessionId),
        refetchType: "active",
      });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeSessionId, sessionStatus?.type, queryClient]);

  // ── Fallback: if the last assistant message has been "Thinking..." for >10s
  // without getting any parts, force a refetch (covers dropped session.idle).
  useEffect(() => {
    if (lastMessage?.info.role !== "assistant" || lastMessage.parts.length > 0) return;
    const timer = window.setTimeout(() => {
      void queryClient.invalidateQueries({
        queryKey: qk.messages(activeSessionId ?? ""),
        refetchType: "active",
      });
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [lastMessage, activeSessionId, queryClient]);

  // Determine the role of every message so we know where each task ends.
  const rolesByIndex = useMemo(() => {
    if (!activeSessionId) return new Map<number, string>();
    const cache = queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId));
    const roles = new Map<number, string>();
    messageIds.forEach((id, index) => {
      roles.set(index, cache?.messagesById[id]?.info.role ?? "");
    });
    return roles;
  }, [activeSessionId, messageIds, queryClient]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const lastScrollTop = useRef(0);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const virtualizer = useVirtualizer({
    count: messageIds.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const currentScrollTop = el.scrollTop;
    const distanceFromBottom = el.scrollHeight - currentScrollTop - el.clientHeight;

    const isScrollingDown = currentScrollTop > lastScrollTop.current;
    // The user is actively scrolling up → block auto-scroll immediately so
    // we don't yank the view back down (the "bounce" bug).
    if (!isScrollingDown && currentScrollTop > 0) {
      shouldAutoScroll.current = false;
    } else if (isScrollingDown && distanceFromBottom < 80) {
      shouldAutoScroll.current = true;
    }
    setShowJumpToBottom(distanceFromBottom > SCROLL_UP_THRESHOLD_PX);
    lastScrollTop.current = currentScrollTop;
  }, []);

  // Wrap the auto-scroll toggle so a manual jump re-enables it and hides the button.
  const jumpToBottom = useCallback(() => {
    shouldAutoScroll.current = true;
    setShowJumpToBottom(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    const anchor = bottomRef.current;
    if (!el || !anchor) return;
    let rafId = 0;
    const observer = new MutationObserver((mutations) => {
      const onlyDisclosureChanges = mutations.every((mutation) => {
        const target =
          mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        return target?.closest("[data-preserve-scroll]") !== null;
      });
      if (onlyDisclosureChanges) return;
      if (!shouldAutoScroll.current) {
        // New content landed while the user is scrolled up — make sure the
        // jump button reflects the current position.
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setShowJumpToBottom(distanceFromBottom > SCROLL_UP_THRESHOLD_PX);
        return;
      }
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          anchor.scrollIntoView({ behavior: "instant" });
        });
      }
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll triggers
  useEffect(() => {
    if (shouldAutoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isBusy, todos, activeQuestion, activePermission]);

  const handleAnswer = useCallback(
    (requestID: string, answers: QuestionAnswer[]) => answerQuestion.mutate({ requestID, answers }),
    [answerQuestion],
  );
  const handleReject = useCallback(
    (requestID: string) => rejectQuestion.mutate(requestID),
    [rejectQuestion],
  );
  const handleReplyPermission = useCallback(
    (requestID: string, reply: "once" | "always" | "reject") =>
      replyPermission.mutate({ requestID, reply }),
    [replyPermission],
  );

  if (messageIds.length === 0 && !isBusy && !sessionError) {
    return (
      <LightboxProvider>
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="animate-fade-in-up text-center">
            <h2 className="font-serif text-2xl italic text-foreground">
              What would you like to build?
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Ask me to create scripts, design game mechanics, or modify your Roblox Studio project.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground/80">
              <span className="inline-flex items-center gap-1.5">
                <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">N</kbd> new session
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">E</kbd> explorer
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">,</kbd> settings
              </span>
            </div>
          </div>
        </div>
      </LightboxProvider>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <LightboxProvider>
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          data-chat-scroll
          onScroll={handleScroll}
          className="app-scrollbar absolute inset-0 overflow-y-auto [overflow-anchor:none]"
        >
          <div className="mx-auto max-w-2xl px-4 py-4">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: "relative",
                width: "100%",
              }}
            >
              {virtualItems.map((virtualItem) => {
                const msgId = messageIds[virtualItem.index];
                const isLastIndex = virtualItem.index === messageIds.length - 1;
                // Filter out injected system notifications (e.g. restore context
                // patches) from the visual feed. They remain in the session for
                // the agent's context, but are never rendered as a message bubble.
                const cacheMsg = activeSessionId
                  ? queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId))
                      ?.messagesById[msgId]
                  : undefined;
                const isSystemNotification = cacheMsg?.parts?.some(
                  (p) => p.type === "text" && p.text.startsWith("[SYSTEM_NOTIFICATION"),
                );
                if (isSystemNotification) {
                  return (
                    <div
                      key={msgId}
                      data-index={virtualItem.index}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    />
                  );
                }
                // This message is the end of a task if it's the last message,
                // OR the very next message belongs to the user.
                const nextRole = rolesByIndex.get(virtualItem.index + 1);
                // Treat any non-assistant next role (including empty string when
                // the cache hasn't caught up to a new user message yet) as the
                // end of a task. This prevents the button from disappearing
                // when the user types and the role cache is briefly stale.
                const isLastOfTask = isLastIndex || nextRole !== "assistant";
                // Treat anything that isn't "busy" as idle so buttons persist
                // during brief status refetches/polls where sessionStatus is
                // momentarily undefined. Only hide controls when the agent is
                // actively working.
                const isTaskIdle = sessionStatus?.type !== "busy";

                return (
                  <div
                    key={msgId}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <div className="pb-4">
                      <MessageBubble
                        messageId={msgId}
                        showControls={isLastOfTask && isTaskIdle}
                        isLastIndex={isLastIndex}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-4">
              {todos.length > 0 && <TodoPanel todos={todos} />}
              {activeQuestion && (
                <QuestionPrompt
                  question={activeQuestion}
                  onAnswer={handleAnswer}
                  onReject={handleReject}
                />
              )}
              {activePermission && (
                <PermissionPrompt permission={activePermission} onReply={handleReplyPermission} />
              )}
              <BusyThinkingIndicator status={sessionStatus} lastMessage={lastMessage} />
              {showContinue && (
                <div className="flex justify-center py-2">
                  <button
                    type="button"
                    onClick={handleContinue}
                    disabled={sendMessageForContinue.isPending}
                    className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                    aria-label="Continue generation"
                    title="Continue generating from where you left off"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    Continue
                  </button>
                </div>
              )}
              {usageAction && (
                <UsageLimitDialog
                  key={`${usageAction.provider}:${usageAction.reason}`}
                  action={usageAction}
                />
              )}
              {sessionError && !lastMessageHasError && <ModelErrorCard error={sessionError} />}
            </div>
            <div ref={bottomRef} />
          </div>
        </div>
        {showJumpToBottom && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="absolute bottom-5 right-6 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-popover text-foreground shadow-lg transition-colors hover:bg-selected/15 hover:text-selected-foreground"
            title="Jump to latest"
            aria-label="Jump to latest messages"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>
    </LightboxProvider>
  );
}

export default ChatMessages;

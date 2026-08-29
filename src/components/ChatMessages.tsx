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
import {
  isSilentContinueInProgress,
  isSilentContinueMessage,
  SILENT_CONTINUE_PROMPT,
} from "@/lib/silentContinue";
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
  // "Definitely idle" distinguishes a settled turn (status === idle) from the
  // transient windows where the status query briefly returns undefined during
  // refetch/reconnect while the agent is still working. Only a definitely-idle
  // session with an unfinished last message is treated as interrupted; a live
  // turn or a transient status blip must never trigger the "you left while the
  // agent was working" state.
  const isBusy = sessionStatus !== undefined && sessionStatus.type !== "idle";
  const rawBusy = isBusy;
  const statusIsIdle = sessionStatus?.type === "idle";
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
  // Detect a turn that was abandoned by closing the app while the agent was
  // still working. The engine process is killed with the app and never sends a
  // status for the session again, so `sessionStatus`/`hasInterruptedFlag` may
  // both be empty on reopen. The reliable signal is the message cache itself:
  // the last assistant message never produced a final text answer and never
  // errored → the turn was interrupted mid-flight.
  const lastMessageHasFinalText = !!lastMessage?.parts.some(
    (p): boolean =>
      p.type === "text" &&
      typeof (p as { text?: unknown }).text === "string" &&
      (p as { text: string }).text.trim().length > 0,
  );
  const lastMessageIsCompleted = !!(lastMessage?.info as { time?: { completed?: unknown } })?.time
    ?.completed;
  // ── Persistent last-known-state detection (close-mid-turn) ──────────────
  // While the agent works we continuously persist `busy` for the session, and
  // flip it to `idle` only when the engine explicitly reports an idle status.
  // If the app is closed mid-turn, the marker survives as `busy` — even if the
  // close-time `pagehide` hook never fires — so on reopen we can detect that
  // the session was abandoned while working.
  const [lastKnownBusy, setLastKnownBusy] = useState(false);
  // The status query can transiently return `undefined` during refetches while
  // the agent is actively working. Only trust the persisted `busy` marker once
  // the status has stayed unknown for a settle window (i.e. a real reopen where
  // the engine has no status for the session), never during a momentary blip.
  const [statusUnknownSettled, setStatusUnknownSettled] = useState(false);
  useEffect(() => {
    if (sessionStatus !== undefined) {
      setStatusUnknownSettled(false);
      return;
    }
    const t = setTimeout(() => setStatusUnknownSettled(true), 2000);
    return () => clearTimeout(t);
  }, [sessionStatus]);
  useEffect(() => {
    if (!activeSessionId) {
      setLastKnownBusy(false);
      return;
    }
    const key = `BloxMind:lastKnownState:${activeSessionId}`;
    if (rawBusy) {
      // Agent is active (raw, not latched) → mark last known state as busy
      // immediately. Using raw avoids holding "busy" for the 2s idle-confirm
      // window after a natural completion, which would otherwise leave a stale
      // busy marker that resurrects the interrupted banner on next reopen.
      try {
        localStorage.setItem(key, "busy");
      } catch {
        // ignore storage errors
      }
      return;
    }
    if (statusIsIdle) {
      // Clean finish → mark as idle and release any stale busy marker.
      try {
        localStorage.setItem(key, "idle");
      } catch {
        // ignore storage errors
      }
      setLastKnownBusy(false);
      return;
    }
    // Status unknown: only trust the persisted state after the settle window,
    // so a transient refetch blip during a live turn can't read as a reopen.
    if (!statusUnknownSettled) {
      setLastKnownBusy(false);
      return;
    }
    try {
      setLastKnownBusy(localStorage.getItem(key) === "busy");
    } catch {
      setLastKnownBusy(false);
    }
  }, [activeSessionId, rawBusy, statusIsIdle, statusUnknownSettled]);

  // Strict Continue visibility: ONLY when explicitly interrupted
  // (persisted `BloxMind:interrupted:*` flag) AND session is idle waiting.
  // Do NOT trigger on normal completion (finalText / isComplete) alone.
  // `lastKnownBusy` is retained only as a persistence fallback but does NOT
  // drive UI on its own — the explicit flag is the single source of truth.
  const isTaskInterrupted = hasInterruptedFlag;
  const interrupted = !isBusy && isTaskInterrupted;
  const showContinue = !!activeSessionId && interrupted;
  const handleContinue = useCallback(() => {
    if (!activeSessionId || isBusy) return;
    try {
      localStorage.removeItem(`BloxMind:interrupted:${activeSessionId}`);
      // Release the persisted busy marker so the paused state clears even if
      // the engine has no status for this session yet.
      localStorage.setItem(`BloxMind:lastKnownState:${activeSessionId}`, "idle");
    } catch {
      // ignore
    }
    setHasInterruptedFlag(false);
    setLastKnownBusy(false);
    // Silent continuation: the prompt reaches the agent, but the renderer
    // hides the marker user message (see isSilentContinueMessage) so no
    // "Continue…" bubble ever appears in the visible stream.
    void sendMessageForContinue
      .mutateAsync({
        text: SILENT_CONTINUE_PROMPT,
      })
      .catch(() => undefined);
  }, [activeSessionId, isBusy, sendMessageForContinue]);
  // Clear the interrupted marker when a new generation starts or a fresh assistant
  // message completes naturally (final text OR engine-reported completed time).
  // This handles tool-only completions where `time.completed` is set without a
  // final text part. `lastKnownBusy` is also cleared so stale "busy" does not
  // resurrect the banner on the next normal task.
  useEffect(() => {
    if ((!hasInterruptedFlag && !lastKnownBusy) || !activeSessionId) return;
    if (isBusy) {
      try {
        localStorage.removeItem(`BloxMind:interrupted:${activeSessionId}`);
        localStorage.setItem(`BloxMind:lastKnownState:${activeSessionId}`, "idle");
      } catch {
        // ignore
      }
      setHasInterruptedFlag(false);
      setLastKnownBusy(false);
      return;
    }
    if (lastMessage?.info.role === "assistant" && !isLastMessageAborted) {
      const hasFinal = lastMessageHasFinalText || lastMessageIsCompleted;
      if (hasFinal) {
        try {
          localStorage.removeItem(`BloxMind:interrupted:${activeSessionId}`);
          localStorage.setItem(`BloxMind:lastKnownState:${activeSessionId}`, "idle");
        } catch {
          // ignore
        }
        setHasInterruptedFlag(false);
        setLastKnownBusy(false);
      }
    }
  }, [
    hasInterruptedFlag,
    lastKnownBusy,
    activeSessionId,
    isBusy,
    lastMessage,
    lastMessageHasFinalText,
    lastMessageIsCompleted,
    isLastMessageAborted,
  ]);

  // Requirement 2: Clean state reset on natural task completion.
  // When the turn completes normally (idle + natural completion signal), explicitly
  // clear any stale interrupted/shouldContinue flags so the Continue button and
  // the "You left while the agent was working" block disappear forever for that
  // completed prompt. Uses `time.completed` in addition to `hasFinalText` to
  // cover tool-only completions. The `!isBusy` (idle/unknown) check ensures an
  // actually-interrupted turn that never got an idle status (status remains
  // undefined on reopen) keeps its flag until the user explicitly continues.
  useEffect(() => {
    if (!activeSessionId) return;
    const naturallyCompleted =
      (lastMessageHasFinalText || lastMessageIsCompleted) && !isLastMessageAborted;
    if (statusIsIdle && naturallyCompleted) {
      const hasFlag = hasInterruptedFlag || lastKnownBusy;
      if (!hasFlag) return;
      try {
        localStorage.removeItem(`BloxMind:interrupted:${activeSessionId}`);
        localStorage.setItem(`BloxMind:lastKnownState:${activeSessionId}`, "idle");
      } catch {
        // ignore
      }
      setHasInterruptedFlag(false);
      setLastKnownBusy(false);
    }
  }, [
    activeSessionId,
    statusIsIdle,
    lastMessageHasFinalText,
    lastMessageIsCompleted,
    isLastMessageAborted,
    hasInterruptedFlag,
    lastKnownBusy,
  ]);

  // ── Authoritative message sync while the agent is generating ──────────
  // The OpenCode engine (anomalyco/opencode >= 1.14.42) drops SyncEvent
  // publishes — including `message.part.updated` — from the `/event` SSE
  // stream. Message bubbles still appear (their shells arrive), but their
  // parts never do, so they render as "..." / "Thinking..." and the assistant
  // response never shows. The persisted store (`session.messages()`) stays
  // authoritative, so we poll it whenever there's an active session.
  //
  // IMPORTANT: this poll is now ONLY a part hydrator. It no longer decides
  // when the "Thinking..." indicator or the Stop button flips — completion is
  // driven by SSE `message.updated` -> `info.time.completed` (see
  // MessageBubble), which updates the messages cache instantly. We keep a
  // slightly faster cadence while "busy"/"retry" so streamed parts materialize
  // promptly, and a slower one otherwise (also covers engines that emit no
  // session.status events at all).
  useEffect(() => {
    if (!activeSessionId) return;
    const isActivelyGenerating = sessionStatus?.type === "busy" || sessionStatus?.type === "retry";
    const POLL_MS = isActivelyGenerating ? 1500 : 4000;
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
    estimateSize: (index) => {
      const id = messageIds[index];
      const cache = activeSessionId
        ? queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId))
        : undefined;
      const msg = id ? cache?.messagesById[id] : undefined;
      if (msg) {
        const isSystem = msg.parts?.some(
          (p) => p.type === "text" && p.text.startsWith("[SYSTEM_NOTIFICATION"),
        );
        if (isSystem) return 0;
        if (isSilentContinueMessage(msg)) return 0;
        if (isSilentContinueInProgress(msg)) {
          const isEmptyShell = msg.parts.length === 0;
          if (isEmptyShell) {
            if (hasInterruptedFlag) return 0;
          } else {
            return 0;
          }
        }
      }
      return 80;
    },
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
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
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
                // Silent continuation prompts reach the agent but are never
                // rendered as a visible bubble — same hidden-in-feed treatment
                // as system notes. This also covers the streaming window where
                // the continue-marker user message exists only as an empty shell
                // (parts: []) or is mid-assembly via delta events: those must
                // never produce a blank/empty bubble in the visible stream.
                const isSilentContinue =
                  !isSystemNotification &&
                  cacheMsg !== undefined &&
                  (isSilentContinueMessage(cacheMsg) ||
                    isSilentContinueInProgress(cacheMsg) ||
                    (cacheMsg.info.role === "user" && cacheMsg.parts.length === 0));
                if (isSystemNotification || isSilentContinue) {
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
                // Use latched busy so copy/retry controls don't flicker during
                // transient idle/unknown blips. Only hide controls when the agent
                // is actively working (latched).
                const isTaskIdle = !isBusy;

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
                        interrupted={interrupted && isLastIndex}
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

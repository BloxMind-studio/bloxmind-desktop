import type { QuestionAnswer, SessionStatus } from "@opencode-ai/sdk/v2/client";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { ModelErrorCard, UsageLimitDialog } from "@/components/chat/ErrorViews";
import { LightboxProvider } from "@/components/chat/Lightbox";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { PermissionPrompt, QuestionPrompt } from "@/components/chat/Prompts";
import { BusyThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { TodoPanel } from "@/components/chat/TodoPanel";
import { useAnswerQuestion, useRejectQuestion } from "@/hooks/mutations/useAnswerQuestion";
import { useReplyPermission } from "@/hooks/mutations/useReplyPermission";
import { useCheckpointHistory } from "@/hooks/useCheckpointHistory";
import { useCheckpoints } from "@/hooks/useCheckpoints";
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
  // Extract the session status type early so we can pass it as a refresh
  // trigger to useCheckpointHistory. This ensures the hook re-fetches the
  // checkpoint list when the agent transitions between busy/idle (which is
  // when checkpoints are captured/restored). Without this, the checkpoint
  // badge and restore button would never appear after a capture.
  const sessionStatusType = sessionStatus?.type;
  const checkpoint = useCheckpointHistory(activeSessionId ?? undefined);
  const {
    capture: captureCheckpoint,
    validate: validateWorkspace,
    list: listCheckpoints,
    restore: restoreCheckpoint,
  } = useCheckpoints();

  // Pre-Execution Checkpoint: when the agent transitions to "busy"
  // (it's about to modify files for the latest message), capture a full
  // pre-task snapshot so auto-rollback always has a restore point.
  const previousStatusRef = useRef<SessionStatus | undefined>(undefined);
  const capturedForMessageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) {
      previousStatusRef.current = undefined;
      capturedForMessageRef.current = null;
      return;
    }
    const prev = previousStatusRef.current;
    previousStatusRef.current = sessionStatus;
    // Capture whenever the agent transitions into "busy" (from idle, error,
    // or the very first message of a session), once per message. Empty paths
    // → full-workspace journal snapshot (works with or without git).
    if (prev?.type !== "busy" && sessionStatusType === "busy") {
      const lastId = messageIds[messageIds.length - 1];
      if (!lastId || capturedForMessageRef.current === lastId) return;
      capturedForMessageRef.current = lastId;
      void captureCheckpoint({
        sessionId: activeSessionId,
        messageId: lastId,
        tool: "session.promptAsync",
        paths: [],
      })
        .then(() => {
          void checkpoint.refreshCheckpoints();
          // Retry once after a short delay: the capture IPC may have
          // resolved, but the file-system write can lag by ~1-2s on
          // Windows. Without this retry the button would flicker and
          // disappear when the stale empty list overwrites state.
          setTimeout(() => void checkpoint.refreshCheckpoints(), 600);
        })
        .catch((err: unknown) => {
          console.error("Pre-execution checkpoint capture failed:", err);
        });
    }
  }, [
    sessionStatusType,
    activeSessionId,
    messageIds,
    captureCheckpoint,
    sessionStatus,
    checkpoint.refreshCheckpoints,
  ]);

  // Auto-save a permanent checkpoint whenever the agent finishes a task
  useEffect(() => {
    if (sessionStatus?.type === "idle" && messageIds.length > 0) {
      // Debounce the save so we don't spam localStorage
      const timeout = setTimeout(() => checkpoint.saveCheckpoint(), 300);
      return () => clearTimeout(timeout);
    }
  }, [sessionStatus?.type, messageIds.length, checkpoint.saveCheckpoint]);

  // Automatic Rollback (Validation Failure): when the agent finishes a task,
  // run the validation pipeline. If it fails, restore the pre-execution file
  // checkpoint so broken code never stays in the workspace.
  useEffect(() => {
    if (sessionStatus?.type !== "idle" || !activeSessionId) return;
    if (messageIds.length === 0) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const validation = await validateWorkspace();
          if (cancelled) return;
          if (validation.ok) return;

          // Validation failed → find the latest FS checkpoint and restore it.
          const fsList = await listCheckpoints(activeSessionId);
          if (cancelled) return;
          if (fsList.length === 0) {
            toast.error(validation.logs.slice(0, 200), {
              description: "Build failed, but no checkpoint exists to restore.",
            });
            return;
          }
          const latest = fsList[fsList.length - 1];
          // Full-workspace pre-task snapshots can't safely preserve user
          // edits — this is an explicit auto-rollback, so bypass preservation
          // to avoid triggering the service's refusal guard (and a noisy IPC
          // error log).
          await restoreCheckpoint({
            checkpointId: latest.id,
            sessionId: activeSessionId,
            dryRun: false,
            preserveUserEdits: !latest.fullSnapshot,
          });
          if (cancelled) return;
          toast.error("Revalidating workspace…", {
            description:
              validation.logs.length > 0
                ? `Validation failed and files were restored to the last checkpoint. ${validation.logs.slice(0, 160)}`
                : "Validation failed and files were restored to the last checkpoint.",
          });
          void queryClient.invalidateQueries({ queryKey: qk.messages(activeSessionId) });
          void queryClient.invalidateQueries({ queryKey: qk.todos(activeSessionId) });
        } catch (err) {
          if (!cancelled) {
            console.error("Auto-validation failed to run:", err);
          }
        }
      })();
    }, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    sessionStatus?.type,
    activeSessionId,
    messageIds.length,
    queryClient,
    listCheckpoints,
    restoreCheckpoint,
    validateWorkspace,
  ]);

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
    lastScrollTop.current = currentScrollTop;
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
      if (!shouldAutoScroll.current) return;
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
          </div>
        </div>
      </LightboxProvider>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <LightboxProvider>
      <div
        ref={containerRef}
        data-chat-scroll
        onScroll={handleScroll}
        className="app-scrollbar flex-1 overflow-y-auto [overflow-anchor:none]"
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

              // The `!isLastIndex` guard is intentionally omitted: the
              // completed agent turn is always the last message, so excluding
              // it would hide the restore button right after every task
              // finishes. `isTaskIdle` already prevents the button from
              // appearing while the agent is still streaming.
              const showRestore = isLastOfTask && isTaskIdle;

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
                      checkpoint={checkpoint}
                      showRestore={showRestore}
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
    </LightboxProvider>
  );
}

export default ChatMessages;

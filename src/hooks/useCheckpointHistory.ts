import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCheckpoints } from "@/hooks/useCheckpoints";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { Checkpoint } from "@/types/checkpoints";

const CHECKPOINT_CAP = 10; // Max checkpoints to store in localStorage

interface CheckpointHistoryState {
  undoStack: string[];
  current: string | null;
  redoStack: string[];
}

function checkpointStorageKeys(sessionId: string) {
  return {
    list: `BloxMind:checkpoints:${sessionId}`,
    total: `BloxMind:checkpoints:total:${sessionId}`,
  };
}

function getCheckpointsFromStorage(sessionId: string): string[] {
  const keys = checkpointStorageKeys(sessionId);
  try {
    const raw = window.localStorage.getItem(keys.list);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // ignore malformed storage
  }
  return [];
}

/** Parses a cached MessagesCache JSON string, validating its shape so corrupt
 *  or truncated localStorage data can never crash rendering. Returns null when
 *  the value isn't a valid cache. */
function parseCache(serialized: string): MessagesCache | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      value !== null &&
      typeof value === "object" &&
      Array.isArray((value as { messageIds?: unknown }).messageIds) &&
      (value as { messageIds: unknown[] }).messageIds.every((id) => typeof id === "string") &&
      typeof (value as { messagesById?: unknown }).messagesById === "object" &&
      (value as { messagesById: unknown }).messagesById !== null
    ) {
      return value as MessagesCache;
    }
  } catch {
    // malformed JSON
  }
  return null;
}

/**
 * Applies a restored cache to the React Query client so the UI updates instantly.
 * Updates both the main message list cache AND every individual message cache
 * to force <MessageBubble> re-renders.
 */
function applyCacheToQueryClient(
  sessionId: string,
  cache: MessagesCache,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  // 1. Update the main list
  queryClient.setQueryData(qk.messages(sessionId), cache);

  // 2. Update every single message's individual cache to force re-renders
  cache.messageIds.forEach((messageId) => {
    const message = cache.messagesById[messageId];
    if (message) {
      queryClient.setQueryData(["message", sessionId, messageId], message);
    }
  });
}

export function useCheckpointHistory(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  const { client } = useOpenCodeClient();
  const checkpoints = useCheckpoints();

  // 1. State Management
  const [history, setHistory] = useState<CheckpointHistoryState>({
    undoStack: [],
    current: null,
    redoStack: [],
  });

  // Track checkpoint count as state so the UI re-renders when it changes
  const [checkpointCount, setCheckpointCount] = useState(0);
  // Track real file-system checkpoints for this session (git + journal)
  const [fsCheckpointCount, setFsCheckpointCount] = useState(0);
  // Cached copy of fsCheckpointCount that persists across re-fetches so the
  // UI never flickers to 0 while the list is being refreshed.
  const [cachedFsCheckpointCount, setCachedFsCheckpointCount] = useState(0);
  // Latest automatic FS checkpoint (metadata + affected paths for the badge).
  const [latestFsCheckpoint, setLatestFsCheckpoint] = useState<Checkpoint | null>(null);
  // Tracks whether the most recent file restore was live-synced to Roblox
  // Studio via Rojo. The RestoreCheckpointButton uses this to show a visual
  // indicator (green dot = synced, amber dot = not synced) so the user knows
  // at a glance whether Studio reflects the reverted code.
  const [lastRestoreSynced, setLastRestoreSynced] = useState<boolean | null>(null);
  // Tracks which checkpoint was restored via the button. When it matches the
  // latest checkpoint id, the button shows a "Restored" state and is disabled,
  // so the user can't re-restore the same checkpoint. It resets automatically
  // when a new checkpoint is captured for a new turn.
  const [restoredCheckpointId, setRestoredCheckpointId] = useState<string | null>(null);
  // Tracks the messageId of the task that was restored. Only the button
  // belonging to this specific message shows "Restored"; all others stay
  // "Restore files". Resets when a new checkpoint is captured.
  const [restoredMessageId, setRestoredMessageId] = useState<string | null>(null);

  // Only initialize localStorage-backed counts on session change.
  // File-system checkpoint state (fsCheckpointCount, latestFsCheckpoint)
  // is refreshed explicitly via refreshCheckpoints() after captures and
  // restores. Keeping the list-fetch out of this effect eliminates the
  // race where a session-change-triggered fetch overwrites correct state
  // with a stale empty result while a capture is still being persisted.
  useEffect(() => {
    if (!sessionId) {
      setCheckpointCount(0);
      setFsCheckpointCount(0);
      // Clear the cached badge count too — otherwise a stale cached value
      // would survive session switches and leak between conversations.
      setCachedFsCheckpointCount(0);
      setLatestFsCheckpoint(null);
      setRestoredCheckpointId(null);
      return;
    }
    setCheckpointCount(getCheckpointsFromStorage(sessionId).length);
  }, [sessionId]);

  // Keep the latest checkpoints service in a ref so `refreshCheckpoints`
  // stays referentially stable across re-renders (the service object is
  // recreated per render, which previously forced the callback — and every
  // effect depending on it — to be torn down and re-run on each render).
  const checkpointsRef = useRef(checkpoints);
  checkpointsRef.current = checkpoints;

  /** Re-fetch the checkpoint list from the main process and update state. */
  const refreshCheckpoints = useCallback(async () => {
    if (!sessionId) return;
    try {
      const list = await checkpointsRef.current.list(sessionId);
      setFsCheckpointCount(list.length);
      if (list.length > 0) setCachedFsCheckpointCount(list.length);
      const latest = list.length > 0 ? list[list.length - 1] : null;
      setLatestFsCheckpoint(latest);
      setRestoredCheckpointId((prev) => (prev && latest && prev !== latest.id ? null : prev));
      // Reset the restored message marker when a new checkpoint arrives
      // so previous task buttons revert to "Restore files".
      setRestoredMessageId((prev) =>
        prev && latest?.messageId && prev !== latest.messageId ? null : prev,
      );
    } catch {
      // Keep last-known counts on transient failures.
    }
  }, [sessionId]);

  // Hydrate FS checkpoint state whenever the active session changes (and on
  // first mount). Without this, counts stay at their initial 0 after an app
  // restart even though checkpoints persist on disk — leaving the Checkpoint
  // badge and Restore button permanently invisible until a NEW capture runs.
  useEffect(() => {
    if (!sessionId) return;
    void refreshCheckpoints();
  }, [sessionId, refreshCheckpoints]);

  /** Restore the latest FS checkpoint for a specific message (full file rollback). */
  const restoreLatestFileCheckpoint = useCallback(
    async (targetMessageId: string) => {
      if (!sessionId) return null;
      // 1. Instantly switch UI state synchronously so the correct button
      // shows "Restored" immediately, eliminating the race where clicking
      // another task before the IPC resolves leaves stale "Restored" state.
      setRestoredMessageId(targetMessageId);
      try {
        const fsList = await checkpoints.list(sessionId);
        if (fsList.length === 0) {
          setRestoredMessageId(null);
          return null;
        }
        // Find the checkpoint whose messageId matches the target, so clicking
        // "Restore" on an older message restores that specific checkpoint
        // instead of always restoring the latest one.
        const targetCheckpoint =
          fsList.find((c) => c.messageId === targetMessageId) ?? fsList[fsList.length - 1];
        // Full-workspace pre-task snapshots can't safely preserve user edits —
        // this is an explicit rollback, so bypass preservation for them to avoid
        // triggering the service's refusal guard (and a noisy IPC error log).
        const result: Awaited<ReturnType<typeof checkpoints.restore>> = await checkpoints.restore({
          checkpointId: targetCheckpoint.id,
          sessionId,
          dryRun: false,
          preserveUserEdits: !targetCheckpoint.fullSnapshot,
        });

        // Rewind the agent's conversation context to the restored checkpoint
        // automatically, so the user never has to type a manual "continue from
        // this point" message after restoring. The checkpoint's messageId is
        // the prompt that started the task; reverting the FIRST message after
        // it keeps that prompt active while dropping the reverted work from
        // the agent's context. Reverted messages are only marked, not
        // deleted, so the Redo flow (session.unrevert) can bring them back.
        // This replaces the old session.prompt() injection, which surfaced a
        // noisy system message in the chat and triggered an agent reply.
        //
        // SAFETY GATE: session.revert also rolls workspace files back to the
        // pre-message snapshot and does NOT preserve post-checkpoint user
        // edits. Full-snapshot restores already bypass edit preservation
        // (explicit rollback), so the rewind adds no extra risk there. For
        // incremental checkpoints the restore above deliberately keeps user
        // edits, and the rewind would wipe them again — so it is skipped.
        let contextRewound = false;
        if (client && targetCheckpoint.messageId && targetCheckpoint.fullSnapshot) {
          try {
            const cache = queryClient.getQueryData<MessagesCache>(qk.messages(sessionId));
            const ids = cache?.messageIds ?? [];
            const anchorIndex = ids.indexOf(targetCheckpoint.messageId);
            const firstAfterCheckpoint = anchorIndex >= 0 ? ids[anchorIndex + 1] : undefined;
            if (firstAfterCheckpoint) {
              await client.session.revert(
                { sessionID: sessionId, messageID: firstAfterCheckpoint },
                { throwOnError: true },
              );
              contextRewound = true;
            }
          } catch (contextErr) {
            // Context rewind is best-effort: the files are already restored,
            // so a failed revert only means the agent may still see the
            // pre-restore conversation context.
            console.error("Failed to rewind agent context after restore:", contextErr);
          }
        }

        // Refresh messages after a real file restore
        void queryClient.invalidateQueries({ queryKey: qk.messages(sessionId) });
        void queryClient.invalidateQueries({ queryKey: qk.todos(sessionId) });
        // Subtle status: confirm when the reverted files were live-synced to
        // Roblox Studio via the running & connected Rojo server, and mention
        // when the agent context was rewound automatically (no manual
        // follow-up message needed).
        const contextNote = contextRewound
          ? "The agent's context was automatically rewound to this checkpoint."
          : undefined;
        if (result?.rojoSynced) {
          toast.success(result.message ?? `Reverted to Checkpoint ${result.restoredId}`, {
            description: contextNote,
          });
        } else if (result) {
          toast.info(result.message ?? `Reverted to Checkpoint ${result.restoredId}`, {
            description:
              "Roblox Studio isn't connected to Rojo — connect via the Rojo plugin to see the reverted code." +
              (contextNote ? ` ${contextNote}` : ""),
          });
        }
        setLastRestoreSynced(result?.rojoSynced ?? false);
        if (result) {
          setRestoredCheckpointId(result.restoredId);
          setRestoredMessageId(targetCheckpoint.messageId ?? null);
        }
        return result;
      } catch (err) {
        // Rollback on failure so the button returns to "Restore files".
        setRestoredMessageId(null);
        console.error("Failed to restore file checkpoint:", err);
        toast.error("Couldn't restore files", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
        return null;
      }
    },
    [sessionId, checkpoints, queryClient, client],
  );

  // 2. Save to LocalStorage (Persistent)
  const saveCheckpoint = useCallback(() => {
    if (!sessionId) return;
    const cache = queryClient.getQueryData<MessagesCache>(qk.messages(sessionId));
    if (!cache || cache.messageIds.length === 0) return;

    // Serialize cache for storage
    const serialized = JSON.stringify(cache);

    // Retrieve existing checkpoints
    const list = getCheckpointsFromStorage(sessionId);

    // Add new checkpoint and limit size
    list.push(serialized);
    if (list.length > CHECKPOINT_CAP) list.shift();

    const keys = checkpointStorageKeys(sessionId);
    try {
      window.localStorage.setItem(keys.list, JSON.stringify(list));
      window.localStorage.setItem(keys.total, String(list.length));
      setCheckpointCount(list.length);
    } catch {
      // quota exceeded - silently fail
    }
  }, [sessionId, queryClient]);

  // 3. Restore from LocalStorage (Persistent)
  const restoreCheckpoint = useCallback(
    (index?: number) => {
      if (!sessionId) return;

      const list = getCheckpointsFromStorage(sessionId);
      if (list.length === 0) return;

      // Default to latest checkpoint if no index provided
      const targetIndex = index ?? list.length - 1;
      if (targetIndex < 0 || targetIndex >= list.length) return;

      try {
        const cache = parseCache(list[targetIndex]);
        if (!cache) return;

        // Capture the current message IDs BEFORE applying the checkpoint,
        // so we can pass the correct messageID to the revert API.
        const currentCache = queryClient.getQueryData<MessagesCache>(qk.messages(sessionId));
        const currentMessageIds = currentCache?.messageIds ?? [];
        const checkpointMessageIds = new Set(cache.messageIds);
        // Find the first message that exists now but wasn't in the checkpoint.
        const messageToRevert = currentMessageIds.find((id) => !checkpointMessageIds.has(id));

        applyCacheToQueryClient(sessionId, cache, queryClient);

        // Also call OpenCode's revert API to undo actual code changes
        // so Roblox Studio matches the restored checkpoint state.
        // The revert API requires a messageID in the body — without it the
        // server rejects the request with "Expected object, got undefined".
        if (client && messageToRevert) {
          client.session
            .revert({ sessionID: sessionId, messageID: messageToRevert }, { throwOnError: false })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: qk.messages(sessionId) });
              void queryClient.invalidateQueries({ queryKey: qk.todos(sessionId) });
            })
            .catch((err: unknown) => {
              console.error("Revert during checkpoint restore failed:", err);
              toast.error("Couldn't restore code changes in Studio", {
                description: err instanceof Error ? err.message : "Unknown error",
              });
            });
        }
      } catch (e) {
        console.error("Failed to restore checkpoint:", e);
      }
    },
    [sessionId, queryClient, client],
  );

  // 4. In-Memory Undo/Redo (Ephemeral)
  const saveToHistory = useCallback(() => {
    if (!sessionId) return;
    const cache = queryClient.getQueryData<MessagesCache>(qk.messages(sessionId));
    if (!cache) return;

    setHistory((prev) => ({
      undoStack: prev.current ? [...prev.undoStack, prev.current].slice(-20) : prev.undoStack,
      current: JSON.stringify(cache),
      redoStack: [], // Clear redo stack on new action
    }));
  }, [sessionId, queryClient]);

  const undo = useCallback(() => {
    if (!sessionId) return;
    setHistory((prev) => {
      if (prev.undoStack.length === 0) return prev;

      const newUndoStack = [...prev.undoStack];
      const previousState = newUndoStack.pop();
      if (previousState === undefined) return prev;

      // Capture the current message IDs BEFORE applying the previous state,
      // so we can pass the correct messageID to the revert API.
      const currentCache = queryClient.getQueryData<MessagesCache>(qk.messages(sessionId));
      const currentMessageIds = currentCache?.messageIds ?? [];

      // Parse previous state to find which messages are new
      const cache = parseCache(previousState);
      if (!cache) return prev;
      const previousMessageIds = new Set(cache.messageIds);
      // Find the first message that exists now but won't exist after undo.
      const messageToRevert = currentMessageIds.find((id) => !previousMessageIds.has(id));

      // Apply previous UI state
      applyCacheToQueryClient(sessionId, cache, queryClient);

      // Call OpenCode's revert API to undo actual code/file changes
      // in Roblox Studio. This reverts the last assistant message's effects.
      // The revert API requires a messageID in the body — without it the
      // server rejects the request with "Expected object, got undefined".
      if (client && messageToRevert) {
        client.session
          .revert({ sessionID: sessionId, messageID: messageToRevert }, { throwOnError: false })
          .then(() => {
            // Invalidate to refresh from server after revert
            void queryClient.invalidateQueries({ queryKey: qk.messages(sessionId) });
            void queryClient.invalidateQueries({ queryKey: qk.todos(sessionId) });
          })
          .catch((err: unknown) => {
            console.error("Revert API call failed:", err);
            toast.error("Couldn't undo code changes in Studio", {
              description: err instanceof Error ? err.message : "Unknown error",
            });
          });
      }

      return {
        undoStack: newUndoStack,
        current: previousState,
        redoStack: prev.current ? [...prev.redoStack, prev.current] : prev.redoStack,
      };
    });
  }, [sessionId, queryClient, client]);

  const redo = useCallback(() => {
    if (!sessionId) return;
    setHistory((prev) => {
      if (prev.redoStack.length === 0) return prev;

      const newRedoStack = [...prev.redoStack];
      const nextState = newRedoStack.pop();
      if (nextState === undefined) return prev;

      // Apply next UI state
      const cache = parseCache(nextState);
      if (!cache) return prev;
      applyCacheToQueryClient(sessionId, cache, queryClient);

      // Call OpenCode's unrevert API to redo the code/file changes
      // that were undone by a previous revert.
      if (client) {
        client.session
          .unrevert({ sessionID: sessionId }, { throwOnError: false })
          .then(() => {
            // Invalidate to refresh from server after unrevert
            void queryClient.invalidateQueries({ queryKey: qk.messages(sessionId) });
            void queryClient.invalidateQueries({ queryKey: qk.todos(sessionId) });
          })
          .catch((err: unknown) => {
            console.error("Unrevert API call failed:", err);
            toast.error("Couldn't redo code changes in Studio", {
              description: err instanceof Error ? err.message : "Unknown error",
            });
          });
      }

      return {
        undoStack: prev.current ? [...prev.undoStack, prev.current] : prev.undoStack,
        current: nextState,
        redoStack: newRedoStack,
      };
    });
  }, [sessionId, queryClient, client]);

  return useMemo(
    () => ({
      canUndo: history.undoStack.length > 0,
      canRedo: history.redoStack.length > 0,
      undo,
      redo,
      saveToHistory,
      saveCheckpoint,
      restoreCheckpoint,
      restoreLatestFileCheckpoint,
      refreshCheckpoints,
      checkpointCount,
      fsCheckpointCount,
      cachedFsCheckpointCount,
      latestFsCheckpoint,
      lastRestoreSynced,
      restoredCheckpointId,
      restoredMessageId,
    }),
    [
      history.undoStack.length,
      history.redoStack.length,
      undo,
      redo,
      saveToHistory,
      saveCheckpoint,
      restoreCheckpoint,
      restoreLatestFileCheckpoint,
      refreshCheckpoints,
      checkpointCount,
      fsCheckpointCount,
      cachedFsCheckpointCount,
      latestFsCheckpoint,
      lastRestoreSynced,
      restoredCheckpointId,
      restoredMessageId,
    ],
  );
}

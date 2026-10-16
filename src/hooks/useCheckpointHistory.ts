import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCheckpoints } from "@/hooks/useCheckpoints";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { Checkpoint } from "@/types/checkpoints";

/**
 * Renderer-side checkpoint history for the active session.
 *
 * Checkpoint *data* is persisted on disk by the main process, but the UI
 * deliberately mirrors only checkpoints captured during THIS app run, in RAM:
 *  - After a restart, checkpoints from a previous run must not surface any UI.
 *    A stale "Restore files" offer against a workspace the user has since
 *    edited is worse than no offer at all.
 *  - Nothing is read from or written to localStorage; closing the app clears
 *    the history by construction.
 *
 * The view re-syncs to the RAM map whenever the active session changes, and
 * checkpoint UI only appears once a capture for the current run has resolved.
 */
export function useCheckpointHistory(sessionId: string | undefined) {
  const checkpoints = useCheckpoints();
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  // Checkpoints captured this run, keyed by session id.
  const liveCheckpointsRef = useRef(new Map<string, Checkpoint[]>());
  // RAM view of the active session's live checkpoints.
  const [liveCheckpoints, setLiveCheckpoints] = useState<Checkpoint[]>([]);
  // Tracks the messageId of the task that was restored. Only the button
  // belonging to this specific message shows "Restored"; all others stay
  // "Restore files". Resets when a new checkpoint is captured or the user
  // switches sessions.
  const [restoredMessageId, setRestoredMessageId] = useState<string | null>(null);

  const syncFromRam = useCallback((id: string | undefined) => {
    setLiveCheckpoints(id ? (liveCheckpointsRef.current.get(id) ?? []) : []);
    setRestoredMessageId(null);
  }, []);

  // Re-sync (and clear restore markers) whenever the active session changes.
  useEffect(() => {
    syncFromRam(sessionId);
  }, [sessionId, syncFromRam]);

  /**
   * Record a checkpoint that was just captured this run. Called by the
   * pre-execution capture effect; captures that fail never reach this point,
   * so a failed capture surfaces no UI.
   */
  const recordCapturedCheckpoint = useCallback(
    (checkpoint: Checkpoint) => {
      const list = liveCheckpointsRef.current.get(checkpoint.sessionId) ?? [];
      const existingIndex = list.findIndex(
        (entry) => entry.messageId !== null && entry.messageId === checkpoint.messageId,
      );
      if (existingIndex >= 0) list[existingIndex] = checkpoint;
      else list.push(checkpoint);
      liveCheckpointsRef.current.set(checkpoint.sessionId, list);
      if (checkpoint.sessionId !== sessionId) return;
      setLiveCheckpoints([...list]);
      // A new capture belongs to a new turn: previous "Restored" markers
      // revert to "Restore files".
      setRestoredMessageId(null);
    },
    [sessionId],
  );

  /** Restore the latest live checkpoint for a specific message (full file rollback). */
  const restoreLatestFileCheckpoint = useCallback(
    async (targetMessageId: string) => {
      if (!sessionId) return null;
      // 1. Instantly switch UI state synchronously so the correct button
      // shows "Restored" immediately, eliminating the race where clicking
      // another task before the IPC resolves leaves stale "Restored" state.
      setRestoredMessageId(targetMessageId);
      try {
        const live = liveCheckpointsRef.current.get(sessionId) ?? [];
        // Find the checkpoint whose messageId matches the target, so clicking
        // "Restore" on an older message restores that specific checkpoint
        // instead of always restoring the latest one.
        const targetCheckpoint =
          live.find((c) => c.messageId === targetMessageId) ?? live[live.length - 1];
        if (!targetCheckpoint) {
          setRestoredMessageId(null);
          return null;
        }
        // Full-workspace pre-task snapshots can't safely preserve user edits —
        // this is an explicit rollback, so bypass preservation for them to avoid
        // triggering the service's refusal guard (and a noisy IPC error log).
        const result: Awaited<ReturnType<typeof checkpoints.restore>> = await checkpoints.restore({
          checkpointId: targetCheckpoint.id,
          sessionId,
          dryRun: false,
          preserveUserEdits: !targetCheckpoint.fullSnapshot,
        });

        // NOTE: The restore is filesystem-only. We deliberately do NOT call
        // client.session.revert() here — that OpenCode runtime call rewinds
        // the agent's context window and truncates the session's messages,
        // which would delete chat history. The checkpoint restore above
        // (git checkout + journal restore) already reverts the files on disk.

        // Align the agent's runtime context with the restored codebase state.
        // The files on disk were reverted (e.g. settings like "jump height")
        // but the session context still reflects the newer messages. Inject a
        // silent system-level context update so future prompts inspect the
        // current on-disk code rather than stale chat-derived values.
        if (client && result && targetCheckpoint.messageId) {
          try {
            await client.session.prompt({
              sessionID: sessionId,
              parts: [
                {
                  type: "text",
                  text: `[SYSTEM_NOTIFICATION_RESTORE]: The user has restored project files back to checkpoint "${targetCheckpoint.messageId}". Note that subsequent code changes in the chat history have been reverted on disk. Always inspect the current codebase and respect this restored point for any performance parameters, script values, and future edits.`,
                },
              ],
            });
          } catch (contextErr) {
            // Context injection is best-effort; don't fail the restore if the
            // agent runtime rejects it.
            console.error("Failed to inject restore context into agent:", contextErr);
          }
        }

        // Refresh messages after a real file restore
        void queryClient.invalidateQueries({ queryKey: qk.messages(sessionId) });
        void queryClient.invalidateQueries({ queryKey: qk.todos(sessionId) });
        if (result) {
          toast.success(result.message ?? `Reverted to Checkpoint ${result.restoredId}`);
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

  return {
    liveCheckpoints,
    recordCapturedCheckpoint,
    restoreLatestFileCheckpoint,
    fsCheckpointCount: liveCheckpoints.length,
    latestFsCheckpoint:
      liveCheckpoints.length > 0 ? liveCheckpoints[liveCheckpoints.length - 1] : null,
    restoredMessageId,
  };
}

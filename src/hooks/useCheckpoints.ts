import { useCallback, useMemo } from "react";
import { desktop } from "@/lib/desktop";
import type {
  CaptureContext,
  Checkpoint,
  CheckpointRestoreInput,
  CheckpointRestoreResult,
  RestorePreview,
  ValidationResult,
} from "@/types/checkpoints";

/**
 * Renderer hook for the checkpoint/rollback system.
 * All git/fs operations are performed by the Electron main process via IPC.
 *
 * The returned object is memoized so callers can safely use it as a useEffect
 * dependency without the effect re-firing on every render (which would cause
 * constant IPC round-trips and potentially reset state to 0 on transient
 * failures).
 */
export function useCheckpoints() {
  const capture = useCallback(async (context: CaptureContext): Promise<Checkpoint> => {
    return desktop.checkpointCapture(context);
  }, []);

  const restore = useCallback(
    async (input: CheckpointRestoreInput): Promise<CheckpointRestoreResult> => {
      return desktop.checkpointRestore(input);
    },
    [],
  );

  const preview = useCallback(
    async (checkpointId: string, sessionId: string): Promise<RestorePreview> => {
      return desktop.checkpointPreview(checkpointId, sessionId);
    },
    [],
  );

  const list = useCallback(async (sessionId: string): Promise<Checkpoint[]> => {
    return desktop.checkpointList(sessionId);
  }, []);

  const validate = useCallback(async (): Promise<ValidationResult> => {
    return desktop.checkpointValidate();
  }, []);

  return useMemo(
    () => ({ capture, restore, preview, list, validate }),
    [capture, restore, preview, list, validate],
  );
}

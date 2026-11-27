import { useCallback, useSyncExternalStore } from "react";
import {
  isSessionAutoAllow,
  setSessionAutoAllow,
  subscribeSessionAutoAllow,
} from "@/lib/sessionAutoAllow";

/** Whether the current chat may answer its own permission requests. */
export function useSessionAutoAllow(sessionID: string | null) {
  const enabled = useSyncExternalStore(
    subscribeSessionAutoAllow,
    () => isSessionAutoAllow(sessionID),
    () => false,
  );
  const setEnabled = useCallback(
    (next: boolean) => setSessionAutoAllow(sessionID, next),
    [sessionID],
  );
  return { enabled, setEnabled };
}

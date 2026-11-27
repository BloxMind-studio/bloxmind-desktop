/**
 * "Always allow (this session)" is kept in the app, not in OpenCode: the engine's `always` reply
 * saves an approval for good, while this flag lives only until the app closes and is keyed by chat.
 */
const allowedSessions = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function isSessionAutoAllow(sessionID: string | null): boolean {
  return !!sessionID && allowedSessions.has(sessionID);
}

export function setSessionAutoAllow(sessionID: string | null, enabled: boolean): void {
  if (!sessionID) return;
  if (enabled) allowedSessions.add(sessionID);
  else allowedSessions.delete(sessionID);
  notify();
}

export function subscribeSessionAutoAllow(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Account-wide actions are always a separate decision, even within a trusted chat. */
export function canAutoAllow(permission: string): boolean {
  return !permission.endsWith("upload_image") && !permission.endsWith("open_cloud_invoke");
}

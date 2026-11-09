import type { Session } from "@/lib/opencode";

export function isVisibleSession(session: Session): boolean {
  return session.metadata?.BloxMindHidden !== true;
}

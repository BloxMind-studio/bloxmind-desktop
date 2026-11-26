import type { QueryClient } from "@tanstack/react-query";
import { isWindowFocused, notify } from "@/lib/notifications";
import type { Session, SessionStatus } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import { isVisibleSession } from "@/lib/sessionVisibility";
import { maybeShowStarCallout } from "@/lib/starCallout";

type OpenSession = (sessionID: string) => void;

let openSession: OpenSession = () => {};
let chatOnScreen = true;

/** Set by Chat. Settings and setup screens cover the active chat, so it can't be seen there. */
export function setChatOnScreen(onScreen: boolean): void {
  chatOnScreen = onScreen;
}

/** Set by Chat, which can leave Settings too and sits below the provider reading the event stream. */
export function setSessionOpener(opener: OpenSession): void {
  openSession = opener;
}

function eventData(event: unknown): Record<string, any> {
  const e = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = e.data ?? e.properties;
  return data && typeof data === "object" ? (data as Record<string, any>) : {};
}

function eventType(event: unknown): string {
  const e = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  return typeof e.type === "string" ? e.type : "";
}

/**
 * Turns chat events into notifications. A chat the user is looking at already shows all of this,
 * so it only speaks up when the window is in the background or the event is for another chat.
 */
export class SessionNotifier {
  private readonly busySessions = new Set<string>();

  /** A turn that started before the event stream did never reports its start. */
  trackRunning(statuses: Record<string, SessionStatus> | undefined): void {
    for (const [sessionID, status] of Object.entries(statuses ?? {})) {
      if (status.type !== "idle") this.busySessions.add(sessionID);
    }
  }

  handleEvent(
    queryClient: QueryClient,
    event: unknown,
    activeSessionIdRef: { current: string | null },
  ): void {
    const type = eventType(event);
    const data = eventData(event);

    // Helper chats are hidden and subagent chats belong to their parent, so neither counts.
    const userChat = (sessionID: string) => {
      const session = queryClient
        .getQueryData<Session[]>(qk.sessions)
        ?.find((candidate) => candidate.id === sessionID);
      return session && isVisibleSession(session) && !session.parentID ? session : undefined;
    };

    const announce = (sessionID: string, name: string, title: string, tone?: "error") => {
      const session = userChat(sessionID);
      if (!session) return;
      if (isWindowFocused() && chatOnScreen && sessionID === activeSessionIdRef.current) return;
      notify.attention(title, {
        name,
        description: session.title,
        tone,
        open: { label: "Open", onClick: () => openSession(sessionID) },
      });
    };

    const finish = (sessionID: string) => {
      // OpenCode reports the end of a turn twice, as an idle status and as session.idle.
      if (!this.busySessions.delete(sessionID)) return;
      announce(sessionID, "chat_finished", "Chat finished");
      if (!userChat(sessionID)) return;
      maybeShowStarCallout().catch((error) => {
        console.warn("Failed to show the GitHub callout:", error);
      });
    };

    switch (type) {
      case "session.status": {
        const { sessionID, status } = data;
        if (!sessionID || !status) break;
        if (status.type === "idle") finish(sessionID);
        else this.busySessions.add(sessionID);
        break;
      }
      case "session.idle":
        if (data.sessionID) finish(data.sessionID);
        break;
      case "session.error":
      case "session.execution.failed": {
        const sessionID = data.sessionID ?? activeSessionIdRef.current;
        if (!sessionID) break;
        // Forgetting the turn here keeps the idle event that follows from also saying it finished.
        this.busySessions.delete(sessionID);
        const error = data.error;
        if (error && error.name !== "MessageAbortedError" && error.type !== "MessageAbortedError") {
          announce(sessionID, "chat_failed", "Chat ran into a problem", "error");
        }
        break;
      }
      case "question.asked":
      case "form.created":
        if (data.sessionID) announce(data.sessionID, "chat_question", "BloxBot has a question");
        break;
      case "permission.asked":
        if (data.sessionID) {
          announce(data.sessionID, "chat_permission", "BloxMind needs your approval");
        }
        break;
    }
  }
}

export const sessionNotifier = new SessionNotifier();

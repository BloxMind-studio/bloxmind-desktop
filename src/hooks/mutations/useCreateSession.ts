import type { Session } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";

import { analyticsProperties, errorAnalyticsProperties } from "@/lib/analytics";
import { desktop } from "@/lib/desktop";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

const SESSION_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * OpenCode session ids look like `ses_` + 26 base62 chars. Generating the id
 * client-side lets us create the session's isolated workspace directory BEFORE
 * the session exists and pass it as the session location from the start.
 */
export function generateSessionId(): string {
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);
  let id = "ses_";
  for (const byte of bytes) id += SESSION_ID_ALPHABET[byte % SESSION_ID_ALPHABET.length];
  return id;
}

export function useCreateSession() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { selectSession } = useActiveSession();

  return useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("No client");

      // Prefer creating the session pointed directly at its own isolated
      // workspace (POST /api/session) so Rojo sync and the OpenCode engine
      // operate on exactly this session's files. Falls back to a plain
      // workspace session when the desktop bridge or v2 API is unavailable
      // (e.g. browser-only or an older engine).
      const sessionID = generateSessionId();
      let directory: string | null = null;
      try {
        directory = await desktop.prepareSessionWorkspace(sessionID);
      } catch {
        directory = null;
      }

      if (directory) {
        try {
          const created = await client.v2.session.create(
            { id: sessionID, location: { directory } },
            { throwOnError: true },
          );
          if (!created.data) throw new Error("No data");
          const createdInfo = created.data.data;
          // Fetch through the v1 session API so the cached object matches the
          // Session shape the rest of the app expects.
          const fetched = await client.session.get(
            { sessionID: createdInfo.id },
            { throwOnError: true },
          );
          return fetched.data ?? (createdInfo as unknown as Session);
        } catch (error) {
          console.warn("Isolated session creation failed, falling back:", error);
        }
      }

      const res = await client.session.create({}, { throwOnError: true });
      if (!res.data) throw new Error("No data");
      return res.data;
    },
    onSuccess: (newSession: Session) => {
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return [newSession];
        if (prev.some((s) => s.id === newSession.id)) return prev;
        return [newSession, ...prev];
      });

      // Persist a durable shell immediately. A brand-new session has no
      // messages yet, and the persistence hook deliberately skips empties —
      // without this shell the session lives only in engine memory, so any
      // transient listing failure made freshly created chats vanish from the
      // sidebar. Later saves overwrite this file as messages arrive.
      void desktop
        .sessionStoreSave({
          id: newSession.id,
          title: newSession.title ?? "New session",
          createdAt: Math.floor((newSession.time?.created ?? Date.now() / 1000) * 1000),
          updatedAt: Date.now(),
          messages: { messageIds: [], messagesById: {} },
          metadata: { ...(newSession.metadata ?? {}) },
        })
        .catch(() => undefined);

      // Clear messages/todos/questions/permissions for new session
      queryClient.setQueryData(qk.messages(newSession.id), {
        messageIds: [],
        messagesById: {},
      });
      queryClient.setQueryData(qk.todos(newSession.id), []);
      queryClient.setQueryData(qk.questions(newSession.id), null);
      queryClient.setQueryData(qk.permissions(newSession.id), null);

      selectSession(newSession.id);
      posthog.capture("session_created", analyticsProperties("sessions", { outcome: "success" }));
    },
    onError: (error) =>
      posthog.capture(
        "session_creation_failed",
        errorAnalyticsProperties("sessions", "creation", error),
      ),
  });
}

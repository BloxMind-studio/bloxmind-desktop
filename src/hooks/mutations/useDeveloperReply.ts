import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";

import {
  APP_DEVELOPER_SCHEMA,
  APP_DEVELOPER_SYSTEM_PROMPT,
  APP_DEVELOPER_TEXT_SYSTEM_PROMPT,
  type DeveloperReply,
  developerTranscript,
  GAME_DEVELOPER_SYSTEM_PROMPT,
  GAME_DEVELOPER_TEXT_SYSTEM_PROMPT,
  resolveDeveloperReply,
} from "@/lib/appsBuilder/developer";
import { startStreamingDeltas } from "@/lib/appsBuilder/stream";
import type { AppChatMessage, AppProject } from "@/lib/appsBuilder/types";
import { splitModelKey } from "@/lib/splitModelKey";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";

/** True when a resolveDeveloperReply failure is a structured-output problem. */
function isStructuredOutputFailure(error: Error): boolean {
  return /structured output|invalid app project|empty response/i.test(error.message);
}

/** True when the prompt was aborted without a reason (the user hit Stop). */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** How long a conversational turn may run before it's treated as wedged. */
const REPLY_TIMEOUT_MS = 60_000;

export interface UseDeveloperReplyInput {
  /** The user's latest message. */
  message: string;
  /** Prior chat messages, handed to the model for conversational context. */
  history: readonly AppChatMessage[];
  /**
   * When set, an app is already built and running — the model must treat this
   * message as a change request to that app, not a new build.
   */
  existing?: AppProject | null;
}

export interface UseDeveloperReplyOptions {
  /**
   * Reports the running assistant reply text as the temp session streams, so
   * the studio can render a live typing bubble instead of a cursor wait.
   */
  onDeltas?: (accumulated: string) => void;
  /**
   * When true, uses the game-flavored designer prompts (Games Studio). Defaults
   * to the app-flavored developer prompts (Apps Studio).
   */
  game?: boolean;
}

/**
 * React Query mutation that runs one conversational turn with the AI in a
 * throwaway private session. The model replies like a senior developer and
 * flags whether the user has actually cleared the app to be built. Resolves
 * with null when the turn was cancelled.
 */
export function useDeveloperReply(options?: UseDeveloperReplyOptions) {
  const { client } = useOpenCodeClient();
  const { selectedModel, selectedVariant } = useModelPreferences();
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const onDeltasRef = useRef(options?.onDeltas);
  onDeltasRef.current = options?.onDeltas;
  const gameRef = useRef(options?.game ?? false);
  gameRef.current = options?.game ?? false;

  const mutation = useMutation({
    mutationKey: ["apps-developer-reply"],
    mutationFn: async (input: UseDeveloperReplyInput): Promise<DeveloperReply | null> => {
      if (!client) throw new Error("The AI engine isn't ready yet.");
      const trimmed = input.message.trim();
      if (!trimmed) throw new Error("Say something first.");

      let model: { providerID: string; modelID: string } | undefined;
      if (selectedModel) {
        const [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) model = { providerID, modelID };
      }

      // Created up-front so pressing Stop during setup cancels cleanly too,
      // and the watchdog below guarantees the mutation always settles.
      const controller = new AbortController();
      abortRef.current = controller;
      stoppedRef.current = false;
      let disposedSessionID: string | null = null;
      let deltaController: AbortController | null = null;
      let deltas: { stop: () => Promise<void> } | null = null;
      const timer = setTimeout(
        () => controller.abort(new Error("The developer took too long to respond. Try again.")),
        REPLY_TIMEOUT_MS,
      );

      try {
        const created = await client.session.create(
          {
            title: "App chat (temporary)",
            metadata: { BloxMindHidden: true, purpose: "apps-builder-chat" },
            permission: [{ permission: "*", pattern: "*", action: "deny" }],
          },
          { throwOnError: true, signal: controller.signal },
        );
        const sessionID = created.data?.id ?? null;
        if (!sessionID) throw new Error("Couldn't start the app chat.");
        sessionRef.current = sessionID;
        disposedSessionID = sessionID;

        // Drive a live typing bubble from the temp session's own stream. A
        // second SSE subscription (the provider's global one drops hidden
        // sessions); best-effort and never allowed to fail the turn.
        deltaController = new AbortController();
        deltas = startStreamingDeltas(
          () => client.event.subscribe({}, { throwOnError: true, signal: deltaController?.signal }),
          sessionID,
          (accumulated) => onDeltasRef.current?.(accumulated),
          deltaController.signal,
        );

        const transcript = developerTranscript(input.history);
        const existingNote = input.existing
          ? `CURRENT STATE\n${gameRef.current ? "A game" : "An app"} named "${input.existing.name}" (${input.existing.files.length} files) is already built and running in the preview. The user's message below is a change request to that existing ${gameRef.current ? "game" : "app"} — not a new build.`
          : "";
        const transcriptPart = transcript ? `CONVERSATION SO FAR\n${transcript}` : "";
        const promptText = [`USER MESSAGE\n${trimmed}`, existingNote, transcriptPart]
          .filter(Boolean)
          .join("\n\n");

        const run = (useSchema: boolean) =>
          client.session
            .prompt(
              {
                sessionID,
                model,
                agent: "apps",
                variant: selectedVariant ?? undefined,
                ...(useSchema
                  ? {
                      format: { type: "json_schema", schema: APP_DEVELOPER_SCHEMA, retryCount: 2 },
                      system: gameRef.current
                        ? GAME_DEVELOPER_SYSTEM_PROMPT
                        : APP_DEVELOPER_SYSTEM_PROMPT,
                    }
                  : {
                      system: gameRef.current
                        ? GAME_DEVELOPER_TEXT_SYSTEM_PROMPT
                        : APP_DEVELOPER_TEXT_SYSTEM_PROMPT,
                    }),
                parts: [{ type: "text", text: promptText }],
              },
              { throwOnError: true, signal: controller.signal },
            )
            .then((response) => resolveDeveloperReply(response.data?.info, response.data?.parts));

        try {
          return await run(true);
        } catch (error) {
          // After a stop the session is being torn down — never fall back.
          if (stoppedRef.current) throw error;
          // Never fall back on an engine/plumbing failure; only when the model
          // couldn't emit structured output in the first place.
          if (!(error instanceof Error) || !isStructuredOutputFailure(error)) throw error;
        }
        return await run(false);
      } catch (error: unknown) {
        if (stoppedRef.current || isCancellation(error)) return null;
        throw error;
      } finally {
        clearTimeout(timer);
        if (abortRef.current === controller) abortRef.current = null;
        deltaController?.abort();
        if (deltas) void deltas.stop();
        const sessionID = disposedSessionID;
        if (sessionID) {
          if (sessionRef.current === sessionID) sessionRef.current = null;
          await client.session.delete({ sessionID }).catch(() => undefined);
        }
      }
    },
  });

  return {
    ...mutation,
    abort: () => {
      stoppedRef.current = true;
      // Also interrupt the run on the server so the temp session unwinds
      // promptly instead of streaming to its end in the background.
      const sessionID = sessionRef.current;
      if (sessionID) {
        void client?.session.abort({ sessionID }).catch(() => undefined);
      }
      abortRef.current?.abort();
    },
  };
}

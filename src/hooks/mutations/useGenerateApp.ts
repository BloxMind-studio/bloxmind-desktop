import type { Event } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import {
  type AgentState,
  type BuildPhase,
  buildPhaseFromEvent,
  extractAgentState,
  extractFileOperation,
  type FileOperation,
} from "@/lib/appsBuilder/buildProgress";
import {
  APP_GAME_GENERATION_SYSTEM_PROMPT,
  APP_GAME_UPDATE_SYSTEM_PROMPT,
  APP_GENERATION_SYSTEM_PROMPT,
  APP_UPDATE_SYSTEM_PROMPT,
  looksLikeGameRequest,
} from "@/lib/appsBuilder/generate";
import type { AppEngine, AppProject } from "@/lib/appsBuilder/types";
import { appProjectDirectory, readProjectFromWorkspace } from "@/lib/appsBuilder/workspace";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";

/** True when the prompt was aborted without a reason (the user hit Stop). */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * How long a full generation may run before it's treated as wedged. Covers
 * generated-mesh-style long tasks but guarantees isPending always settles so
 * the studio can never be left loading forever.
 */
const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

export interface UseGenerateAppOptions {
  /**
   * Reports LLM-driven build phases (analyzing → designing → writing) as the
   * generation session streams. Transpiling/finalizing are reported
   * separately by the preview compile and never arrive from stream events.
   */
  onProgress?: (phase: BuildPhase) => void;
  /**
   * Called with file operations as the agent writes/edits/reads files.
   * Use this to show "creating main.tsx", "editing App.tsx" in the chat.
   */
  onFileOperation?: (op: FileOperation) => void;
  /**
   * Called with a live status whenever the agent's activity changes while the
   * generation session streams — "Creating main.tsx", "Editing App.tsx",
   * "Installing npm packages…", "Fixing an error…". Use this to show a
   * "what the agent is doing right now" line next to the spinner.
   */
  onAgentState?: (state: AgentState) => void;
  /**
   * Called with a live Activity Log entry whenever the agent makes a tool call
   * or that call resolves (success/failure/retry). Append these to a dynamic
   * activity feed so the user watches the real operations, not a fixed
   * checklist.
   */
  onActivity?: (event: Event) => void;
  /**
   * Called with the session ID backing this app as soon as it is resolved
   * (reused from a previous turn or freshly created). The caller persists it
   * on the saved app so later edits reuse the same session — and therefore
   * the same `apps/<sessionID>` folder on disk.
   */
  onSessionReady?: (sessionID: string) => void;
}

export interface UseGenerateAppInput {
  /** The user's request. For follow-up turns this is the change request. */
  request: string;
  /**
   * When set, the model UPDATES the existing app instead of creating a fresh
   * one from scratch. The app already lives in `apps/<sessionID>` on disk;
   * the agent edits real files in place and the run reads them back.
   */
  existing?: AppProject | null;
  /**
   * The persistent session backing this app, from a saved app or a previous
   * turn. Reused when the server still has it; a fresh session is created
   * otherwise (and reported via `onSessionReady`).
   */
  sessionID?: string | null;
  /**
   * Explicit rendering stack override for a fresh build. When omitted, the
   * request text is sniffed for game intent. Updates always follow the
   * existing project's engine.
   */
  engine?: AppEngine;
}

/**
 * Permission rulesets for the apps-builder session. The agent is given real
 * file tools scoped to its own `apps/**` folder plus skills/websearch; bash,
 * subagents, and anything outside the folder are denied outright.
 */
const APPS_SESSION_PERMISSIONS = [
  { permission: "*", pattern: "*", action: "deny" as const },
  // Skills are app-authored (they just inject context, no side effects) and
  // websearch lets the builder verify current facts (API shapes, library
  // versions). Delegation and bash are blocked: the agent must author files
  // directly, never shell out or hand work to a subagent.
  { permission: "read", pattern: "apps/**", action: "allow" as const },
  { permission: "write", pattern: "apps/**", action: "allow" as const },
  { permission: "edit", pattern: "apps/**", action: "allow" as const },
  { permission: "glob", pattern: "apps/**", action: "allow" as const },
  { permission: "grep", pattern: "apps/**", action: "allow" as const },
  { permission: "skill", pattern: "*", action: "allow" as const },
  { permission: "websearch", pattern: "*", action: "allow" as const },
  { permission: "task", pattern: "*", action: "deny" as const },
  { permission: "bash", pattern: "*", action: "deny" as const },
];

/**
 * React Query mutation that asks the AI to write a complete Vite + React +
 * TypeScript app as real files under `~/BloxMind/apps/<sessionID>`. The
 * session is persistent and shared across every turn of an app, so follow-up
 * changes edit the same files in place (read → edit → write) rather than
 * re-emitting the whole project. Returns the project freshly read back from
 * disk, or null when the run was cancelled.
 */
export function useGenerateApp(options?: UseGenerateAppOptions) {
  const { client } = useOpenCodeClient();
  const { selectedModel, selectedVariant } = useModelPreferences();
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const onProgressRef = useRef(options?.onProgress);
  onProgressRef.current = options?.onProgress;
  const onSessionReadyRef = useRef(options?.onSessionReady);
  onSessionReadyRef.current = options?.onSessionReady;
  const onFileOperationRef = useRef(options?.onFileOperation);
  onFileOperationRef.current = options?.onFileOperation;
  const onAgentStateRef = useRef(options?.onAgentState);
  onAgentStateRef.current = options?.onAgentState;
  const onActivityRef = useRef(options?.onActivity);
  onActivityRef.current = options?.onActivity;

  const mutation = useMutation({
    mutationFn: async (input: UseGenerateAppInput): Promise<AppProject | null> => {
      if (!client) throw new Error("The AI engine isn't ready yet.");
      const trimmed = input.request.trim();
      if (!trimmed) throw new Error("Describe the app you want to build.");
      const existing = input.existing ?? null;

      let model: { providerID: string; modelID: string } | undefined;
      if (selectedModel) {
        const [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) model = { providerID, modelID };
      }

      // Validate the selected model's provider is actually connected.
      if (model) {
        const providerData = queryClient.getQueryData<{
          all?: Array<{ id: string }>;
          connected?: string[];
        }>(qk.providers);
        const connected = new Set(providerData?.connected ?? []);
        if (!connected.has(model.providerID)) {
          throw new Error(
            `Model provider "${model.providerID}" is not configured in OpenCode. ` +
              `Run "opencode auth add ${model.providerID}" or select a different model.`,
          );
        }
      }

      // Created up-front so pressing Stop during setup cancels cleanly too,
      // and the watchdog below guarantees the mutation always settles.
      const controller = new AbortController();
      abortRef.current = controller;
      stoppedRef.current = false;
      let progressController: AbortController | null = null;
      let progressStream: Promise<void> | null = null;
      const timer = setTimeout(
        () => controller.abort(new Error("Building the app took too long. Try again.")),
        GENERATION_TIMEOUT_MS,
      );

      try {
        // Resolve the session: reuse the app's persistent session when the
        // server still has it; otherwise create a fresh one. The folder name
        // derives from the reused id so the app keeps its on-disk identity
        // across turns and app restarts.
        let sessionID: string | null = null;
        if (input.sessionID) {
          try {
            const lookup = await client.session.get(
              { sessionID: input.sessionID },
              { throwOnError: true, signal: controller.signal },
            );
            sessionID = lookup.data?.id ?? null;
          } catch {
            sessionID = null;
          }
        }
        if (!sessionID) {
          const created = await client.session.create(
            {
              title: "App generation (workspace)",
              metadata: { BloxMindHidden: true, purpose: "apps-builder" },
              permission: APPS_SESSION_PERMISSIONS,
            },
            { throwOnError: true, signal: controller.signal },
          );
          sessionID = created.data?.id ?? null;
        }
        if (!sessionID) throw new Error("Couldn't start the app generator.");
        sessionRef.current = sessionID;
        onSessionReadyRef.current?.(sessionID);

        // Watch the session's stream so the steps reflect the real LLM
        // lifecycle rather than timed placeholders. This is a second SSE
        // subscription; the provider's global one drops hidden sessions.
        progressController = new AbortController();
        progressStream = (async () => {
          try {
            const subscription = await client.event.subscribe(
              {},
              { throwOnError: true, signal: progressController?.signal },
            );
            if (!subscription?.stream) return;
            for await (const event of subscription.stream) {
              if (progressController?.signal.aborted) break;
              const phase = buildPhaseFromEvent(event, sessionID);
              if (phase) onProgressRef.current?.(phase);
              const fileOp = extractFileOperation(event);
              if (fileOp) onFileOperationRef.current?.(fileOp);
              const agentState = extractAgentState(event, sessionID);
              if (agentState) onAgentStateRef.current?.(agentState);
              onActivityRef.current?.(event);
            }
          } catch {
            // Progress is best-effort; never fail generation on a stream error.
          }
        })();

        const appFolder = appProjectDirectory(sessionID);

        // Ground update turns in what already exists on disk, so the model
        // edits against the real file layout instead of guessing (which is the
        // common cause of update regressions).
        const existingContext = existing
          ? `Files currently in the project (read any before editing):\n${existing.files
              .map((f) => `- ${f.path}`)
              .join("\n")}

Stack: engine=${existing.engine === "3d" ? "3D (React Three Fiber)" : "web (Vite + React)"}, entry=${existing.entry || "src/main.tsx"}, target=${existing.target}`
          : "";

        // Route by engine: an update follows the existing project's stack; a
        // fresh build uses an explicit override when provided, otherwise the
        // 3D game prompt is chosen when the request is clearly a game.
        const isGame = existing
          ? existing.engine === "3d"
          : input.engine
            ? input.engine === "3d"
            : looksLikeGameRequest(trimmed);
        const system = isGame
          ? existing
            ? APP_GAME_UPDATE_SYSTEM_PROMPT
            : APP_GAME_GENERATION_SYSTEM_PROMPT
          : existing
            ? APP_UPDATE_SYSTEM_PROMPT
            : APP_GENERATION_SYSTEM_PROMPT;

        await client.session.prompt(
          {
            sessionID,
            model,
            agent: "apps",
            variant: selectedVariant ?? undefined,
            system,
            parts: [
              {
                type: "text",
                text: existing
                  ? `Apply this change to the existing project in your app folder (workspace path "${appFolder}").

CURRENT PROJECT
${existingContext}

CHANGE REQUEST
${trimmed}`
                  : `Build the app described below into your app folder (workspace path "${appFolder}").\n\nAPP REQUEST\n${trimmed}`,
              },
            ],
          },
          { throwOnError: true, signal: controller.signal },
        );
        clearTimeout(timer);

        // The agent wrote real files; rebuild the in-memory project by reading
        // them back from disk so the preview/explorer show exactly what got
        // written. On an update, the existing identity is the fallback if the
        // agent left the manifest untouched.
        return await readProjectFromWorkspace(client, sessionID, existing ?? undefined);
      } catch (error: unknown) {
        if (stoppedRef.current || isCancellation(error)) return null;
        throw error;
      } finally {
        clearTimeout(timer);
        if (abortRef.current === controller) abortRef.current = null;
        progressController?.abort();
        if (progressStream) void progressStream.catch(() => undefined);
        // The session is intentionally NOT deleted: it is the app's persistent
        // identity (and its `apps/<sessionID>` folder lives on even if the app
        // is never saved), so later edits keep reusing it.
      }
    },
  });

  return {
    ...mutation,
    abort: () => {
      stoppedRef.current = true;
      // Also interrupt the run on the server so the session unwinds promptly
      // instead of streaming to its end in the background.
      const sessionID = sessionRef.current;
      if (sessionID) {
        void client?.session.abort({ sessionID }).catch(() => undefined);
      }
      abortRef.current?.abort();
    },
  };
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useCallback } from "react";

import { BUILTIN_PROJECT_INDEX_PROGRAM } from "@/lib/builtinProjectPrograms";
import {
  ProjectIndexProgramEnvelopeSchema,
  PROJECT_INDEX_OUTPUT_SCHEMA,
  type ProjectIndexProgramEnvelope,
  type ProjectSkeleton,
  ProjectSkeletonSchema,
} from "@/lib/projectIndex";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";
import { desktop } from "@/lib/desktop";

// ── useProjectIndex ──────────────────────────────────────────────────────

/**
 * Compile and invoke the project index program to build a dependency graph
 * of all scripts in the current Roblox Studio place.
 *
 * Uses the built-in program ({@link BUILTIN_PROJECT_INDEX_PROGRAM}) via the
 * `GeneratedProgramRuntime` desktop bridge. The result is validated against
 * {@link ProjectSkeletonSchema} before being returned.
 *
 * The query is cached for 30 seconds (`staleTime`) and retries twice on
 * failure. Returns `null` when Studio isn't connected or the index hasn't
 * been built yet.
 *
 * @returns The project skeleton, loading state, error message, and a refresh callback.
 */
export function useProjectIndex(): {
  skeleton: ProjectSkeleton | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { client, ready } = useOpenCodeClient();
  const studioTarget = useStudioTargetOptional();
  const queryClient = useQueryClient();
  const hasStudioTarget = studioTarget?.selected !== null && studioTarget?.status === "ready";

  // Per-target query key so switching Studio targets re-indexes.
  const targetKey = studioTarget?.selected?.key;
  const projectIndexKey = targetKey ? [...qk.projectIndex, targetKey] : qk.projectIndex;

  const { data, isLoading, error } = useQuery<ProjectSkeleton | null>({
    queryKey: projectIndexKey,
    queryFn: async () => {
      if (!client || !hasStudioTarget) return null;

      // Step 1: Compile the built-in program via the GeneratedProgramRuntime.
      const program = await desktop.compileProjectIndexProgram(BUILTIN_PROJECT_INDEX_PROGRAM);
      if (!program) return null;

      // Step 2: Invoke the compiled program to get the skeleton.
      const skeleton = await desktop.invokeProjectIndexProgram(program);
      if (!skeleton) return null;

      // Validate the result against our schema via the runtime Effect system.
      const decoded = Schema.decodeUnknownSync(ProjectSkeletonSchema)(skeleton);
      return decoded;
    },
    enabled: ready && !!client && hasStudioTarget,
    // Keep the index around; it only changes when scripts are added/removed.
    staleTime: 30_000,
    retry: 2,
    retryDelay: 1_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: projectIndexKey });
  }, [queryClient, projectIndexKey]);

  return {
    skeleton: data ?? null,
    isLoading,
    error: error ? String(error) : null,
    refresh,
  };
}

// ── useProjectIndexProgram ───────────────────────────────────────────────

/**
 * Get the project index program envelope (AI-generated or built-in fallback).
 *
 * Tries to generate an AI-tailored program first (via
 * {@link generateProjectIndexProgram}); if that fails or returns null,
 * falls back to {@link BUILTIN_PROJECT_INDEX_PROGRAM}.
 *
 * Used by the AI agent to understand the project structure.
 *
 * @returns The program envelope and loading state.
 */
export function useProjectIndexProgram(): {
  program: ProjectIndexProgramEnvelope | null;
  isLoading: boolean;
} {
  const { client, ready } = useOpenCodeClient();
  const studioTarget = useStudioTargetOptional();
  const targetKey = studioTarget?.selected?.key;
  const hasStudioTarget = studioTarget?.selected !== null && studioTarget?.status === "ready";

  const programKey = targetKey ? [...qk.projectIndexProgram, targetKey] : qk.projectIndexProgram;

  const { data, isLoading } = useQuery<ProjectIndexProgramEnvelope | null>({
    queryKey: programKey,
    queryFn: async () => {
      if (!client || !hasStudioTarget) return null;

      // Try to get an AI-generated program first, fall back to built-in.
      try {
        const generated = await generateProjectIndexProgram(client, targetKey);
        if (generated) return generated;
      } catch {
        // Fall through to built-in on any error.
      }

      return BUILTIN_PROJECT_INDEX_PROGRAM;
    },
    enabled: ready && !!client && hasStudioTarget,
    staleTime: 60_000,
  });

  return {
    program: data ?? null,
    isLoading,
  };
}

// ── AI program generation ────────────────────────────────────────────────

/**
 * Ask the AI to generate a project index program tailored to the current place.
 *
 * Creates a temporary hidden session, sends a prompt with the
 * {@link PROJECT_INDEX_OUTPUT_SCHEMA} as a structured-output constraint,
 * decodes the response into a {@link ProjectIndexProgramEnvelope}, and
 * deletes the session in a `finally` block.
 *
 * This mirrors the pattern used by `generateExplorerProgram` in `lib/explorer.ts`.
 *
 * @param client - The OpenCode client instance.
 * @param targetKey - Optional Studio target key for session metadata.
 * @returns The generated program envelope, or `null` if generation fails.
 * @throws If session creation or prompting fails (caught by the caller).
 */
async function generateProjectIndexProgram(
  client: NonNullable<ReturnType<typeof useOpenCodeClient>["client"]>,
  targetKey?: string,
): Promise<ProjectIndexProgramEnvelope | null> {
  const INITIAL_SYSTEM_PROMPT = `You generate the private TypeScript data provider for BloxBot's project index panel.
Discover the currently available Studio MCP tools and return an import-free deterministic read-only TypeScript program.
The source must define async function run({ input, callTool }) and return a project skeleton matching the requested output contract.
Use callTool directly with the exact discovered tool names and arguments. It must never modify the place.
For every Script, ModuleScript, and LocalScript, read the source via the appropriate MCP tool and parse all require() calls.
Build a dependency graph, identify entry points (modules nothing else depends on), and detect circular dependencies.
Return only the requested structured output.`;

  // Create a temporary hidden session for the planning prompt.
  const created = await client.session.create(
    {
      title: "Project index (temporary)",
      agent: undefined,
      metadata: { bloxbotHidden: true, purpose: "project-index", targetKey },
    },
    { throwOnError: true },
  );
  const planningSessionId = created.data?.id;
  if (!planningSessionId) throw new Error("Couldn't start the project index planner.");

  try {
    const response = await client.session.prompt(
      {
        sessionID: planningSessionId,
        model: undefined,
        agent: undefined,
        variant: undefined,
        format: { type: "json_schema", schema: PROJECT_INDEX_OUTPUT_SCHEMA, retryCount: 2 },
        system: INITIAL_SYSTEM_PROMPT,
        parts: [
          {
            type: "text",
            text: "Discover the read-only Studio tools and generate the reusable TypeScript project index program.",
          },
        ],
      },
      { throwOnError: true },
    );

    // Decode the structured output into our envelope schema.
    return Schema.decodeUnknownSync(ProjectIndexProgramEnvelopeSchema)(
      response.data.info.structured,
    );
  } finally {
    // Always clean up the temporary session, even on error.
    await client.session.delete({ sessionID: planningSessionId }).catch(() => undefined);
  }
}

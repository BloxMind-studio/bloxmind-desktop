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

/**
 * Compile and invoke the project index program to build a dependency graph
 * of all scripts in the current Roblox Studio place.
 *
 * Returns null when Studio isn't connected or the index hasn't been built yet.
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

  const { data, isLoading, error } = useQuery<ProjectSkeleton | null>({
    queryKey: qk.projectIndex,
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
    void queryClient.invalidateQueries({ queryKey: qk.projectIndex });
  }, [queryClient]);

  return {
    skeleton: data ?? null,
    isLoading,
    error: error ? String(error) : null,
    refresh,
  };
}

/**
 * Get the project index program envelope (compiled or built-in).
 * Used by the AI agent to understand the project structure.
 */
export function useProjectIndexProgram(): {
  program: ProjectIndexProgramEnvelope | null;
  isLoading: boolean;
} {
  const { client, ready } = useOpenCodeClient();
  const studioTarget = useStudioTargetOptional();
  const hasStudioTarget = studioTarget?.selected !== null && studioTarget?.status === "ready";

  const { data, isLoading } = useQuery<ProjectIndexProgramEnvelope | null>({
    queryKey: qk.projectIndexProgram,
    queryFn: async () => {
      if (!client || !hasStudioTarget) return null;

      // Try to get an AI-generated program first, fall back to built-in.
      try {
        const generated = await generateProjectIndexProgram(client);
        if (generated) return generated;
      } catch {
        // Fall through to built-in.
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

/**
 * Ask the AI to generate a project index program tailored to the current place.
 * This mirrors the pattern used by generateExplorerProgram in lib/explorer.ts.
 */
async function generateProjectIndexProgram(
  client: NonNullable<ReturnType<typeof useOpenCodeClient>["client"]>,
): Promise<ProjectIndexProgramEnvelope | null> {
  const INITIAL_SYSTEM_PROMPT = `You generate the private TypeScript data provider for BloxBot's project index panel.
Discover the currently available Studio MCP tools and return an import-free deterministic read-only TypeScript program.
The source must define async function run({ input, callTool }) and return a project skeleton matching the requested output contract.
Use callTool directly with the exact discovered tool names and arguments. It must never modify the place.
For every Script, ModuleScript, and LocalScript, read the source via the appropriate MCP tool and parse all require() calls.
Build a dependency graph, identify entry points (modules nothing else depends on), and detect circular dependencies.
Return only the requested structured output.`;

  const created = await client.session.create(
    {
      title: "Project index (temporary)",
      agent: undefined,
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

    return Schema.decodeUnknownSync(ProjectIndexProgramEnvelopeSchema)(
      response.data.info.structured,
    );
  } finally {
    await client.session.delete({ sessionID: planningSessionId }).catch(() => undefined);
  }
}

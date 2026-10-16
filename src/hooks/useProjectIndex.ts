import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useCallback, useMemo } from "react";

import { BUILTIN_PROJECT_INDEX_PROGRAM } from "@/lib/builtinProjectPrograms";
import { desktop } from "@/lib/desktop";
import { type ProjectSkeleton, ProjectSkeletonSchema } from "@/lib/projectIndex";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

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
  const hasStudioTarget = Boolean(studioTarget?.selected) && studioTarget?.status === "ready";

  // Per-target query key so switching Studio targets re-indexes.
  const targetKey = studioTarget?.selected?.key;
  const projectIndexKey = useMemo(
    () => (targetKey ? [...qk.projectIndex, targetKey] : qk.projectIndex),
    [targetKey],
  );

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

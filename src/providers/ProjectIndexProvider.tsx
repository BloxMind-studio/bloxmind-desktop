import { createContext, type ReactNode, useContext, useMemo } from "react";

import { useProjectIndex } from "@/hooks/useProjectIndex";
import type { ProjectSkeleton } from "@/lib/projectIndex";

interface ProjectIndexContextValue {
  skeleton: ProjectSkeleton | null;
  isLoading: boolean;
  error: string | null;
  contextPrompt: string | null;
  refresh: () => void;
}

const ProjectIndexContext = createContext<ProjectIndexContextValue | null>(null);

/**
 * Formats the project skeleton into a concise system-prompt snippet
 * that tells the agent about the project structure.
 */
function formatProjectContext(skeleton: ProjectSkeleton): string {
  const lines: string[] = [];

  lines.push(`<project_index>`);
  lines.push(`Scripts: ${skeleton.totalScripts} · ModuleScripts: ${skeleton.totalModuleScripts}`);

  if (skeleton.entryPoints.length > 0) {
    const entries = skeleton.entryPoints.slice(0, 8);
    lines.push(`Entry points: ${entries.join(", ")}`);
    if (skeleton.entryPoints.length > 8) {
      lines.push(`  … and ${skeleton.entryPoints.length - 8} more`);
    }
  }

  if (skeleton.modules.length > 0) {
    // Include the first N modules as a compact listing.
    const shown = skeleton.modules.slice(0, 30);
    lines.push(`Modules (${skeleton.modules.length} total):`);
    for (const mod of shown) {
      const deps =
        mod.dependencies.length > 0 ? ` → ${mod.dependencies.slice(0, 5).join(", ")}` : "";
      lines.push(`  ${mod.className} ${mod.path} (${mod.sourceLength}B)${deps}`);
    }
    if (skeleton.modules.length > 30) {
      lines.push(`  … and ${skeleton.modules.length - 30} more`);
    }
  }

  if (skeleton.circularDependencies.length > 0) {
    lines.push(`Circular deps:`);
    for (const [from, to] of skeleton.circularDependencies.slice(0, 5)) {
      lines.push(`  ${from} ↔ ${to}`);
    }
  }

  lines.push(`</project_index>`);
  return lines.join("\n");
}

export function ProjectIndexProvider({ children }: { children: ReactNode }) {
  const { skeleton, isLoading, error, refresh } = useProjectIndex();

  const contextPrompt = useMemo(() => {
    if (!skeleton) return null;
    return formatProjectContext(skeleton);
  }, [skeleton]);

  const value = useMemo<ProjectIndexContextValue>(
    () => ({ skeleton, isLoading, error, contextPrompt, refresh }),
    [skeleton, isLoading, error, contextPrompt, refresh],
  );

  return (
    <ProjectIndexContext.Provider value={value}>{children}</ProjectIndexContext.Provider>
  );
}

export function useProjectIndexContext() {
  const value = useContext(ProjectIndexContext);
  // Return a default no-op context when used outside the provider.
  // This avoids breaking tests and edge cases where the provider isn't mounted.
  if (!value) {
    return {
      skeleton: null,
      isLoading: false,
      error: null,
      contextPrompt: null,
      refresh: () => {},
    } as ProjectIndexContextValue;
  }
  return value;
}

/**
 * Like useProjectIndexContext, but throws when the provider is not mounted.
 * Useful for components that always expect the provider to be present.
 */
export function useProjectIndexContextOrThrow() {
  const value = useContext(ProjectIndexContext);
  if (!value) throw new Error("useProjectIndexContext must be used within ProjectIndexProvider");
  return value;
}

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
 * Escape XML special characters to prevent prompt injection via script paths
 * or dependency names that contain <, >, or & characters.
 */
function escapeXml(str: string): string {
  const amp = `${String.fromCharCode(38)}amp;`;
  const lt = `${String.fromCharCode(38)}lt;`;
  const gt = `${String.fromCharCode(38)}gt;`;
  return str.replace(/&/g, amp).replace(/</g, lt).replace(/>/g, gt);
}

/**
 * Extract the service name from a qualified game path.
 * e.g. "game.ReplicatedStorage.Foo" -> "ReplicatedStorage"
 */
function serviceOfPath(path: string): string {
  const parts = path.split(".");
  return parts[0] === "game" ? (parts[1] ?? "Unknown") : (parts[0] ?? "Unknown");
}

/**
 * Formats the project skeleton into a concise system-prompt snippet
 * that tells the agent about the project structure.
 *
 * Includes:
 *   - Script counts by type
 *   - Service distribution (how many scripts per service)
 *   - Entry points (top-level scripts nothing depends on)
 *   - Hub modules (most-required modules by dependentsCount)
 *   - Module listing with dependency depth and dependents count
 *   - Circular dependency warnings
 */
function formatProjectContext(skeleton: ProjectSkeleton): string {
  const lines: string[] = [];

  lines.push(`<project_index>`);
  lines.push(`Scripts: ${skeleton.totalScripts} · ModuleScripts: ${skeleton.totalModuleScripts}`);

  // Service distribution summary.
  if (skeleton.modules.length > 0) {
    const serviceCounts = new Map<string, number>();
    for (const mod of skeleton.modules) {
      const svc = serviceOfPath(mod.path);
      serviceCounts.set(svc, (serviceCounts.get(svc) ?? 0) + 1);
    }
    const sortedServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]);
    const serviceSummary = sortedServices
      .slice(0, 6)
      .map(([svc, count]) => `${escapeXml(svc)}: ${count}`)
      .join(", ");
    lines.push(`Services: ${serviceSummary}`);
    if (sortedServices.length > 6) {
      lines.push(`  … and ${sortedServices.length - 6} more services`);
    }
  }

  if (skeleton.entryPoints.length > 0) {
    const entries = skeleton.entryPoints.slice(0, 8).map(escapeXml);
    lines.push(`Entry points: ${entries.join(", ")}`);
    if (skeleton.entryPoints.length > 8) {
      lines.push(`  … and ${skeleton.entryPoints.length - 8} more`);
    }
  }

  // Hub modules: most-required modules (high dependentsCount).
  const hubs = skeleton.modules
    .filter((mod) => mod.dependentsCount > 0)
    .sort((a, b) => b.dependentsCount - a.dependentsCount)
    .slice(0, 5);
  if (hubs.length > 0) {
    const hubSummary = hubs
      .map((mod) => `${escapeXml(mod.path)} (${mod.dependentsCount} dependents)`)
      .join(", ");
    lines.push(`Hub modules: ${hubSummary}`);
  }

  if (skeleton.modules.length > 0) {
    // Include the first N modules as a compact listing, sorted by depth (deepest first).
    const sorted = [...skeleton.modules].sort(
      (a, b) => b.dependencyDepth - a.dependencyDepth || b.sourceLength - a.sourceLength,
    );
    const shown = sorted.slice(0, 30);
    lines.push(`Modules (${skeleton.modules.length} total, by depth):`);
    for (const mod of shown) {
      const deps =
        mod.dependencies.length > 0
          ? ` → ${mod.dependencies.slice(0, 5).map(escapeXml).join(", ")}`
          : "";
      const hub = mod.dependentsCount > 0 ? ` · ${mod.dependentsCount} deps` : "";
      lines.push(
        `  ${escapeXml(mod.className)} ${escapeXml(mod.path)} (depth ${mod.dependencyDepth}, ${mod.sourceLength}B)${hub}${deps}`,
      );
    }
    if (skeleton.modules.length > 30) {
      lines.push(`  … and ${skeleton.modules.length - 30} more`);
    }
  }

  if (skeleton.circularDependencies.length > 0) {
    lines.push(`Circular deps:`);
    for (const [from, to] of skeleton.circularDependencies.slice(0, 5)) {
      lines.push(`  ${escapeXml(from)} ↔ ${escapeXml(to)}`);
    }
    if (skeleton.circularDependencies.length > 5) {
      lines.push(`  … and ${skeleton.circularDependencies.length - 5} more`);
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

  return <ProjectIndexContext.Provider value={value}>{children}</ProjectIndexContext.Provider>;
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
  if (!value)
    throw new Error("useProjectIndexContextOrThrow must be used within ProjectIndexProvider");
  return value;
}

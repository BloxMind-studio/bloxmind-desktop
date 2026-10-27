import { createContext, type ReactNode, useContext, useMemo } from "react";

import { useProjectIndex } from "@/hooks/useProjectIndex";
import type { ProjectSkeleton } from "@/lib/projectIndex";

interface ProjectIndexContextValue {
  skeleton: ProjectSkeleton | null;
  isLoading: boolean;
  isFetching: boolean;
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
  const ampersand = String.fromCharCode(38);
  const amp = `${ampersand}amp;`;
  const lt = `${ampersand}lt;`;
  const gt = `${ampersand}gt;`;
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
 *   - A short instruction on using the map before scanning the place
 *   - Script counts by type
 *   - Service distribution (how many scripts per service)
 *   - Entry points (top-level scripts nothing depends on)
 *   - Hub modules (most-required modules by dependentsCount)
 *   - Module listing with resolved dependencies and dependents count
 *   - Warnings when the map is incomplete
 *   - Circular dependency warnings
 */
function formatProjectContext(skeleton: ProjectSkeleton): string {
  const lines: string[] = [];
  const total = skeleton.totalScripts + skeleton.totalModuleScripts;

  lines.push(`<project_index>`);
  lines.push(
    "A live map of every script in the open Studio place, read from Studio. Use it before scanning the place: start from the entry points and hub modules, then read only the scripts you need. A path here is exactly the target_file value for Studio's script_read tool (roblox-studio_script_read in your tool list). If the place changed since this map was made, refresh it with the Index button in the chat header instead of rebuilding it by hand.",
  );
  lines.push(
    `Counts: ${total} scripts (${skeleton.totalScripts} Script/LocalScript · ${skeleton.totalModuleScripts} ModuleScript)`,
  );
  if (total === 0) {
    lines.push(
      "No scripts were found in the open place. If that is unexpected, check the selected Studio target and refresh the index before searching by hand.",
    );
  }

  if (skeleton.unreadableScripts > 0) {
    lines.push(
      `Note: ${skeleton.unreadableScripts} script(s) could not be read, so their dependencies are unknown. They are still counted above.`,
    );
  }
  if (skeleton.partial) {
    lines.push(
      "Note: reading hit its time limit before every script was read. Counts are complete; some dependency links are missing.",
    );
  }

  // Service distribution summary.
  if (skeleton.modules.length > 0) {
    const serviceCounts = new Map<string, number>();
    for (const mod of skeleton.modules) {
      const svc = serviceOfPath(mod.path);
      serviceCounts.set(svc, (serviceCounts.get(svc) ?? 0) + 1);
    }
    const sortedServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]);
    const serviceSummary = sortedServices
      .slice(0, 8)
      .map(([svc, count]) => `${escapeXml(svc)}: ${count}`)
      .join(", ");
    lines.push(`Services: ${serviceSummary}`);
    if (sortedServices.length > 8) {
      lines.push(`  … and ${sortedServices.length - 8} more services`);
    }
  }

  if (skeleton.entryPoints.length > 0) {
    const entries = skeleton.entryPoints.slice(0, 10).map(escapeXml);
    lines.push(`Entry points (no resolved file requires these): ${entries.join(", ")}`);
    if (skeleton.entryPoints.length > 10) {
      lines.push(`  … and ${skeleton.entryPoints.length - 10} more`);
    }
  }

  // Hub modules: most-required modules (high dependentsCount).
  const hubs = skeleton.modules
    .filter((mod) => mod.dependentsCount > 0)
    .sort((a, b) => b.dependentsCount - a.dependentsCount)
    .slice(0, 6);
  if (hubs.length > 0) {
    const hubSummary = hubs
      .map((mod) => `${escapeXml(mod.path)} (${mod.dependentsCount} dependents)`)
      .join(", ");
    lines.push(`Hub modules (read before changing shared code): ${hubSummary}`);
  }

  if (skeleton.modules.length > 0) {
    const knownPaths = new Set(skeleton.modules.map((mod) => mod.path));
    // Deepest and largest first: those are the modules that carry the most
    // context, and they are the ones an agent is least likely to guess.
    const sorted = [...skeleton.modules].sort(
      (a, b) => b.dependencyDepth - a.dependencyDepth || b.sourceLength - a.sourceLength,
    );
    const shown = sorted.slice(0, 40);
    lines.push(`Modules (${skeleton.modules.length} total, deepest first):`);
    for (const mod of shown) {
      // Only show dependencies that resolve to a module in this map; string
      // literals and variable references would just add noise.
      const resolved = mod.dependencies.filter((dep) => knownPaths.has(dep)).slice(0, 5);
      const deps = resolved.length > 0 ? ` requires ${resolved.map(escapeXml).join(", ")}` : "";
      const users = mod.dependentsCount > 0 ? ` · ${mod.dependentsCount} dependents` : "";
      lines.push(
        `  ${escapeXml(mod.className)} ${escapeXml(mod.path)} (depth ${mod.dependencyDepth}, ${mod.sourceLength}B)${users}${deps}`,
      );
    }
    if (skeleton.modules.length > shown.length) {
      lines.push(
        `  … and ${skeleton.modules.length - shown.length} more. Ask the user which service to focus on, or search Studio for the missing name.`,
      );
    }
  }

  if (skeleton.circularDependencies.length > 0) {
    lines.push(`Circular deps (avoid adding another edge between these):`);
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
  const { skeleton, isLoading, isFetching, error, refresh } = useProjectIndex();

  const contextPrompt = useMemo(() => {
    if (!skeleton) return null;
    return formatProjectContext(skeleton);
  }, [skeleton]);

  const value = useMemo<ProjectIndexContextValue>(
    () => ({ skeleton, isLoading, isFetching, error, contextPrompt, refresh }),
    [skeleton, isLoading, isFetching, error, contextPrompt, refresh],
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
      isFetching: false,
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

import { useCallback, useState } from "react";

import type { IsoWorldPos } from "@/lib/agentStudio/types";

/**
 * Persisted, per-agent 3D canvas node positions.
 *
 * Positions are stored under a key scoped to the agent so that:
 *  - custom layouts survive reloads, view/mode toggles, and navigating away and
 *    back (the bug where dragged blocks snapped back to the auto-grid);
 *  - switching agents starts from that agent's saved layout, not a leftover
 *    from another agent.
 *
 * `useState` is seeded from localStorage only once per agent (the `key` input),
 * so the very first paint of a brand-new agent falls back to the default
 * auto-layout and only ever remembers positions the user actually dragged.
 */

function storageKey(agentId: string): string {
  return `BloxMind-agent-positions:${agentId}`;
}

type Positions = Record<string, IsoWorldPos>;

function readStored(agentId: string): Positions {
  try {
    const raw = window.localStorage.getItem(storageKey(agentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Positions;
    }
  } catch {
    // Corrupted JSON or storage unavailable (e.g. third-party cookies off in
    // some browsers) — start fresh from the default layout rather than crashing.
  }
  return {};
}

function persist(agentId: string, positions: Positions): void {
  try {
    window.localStorage.setItem(storageKey(agentId), JSON.stringify(positions));
  } catch {
    // Storage may be unavailable or full — ignore; we still keep the in-memory
    // layout for this session.
  }
}

export function useNodePositions(agentId: string | null) {
  const key = agentId ?? "__none__";
  const [positions, setPositions] = useState<Positions>(() => readStored(key));

  const save = useCallback(
    (next: Positions | ((current: Positions) => Positions)) => {
      setPositions((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        persist(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  const remove = useCallback(
    (nodeId: string) => {
      save((current) => {
        if (!(nodeId in current)) return current;
        const next = { ...current };
        delete next[nodeId];
        return next;
      });
    },
    [save],
  );

  const reset = useCallback(() => {
    persist(key, {});
    setPositions({});
  }, [key]);

  return { positions, setPositions: save, removePosition: remove, resetPositions: reset };
}

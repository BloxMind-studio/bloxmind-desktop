import type { Agent } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { patchConfig } from "@/lib/config";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import { persistSessionModels, SESSION_MODELS_KEY, tauriStore } from "@/lib/tauriStore";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

interface ConfigData {
  hasLaunched: boolean;
  lastModel: string | null;
  hiddenModels: string[];
  ownSessionIds: Set<string>;
  sessionModels: Record<string, string>;
  connectedProviders: string[];
  providerDefaults?: Record<string, string>;
}

interface PreferencesContextValue {
  hasLaunched: boolean | null;
  selectedModel: string | null;
  selectedAgent: string | null;
  selectedVariant: string | null;
  hiddenModels: Set<string>;
  sessionModels: Record<string, string>;
  ownSessionIds: Set<string>;
  showAllSessions: boolean;
  setSelectedModel: (modelID: string) => void;
  setSelectedAgent: (name: string) => void;
  setSelectedVariant: (variant: string | null) => void;
  toggleModelVisibility: (modelKey: string) => void;
  setShowAllSessions: (show: boolean) => void;
  dismissWelcome: () => void;
  addOwnSessionId: (id: string) => void;
  removeOwnSessionId: (id: string) => void;
  setSessionModel: (sessionId: string, modelId: string) => void;
  removeSessionModel: (sessionId: string) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue>(null!);

export function usePreferences() {
  return useContext(PreferencesContext);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { activeSessionId } = useActiveSession();

  // Read config from query cache (populated by init)
  const { data: configData } = useQuery<ConfigData>({ queryKey: qk.config });

  const [hasLaunched, setHasLaunched] = useState<boolean | null>(null);
  const [selectedModel, setSelectedModelState] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgentState] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariantState] = useState<string | null>(null);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());
  const [sessionModels, setSessionModels] = useState<Record<string, string>>({});
  const [ownSessionIds, setOwnSessionIds] = useState<Set<string>>(new Set());
  const [showAllSessions, setShowAllSessionsState] = useState(false);

  // Initialize from config data when it arrives
  useEffect(() => {
    if (!configData) return;
    setHasLaunched(configData.hasLaunched);
    setHiddenModels(new Set(configData.hiddenModels));
    setOwnSessionIds(configData.ownSessionIds);
    setSessionModels(configData.sessionModels);

    // Model selection priority
    const connected = configData.connectedProviders;
    if (configData.lastModel && connected.includes(splitModelKey(configData.lastModel)[0])) {
      setSelectedModelState(configData.lastModel);
    } else if (configData.providerDefaults) {
      const entry = Object.entries(configData.providerDefaults).find(([pid]) =>
        connected.includes(pid),
      );
      if (entry) {
        setSelectedModelState(`${entry[0]}/${entry[1]}`);
      }
    }
  }, [configData]);

  // Auto-select first agent
  const { data: agents } = useQuery<Agent[]>({ queryKey: qk.agents });
  useEffect(() => {
    if (!agents || selectedAgent) return;
    const primary = agents.find((a) => a.mode === "primary" && !a.hidden);
    if (primary) setSelectedAgentState(primary.name);
  }, [agents, selectedAgent]);

  // Restore per-session model on session change
  useEffect(() => {
    if (activeSessionId && sessionModels[activeSessionId]) {
      setSelectedModelState(sessionModels[activeSessionId]);
    }
  }, [activeSessionId, sessionModels]);

  const setSelectedModel = useCallback(
    (modelID: string) => {
      setSelectedModelState(modelID);
      patchConfig({ lastModel: modelID }).catch(() => {});
      if (activeSessionId) {
        setSessionModels((prev) => {
          const next = { ...prev, [activeSessionId]: modelID };
          persistSessionModels(next).catch(() => {});
          return next;
        });
      }
    },
    [activeSessionId],
  );

  const setSelectedAgent = useCallback((name: string) => {
    setSelectedAgentState(name);
  }, []);

  const setSelectedVariant = useCallback((variant: string | null) => {
    setSelectedVariantState(variant);
  }, []);

  const toggleModelVisibility = useCallback((modelKey: string) => {
    setHiddenModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelKey)) {
        next.delete(modelKey);
      } else {
        next.add(modelKey);
      }
      patchConfig({ hiddenModels: [...next] }).catch(() => {});
      return next;
    });
  }, []);

  const setShowAllSessions = useCallback((show: boolean) => {
    setShowAllSessionsState(show);
  }, []);

  const dismissWelcome = useCallback(() => {
    setHasLaunched(true);
    patchConfig({ hasLaunched: true }).catch(() => {});
    import("@/lib/telemetry").then(({ capture }) => capture("welcome_completed"));
  }, []);

  const addOwnSessionId = useCallback((id: string) => {
    setOwnSessionIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      import("@/lib/tauriStore").then(({ persistOwnSessionIds }) =>
        persistOwnSessionIds(next).catch(() => {}),
      );
      return next;
    });
  }, []);

  const removeOwnSessionId = useCallback((id: string) => {
    setOwnSessionIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      import("@/lib/tauriStore").then(({ persistOwnSessionIds }) =>
        persistOwnSessionIds(next).catch(() => {}),
      );
      return next;
    });
  }, []);

  const setSessionModel = useCallback((sessionId: string, modelId: string) => {
    setSessionModels((prev) => {
      const next = { ...prev, [sessionId]: modelId };
      tauriStore.set(SESSION_MODELS_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const removeSessionModel = useCallback((sessionId: string) => {
    setSessionModels((prev) => {
      const { [sessionId]: _removed, ...rest } = prev;
      tauriStore.set(SESSION_MODELS_KEY, rest).catch(() => {});
      return rest;
    });
  }, []);

  const value: PreferencesContextValue = {
    hasLaunched,
    selectedModel,
    selectedAgent,
    selectedVariant,
    hiddenModels,
    sessionModels,
    ownSessionIds,
    showAllSessions,
    setSelectedModel,
    setSelectedAgent,
    setSelectedVariant,
    toggleModelVisibility,
    setShowAllSessions,
    dismissWelcome,
    addOwnSessionId,
    removeOwnSessionId,
    setSessionModel,
    removeSessionModel,
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

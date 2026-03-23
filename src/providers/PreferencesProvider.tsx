import type { Agent } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { patchConfig } from "@/lib/config";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";

interface ConfigData {
  lastModel: string | null;
  hiddenModels: string[];
  connectedProviders: string[];
  providerDefaults?: Record<string, string>;
}

interface PreferencesContextValue {
  selectedModel: string | null;
  selectedAgent: string | null;
  selectedVariant: string | null;
  hiddenModels: Set<string>;
  setSelectedModel: (modelID: string) => void;
  setSelectedAgent: (name: string) => void;
  setSelectedVariant: (variant: string | null) => void;
  toggleModelVisibility: (modelKey: string) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue>(null!);

export function usePreferences() {
  return useContext(PreferencesContext);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  // Read config from query cache (populated by init)
  const { data: configData } = useQuery<ConfigData>({ queryKey: qk.config, enabled: false });

  const [selectedModel, setSelectedModelState] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgentState] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariantState] = useState<string | null>(null);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());

  // Initialize from config data when it arrives
  useEffect(() => {
    if (!configData) return;
    setHiddenModels(new Set(configData.hiddenModels));

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
  const { data: agents } = useQuery<Agent[]>({ queryKey: qk.agents, enabled: false });
  useEffect(() => {
    if (!agents || selectedAgent) return;
    const primary = agents.find((a) => a.mode === "primary" && !a.hidden);
    if (primary) setSelectedAgentState(primary.name);
  }, [agents, selectedAgent]);

  const setSelectedModel = useCallback((modelID: string) => {
    setSelectedModelState(modelID);
    patchConfig({ lastModel: modelID }).catch(() => {});
  }, []);

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

  const value: PreferencesContextValue = {
    selectedModel,
    selectedAgent,
    selectedVariant,
    hiddenModels,
    setSelectedModel,
    setSelectedAgent,
    setSelectedVariant,
    toggleModelVisibility,
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

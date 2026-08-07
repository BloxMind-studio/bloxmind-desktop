import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useAgents } from "@/hooks/useAgents";
import { useConnectedProviders } from "@/hooks/useProviders";
import { setDetailedAnalyticsEnabled as setDetailedAnalyticsCollection } from "@/lib/analytics";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import type { AccentColor, LayoutDensity } from "@/types/desktop";

const ACCENT_CSS_VALUES: Record<AccentColor, string> = {
  blue: "221 83% 58%",
  violet: "262 83% 58%",
  emerald: "160 84% 39%",
  rose: "350 89% 60%",
  amber: "38 92% 50%",
};

function applyAccentColor(color: AccentColor) {
  if (typeof window === "undefined") return;
  window.document.documentElement.style.setProperty("--accent-hsl", ACCENT_CSS_VALUES[color]);
}

function applyLayoutDensity(density: LayoutDensity) {
  if (typeof window === "undefined") return;
  const root = window.document.documentElement;
  root.classList.toggle("layout-compact", density === "compact");
  root.classList.toggle("layout-comfortable", density === "comfortable");
}

function applyFontSize(size: number) {
  if (typeof window === "undefined") return;
  window.document.documentElement.style.setProperty("--app-font-scale", String(size));
}

interface PreferencesContextValue {
  selectedModel: string | null;
  selectedAgent: string | null;
  selectedVariant: string | null;
  hiddenModels: Set<string>;
  detailedAnalyticsEnabled: boolean;
  // UI customization
  accentColor: AccentColor;
  layoutDensity: LayoutDensity;
  fontSize: number;
  soundEffects: boolean;
  // AI engine
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  customApiEndpoint: string | null;
  // Behavior
  autoScroll: boolean;
  enterToSend: boolean;
  notificationsEnabled: boolean;
  // SSE connection
  sseReconnectDelay: number;
  sseHeartbeatTimeout: number;
  setSelectedModel: (modelID: string) => void;
  setSelectedAgent: (name: string) => void;
  setSelectedVariant: (variant: string | null) => void;
  toggleModelVisibility: (modelKey: string) => void;
  setDetailedAnalyticsEnabled: (enabled: boolean) => void;
  setAccentColor: (color: AccentColor) => void;
  setLayoutDensity: (density: LayoutDensity) => void;
  setFontSize: (size: number) => void;
  setSoundEffects: (enabled: boolean) => void;
  setTemperature: (temp: number) => void;
  setMaxTokens: (tokens: number) => void;
  setSystemPrompt: (prompt: string) => void;
  setCustomApiEndpoint: (endpoint: string | null) => void;
  setAutoScroll: (enabled: boolean) => void;
  setEnterToSend: (enabled: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setSseReconnectDelay: (delay: number) => void;
  setSseHeartbeatTimeout: (timeout: number) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences must be used within a PreferencesProvider");
  return context;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { data: configData } = useQuery<AppConfig>({
    queryKey: qk.config,
    queryFn: loadConfig,
  });

  const [selectedModel, setSelectedModelState] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgentState] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariantState] = useState<string | null>(null);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());
  const [detailedAnalyticsEnabled, setDetailedAnalyticsEnabledState] = useState(false);
  const detailedAnalyticsEnabledRef = useRef(false);
  // UI customization
  const [accentColor, setAccentColorState] = useState<AccentColor>("blue");
  const [layoutDensity, setLayoutDensityState] = useState<LayoutDensity>("comfortable");
  const [fontSize, setFontSizeState] = useState(1);
  const [soundEffects, setSoundEffectsState] = useState(true);
  // AI engine
  const [temperature, setTemperatureState] = useState(0.7);
  const [maxTokens, setMaxTokensState] = useState(4_096);
  const [systemPrompt, setSystemPromptState] = useState("");
  const [customApiEndpoint, setCustomApiEndpointState] = useState<string | null>(null);
  // Behavior
  const [autoScroll, setAutoScrollState] = useState(true);
  const [enterToSend, setEnterToSendState] = useState(true);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  // SSE connection
  const [sseReconnectDelay, setSseReconnectDelayState] = useState(3_000);
  const [sseHeartbeatTimeout, setSseHeartbeatTimeoutState] = useState(30_000);

  const connectedProviders = useConnectedProviders();

  const setDetailedAnalyticsEnabled = useCallback((enabled: boolean) => {
    const previous = detailedAnalyticsEnabledRef.current;
    detailedAnalyticsEnabledRef.current = enabled;
    setDetailedAnalyticsEnabledState(enabled);
    setDetailedAnalyticsCollection(enabled);
    patchConfig({ detailedAnalytics: enabled ? "enabled" : "disabled" }).catch(() => {
      detailedAnalyticsEnabledRef.current = previous;
      setDetailedAnalyticsEnabledState(previous);
      setDetailedAnalyticsCollection(previous);
    });
  }, []);

  // Initialize from config data when it arrives and prompt once when no choice exists.
  useEffect(() => {
    if (!configData) return;
    setHiddenModels(new Set(configData.hiddenModels));
    const detailedEnabled = configData.detailedAnalytics === "enabled";
    detailedAnalyticsEnabledRef.current = detailedEnabled;
    setDetailedAnalyticsEnabledState(detailedEnabled);
    setDetailedAnalyticsCollection(detailedEnabled);
    // UI customization
    setAccentColorState(configData.accentColor);
    setLayoutDensityState(configData.layoutDensity);
    setFontSizeState(configData.fontSize);
    setSoundEffectsState(configData.soundEffects);
    // AI engine
    setTemperatureState(configData.temperature);
    setMaxTokensState(configData.maxTokens);
    setSystemPromptState(configData.systemPrompt);
    setCustomApiEndpointState(configData.customApiEndpoint);
    // Behavior
    setAutoScrollState(configData.autoScroll);
    setEnterToSendState(configData.enterToSend);
    setNotificationsEnabledState(configData.notificationsEnabled);
    // SSE connection
    setSseReconnectDelayState(configData.sseReconnectDelay);
    setSseHeartbeatTimeoutState(configData.sseHeartbeatTimeout);

    if (configData.detailedAnalytics === "unset") {
      toast("Help improve BloxMind", {
        id: "detailed-analytics-consent",
        className: "analytics-consent-toast",
        description:
          "Share provider, model, and aggregate token usage. Prompts, responses, files, and agent names are never collected.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Share usage",
          onClick: () => setDetailedAnalyticsEnabled(true),
        },
        cancel: {
          label: "Not now",
          onClick: () => setDetailedAnalyticsEnabled(false),
        },
      });
    }
  }, [configData, setDetailedAnalyticsEnabled]);

  // Restore a valid last-used model and clear selections whose provider disconnected.
  useEffect(() => {
    if (!configData) return;
    if (selectedModel && !connectedProviders.includes(splitModelKey(selectedModel)[0])) {
      setSelectedModelState(null);
      setSelectedVariantState(null);
      return;
    }
    if (
      !selectedModel &&
      configData.lastModel &&
      connectedProviders.includes(splitModelKey(configData.lastModel)[0])
    ) {
      setSelectedModelState(configData.lastModel);
    }
    // Restore the persisted default variant (reasoning effort).
    if (configData.defaultVariant) {
      setSelectedVariantState(configData.defaultVariant);
    }
  }, [configData, connectedProviders, selectedModel]);
  // Auto-select first agent
  const agents = useAgents();
  useEffect(() => {
    if (agents.length === 0 || selectedAgent) return;
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
    patchConfig({ defaultVariant: variant }).catch(() => {});
  }, []);

  const toggleModelVisibility = useCallback(
    (modelKey: string) => {
      const next = new Set(hiddenModels);
      if (next.has(modelKey)) {
        next.delete(modelKey);
      } else {
        next.add(modelKey);
      }
      setHiddenModels(next);
      patchConfig({ hiddenModels: [...next] }).catch(() => {});
    },
    [hiddenModels],
  );

  // UI customization setters
  const setAccentColor = useCallback((color: AccentColor) => {
    setAccentColorState(color);
    patchConfig({ accentColor: color }).catch(() => {});
  }, []);
  const setLayoutDensity = useCallback((density: LayoutDensity) => {
    setLayoutDensityState(density);
    patchConfig({ layoutDensity: density }).catch(() => {});
  }, []);
  const setFontSize = useCallback((size: number) => {
    setFontSizeState(size);
    patchConfig({ fontSize: size }).catch(() => {});
  }, []);
  const setSoundEffects = useCallback((enabled: boolean) => {
    setSoundEffectsState(enabled);
    patchConfig({ soundEffects: enabled }).catch(() => {});
  }, []);

  // AI engine setters
  const setTemperature = useCallback((temp: number) => {
    setTemperatureState(temp);
    patchConfig({ temperature: temp }).catch(() => {});
  }, []);
  const setMaxTokens = useCallback((tokens: number) => {
    setMaxTokensState(tokens);
    patchConfig({ maxTokens: tokens }).catch(() => {});
  }, []);
  const setSystemPrompt = useCallback((prompt: string) => {
    setSystemPromptState(prompt);
    patchConfig({ systemPrompt: prompt }).catch(() => {});
  }, []);
  const setCustomApiEndpoint = useCallback((endpoint: string | null) => {
    setCustomApiEndpointState(endpoint);
    patchConfig({ customApiEndpoint: endpoint }).catch(() => {});
  }, []);

  // Behavior setters
  const setAutoScroll = useCallback((enabled: boolean) => {
    setAutoScrollState(enabled);
    patchConfig({ autoScroll: enabled }).catch(() => {});
  }, []);
  const setEnterToSend = useCallback((enabled: boolean) => {
    setEnterToSendState(enabled);
    patchConfig({ enterToSend: enabled }).catch(() => {});
  }, []);
  const setNotificationsEnabled = useCallback((enabled: boolean) => {
    setNotificationsEnabledState(enabled);
    patchConfig({ notificationsEnabled: enabled }).catch(() => {});
  }, []);

  // SSE connection setters
  const setSseReconnectDelay = useCallback((delay: number) => {
    setSseReconnectDelayState(delay);
    patchConfig({ sseReconnectDelay: delay }).catch(() => {});
  }, []);
  const setSseHeartbeatTimeout = useCallback((timeout: number) => {
    setSseHeartbeatTimeoutState(timeout);
    patchConfig({ sseHeartbeatTimeout: timeout }).catch(() => {});
  }, []);

  // Apply UI customization CSS variables
  useEffect(() => {
    applyAccentColor(accentColor);
  }, [accentColor]);

  useEffect(() => {
    applyLayoutDensity(layoutDensity);
  }, [layoutDensity]);

  useEffect(() => {
    applyFontSize(fontSize);
  }, [fontSize]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      selectedModel,
      selectedAgent,
      selectedVariant,
      hiddenModels,
      detailedAnalyticsEnabled,
      accentColor,
      layoutDensity,
      fontSize,
      soundEffects,
      temperature,
      maxTokens,
      systemPrompt,
      customApiEndpoint,
      autoScroll,
      enterToSend,
      notificationsEnabled,
      sseReconnectDelay,
      sseHeartbeatTimeout,
      setSelectedModel,
      setSelectedAgent,
      setSelectedVariant,
      toggleModelVisibility,
      setDetailedAnalyticsEnabled,
      setAccentColor,
      setLayoutDensity,
      setFontSize,
      setSoundEffects,
      setTemperature,
      setMaxTokens,
      setSystemPrompt,
      setCustomApiEndpoint,
      setAutoScroll,
      setEnterToSend,
      setNotificationsEnabled,
      setSseReconnectDelay,
      setSseHeartbeatTimeout,
    }),
    [
      selectedModel,
      selectedAgent,
      selectedVariant,
      hiddenModels,
      detailedAnalyticsEnabled,
      accentColor,
      layoutDensity,
      fontSize,
      soundEffects,
      temperature,
      maxTokens,
      systemPrompt,
      customApiEndpoint,
      autoScroll,
      enterToSend,
      notificationsEnabled,
      sseReconnectDelay,
      sseHeartbeatTimeout,
      setSelectedModel,
      setSelectedAgent,
      setSelectedVariant,
      toggleModelVisibility,
      setDetailedAnalyticsEnabled,
      setAccentColor,
      setLayoutDensity,
      setFontSize,
      setSoundEffects,
      setTemperature,
      setMaxTokens,
      setSystemPrompt,
      setCustomApiEndpoint,
      setAutoScroll,
      setEnterToSend,
      setNotificationsEnabled,
      setSseReconnectDelay,
      setSseHeartbeatTimeout,
    ],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

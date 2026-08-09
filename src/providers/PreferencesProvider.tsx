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
  indigo: "239 84% 67%",
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

/** Helper to persist a config patch with user-facing error handling.
 * On failure, shows a toast and calls the optional revert callback. */
function persistWithFeedback(patch: Partial<AppConfig>, revert?: () => void): void {
  patchConfig(patch).catch((err) => {
    console.error("Failed to save preference:", err);
    toast.error("Failed to save setting", {
      description: "Your change was not persisted. Try again or restart the app.",
    });
    revert?.();
  });
}

// ── Model / session slice ────────────────────────────────────────────────

export interface ModelPreferences {
  selectedModel: string | null;
  selectedAgent: string | null;
  selectedVariant: string | null;
  hiddenModels: Set<string>;
  detailedAnalyticsEnabled: boolean;
  setSelectedModel: (modelID: string) => void;
  setSelectedAgent: (name: string) => void;
  setSelectedVariant: (variant: string | null) => void;
  toggleModelVisibility: (modelKey: string) => void;
  setDetailedAnalyticsEnabled: (enabled: boolean) => void;
}

export const ModelPreferencesContext = createContext<ModelPreferences | undefined>(undefined);

export function useModelPreferences() {
  const context = useContext(ModelPreferencesContext);
  if (!context) throw new Error("useModelPreferences must be used within a PreferencesProvider");
  return context;
}

// ── UI customization slice ───────────────────────────────────────────────

export interface UIPreferences {
  accentColor: AccentColor;
  layoutDensity: LayoutDensity;
  fontSize: number;
  soundEffects: boolean;
  setAccentColor: (color: AccentColor) => void;
  setLayoutDensity: (density: LayoutDensity) => void;
  setFontSize: (size: number) => void;
  setSoundEffects: (enabled: boolean) => void;
}

export const UIPreferencesContext = createContext<UIPreferences | undefined>(undefined);

export function useUIPreferences() {
  const context = useContext(UIPreferencesContext);
  if (!context) throw new Error("useUIPreferences must be used within a PreferencesProvider");
  return context;
}

// ── AI engine slice ──────────────────────────────────────────────────────

export interface EnginePreferences {
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  customApiEndpoint: string | null;
  setTemperature: (temp: number) => void;
  setMaxTokens: (tokens: number) => void;
  setSystemPrompt: (prompt: string) => void;
  setCustomApiEndpoint: (endpoint: string | null) => void;
}

export const EnginePreferencesContext = createContext<EnginePreferences | undefined>(undefined);

export function useEnginePreferences() {
  const context = useContext(EnginePreferencesContext);
  if (!context) throw new Error("useEnginePreferences must be used within a PreferencesProvider");
  return context;
}

// ── Behavior slice ───────────────────────────────────────────────────────

export interface BehaviorPreferences {
  autoScroll: boolean;
  enterToSend: boolean;
  notificationsEnabled: boolean;
  setAutoScroll: (enabled: boolean) => void;
  setEnterToSend: (enabled: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
}

export const BehaviorPreferencesContext = createContext<BehaviorPreferences | undefined>(undefined);

export function useBehaviorPreferences() {
  const context = useContext(BehaviorPreferencesContext);
  if (!context) throw new Error("useBehaviorPreferences must be used within a PreferencesProvider");
  return context;
}

// ── SSE connection slice ─────────────────────────────────────────────────

export interface SSEPreferences {
  sseReconnectDelay: number;
  sseHeartbeatTimeout: number;
  setSseReconnectDelay: (delay: number) => void;
  setSseHeartbeatTimeout: (timeout: number) => void;
}

export const SSEPreferencesContext = createContext<SSEPreferences | undefined>(undefined);

export function useSSEPreferences() {
  const context = useContext(SSEPreferencesContext);
  if (!context) throw new Error("useSSEPreferences must be used within a PreferencesProvider");
  return context;
}

// ── Composite (backwards-compatible) API ─────────────────────────────────

export interface PreferencesContextValue
  extends ModelPreferences,
    UIPreferences,
    EnginePreferences,
    BehaviorPreferences,
    SSEPreferences {}

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
  const [accentColor, setAccentColorState] = useState<AccentColor>("indigo");
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
    persistWithFeedback({ detailedAnalytics: enabled ? "enabled" : "disabled" }, () => {
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
    persistWithFeedback({ lastModel: modelID }, () => setSelectedModelState(null));
  }, []);

  const setSelectedAgent = useCallback((name: string) => {
    setSelectedAgentState(name);
  }, []);

  const setSelectedVariant = useCallback((variant: string | null) => {
    setSelectedVariantState(variant);
    persistWithFeedback({ defaultVariant: variant }, () => setSelectedVariantState(null));
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
      persistWithFeedback({ hiddenModels: [...next] }, () => setHiddenModels(hiddenModels));
    },
    [hiddenModels],
  );

  // UI customization setters
  const setAccentColor = useCallback((color: AccentColor) => {
    setAccentColorState(color);
    persistWithFeedback({ accentColor: color }, () => setAccentColorState("indigo"));
  }, []);
  const setLayoutDensity = useCallback((density: LayoutDensity) => {
    setLayoutDensityState(density);
    persistWithFeedback({ layoutDensity: density }, () => setLayoutDensityState("comfortable"));
  }, []);
  const setFontSize = useCallback((size: number) => {
    setFontSizeState(size);
    persistWithFeedback({ fontSize: size }, () => setFontSizeState(1));
  }, []);
  const setSoundEffects = useCallback((enabled: boolean) => {
    setSoundEffectsState(enabled);
    persistWithFeedback({ soundEffects: enabled }, () => setSoundEffectsState(true));
  }, []);

  // AI engine setters
  const setTemperature = useCallback((temp: number) => {
    setTemperatureState(temp);
    persistWithFeedback({ temperature: temp }, () => setTemperatureState(0.7));
  }, []);
  const setMaxTokens = useCallback((tokens: number) => {
    setMaxTokensState(tokens);
    persistWithFeedback({ maxTokens: tokens }, () => setMaxTokensState(4_096));
  }, []);
  const setSystemPrompt = useCallback((prompt: string) => {
    setSystemPromptState(prompt);
    persistWithFeedback({ systemPrompt: prompt }, () => setSystemPromptState(""));
  }, []);
  const setCustomApiEndpoint = useCallback((endpoint: string | null) => {
    setCustomApiEndpointState(endpoint);
    persistWithFeedback({ customApiEndpoint: endpoint }, () => setCustomApiEndpointState(null));
  }, []);

  // Behavior setters
  const setAutoScroll = useCallback((enabled: boolean) => {
    setAutoScrollState(enabled);
    persistWithFeedback({ autoScroll: enabled }, () => setAutoScrollState(true));
  }, []);
  const setEnterToSend = useCallback((enabled: boolean) => {
    setEnterToSendState(enabled);
    persistWithFeedback({ enterToSend: enabled }, () => setEnterToSendState(true));
  }, []);
  const setNotificationsEnabled = useCallback((enabled: boolean) => {
    setNotificationsEnabledState(enabled);
    persistWithFeedback({ notificationsEnabled: enabled }, () =>
      setNotificationsEnabledState(true),
    );
  }, []);

  // SSE connection setters
  const setSseReconnectDelay = useCallback((delay: number) => {
    setSseReconnectDelayState(delay);
    persistWithFeedback({ sseReconnectDelay: delay }, () => setSseReconnectDelayState(3_000));
  }, []);
  const setSseHeartbeatTimeout = useCallback((timeout: number) => {
    setSseHeartbeatTimeoutState(timeout);
    persistWithFeedback({ sseHeartbeatTimeout: timeout }, () =>
      setSseHeartbeatTimeoutState(30_000),
    );
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

  const modelValue = useMemo<ModelPreferences>(
    () => ({
      selectedModel,
      selectedAgent,
      selectedVariant,
      hiddenModels,
      detailedAnalyticsEnabled,
      setSelectedModel,
      setSelectedAgent,
      setSelectedVariant,
      toggleModelVisibility,
      setDetailedAnalyticsEnabled,
    }),
    [
      selectedModel,
      selectedAgent,
      selectedVariant,
      hiddenModels,
      detailedAnalyticsEnabled,
      setSelectedModel,
      setSelectedAgent,
      setSelectedVariant,
      toggleModelVisibility,
      setDetailedAnalyticsEnabled,
    ],
  );

  const uiValue = useMemo<UIPreferences>(
    () => ({
      accentColor,
      layoutDensity,
      fontSize,
      soundEffects,
      setAccentColor,
      setLayoutDensity,
      setFontSize,
      setSoundEffects,
    }),
    [
      accentColor,
      layoutDensity,
      fontSize,
      soundEffects,
      setAccentColor,
      setLayoutDensity,
      setFontSize,
      setSoundEffects,
    ],
  );

  const engineValue = useMemo<EnginePreferences>(
    () => ({
      temperature,
      maxTokens,
      systemPrompt,
      customApiEndpoint,
      setTemperature,
      setMaxTokens,
      setSystemPrompt,
      setCustomApiEndpoint,
    }),
    [
      temperature,
      maxTokens,
      systemPrompt,
      customApiEndpoint,
      setTemperature,
      setMaxTokens,
      setSystemPrompt,
      setCustomApiEndpoint,
    ],
  );

  const behaviorValue = useMemo<BehaviorPreferences>(
    () => ({
      autoScroll,
      enterToSend,
      notificationsEnabled,
      setAutoScroll,
      setEnterToSend,
      setNotificationsEnabled,
    }),
    [
      autoScroll,
      enterToSend,
      notificationsEnabled,
      setAutoScroll,
      setEnterToSend,
      setNotificationsEnabled,
    ],
  );

  const sseValue = useMemo<SSEPreferences>(
    () => ({
      sseReconnectDelay,
      sseHeartbeatTimeout,
      setSseReconnectDelay,
      setSseHeartbeatTimeout,
    }),
    [sseReconnectDelay, sseHeartbeatTimeout, setSseReconnectDelay, setSseHeartbeatTimeout],
  );

  const compositeValue = useMemo<PreferencesContextValue>(
    () => ({ ...modelValue, ...uiValue, ...engineValue, ...behaviorValue, ...sseValue }),
    [modelValue, uiValue, engineValue, behaviorValue, sseValue],
  );

  return (
    <ModelPreferencesContext.Provider value={modelValue}>
      <UIPreferencesContext.Provider value={uiValue}>
        <EnginePreferencesContext.Provider value={engineValue}>
          <BehaviorPreferencesContext.Provider value={behaviorValue}>
            <SSEPreferencesContext.Provider value={sseValue}>
              <PreferencesContext.Provider value={compositeValue}>
                {children}
              </PreferencesContext.Provider>
            </SSEPreferencesContext.Provider>
          </BehaviorPreferencesContext.Provider>
        </EnginePreferencesContext.Provider>
      </UIPreferencesContext.Provider>
    </ModelPreferencesContext.Provider>
  );
}

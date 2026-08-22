import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import type {
  AccentColor,
  FontStyle,
  LayoutDensity,
  ThemeColors,
  ThemePreset,
} from "@/types/desktop";
import { DEFAULT_APP_CONFIG } from "@/types/desktop";

const ACCENT_CSS_VALUES: Record<AccentColor, string> = {
  blue: "221 83% 58%",
  indigo: "239 84% 67%",
  violet: "262 83% 58%",
  emerald: "160 84% 39%",
  rose: "350 89% 60%",
  amber: "38 92% 50%",
  cyan: "187 94% 43%",
};

const ACCENT_HEX_VALUES: Record<AccentColor, string> = {
  blue: "#3B82F6",
  indigo: "#6366F1",
  violet: "#8B5CF6",
  emerald: "#22C55E",
  rose: "#F43F63",
  amber: "#F59E0B",
  cyan: "#06B6D4",
};

// Theme-color presets. Selecting one applies its tokens. The hover overlay is
// intentionally fixed to a neutral light grey and cannot be themed per-preset.
export const LOCKED_HOVER_BG = "#E0E0E0";
export const LOCKED_HOVER_FG = "#000000";

export const THEME_PRESETS: Record<Exclude<ThemePreset, "custom">, ThemeColors> = {
  "soft-blue": {
    selectedBg: "#3B82F6",
    selectedFg: "#1D4ED8",
    hoverBg: LOCKED_HOVER_BG,
    hoverFg: LOCKED_HOVER_FG,
  },
  "dark-neon": {
    selectedBg: "#06B6D4",
    selectedFg: "#000000",
    hoverBg: LOCKED_HOVER_BG,
    hoverFg: LOCKED_HOVER_FG,
  },
  emerald: {
    selectedBg: "#10B981",
    selectedFg: "#065F46",
    hoverBg: LOCKED_HOVER_BG,
    hoverFg: LOCKED_HOVER_FG,
  },
};

function applyAccentColor(color: AccentColor) {
  if (typeof window === "undefined") return;
  const root = window.document.documentElement;
  const hsl = ACCENT_CSS_VALUES[color];
  root.style.setProperty("--accent-hsl", hsl);
  // Derive soft/glow variants from the base HSL by adjusting lightness.
  const [h, s, l] = hsl.split(" ");
  const lv = Number.parseInt(l, 10);
  const lift = (delta: number) => `${h} ${s} ${Math.min(lv + delta, 90)}%`;
  root.style.setProperty("--accent-hsl-soft", lift(7));
  root.style.setProperty("--accent-hsl-glow", lift(15));
  // Also set the hex-based --accent used by components like btn-primary
  const hex = ACCENT_HEX_VALUES[color];
  root.style.setProperty("--accent", hex);
}

function applyThemeColors(colors: ThemeColors) {
  if (typeof window === "undefined") return;
  const root = window.document.documentElement;
  root.style.setProperty("--selected", colors.selectedBg);
  root.style.setProperty("--selected-foreground", colors.selectedFg);
  // Hover overlay is locked to a neutral light grey in every preset and can't
  // be overridden by custom theme colors.
  root.style.setProperty("--hover", LOCKED_HOVER_BG);
  root.style.setProperty("--hover-foreground", LOCKED_HOVER_FG);
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

// Font-style presets. The selected style is applied as a `data-font-style`
// attribute on <html>; matching CSS rules in index.css drive `--app-font-sans`,
// which the body and interactive text inherit. Kept in sync with index.css.
function applyFontStyle(style: FontStyle) {
  if (typeof window === "undefined") return;
  window.document.documentElement.setAttribute("data-font-style", style);
}

/**
 * Persist a config patch with optimistic cache update and user-facing error
 * handling. The React Query cache (`qk.config`) is updated immediately so all
 * consumers (OpenCodeClientProvider, theme-provider) see the change without
 * waiting for the IPC round-trip to complete. On failure, the cache is
 * reverted and the user is notified.
 */
function persistWithFeedback(
  queryClient: ReturnType<typeof useQueryClient>,
  patch: Partial<AppConfig>,
  revert: (() => void) | undefined,
): void {
  // Capture the previous cache value for rollback. Seed from defaults if the
  // query hasn't resolved yet so the update is immediately visible to observers.
  const previous = queryClient.getQueryData<AppConfig>(qk.config) ?? DEFAULT_APP_CONFIG;
  queryClient.setQueryData<AppConfig>(qk.config, { ...previous, ...patch });
  patchConfig(patch).catch((err: unknown) => {
    console.error("Failed to save preference:", err);
    // Roll back the optimistic cache update.
    queryClient.setQueryData<AppConfig>(qk.config, previous);
    revert?.();
    toast.error("Failed to save setting", {
      description: "Your change was not persisted. Try again or restart the app.",
    });
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
  fontStyle: FontStyle;
  soundEffects: boolean;
  themePreset: ThemePreset;
  themeColors: ThemeColors;
  sidebarCollapsed: boolean;
  explorerCollapsed: boolean;
  setAccentColor: (color: AccentColor) => void;
  setLayoutDensity: (density: LayoutDensity) => void;
  setFontSize: (size: number) => void;
  setFontStyle: (style: FontStyle) => void;
  setSoundEffects: (enabled: boolean) => void;
  setThemePreset: (preset: ThemePreset) => void;
  setThemeColors: (colors: ThemeColors) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setExplorerCollapsed: (collapsed: boolean) => void;
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
  const queryClient = useQueryClient();
  const { data: configData } = useQuery<AppConfig>({
    queryKey: qk.config,
    queryFn: loadConfig,
  });

  // `selectedAgent` is ephemeral (auto-selected from the live agent list, not
  // persisted to config), so it stays as local state.
  const [selectedAgent, setSelectedAgentState] = useState<string | null>(null);
  const detailedAnalyticsEnabledRef = useRef(false);

  // Local state for config fields — initialized from the query cache and kept
  // in sync when configData changes externally (e.g. another window writes
  // preferences). Local state provides immediate UI feedback on user edits
  // without waiting for the async IPC round-trip; `persistWithFeedback` also
  // pushes the same change into the shared React Query cache so other consumers
  // (OpenCodeClientProvider, theme-provider) see it instantly.
  const [selectedModel, setSelectedModelState] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariantState] = useState<string | null>(null);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());
  const [detailedAnalyticsEnabled, setDetailedAnalyticsEnabledState] = useState(false);
  // UI customization
  const [accentColor, setAccentColorState] = useState<AccentColor>("cyan");
  const [layoutDensity, setLayoutDensityState] = useState<LayoutDensity>("comfortable");
  const [fontSize, setFontSizeState] = useState(1);
  const [fontStyle, setFontStyleState] = useState<FontStyle>(DEFAULT_APP_CONFIG.fontStyle);
  const [soundEffects, setSoundEffectsState] = useState(true);
  const [themePreset, setThemePresetState] = useState<ThemePreset>("dark-neon");
  const [themeColors, setThemeColorsState] = useState<ThemeColors>(DEFAULT_APP_CONFIG.themeColors);
  // Sidepanel layout (persisted so toggles survive restarts)
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(
    DEFAULT_APP_CONFIG.sidebarCollapsed,
  );
  const [explorerCollapsed, setExplorerCollapsedState] = useState(
    DEFAULT_APP_CONFIG.explorerCollapsed,
  );
  // AI engine
  const [temperature, setTemperatureState] = useState(DEFAULT_APP_CONFIG.temperature);
  const [maxTokens, setMaxTokensState] = useState(DEFAULT_APP_CONFIG.maxTokens);
  const [systemPrompt, setSystemPromptState] = useState(DEFAULT_APP_CONFIG.systemPrompt);
  const [customApiEndpoint, setCustomApiEndpointState] = useState<string | null>(null);
  // Behavior
  const [autoScroll, setAutoScrollState] = useState(DEFAULT_APP_CONFIG.autoScroll);
  const [enterToSend, setEnterToSendState] = useState(DEFAULT_APP_CONFIG.enterToSend);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(
    DEFAULT_APP_CONFIG.notificationsEnabled,
  );
  // SSE connection
  const [sseReconnectDelay, setSseReconnectDelayState] = useState(
    DEFAULT_APP_CONFIG.sseReconnectDelay,
  );
  const [sseHeartbeatTimeout, setSseHeartbeatTimeoutState] = useState(
    DEFAULT_APP_CONFIG.sseHeartbeatTimeout,
  );

  const connectedProviders = useConnectedProviders();

  // Seed the cache with defaults on first mount so that `persistWithFeedback`
  // always has a value to read/patch (and so tests that don't await the async
  // config query still see defaults immediately). Subsequent real config data
  // from `loadConfig` overrides this.
  useEffect(() => {
    const existing = queryClient.getQueryData<AppConfig>(qk.config);
    if (!existing) {
      queryClient.setQueryData<AppConfig>(qk.config, DEFAULT_APP_CONFIG);
    }
  }, [queryClient]);

  // Defined before the config-sync effect below because the consent toast's
  // buttons call it; hoisting it above prevents a temporal-dead-zone crash.
  const setDetailedAnalyticsEnabled = useCallback(
    (enabled: boolean) => {
      const previous = detailedAnalyticsEnabledRef.current;
      detailedAnalyticsEnabledRef.current = enabled;
      setDetailedAnalyticsEnabledState(enabled);
      setDetailedAnalyticsCollection(enabled);
      persistWithFeedback(
        queryClient,
        { detailedAnalytics: enabled ? "enabled" : "disabled" },
        () => {
          detailedAnalyticsEnabledRef.current = previous;
          setDetailedAnalyticsEnabledState(previous);
          setDetailedAnalyticsCollection(previous);
        },
      );
    },
    [queryClient],
  );

  // Sync local state when config data arrives (from async load or external
  // update). Merge with DEFAULT_APP_CONFIG so partial configs (common in tests)
  // still fill every local-state field.
  useEffect(() => {
    if (!configData) return;
    const cfg = { ...DEFAULT_APP_CONFIG, ...configData };
    setHiddenModels(new Set(cfg.hiddenModels));
    const detailedEnabled = cfg.detailedAnalytics === "enabled";
    detailedAnalyticsEnabledRef.current = detailedEnabled;
    setDetailedAnalyticsEnabledState(detailedEnabled);
    setDetailedAnalyticsCollection(detailedAnalyticsEnabledRef.current);
    // UI customization
    setAccentColorState(cfg.accentColor);
    setLayoutDensityState(cfg.layoutDensity);
    setFontSizeState(cfg.fontSize);
    setFontStyleState(cfg.fontStyle);
    setSoundEffectsState(cfg.soundEffects);
    setThemePresetState(cfg.themePreset);
    setThemeColorsState(cfg.themeColors);
    setSidebarCollapsedState(cfg.sidebarCollapsed);
    setExplorerCollapsedState(cfg.explorerCollapsed);
    // AI engine
    setTemperatureState(cfg.temperature);
    setMaxTokensState(cfg.maxTokens);
    setSystemPromptState(cfg.systemPrompt);
    setCustomApiEndpointState(cfg.customApiEndpoint);
    // Behavior
    setAutoScrollState(cfg.autoScroll);
    setEnterToSendState(cfg.enterToSend);
    setNotificationsEnabledState(cfg.notificationsEnabled);
    // SSE connection
    setSseReconnectDelayState(cfg.sseReconnectDelay);
    setSseHeartbeatTimeoutState(cfg.sseHeartbeatTimeout);

    if (cfg.detailedAnalytics === "unset") {
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

  const setSelectedModel = useCallback(
    (modelID: string) => {
      setSelectedModelState(modelID);
      persistWithFeedback(queryClient, { lastModel: modelID }, () => setSelectedModelState(null));
    },
    [queryClient],
  );

  const setSelectedAgent = useCallback((name: string) => setSelectedAgentState(name), []);

  const setSelectedVariant = useCallback(
    (variant: string | null) => {
      setSelectedVariantState(variant);
      persistWithFeedback(queryClient, { defaultVariant: variant }, () =>
        setSelectedVariantState(null),
      );
    },
    [queryClient],
  );

  const toggleModelVisibility = useCallback(
    (modelKey: string) => {
      const next = new Set(hiddenModels);
      if (next.has(modelKey)) {
        next.delete(modelKey);
      } else {
        next.add(modelKey);
      }
      setHiddenModels(next);
      persistWithFeedback(queryClient, { hiddenModels: [...next] }, () =>
        setHiddenModels(hiddenModels),
      );
    },
    [queryClient, hiddenModels],
  );

  // UI customization setters
  const setAccentColor = useCallback(
    (color: AccentColor) => {
      setAccentColorState(color);
      persistWithFeedback(queryClient, { accentColor: color }, () => setAccentColorState("cyan"));
    },
    [queryClient],
  );
  const setLayoutDensity = useCallback(
    (density: LayoutDensity) => {
      setLayoutDensityState(density);
      persistWithFeedback(queryClient, { layoutDensity: density }, () =>
        setLayoutDensityState("comfortable"),
      );
    },
    [queryClient],
  );
  const setFontSize = useCallback(
    (size: number) => {
      setFontSizeState(size);
      persistWithFeedback(queryClient, { fontSize: size }, () => setFontSizeState(1));
    },
    [queryClient],
  );
  const setFontStyle = useCallback(
    (style: FontStyle) => {
      setFontStyleState(style);
      persistWithFeedback(queryClient, { fontStyle: style }, () =>
        setFontStyleState(DEFAULT_APP_CONFIG.fontStyle),
      );
    },
    [queryClient],
  );
  const setSoundEffects = useCallback(
    (enabled: boolean) => {
      setSoundEffectsState(enabled);
      persistWithFeedback(queryClient, { soundEffects: enabled }, () => setSoundEffectsState(true));
    },
    [queryClient],
  );
  const setThemePreset = useCallback(
    (preset: ThemePreset) => {
      setThemePresetState(preset);
      if (preset !== "custom") {
        const colors = THEME_PRESETS[preset];
        setThemeColorsState(colors);
        persistWithFeedback(queryClient, { themePreset: preset, themeColors: colors }, () =>
          setThemePresetState("dark-neon"),
        );
      } else {
        persistWithFeedback(queryClient, { themePreset: preset }, () =>
          setThemePresetState("dark-neon"),
        );
      }
    },
    [queryClient],
  );
  const setThemeColors = useCallback(
    (colors: ThemeColors) => {
      setThemeColorsState(colors);
      setThemePresetState("custom");
      persistWithFeedback(queryClient, { themePreset: "custom", themeColors: colors }, () =>
        setThemeColorsState({
          selectedBg: "#06B6D4",
          selectedFg: "#000000",
          hoverBg: LOCKED_HOVER_BG,
          hoverFg: LOCKED_HOVER_FG,
        }),
      );
    },
    [queryClient],
  );
  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => {
      setSidebarCollapsedState(collapsed);
      persistWithFeedback(queryClient, { sidebarCollapsed: collapsed }, () =>
        setSidebarCollapsedState(DEFAULT_APP_CONFIG.sidebarCollapsed),
      );
    },
    [queryClient],
  );
  const setExplorerCollapsed = useCallback(
    (collapsed: boolean) => {
      setExplorerCollapsedState(collapsed);
      persistWithFeedback(queryClient, { explorerCollapsed: collapsed }, () =>
        setExplorerCollapsedState(DEFAULT_APP_CONFIG.explorerCollapsed),
      );
    },
    [queryClient],
  );

  // AI engine setters
  const setTemperature = useCallback(
    (temp: number) => {
      setTemperatureState(temp);
      persistWithFeedback(queryClient, { temperature: temp }, () => setTemperatureState(0.7));
    },
    [queryClient],
  );
  const setMaxTokens = useCallback(
    (tokens: number) => {
      setMaxTokensState(tokens);
      persistWithFeedback(queryClient, { maxTokens: tokens }, () => setMaxTokensState(4_096));
    },
    [queryClient],
  );
  const setSystemPrompt = useCallback(
    (prompt: string) => {
      setSystemPromptState(prompt);
      persistWithFeedback(queryClient, { systemPrompt: prompt }, () => setSystemPromptState(""));
    },
    [queryClient],
  );
  const setCustomApiEndpoint = useCallback(
    (endpoint: string | null) => {
      setCustomApiEndpointState(endpoint);
      persistWithFeedback(queryClient, { customApiEndpoint: endpoint }, () =>
        setCustomApiEndpointState(null),
      );
    },
    [queryClient],
  );

  // Behavior setters
  const setAutoScroll = useCallback(
    (enabled: boolean) => {
      setAutoScrollState(enabled);
      persistWithFeedback(queryClient, { autoScroll: enabled }, () => setAutoScrollState(true));
    },
    [queryClient],
  );
  const setEnterToSend = useCallback(
    (enabled: boolean) => {
      setEnterToSendState(enabled);
      persistWithFeedback(queryClient, { enterToSend: enabled }, () => setEnterToSendState(true));
    },
    [queryClient],
  );
  const setNotificationsEnabled = useCallback(
    (enabled: boolean) => {
      setNotificationsEnabledState(enabled);
      persistWithFeedback(queryClient, { notificationsEnabled: enabled }, () =>
        setNotificationsEnabledState(true),
      );
    },
    [queryClient],
  );

  // SSE connection setters
  const setSseReconnectDelay = useCallback(
    (delay: number) => {
      setSseReconnectDelayState(delay);
      persistWithFeedback(queryClient, { sseReconnectDelay: delay }, () =>
        setSseReconnectDelayState(3_000),
      );
    },
    [queryClient],
  );
  const setSseHeartbeatTimeout = useCallback(
    (timeout: number) => {
      setSseHeartbeatTimeoutState(timeout);
      persistWithFeedback(queryClient, { sseHeartbeatTimeout: timeout }, () =>
        setSseHeartbeatTimeoutState(30_000),
      );
    },
    [queryClient],
  );

  // Apply UI customization CSS variables
  useEffect(() => {
    applyAccentColor(accentColor);
  }, [accentColor]);

  useEffect(() => {
    applyThemeColors(themeColors);
  }, [themeColors]);

  useEffect(() => {
    applyLayoutDensity(layoutDensity);
  }, [layoutDensity]);

  useEffect(() => {
    applyFontSize(fontSize);
  }, [fontSize]);

  useEffect(() => {
    applyFontStyle(fontStyle);
  }, [fontStyle]);

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
      fontStyle,
      soundEffects,
      themePreset,
      themeColors,
      sidebarCollapsed,
      explorerCollapsed,
      setAccentColor,
      setLayoutDensity,
      setFontSize,
      setFontStyle,
      setSoundEffects,
      setThemePreset,
      setThemeColors,
      setSidebarCollapsed,
      setExplorerCollapsed,
    }),
    [
      accentColor,
      layoutDensity,
      fontSize,
      fontStyle,
      soundEffects,
      themePreset,
      themeColors,
      sidebarCollapsed,
      explorerCollapsed,
      setAccentColor,
      setLayoutDensity,
      setFontSize,
      setFontStyle,
      setSoundEffects,
      setThemePreset,
      setThemeColors,
      setSidebarCollapsed,
      setExplorerCollapsed,
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

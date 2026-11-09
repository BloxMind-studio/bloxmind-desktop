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
import {
  ANALYTICS_NOTICE_VERSION,
  setDetailedAnalyticsEnabled as setDetailedAnalyticsCollection,
} from "@/lib/analytics";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { setNotificationsEnabled as setDesktopNotificationsEnabled } from "@/lib/desktopNotifications";
import { applyMcpServers, type McpServerConfig } from "@/lib/mcpServers";
import { qk } from "@/lib/queryKeys";
import { setSoundEffectsEnabled } from "@/lib/soundEffects";
import { splitModelKey } from "@/lib/splitModelKey";
import { DEFAULT_VERIFICATION_LEVEL, type VerificationLevel } from "@/lib/verification";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
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
  /** Summarize older messages automatically when the context window fills up. */
  autoCompaction: boolean;
  systemPrompt: string;
  customApiEndpoint: string | null;
  // Behavior
  autoScroll: boolean;
  enterToSend: boolean;
  notificationsEnabled: boolean;
  /** How thoroughly the assistant verifies a change before reporting. */
  verificationLevel: VerificationLevel;
  // SSE connection
  sseReconnectDelay: number;
  sseHeartbeatTimeout: number;
  // Extra MCP servers (Settings → Integrations)
  mcpServers: McpServerConfig[];
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
  setAutoCompaction: (enabled: boolean) => void;
  setSystemPrompt: (prompt: string) => void;
  setCustomApiEndpoint: (endpoint: string | null) => void;
  setAutoScroll: (enabled: boolean) => void;
  setEnterToSend: (enabled: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setVerificationLevel: (level: VerificationLevel) => void;
  setSseReconnectDelay: (delay: number) => void;
  setSseHeartbeatTimeout: (timeout: number) => void;
  setMcpServers: (servers: McpServerConfig[]) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

/**
 * Settings inputs fire per keystroke and per slider step. Each write is an IPC
 * round trip plus a full config rewrite, so a burst is coalesced into one.
 */
const CONFIG_WRITE_DEBOUNCE_MS = 400;

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
  // Whether the persisted default variant has been applied this session; a
  // later config refetch must not reset a variant the user has since picked.
  const variantRestoredRef = useRef(false);
  // UI customization
  const [accentColor, setAccentColorState] = useState<AccentColor>("blue");
  const [layoutDensity, setLayoutDensityState] = useState<LayoutDensity>("comfortable");
  const [fontSize, setFontSizeState] = useState(1);
  const [soundEffects, setSoundEffectsState] = useState(true);
  // AI engine
  const [temperature, setTemperatureState] = useState(0.7);
  const [maxTokens, setMaxTokensState] = useState(0);
  const [autoCompaction, setAutoCompactionState] = useState(true);
  const [systemPrompt, setSystemPromptState] = useState("");
  const [customApiEndpoint, setCustomApiEndpointState] = useState<string | null>(null);
  // Behavior
  const [autoScroll, setAutoScrollState] = useState(true);
  const [enterToSend, setEnterToSendState] = useState(true);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [verificationLevel, setVerificationLevelState] = useState<VerificationLevel>(
    DEFAULT_VERIFICATION_LEVEL,
  );
  // SSE connection
  const [sseReconnectDelay, setSseReconnectDelayState] = useState(3_000);
  const [sseHeartbeatTimeout, setSseHeartbeatTimeoutState] = useState(30_000);
  // Extra MCP servers (Settings → Integrations)
  const [mcpServers, setMcpServersState] = useState<McpServerConfig[]>([]);

  const connectedProviders = useConnectedProviders();
  const { client } = useOpenCodeClient();

  // Pending settings write. Merged so a burst of edits lands as one patch and
  // flushed on blur/unmount so a fast quit cannot drop the last change.
  const pendingPatchRef = useRef<Partial<AppConfig>>({});
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingPatch = useCallback(() => {
    if (patchTimerRef.current !== null) {
      clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(patch).length === 0) return;
    patchConfig(patch).catch(() => {});
  }, []);
  const queuePatch = useCallback(
    (patch: Partial<AppConfig>) => {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
      if (patchTimerRef.current !== null) clearTimeout(patchTimerRef.current);
      patchTimerRef.current = setTimeout(() => {
        patchTimerRef.current = null;
        flushPendingPatch();
      }, CONFIG_WRITE_DEBOUNCE_MS);
    },
    [flushPendingPatch],
  );

  useEffect(() => {
    const flush = () => flushPendingPatch();
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", flush);
      flushPendingPatch();
    };
  }, [flushPendingPatch]);

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

  // Initialize from config data when it arrives and notify once about opt-out metrics.
  useEffect(() => {
    if (!configData) return;
    // A debounced edit is newer than this snapshot; applying it would undo
    // what the user is typing.
    if (Object.keys(pendingPatchRef.current).length > 0) return;
    setHiddenModels(new Set(configData.hiddenModels));

    // These settings are independent of the analytics notice, so they are
    // applied before the branch below. Returning early for a pending notice
    // used to leave every one of them at its default until some later refetch.
    // UI customization
    setAccentColorState(configData.accentColor);
    setLayoutDensityState(configData.layoutDensity);
    setFontSizeState(configData.fontSize);
    setSoundEffectsState(configData.soundEffects);
    // AI engine
    setTemperatureState(configData.temperature);
    setMaxTokensState(configData.maxTokens);
    setAutoCompactionState(configData.autoCompaction);
    setSystemPromptState(configData.systemPrompt);
    setCustomApiEndpointState(configData.customApiEndpoint);
    // Behavior
    setAutoScrollState(configData.autoScroll);
    setEnterToSendState(configData.enterToSend);
    setNotificationsEnabledState(configData.notificationsEnabled);
    setVerificationLevelState(configData.verificationLevel);
    // SSE connection
    setSseReconnectDelayState(configData.sseReconnectDelay);
    setSseHeartbeatTimeoutState(configData.sseHeartbeatTimeout);
    // Extra MCP servers
    setMcpServersState(configData.mcpServers);

    // Detailed AI traces are opt-in as of notice version 3: nothing beyond basic
    // app health events leaves the device until the user turns sharing on. Users
    // who already declined are not asked again; anyone else gets one prompt and
    // stays off unless they accept it (or enable the switch later).
    if (configData.analyticsNoticeVersion < ANALYTICS_NOTICE_VERSION) {
      const alreadyDeclined = configData.detailedAnalytics === "disabled";
      detailedAnalyticsEnabledRef.current = false;
      setDetailedAnalyticsEnabledState(false);
      setDetailedAnalyticsCollection(false);
      if (!alreadyDeclined) {
        toast("Share AI usage data?", {
          id: "analytics-optin-notice",
          className: "analytics-consent-toast",
          description:
            "Off by default. Turn on to share your prompts, AI responses and tool activity to improve BloxMind. Details in Settings → Privacy.",
          duration: Number.POSITIVE_INFINITY,
          action: {
            label: "Share",
            onClick: () => setDetailedAnalyticsEnabled(true),
          },
          cancel: {
            label: "No thanks",
            onClick: () => {},
          },
        });
      }
      // Persist only after the notice is on screen, so a failure to show it
      // leaves the version behind and the notice fires again next launch.
      patchConfig({
        detailedAnalytics: "disabled",
        analyticsNoticeVersion: ANALYTICS_NOTICE_VERSION,
      }).catch(() => {});
      return;
    }

    const detailedEnabled = configData.detailedAnalytics === "enabled";
    detailedAnalyticsEnabledRef.current = detailedEnabled;
    setDetailedAnalyticsEnabledState(detailedEnabled);
    setDetailedAnalyticsCollection(detailedEnabled);
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
    // Restore the persisted default variant (reasoning effort) once per
    // session. Re-applying it on every config refetch would clobber a variant
    // the user picked after the initial load (e.g. right after a model switch
    // triggers a config patch + refetch).
    if (!variantRestoredRef.current) {
      variantRestoredRef.current = true;
      if (configData.defaultVariant) {
        setSelectedVariantState(configData.defaultVariant);
      }
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
      queuePatch({ lastModel: modelID });
    },
    [queuePatch],
  );

  const setSelectedAgent = useCallback((name: string) => {
    setSelectedAgentState(name);
  }, []);

  const setSelectedVariant = useCallback(
    (variant: string | null) => {
      setSelectedVariantState(variant);
      queuePatch({ defaultVariant: variant });
    },
    [queuePatch],
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
      queuePatch({ hiddenModels: [...next] });
    },
    [hiddenModels, queuePatch],
  );

  // UI customization setters
  const setAccentColor = useCallback(
    (color: AccentColor) => {
      setAccentColorState(color);
      queuePatch({ accentColor: color });
    },
    [queuePatch],
  );
  const setLayoutDensity = useCallback(
    (density: LayoutDensity) => {
      setLayoutDensityState(density);
      queuePatch({ layoutDensity: density });
    },
    [queuePatch],
  );
  const setFontSize = useCallback(
    (size: number) => {
      setFontSizeState(size);
      queuePatch({ fontSize: size });
    },
    [queuePatch],
  );
  const setSoundEffects = useCallback(
    (enabled: boolean) => {
      setSoundEffectsState(enabled);
      queuePatch({ soundEffects: enabled });
    },
    [queuePatch],
  );

  // AI engine setters
  const setTemperature = useCallback(
    (temp: number) => {
      setTemperatureState(temp);
      queuePatch({ temperature: temp });
    },
    [queuePatch],
  );
  const setMaxTokens = useCallback(
    (tokens: number) => {
      setMaxTokensState(tokens);
      queuePatch({ maxTokens: tokens });
    },
    [queuePatch],
  );
  const setAutoCompaction = useCallback(
    (enabled: boolean) => {
      setAutoCompactionState(enabled);
      queuePatch({ autoCompaction: enabled });
    },
    [queuePatch],
  );
  const setSystemPrompt = useCallback(
    (prompt: string) => {
      setSystemPromptState(prompt);
      queuePatch({ systemPrompt: prompt });
    },
    [queuePatch],
  );
  const setCustomApiEndpoint = useCallback(
    (endpoint: string | null) => {
      setCustomApiEndpointState(endpoint);
      queuePatch({ customApiEndpoint: endpoint });
    },
    [queuePatch],
  );

  // Behavior setters
  const setAutoScroll = useCallback(
    (enabled: boolean) => {
      setAutoScrollState(enabled);
      queuePatch({ autoScroll: enabled });
    },
    [queuePatch],
  );
  const setEnterToSend = useCallback(
    (enabled: boolean) => {
      setEnterToSendState(enabled);
      queuePatch({ enterToSend: enabled });
    },
    [queuePatch],
  );
  const setNotificationsEnabled = useCallback(
    (enabled: boolean) => {
      setNotificationsEnabledState(enabled);
      queuePatch({ notificationsEnabled: enabled });
    },
    [queuePatch],
  );
  const setVerificationLevel = useCallback(
    (level: VerificationLevel) => {
      setVerificationLevelState(level);
      queuePatch({ verificationLevel: level });
    },
    [queuePatch],
  );

  // SSE connection setters
  const setSseReconnectDelay = useCallback(
    (delay: number) => {
      setSseReconnectDelayState(delay);
      queuePatch({ sseReconnectDelay: delay });
    },
    [queuePatch],
  );
  const setSseHeartbeatTimeout = useCallback(
    (timeout: number) => {
      setSseHeartbeatTimeoutState(timeout);
      queuePatch({ sseHeartbeatTimeout: timeout });
    },
    [queuePatch],
  );

  // Persist the MCP server list and push it into the running engine. The
  // engine config file also carries the list, so a change made while the
  // engine is starting still lands at next launch; the live apply covers the
  // running session.
  const setMcpServers = useCallback(
    (next: McpServerConfig[]) => {
      const removed = mcpServers
        .filter((server) => !next.some((candidate) => candidate.name === server.name))
        .map((server) => server.name);
      setMcpServersState(next);
      patchConfig({ mcpServers: next }).catch(() => {});
      if (client) {
        void applyMcpServers(client, next, removed).catch((error: unknown) => {
          console.warn("Failed to apply MCP servers:", error);
          toast.error(
            "The change was saved, but the running engine didn't accept it. Restart BloxMind to apply it.",
          );
        });
      }
    },
    [client, mcpServers],
  );

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

  // Mirror the toggles into the module-level flags the chat surfaces read.
  useEffect(() => {
    setSoundEffectsEnabled(soundEffects);
  }, [soundEffects]);

  useEffect(() => {
    setDesktopNotificationsEnabled(notificationsEnabled);
  }, [notificationsEnabled]);

  // OpenCode 2 has no live config channel (BloxMind's engine reads its config
  // from disk at startup), so there is nothing to push here: the engine gets
  // the settings at the next launch, and they are applied through the engine
  // config file, not through a config-patch round-trip.

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
      autoCompaction,
      systemPrompt,
      customApiEndpoint,
      autoScroll,
      enterToSend,
      notificationsEnabled,
      verificationLevel,
      sseReconnectDelay,
      sseHeartbeatTimeout,
      mcpServers,
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
      setAutoCompaction,
      setSystemPrompt,
      setCustomApiEndpoint,
      setAutoScroll,
      setEnterToSend,
      setNotificationsEnabled,
      setVerificationLevel,
      setSseReconnectDelay,
      setSseHeartbeatTimeout,
      setMcpServers,
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
      autoCompaction,
      systemPrompt,
      customApiEndpoint,
      autoScroll,
      enterToSend,
      notificationsEnabled,
      verificationLevel,
      sseReconnectDelay,
      sseHeartbeatTimeout,
      mcpServers,
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
      setAutoCompaction,
      setSystemPrompt,
      setCustomApiEndpoint,
      setAutoScroll,
      setEnterToSend,
      setNotificationsEnabled,
      setVerificationLevel,
      setSseReconnectDelay,
      setSseHeartbeatTimeout,
      setMcpServers,
    ],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

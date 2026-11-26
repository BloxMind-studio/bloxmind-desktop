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
import { useConnectedProviders, useProviderList } from "@/hooks/useProviders";
import {
  ANALYTICS_NOTICE_VERSION,
  setDetailedAnalyticsEnabled as setDetailedAnalyticsCollection,
} from "@/lib/analytics";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { goneReason, modelName, replacementModel } from "@/lib/modelChoice";
import { offerNotificationsOnce } from "@/lib/notificationOffer";
import { setNotificationPreferences } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
import { setSoundEffectsEnabled } from "@/lib/soundEffects";
import { splitModelKey } from "@/lib/splitModelKey";
import { DEFAULT_VERIFICATION_LEVEL, type VerificationLevel } from "@/lib/verification";
import type { AccentColor, LayoutDensity, NotificationKinds } from "@/types/desktop";

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
  /** Models refused in the user's region. */
  unavailableModels: Set<string>;
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
  /** Granular notification choices; the master switch above still applies. */
  notifications: { kinds: NotificationKinds; sound: boolean };
  /** How thoroughly the assistant verifies a change before reporting. */
  verificationLevel: VerificationLevel;
  // SSE connection
  sseReconnectDelay: number;
  sseHeartbeatTimeout: number;
  setSelectedModel: (modelID: string) => void;
  setSelectedAgent: (name: string) => void;
  setSelectedVariant: (variant: string | null) => void;
  toggleModelVisibility: (modelKey: string) => void;
  markModelUnavailable: (modelKey: string) => void;
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
  setNotificationKind: (kind: keyof NotificationKinds, enabled: boolean) => void;
  setNotificationSound: (enabled: boolean) => void;
  setVerificationLevel: (level: VerificationLevel) => void;
  setSseReconnectDelay: (delay: number) => void;
  setSseHeartbeatTimeout: (timeout: number) => void;
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
  const [unavailableModels, setUnavailableModels] = useState<Set<string>>(new Set());
  const unavailableRef = useRef(unavailableModels);
  // Models already moved away from, so a stale saved choice isn't announced twice.
  const movedFromRef = useRef(new Set<string>());
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
  const [notificationKinds, setNotificationKindsState] = useState<NotificationKinds>({
    finished: true,
    waiting: true,
    failed: true,
    app: true,
  });
  const [notificationSound, setNotificationSoundState] = useState(true);
  const [verificationLevel, setVerificationLevelState] = useState<VerificationLevel>(
    DEFAULT_VERIFICATION_LEVEL,
  );
  // SSE connection
  const [sseReconnectDelay, setSseReconnectDelayState] = useState(3_000);
  const [sseHeartbeatTimeout, setSseHeartbeatTimeoutState] = useState(30_000);

  const connectedProviders = useConnectedProviders();
  const providerList = useProviderList();

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
    unavailableRef.current = new Set(configData.unavailableModels ?? []);
    setUnavailableModels(unavailableRef.current);

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
    setNotificationKindsState(
      configData.notificationKinds ?? { finished: true, waiting: true, failed: true, app: true },
    );
    setNotificationSoundState(configData.notificationSound);
    setVerificationLevelState(configData.verificationLevel);
    // SSE connection
    setSseReconnectDelayState(configData.sseReconnectDelay);
    setSseHeartbeatTimeoutState(configData.sseHeartbeatTimeout);

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

    const restoring =
      !selectedModel &&
      configData.lastModel &&
      connectedProviders.includes(splitModelKey(configData.lastModel)[0])
        ? configData.lastModel
        : null;
    const current = selectedModel ?? restoring;

    if (current) {
      // Read from the config too: on first load the state hasn't caught up with it yet.
      const unavailable = new Set([...(configData.unavailableModels ?? []), ...unavailableModels]);
      const gone = providerList && goneReason(providerList, current, unavailable);
      // A model refused in this region keeps its card, which offers the switch,
      // until the next launch.
      if (providerList && (gone === "retired" || (gone === "region" && restoring))) {
        if (!movedFromRef.current.has(current)) {
          movedFromRef.current.add(current);
          const next = replacementModel(providerList, current, unavailable);
          setSelectedModelState(next?.key ?? null);
          setSelectedVariantState(null);
          queuePatch({ lastModel: next?.key ?? null });
          toast(
            `${modelName(providerList, current)} ${
              gone === "retired" ? "is no longer available" : "isn't offered in your region"
            }`,
            {
              description: `This chat now uses ${next?.name ?? "the default model"}.`,
            },
          );
        }
        return;
      }
    }

    if (restoring) setSelectedModelState(restoring);
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
  }, [configData, connectedProviders, providerList, selectedModel, unavailableModels, queuePatch]);
  // Auto-select first agent
  const agents = useAgents();
  useEffect(() => {
    if (agents.length === 0 || selectedAgent) return;
    const primary = agents.find((a) => a.mode === "primary" && !a.hidden);
    if (primary) setSelectedAgentState(primary.id);
  }, [agents, selectedAgent]);

  const setSelectedModel = useCallback(
    (modelID: string) => {
      setSelectedModelState((current) => {
        // A variant belongs to its model, and another model may not have it.
        if (current !== modelID) setSelectedVariantState(null);
        return modelID;
      });
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

  const markModelUnavailable = useCallback(
    (modelKey: string) => {
      if (unavailableRef.current.has(modelKey)) return;
      const next = new Set(unavailableRef.current).add(modelKey);
      unavailableRef.current = next;
      setUnavailableModels(next);
      queuePatch({ unavailableModels: [...next] });
    },
    [queuePatch],
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
  const setNotificationKind = useCallback(
    (kind: keyof NotificationKinds, enabled: boolean) => {
      setNotificationKindsState((current) => {
        const next = { ...current, [kind]: enabled };
        queuePatch({ notificationKinds: next });
        return next;
      });
    },
    [queuePatch],
  );
  const setNotificationSound = useCallback(
    (enabled: boolean) => {
      setNotificationSoundState(enabled);
      queuePatch({ notificationSound: enabled });
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
    setNotificationPreferences(notificationKinds, notificationSound, notificationsEnabled);
  }, [notificationKinds, notificationSound, notificationsEnabled]);

  // A Mac only asks for notification permission when the first one is sent, so
  // ask once while someone is here to answer rather than when they are away.
  useEffect(() => {
    if (!configData) return;
    void offerNotificationsOnce();
  }, [configData]);

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
      unavailableModels,
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
      notifications: { kinds: notificationKinds, sound: notificationSound },
      verificationLevel,
      sseReconnectDelay,
      sseHeartbeatTimeout,
      setSelectedModel,
      setSelectedAgent,
      setSelectedVariant,
      toggleModelVisibility,
      markModelUnavailable,
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
      setNotificationKind,
      setNotificationSound,
      setVerificationLevel,
      setSseReconnectDelay,
      setSseHeartbeatTimeout,
    }),
    [
      selectedModel,
      selectedAgent,
      selectedVariant,
      hiddenModels,
      unavailableModels,
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
      notificationKinds,
      notificationSound,
      verificationLevel,
      sseReconnectDelay,
      sseHeartbeatTimeout,
      setSelectedModel,
      setSelectedAgent,
      setSelectedVariant,
      toggleModelVisibility,
      markModelUnavailable,
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
      setNotificationKind,
      setNotificationSound,
      setVerificationLevel,
      setSseReconnectDelay,
      setSseHeartbeatTimeout,
    ],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

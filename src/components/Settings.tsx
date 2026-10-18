import type { Model } from "@opencode-ai/sdk/v2/client";
import { Search, Sparkles } from "lucide-react";
import posthog from "posthog-js/dist/module.full.no-external.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import ProviderCheckPopover from "@/components/ProviderCheckPopover";
import ProviderConnectDialog from "@/components/ProviderConnectDialog";
import ProviderLogo from "@/components/ProviderLogo";
import { THEME_OPTIONS, type Theme, useTheme } from "@/components/theme-provider";
import { useCheckProvider } from "@/hooks/mutations/useCheckProvider";
import { useDisconnectProvider } from "@/hooks/mutations/useSetApiKey";
import { type McpServerLiveStatus, useMcpStatus } from "@/hooks/useMcpStatus";
import {
  useAllModels,
  useAllProviders,
  useAuthMethods,
  useConnectedProviders,
  useProviderList,
} from "@/hooks/useProviders";
import { analyticsDeviceId, analyticsProperties } from "@/lib/analytics";
import { desktop } from "@/lib/desktop";
import {
  BLENDER_ANIMATIONS_PLUGIN_URL,
  blenderMcpServer,
  type McpServerConfig,
  parseCommandLine,
  validateMcpServer,
} from "@/lib/mcpServers";
import { OPENCODE_GO, shouldRecommendOpenCodeGo } from "@/lib/opencodeGo";
import { connectHint, isFreeTier, providerDisplayName } from "@/lib/providerAuth";
import { checkModels, checkPreference, type ProviderCheckResult } from "@/lib/providerCheck";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { ModelInfo, ProviderInfo } from "@/types";
import {
  type AppConfig,
  type BlenderSetupResult,
  DEFAULT_APP_CONFIG,
  type UpdateInfo,
} from "@/types/desktop";

// ── Popular providers (same order as OpenCode's web UI) ──────────────
const POPULAR_PROVIDERS = [
  "opencode",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
];

/** OpenCode Zen with only the built-in free models. */
const isFreeZen = isFreeTier;

/** OpenCode Zen with a key added in BloxMind, which falls back to the free models when removed. */
function hasZenKey(provider: ProviderInfo): boolean {
  return provider.id === "opencode" && provider.source === "api";
}

/** OpenCode Zen with a key from the environment or config, which BloxMind can't remove. */
function hasOutsideZenKey(provider: ProviderInfo): boolean {
  return provider.id === "opencode" && !isFreeZen(provider) && !hasZenKey(provider);
}

const TECHNOLOGIES = [
  { name: "OpenCode", url: "https://opencode.ai", description: "AI coding engine" },
  {
    name: "Roblox Studio MCP",
    url: "https://create.roblox.com/docs/studio/mcp",
    description: "Official Studio MCP server",
  },
];

type SettingsTab =
  | "general"
  | "providers"
  | "models"
  | "integrations"
  | "engine"
  | "behavior"
  | "connection"
  | "appearance"
  | "privacy"
  | "about";

interface SettingsProps {
  onClose: () => void;
}

function Settings({ onClose }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>("providers");
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    desktop
      .getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4">
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Back to chat"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h3 className="text-xs font-semibold">Settings</h3>
      </div>

      {/* Body: sidebar + content. When narrow (e.g. the sessions sidebar is
          open in a small window) the sidebar becomes a tab row on top. */}
      <div className="flex min-h-0 flex-1 flex-col @xl:flex-row">
        {/* Sidebar */}
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-1.5 py-2 @xl:w-40 @xl:flex-col @xl:gap-0 @xl:overflow-visible @xl:border-r @xl:border-b-0 @xl:px-0 @xl:py-3">
          <div className="hidden px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground @xl:block">
            Server
          </div>
          <button
            onClick={() => setTab("providers")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-xs transition-colors @xl:mx-1.5 ${
              tab === "providers"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Providers
          </button>
          <button
            onClick={() => setTab("models")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-xs transition-colors @xl:mx-1.5 ${
              tab === "models"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Models
          </button>
          <button
            onClick={() => setTab("integrations")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-xs transition-colors @xl:mx-1.5 ${
              tab === "integrations"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 3H5a2 2 0 0 0-2 2v4" />
              <path d="M15 3h4a2 2 0 0 1 2 2v4" />
              <path d="M9 21H5a2 2 0 0 1-2-2v-4" />
              <path d="M15 21h4a2 2 0 0 0 2-2v-4" />
              <circle cx="12" cy="12" r="2" />
            </svg>
            Integrations
          </button>

          <div className="mt-4 hidden px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground @xl:block">
            App
          </div>
          <button
            onClick={() => setTab("general")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "general"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            General
          </button>
          <button
            onClick={() => setTab("engine")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "engine"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            AI Engine
          </button>
          <button
            onClick={() => setTab("behavior")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "behavior"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20V10" />
              <path d="M18 20V4" />
              <path d="M6 20v-4" />
            </svg>
            Behavior
          </button>
          <button
            onClick={() => setTab("connection")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "connection"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            Connection
          </button>
          <button
            onClick={() => setTab("appearance")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-xs transition-colors @xl:mx-1.5 ${
              tab === "appearance"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            Appearance
          </button>
          <button
            onClick={() => setTab("about")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-xs transition-colors @xl:mx-1.5 ${
              tab === "about"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            About
          </button>
          <button
            type="button"
            onClick={() => setTab("privacy")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-xs transition-colors @xl:mx-1.5 ${
              tab === "privacy"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Privacy
          </button>
        </div>

        {/* Content area */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {tab === "general" && <GeneralTab />}
          {tab === "providers" && <ProvidersTab />}
          {tab === "models" && <ModelsTab />}
          {tab === "integrations" && <IntegrationsTab />}
          {tab === "engine" && <EngineTab />}
          {tab === "behavior" && <BehaviorTab />}
          {tab === "connection" && <ConnectionTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "privacy" && <PrivacyTab />}
          {tab === "about" && <AboutTab appVersion={appVersion} />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Providers Tab — connected, popular, and every other provider, searchable
// ═══════════════════════════════════════════════════════════════════════

function ProvidersTab() {
  const allProviders = useAllProviders();
  const connectedProviders = useConnectedProviders();
  const authMethods = useAuthMethods();
  const disconnectMutation = useDisconnectProvider();

  const [connecting, setConnecting] = useState<ProviderInfo | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [checks, setChecks] = useState<Record<string, "checking" | ProviderCheckResult>>({});
  const checkMutation = useCheckProvider();
  const providerList = useProviderList();
  const { selectedModel } = usePreferences();

  // Bumped whenever a provider's credential changes, so a check that was
  // running for the old credential can't report onto the new one.
  const checkGeneration = useRef<Record<string, number>>({});
  const [checkPickerFor, setCheckPickerFor] = useState<string | null>(null);

  function forgetCheck(providerId: string) {
    checkGeneration.current[providerId] = (checkGeneration.current[providerId] ?? 0) + 1;
    setChecks((prev) => {
      const { [providerId]: _stale, ...rest } = prev;
      return rest;
    });
  }

  // A provider's chat models, the user's chat model or the provider's default
  // first. Kept in a ref so the toast's check, clicked later, sees the models
  // the new credential unlocked.
  const checkModelsFor = useRef<(providerId: string) => Model[]>(() => []);
  checkModelsFor.current = (providerId) => {
    const provider = providerList?.all.find((p) => p.id === providerId);
    return provider
      ? checkModels(provider, checkPreference(providerId, selectedModel, providerList?.default))
      : [];
  };

  async function runCheck(provider: ProviderInfo, model: Model | undefined) {
    const generation = (checkGeneration.current[provider.id] ?? 0) + 1;
    checkGeneration.current[provider.id] = generation;
    let result: ProviderCheckResult;
    if (!model) {
      result = {
        ok: false,
        message: "This provider has no chat models to test with.",
        keyRejected: false,
      };
    } else {
      setChecks((prev) => ({ ...prev, [provider.id]: "checking" }));
      try {
        result = await checkMutation.mutateAsync({ providerID: provider.id, modelID: model.id });
      } catch {
        result = {
          ok: false,
          message: "BloxMind couldn't run the check. Try again.",
          keyRejected: false,
          modelName: model.name,
        };
      }
    }
    if (checkGeneration.current[provider.id] !== generation) return;
    setChecks((prev) => ({ ...prev, [provider.id]: result }));
  }

  function handleConnected(provider: ProviderInfo) {
    // A new credential makes any earlier or running check stale.
    forgetCheck(provider.id);
    toast.success(`${provider.name} connected`, {
      action: {
        label: "Check it works",
        // Opens the picker rather than checking a guessed model: only the
        // user knows which models their key or plan includes.
        onClick: () => setCheckPickerFor(provider.id),
      },
    });
  }

  async function handleDisconnect(provider: ProviderInfo) {
    setDisconnecting(provider.id);
    try {
      await disconnectMutation.mutateAsync(provider.id);
      forgetCheck(provider.id);
      toast.success(
        hasZenKey(provider)
          ? "OpenCode Zen key removed. The free models are still available."
          : "Provider disconnected",
      );
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setDisconnecting(null);
    }
  }

  const needle = query.trim().toLowerCase();
  const matches = useCallback(
    (p: ProviderInfo, label = p.name) =>
      !needle || label.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle),
    [needle],
  );

  const connected = allProviders.filter(
    (p) => connectedProviders.includes(p.id) && matches(p, providerDisplayName(p)),
  );

  const goProvider = allProviders.find((p) => p.id === OPENCODE_GO.providerId);
  const recommendGo =
    !!goProvider &&
    !needle &&
    shouldRecommendOpenCodeGo(allProviders.filter((p) => connectedProviders.includes(p.id)));

  function setUpGo(source: "recommendation" | "list") {
    if (!goProvider) return;
    posthog.capture(
      "provider_recommendation_clicked",
      analyticsProperties("providers", { provider: OPENCODE_GO.providerId, source }),
    );
    setConnecting(goProvider);
  }

  // Popular first in OpenCode's order, then everything else alphabetically
  const { popular, others } = useMemo(() => {
    const pop: ProviderInfo[] = [];
    const oth: ProviderInfo[] = [];
    for (const p of allProviders) {
      // With only the free models connected, Zen is still offered as its own
      // provider: a key turns the same OpenCode provider into a Zen account.
      if ((connectedProviders.includes(p.id) && !isFreeZen(p)) || !matches(p)) continue;
      // The recommendation card already offers Go.
      if (recommendGo && p.id === OPENCODE_GO.providerId) continue;
      if (POPULAR_PROVIDERS.includes(p.id)) {
        pop.push(p);
      } else {
        oth.push(p);
      }
    }
    pop.sort((a, b) => POPULAR_PROVIDERS.indexOf(a.id) - POPULAR_PROVIDERS.indexOf(b.id));
    oth.sort((a, b) => a.name.localeCompare(b.name));
    return { popular: pop, others: oth };
  }, [allProviders, connectedProviders, matches, recommendGo]);

  const nothingMatches =
    allProviders.length > 0 && connected.length + popular.length + others.length === 0;

  function renderAvailable(provider: ProviderInfo) {
    return (
      <div key={provider.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <ProviderLogo providerId={provider.id} name={provider.name} />
        <div className="min-w-[7rem] flex-1">
          <div className="truncate text-sm font-medium">{provider.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {connectHint(provider.id, authMethods[provider.id])}
          </div>
        </div>
        <button
          onClick={() =>
            provider.id === OPENCODE_GO.providerId ? setUpGo("list") : setConnecting(provider)
          }
          className="shrink-0 whitespace-nowrap rounded-md border bg-background px-3 py-1 text-[11px] font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Connect
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="font-serif text-lg italic text-foreground">Providers</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Connect an AI provider to chat with its models.
      </p>

      {allProviders.length > 0 && (
        <div className="relative mt-5">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${allProviders.length} providers`}
            aria-label="Search providers"
            className="h-8 w-full rounded-md border bg-background pr-2 pl-8 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {recommendGo && (
        <div className="mt-6 rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <ProviderLogo
              providerId={OPENCODE_GO.providerId}
              name="OpenCode Go"
              className="hidden @md:flex"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium">Want more than the free models?</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                OpenCode Go is a low-cost subscription to strong open coding models like Kimi, GLM,
                Qwen and DeepSeek. Go is {OPENCODE_GO.goPrice}, and Go Plus is{" "}
                {OPENCODE_GO.goPlusPrice} with higher limits.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  onClick={() => setUpGo("recommendation")}
                  className="whitespace-nowrap rounded-md bg-foreground px-3 py-1.5 text-[11px] font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Set up OpenCode Go
                </button>
                <button
                  onClick={() => {
                    desktop.openUrl(OPENCODE_GO.plansUrl).catch(() => {});
                  }}
                  className="whitespace-nowrap text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  Compare plans
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connected providers */}
      {connected.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Connected
          </div>
          <div className="divide-y rounded-lg border bg-card">
            {connected.map((provider) => {
              const check = checks[provider.id];
              return (
                <div key={provider.id} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {isFreeZen(provider) ? (
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background text-foreground"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <ProviderLogo providerId={provider.id} name={provider.name} />
                    )}
                    <div className="min-w-[7rem] flex-1">
                      <div className="truncate text-sm font-medium">
                        {providerDisplayName(provider)}
                      </div>
                      {isFreeZen(provider) && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          Included with BloxMind
                        </div>
                      )}
                    </div>
                    {check && check !== "checking" && (
                      <span
                        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          check.ok
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                            : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${check.ok ? "bg-emerald-500" : "bg-red-500"}`}
                        />
                        {check.ok ? "Working" : "Not working"}
                      </span>
                    )}
                    <ProviderCheckPopover
                      providerName={providerDisplayName(provider)}
                      models={checkModelsFor.current(provider.id)}
                      checking={check === "checking"}
                      open={checkPickerFor === provider.id}
                      onOpenChange={(open) => setCheckPickerFor(open ? provider.id : null)}
                      onCheck={(model) => runCheck(provider, model)}
                    />
                    {/* The free models can't be disconnected, and BloxMind can't
                        remove a Zen key it didn't store. */}
                    {isFreeZen(provider) || hasOutsideZenKey(provider) ? null : (
                      <button
                        onClick={() => handleDisconnect(provider)}
                        disabled={disconnecting === provider.id}
                        className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-50"
                      >
                        {disconnecting === provider.id
                          ? "..."
                          : hasZenKey(provider)
                            ? "Remove key"
                            : "Disconnect"}
                      </button>
                    )}
                  </div>
                  {check && check !== "checking" && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground @md:pl-10">
                      {check.ok ? (
                        `Works with ${check.modelName}.`
                      ) : (
                        <>
                          {check.modelName && `Didn't work with ${check.modelName}. `}
                          <span className="text-red-700 dark:text-red-400">{check.message}</span>
                          {check.keyRejected && !isFreeZen(provider) && (
                            <button
                              onClick={() => setConnecting(provider)}
                              className="ml-1.5 font-medium text-foreground underline-offset-2 hover:underline"
                            >
                              Reconnect
                            </button>
                          )}
                        </>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {popular.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Popular
          </div>
          <div className="divide-y rounded-lg border bg-card">{popular.map(renderAvailable)}</div>
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {popular.length > 0 || connected.length > 0 ? "More providers" : "Providers"}
          </div>
          <div className="divide-y rounded-lg border bg-card">{others.map(renderAvailable)}</div>
        </div>
      )}

      {nothingMatches && (
        <div className="mt-8 text-center text-xs text-muted-foreground">
          No provider matches “{query.trim()}”.
          <button
            onClick={() => setQuery("")}
            className="ml-1 text-foreground underline-offset-2 hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {allProviders.length === 0 && (
        <div className="mt-8 py-4 text-center text-xs text-muted-foreground">
          Loading providers...
        </div>
      )}

      {connecting && (
        <ProviderConnectDialog
          provider={connecting}
          onClose={() => setConnecting(null)}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Models Tab
// ═══════════════════════════════════════════════════════════════════════

function ModelsTab() {
  const allModels = useAllModels();
  const connectedProviders = useConnectedProviders();
  const { hiddenModels, toggleModelVisibility } = usePreferences();

  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Group models by provider (only connected providers), filtered by search
  const modelsByProvider = useMemo(() => {
    const query = search.toLowerCase().trim();
    const groups: Record<string, { providerName: string; models: ModelInfo[] }> = {};

    for (const model of allModels) {
      // Only show models from connected providers
      if (!connectedProviders.includes(model.providerId)) continue;

      // Filter by search
      if (query) {
        const haystack = `${model.name} ${model.id} ${model.providerName}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }

      if (!groups[model.providerId]) {
        groups[model.providerId] = {
          providerName: model.providerName,
          models: [],
        };
      }
      groups[model.providerId].models.push(model);
    }

    // Sort models within each group
    for (const group of Object.values(groups)) {
      group.models.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Sort provider groups: popular first, then alphabetical
    const entries = Object.entries(groups);
    entries.sort(([aId], [bId]) => {
      const aPopular = POPULAR_PROVIDERS.includes(aId);
      const bPopular = POPULAR_PROVIDERS.includes(bId);
      if (aPopular && !bPopular) return -1;
      if (!aPopular && bPopular) return 1;
      if (aPopular && bPopular) {
        return POPULAR_PROVIDERS.indexOf(aId) - POPULAR_PROVIDERS.indexOf(bId);
      }
      return groups[aId].providerName.localeCompare(groups[bId].providerName);
    });

    return entries;
  }, [allModels, connectedProviders, search]);

  const totalModels = allModels.filter((m) => connectedProviders.includes(m.providerId)).length;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="font-serif text-lg italic text-foreground">Models</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Toggle which models appear in the model selector.
      </p>

      {/* Search */}
      <div className="mt-4">
        <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-muted-foreground/50"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            className="h-8 flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
              className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Model groups */}
      <div className="mt-5 space-y-6">
        {modelsByProvider.map(([providerId, group]) => (
          <div key={providerId}>
            <div className="flex items-center gap-2 pb-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-[10px] font-semibold text-muted-foreground">
                {group.providerName.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm font-medium">{group.providerName}</span>
            </div>
            <div className="rounded-lg border bg-card">
              {group.models.map((model, idx) => {
                const modelKey = `${model.providerId}/${model.id}`;
                const isVisible = !hiddenModels.has(modelKey);
                return (
                  <div key={modelKey}>
                    {idx > 0 && <div className="mx-3.5 h-px bg-border" />}
                    <button
                      onClick={() => toggleModelVisibility(modelKey)}
                      className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
                    >
                      <span className="truncate text-xs">{model.name}</span>
                      {/* Toggle switch */}
                      <span
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          isVisible ? "bg-foreground" : "bg-border"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                            isVisible ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {modelsByProvider.length === 0 && totalModels > 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            No models matching &quot;{search}&quot;
          </div>
        )}

        {totalModels === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            Connect a provider to see available models.
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// General Tab
// ═══════════════════════════════════════════════════════════════════════

const ACCENT_COLORS = [
  { value: "blue" as const, label: "Blue", class: "bg-blue-500" },
  { value: "violet" as const, label: "Violet", class: "bg-violet-500" },
  { value: "emerald" as const, label: "Emerald", class: "bg-emerald-500" },
  { value: "rose" as const, label: "Rose", class: "bg-rose-500" },
  { value: "amber" as const, label: "Amber", class: "bg-amber-500" },
];

function GeneralTab() {
  const {
    accentColor,
    setAccentColor,
    layoutDensity,
    setLayoutDensity,
    fontSize,
    setFontSize,
    soundEffects,
    setSoundEffects,
  } = usePreferences();

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">General</h4>
      <p className="mt-1 text-xs text-muted-foreground">Customize your BloxMind experience.</p>

      {/* Accent Color */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Accent Color
        </div>
        <div className="flex gap-2">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => setAccentColor(color.value)}
              aria-pressed={accentColor === color.value}
              className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                accentColor === color.value
                  ? "border-foreground scale-110"
                  : "border-border hover:border-muted-foreground"
              }`}
            >
              <span className={`h-5 w-5 rounded-full ${color.class}`} />
            </button>
          ))}
        </div>
      </div>

      {/* Layout Density */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Layout Density
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(["compact", "comfortable"] as const).map((density) => (
            <button
              key={density}
              type="button"
              onClick={() => setLayoutDensity(density)}
              aria-pressed={layoutDensity === density}
              className={`rounded-lg border px-3 py-2.5 text-center text-xs transition-colors ${
                layoutDensity === density
                  ? "border-foreground bg-accent font-medium text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {density === "compact" ? "Compact" : "Comfortable"}
            </button>
          ))}
        </div>
      </div>

      {/* Font Size */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Font Size
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">A</span>
            <input
              type="range"
              min="0.8"
              max="1.2"
              step="0.05"
              value={fontSize}
              onChange={(e) => setFontSize(parseFloat(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-foreground"
            />
            <span className="text-sm font-medium text-foreground">A</span>
          </div>
          <div className="mt-1 text-center text-[10px] text-muted-foreground">
            {Math.round(fontSize * 100)}%
          </div>
        </div>
      </div>

      {/* Sound Effects */}
      <div className="mt-6">
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Sound Effects</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Play audio cues for events like sending a message or receiving a response.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={soundEffects}
              aria-label="Sound effects"
              onClick={() => setSoundEffects(!soundEffects)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                soundEffects ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                  soundEffects ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// AI Engine Tab
// ═══════════════════════════════════════════════════════════════════════

function EngineTab() {
  const {
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    systemPrompt,
    setSystemPrompt,
    customApiEndpoint,
    setCustomApiEndpoint,
  } = usePreferences();

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">AI Engine</h4>
      <p className="mt-1 text-xs text-muted-foreground">Configure the behavior of the AI model.</p>

      {/* Temperature */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Temperature
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground">Precise</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-foreground"
            />
            <span className="text-[10px] text-muted-foreground">Creative</span>
          </div>
          <div className="mt-1 text-center text-[10px] text-muted-foreground">
            {temperature.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Max Tokens */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Max Tokens
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <input
            type="number"
            min={0}
            max={128_000}
            step={256}
            value={maxTokens}
            onChange={(e) =>
              setMaxTokens(Math.min(128_000, Math.max(0, parseInt(e.target.value) || 0)))
            }
            className="h-8 w-full rounded border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Caps the response length for the selected model (up to 128,000; 0 uses the model's own
            limit). Very low caps can cut a long reply off mid-thought.
          </div>
        </div>
      </div>

      {/* Custom API Endpoint */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Custom API Endpoint
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <input
            type="text"
            value={customApiEndpoint ?? ""}
            onChange={(e) => setCustomApiEndpoint(e.target.value.trim() || null)}
            placeholder="https://api.example.com/v1"
            className="h-8 w-full rounded border bg-background px-2 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Overrides the API base URL for every connected provider. Leave empty to use each
            provider's default endpoint.
          </div>
          {customApiEndpoint && (
            <button
              onClick={() => setCustomApiEndpoint(null)}
              className="mt-1 text-[10px] text-muted-foreground underline hover:text-foreground"
            >
              Reset to default
            </button>
          )}
        </div>
      </div>

      {/* System Prompt */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          System Prompt
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful AI assistant..."
            rows={4}
            className="h-24 w-full resize-y rounded border bg-background px-2 py-1.5 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Custom instructions prepended to every conversation.
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Integrations Tab — extra MCP servers (Blender, custom tools)
// ═══════════════════════════════════════════════════════════════════════

interface McpServerDraft {
  /** The name the draft started from, or null when adding. */
  originalName: string | null;
  name: string;
  type: "local" | "remote";
  commandLine: string;
  url: string;
  enabled: boolean;
  /** Env vars from the original entry, kept as-is (not edited in the form). */
  environment: Record<string, string> | null;
}

function draftFromServer(server: McpServerConfig): McpServerDraft {
  return {
    originalName: server.name,
    name: server.name,
    type: server.type,
    commandLine: (server.command ?? [])
      .map((token) => (token.includes(" ") ? `"${token}"` : token))
      .join(" "),
    url: server.url ?? "",
    enabled: server.enabled,
    environment: server.environment ?? null,
  };
}

function draftToServer(draft: McpServerDraft): McpServerConfig {
  return {
    name: draft.name.trim(),
    type: draft.type,
    command: draft.type === "local" ? parseCommandLine(draft.commandLine.trim()) : null,
    url: draft.type === "remote" ? draft.url.trim() : null,
    enabled: draft.enabled,
    environment: draft.environment,
  };
}

function mcpStatusLabel(status: McpServerLiveStatus | undefined): {
  label: string;
  tone: string;
  hint: string | null;
} {
  switch (status?.state) {
    case "connected":
      return { label: "Connected", tone: "bg-emerald-500", hint: null };
    case "connecting":
      return { label: "Connecting", tone: "bg-amber-500", hint: null };
    case "needs_auth":
      return { label: "Needs sign-in", tone: "bg-amber-500", hint: null };
    case "disabled":
      return { label: "Off", tone: "bg-border", hint: null };
    case "failed":
      return { label: "Failed to start", tone: "bg-red-500", hint: status.error };
    default:
      return {
        label: "Not running",
        tone: "bg-border",
        hint: "BloxMind hasn't seen this server yet. If it just crashed on startup, fix the command and restart BloxMind.",
      };
  }
}

/** What the automatic Blender setup does, shown before it runs. */
const BLENDER_AUTO_STEPS = [
  "Checks Roblox Studio for the Blender Animations plugin, opening its Creator Store page if it's missing.",
  "Installs uv and the Blender bridge addon.",
  "Enables the addon and opens Blender with the bridge running.",
  "Adds the integration so BloxMind can animate characters.",
];

/** The manual alternative, kept in case the automatic setup can't find Blender. */
const BLENDER_MANUAL_STEPS = [
  "Install uv (docs.astral.sh/uv), then run: uvx mcp-for-blender@latest install-addon",
  'Open Blender and enable "MCP for Blender" in Preferences → Add-ons.',
  "Press N in Blender for the MCP for Blender tab; the server starts automatically.",
  "Install the Blender Animations plugin in Studio from its Creator Store listing (button below).",
  "Add the integration here, then ask BloxMind to animate a character.",
];

function IntegrationsTab() {
  const { mcpServers, setMcpServers } = usePreferences();
  const { statuses } = useMcpStatus();
  const [draft, setDraft] = useState<McpServerDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [blenderBusy, setBlenderBusy] = useState(false);
  const [blenderSetup, setBlenderSetup] = useState<BlenderSetupResult | null>(null);
  const [blenderError, setBlenderError] = useState<string | null>(null);

  const hasBlender = mcpServers.some((server) => server.name.toLowerCase() === "blender");

  function saveDraft() {
    if (!draft) return;
    const server = draftToServer(draft);
    const nameError = validateMcpServer(server);
    if (nameError) {
      setDraftError(nameError);
      return;
    }
    const duplicate = mcpServers.some(
      (candidate) =>
        candidate.name.toLowerCase() === server.name.toLowerCase() &&
        candidate.name !== draft.originalName,
    );
    if (duplicate) {
      setDraftError("Every server needs a unique name.");
      return;
    }
    const next = draft.originalName
      ? mcpServers.map((candidate) => (candidate.name === draft.originalName ? server : candidate))
      : [...mcpServers, server];
    setMcpServers(next);
    setDraft(null);
    setDraftError(null);
  }

  function toggleServer(name: string) {
    setMcpServers(
      mcpServers.map((server) =>
        server.name === name ? { ...server, enabled: !server.enabled } : server,
      ),
    );
  }

  function removeServer(name: string) {
    setMcpServers(mcpServers.filter((server) => server.name !== name));
    if (draft?.originalName === name) {
      setDraft(null);
      setDraftError(null);
    }
  }

  function addBlender() {
    setMcpServers([...mcpServers, blenderMcpServer()]);
    toast.success("Blender integration added");
  }

  /** Installs uv, the addon and Blender itself, then wires up the integration. */
  async function setUpBlender() {
    if (blenderBusy) return;
    setBlenderBusy(true);
    setBlenderError(null);
    setBlenderSetup(null);
    try {
      const result = await desktop.blenderSetup();
      setBlenderSetup(result);
      if (result.ok && result.uvxPath) {
        const entry = blenderMcpServer(result.uvxPath);
        const next = hasBlender
          ? mcpServers.map((server) => (server.name.toLowerCase() === "blender" ? entry : server))
          : [...mcpServers, entry];
        setMcpServers(next);
      }
      if (result.ok) toast.success(result.detail);
      else toast.error(result.detail);
    } catch (cause) {
      setBlenderError(cause instanceof Error ? cause.message : "Blender setup failed");
    } finally {
      setBlenderBusy(false);
    }
  }

  async function openBlender() {
    try {
      const result = await desktop.blenderLaunch();
      if (result.launched) toast.success("Opening Blender");
      else toast.error("Blender wasn't found on this computer.");
    } catch {
      toast.error("Couldn't open Blender.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Integrations</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Extra MCP servers BloxMind can use, like Blender for character animations.
      </p>

      {/* Blender preset */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Blender
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Character animations</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Build R6 and R15 animations in Blender and load them straight into Studio.
              </p>
            </div>
            <button
              type="button"
              onClick={setUpBlender}
              disabled={blenderBusy}
              className="shrink-0 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {blenderBusy ? "Setting up…" : hasBlender ? "Re-run setup" : "Set up automatically"}
            </button>
          </div>
          {blenderBusy && (
            <p className="mt-3 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Installing uv and the Blender bridge, then opening Blender. This can take a minute on
              the first run.
            </p>
          )}
          {!blenderBusy && blenderError && (
            <p className="mt-3 border-t pt-3 text-[11px] leading-relaxed text-red-500">
              {blenderError}
            </p>
          )}
          {!blenderBusy && !blenderError && blenderSetup && (
            <div className="mt-3 border-t pt-3">
              <p className="text-[11px] font-medium text-foreground">{blenderSetup.detail}</p>
              <ol className="mt-1.5 space-y-1">
                {blenderSetup.steps.map((step, index) => (
                  <li
                    key={step}
                    className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground"
                  >
                    <span className="shrink-0 font-mono text-muted-foreground/60">
                      {index + 1}.
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              {blenderSetup.studioPlugin === "missing" && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded border border-dashed px-2 py-1.5">
                  <span className="text-[10px] leading-relaxed text-muted-foreground">
                    Studio installs the plugin once you click Install on its page.
                  </span>
                  <button
                    type="button"
                    onClick={() => desktop.openUrl(BLENDER_ANIMATIONS_PLUGIN_URL).catch(() => {})}
                    className="shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Open plugin page
                  </button>
                </div>
              )}
            </div>
          )}
          {!blenderBusy && !blenderError && !blenderSetup && (
            <ol className="mt-3 space-y-1.5 border-t pt-3">
              {BLENDER_AUTO_STEPS.map((step, index) => (
                <li
                  key={step}
                  className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground"
                >
                  <span className="shrink-0 font-mono text-muted-foreground/60">{index + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          )}
          <details className="mt-3 border-t pt-3">
            <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
              Manual setup
            </summary>
            <ol className="mt-2 space-y-1.5">
              {BLENDER_MANUAL_STEPS.map((step, index) => (
                <li
                  key={step}
                  className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground"
                >
                  <span className="shrink-0 font-mono text-muted-foreground/60">{index + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {!hasBlender && (
                <button
                  type="button"
                  onClick={addBlender}
                  className="rounded-md border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Add Blender integration
                </button>
              )}
              <button
                type="button"
                onClick={openBlender}
                className="rounded-md border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Open Blender
              </button>
              <button
                type="button"
                onClick={() => desktop.openUrl(BLENDER_ANIMATIONS_PLUGIN_URL).catch(() => {})}
                className="rounded-md border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Get the Studio plugin
              </button>
              <button
                type="button"
                onClick={() =>
                  desktop
                    .openUrl("https://github.com/ahujasid/blender-mcp#installation")
                    .catch(() => {})
                }
                className="text-[10px] text-muted-foreground underline hover:text-foreground"
              >
                Setup guide
              </button>
            </div>
          </details>
        </div>
      </div>

      {/* Configured servers */}
      <div className="mt-6">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Servers
          </span>
          {!draft && (
            <button
              type="button"
              onClick={() => {
                setDraft({
                  originalName: null,
                  name: "",
                  type: "local",
                  commandLine: "",
                  url: "",
                  enabled: true,
                  environment: null,
                });
                setDraftError(null);
              }}
              className="text-[10px] font-medium text-muted-foreground underline hover:text-foreground"
            >
              Add server
            </button>
          )}
        </div>
        <div className="space-y-2">
          {mcpServers.length === 0 && !draft && (
            <div className="rounded-lg border border-dashed p-3.5 text-[11px] text-muted-foreground">
              No extra servers yet. Add Blender tooling above, or any MCP server you run.
            </div>
          )}
          {mcpServers.map((server) => {
            const status = mcpStatusLabel(statuses[server.name]);
            const description =
              server.type === "local" ? (server.command ?? []).join(" ") : (server.url ?? "");
            return (
              <div key={server.name} className="rounded-lg border bg-card p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs font-medium">{server.name}</span>
                      <span className="shrink-0 rounded border px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                        {server.type}
                      </span>
                    </div>
                    <div
                      className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                      title={description}
                    >
                      {description}
                    </div>
                    <div
                      className="mt-1.5 flex items-center gap-1.5"
                      title={status.hint ?? undefined}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.tone}`} />
                      <span className="text-[10px] text-muted-foreground">{status.label}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={server.enabled}
                      aria-label={`Enable ${server.name}`}
                      onClick={() => toggleServer(server.name)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        server.enabled ? "bg-foreground" : "bg-border"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                          server.enabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3 border-t pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(draftFromServer(server));
                      setDraftError(null);
                    }}
                    className="text-[10px] text-muted-foreground underline hover:text-foreground"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeServer(server.name)}
                    className="text-[10px] text-muted-foreground underline hover:text-destructive"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add / edit form */}
      {draft && (
        <div className="mt-4">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {draft.originalName ? `Edit ${draft.originalName}` : "New server"}
          </div>
          <div className="space-y-3 rounded-lg border bg-card p-3.5">
            <div>
              <label className="mb-1 block text-[10px] text-muted-foreground" htmlFor="mcp-name">
                Name
              </label>
              <input
                id="mcp-name"
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="my-server"
                className="h-8 w-full rounded border bg-background px-2 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] text-muted-foreground">Type</div>
              <div className="flex gap-1.5">
                {(["local", "remote"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setDraft({ ...draft, type })}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                      draft.type === type
                        ? "border-foreground bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {type === "local" ? "Local (command)" : "Remote (URL)"}
                  </button>
                ))}
              </div>
            </div>
            {draft.type === "local" ? (
              <div>
                <label
                  className="mb-1 block text-[10px] text-muted-foreground"
                  htmlFor="mcp-command"
                >
                  Command
                </label>
                <input
                  id="mcp-command"
                  type="text"
                  value={draft.commandLine}
                  onChange={(e) => setDraft({ ...draft, commandLine: e.target.value })}
                  placeholder="uvx blender-mcp"
                  className="h-8 w-full rounded border bg-background px-2 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Wrap paths with spaces in quotes, like "C:\\Program Files\\uv\\uvx.exe" -y.
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[10px] text-muted-foreground" htmlFor="mcp-url">
                  URL
                </label>
                <input
                  id="mcp-url"
                  type="text"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  className="h-8 w-full rounded border bg-background px-2 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}
            {draftError && <div className="text-[10px] text-destructive">{draftError}</div>}
            <div className="flex items-center gap-2 border-t pt-3">
              <button
                type="button"
                onClick={saveDraft}
                className="rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
              >
                {draft.originalName ? "Save changes" : "Add server"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setDraftError(null);
                }}
                className="rounded-md border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-6 text-[10px] leading-relaxed text-muted-foreground">
        MCP servers run on your machine with BloxMind's permissions — the Blender bridge can run
        Python inside Blender. Only add servers you trust. Changes apply right away; a server that
        can't start is skipped until you fix it.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Behavior Tab
// ═══════════════════════════════════════════════════════════════════════

function BehaviorTab() {
  const {
    autoScroll,
    setAutoScroll,
    enterToSend,
    setEnterToSend,
    notificationsEnabled,
    setNotificationsEnabled,
  } = usePreferences();

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Behavior</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Control how BloxMind behaves during conversations.
      </p>

      <div className="mt-6 space-y-3">
        {/* Auto-scroll */}
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Auto-scroll on new messages</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Automatically scroll to the bottom when new messages arrive.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoScroll}
              aria-label="Auto-scroll"
              onClick={() => setAutoScroll(!autoScroll)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                autoScroll ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                  autoScroll ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Enter to send */}
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Enter to send</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Press Enter to send a message. When disabled, use Shift+Enter to send.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enterToSend}
              aria-label="Enter to send"
              onClick={() => setEnterToSend(!enterToSend)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                enterToSend ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                  enterToSend ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Notifications</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Show a desktop notification when a response finishes while BloxMind is in the
                background.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={notificationsEnabled}
              aria-label="Notifications"
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                notificationsEnabled ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                  notificationsEnabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Connection Tab
// ═══════════════════════════════════════════════════════════════════════

function ConnectionTab() {
  const { sseReconnectDelay, setSseReconnectDelay, sseHeartbeatTimeout, setSseHeartbeatTimeout } =
    usePreferences();

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Connection</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Configure SSE connection parameters for the OpenCode engine.
      </p>

      {/* Reconnect delay */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Reconnect Delay (ms)
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <input
            type="number"
            min={1_000}
            max={60_000}
            step={500}
            value={sseReconnectDelay}
            onChange={(e) =>
              setSseReconnectDelay(
                Math.min(60_000, Math.max(1_000, parseInt(e.target.value) || 1_000)),
              )
            }
            className="h-8 w-full rounded border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Base delay between reconnection attempts (1,000–60,000 ms). Uses exponential backoff.
          </div>
        </div>
      </div>

      {/* Heartbeat timeout */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Heartbeat Timeout (ms)
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <input
            type="number"
            min={5_000}
            max={120_000}
            step={1_000}
            value={sseHeartbeatTimeout}
            onChange={(e) =>
              setSseHeartbeatTimeout(
                Math.min(120_000, Math.max(5_000, parseInt(e.target.value) || 5_000)),
              )
            }
            className="h-8 w-full rounded border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            Max time without events before forcing a reconnect (5,000–120,000 ms).
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Appearance Tab
// ═══════════════════════════════════════════════════════════════════════

function AppearanceTab() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="font-serif text-lg italic text-foreground">Appearance</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose how BloxMind looks. System follows your OS preference.
      </p>

      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Theme
        </div>
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map((option) => {
            const selected = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                aria-pressed={selected}
                className={`rounded-lg border px-3 py-3 text-center transition-colors ${
                  selected
                    ? "border-foreground bg-accent font-medium text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <ThemePreview swatch={option.value} />
                <span className="mt-2 block text-xs">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ swatch }: { swatch: Theme }) {
  if (swatch === "light") {
    return (
      <div className="mx-auto flex h-10 w-full max-w-[72px] overflow-hidden rounded-md border border-stone-200">
        <div className="w-1/3 bg-stone-100" />
        <div className="flex-1 bg-stone-50" />
      </div>
    );
  }
  if (swatch === "dark") {
    return (
      <div className="mx-auto flex h-10 w-full max-w-[72px] overflow-hidden rounded-md border border-stone-700">
        <div className="w-1/3 bg-stone-800" />
        <div className="flex-1 bg-stone-950" />
      </div>
    );
  }
  return (
    <div className="mx-auto flex h-10 w-full max-w-[72px] overflow-hidden rounded-md border border-border">
      <div className="w-1/2 bg-stone-50" />
      <div className="w-1/2 bg-stone-950" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Privacy Tab
// ═══════════════════════════════════════════════════════════════════════

function PrivacyTab() {
  const { detailedAnalyticsEnabled, setDetailedAnalyticsEnabled } = usePreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    try {
      const config = await desktop.loadConfig();
      const blob = new Blob([JSON.stringify(config, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bloxmind-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Configuration exported");
    } catch {
      toast.error("Failed to export configuration");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<AppConfig>;
      await desktop.patchConfig(parsed);
      toast.success("Configuration imported");
      window.location.reload();
    } catch {
      toast.error("Invalid configuration file");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleClearData() {
    if (!window.confirm("Clear all settings and reset to defaults?")) return;
    try {
      await desktop.patchConfig({ ...DEFAULT_APP_CONFIG });
      toast.success("Settings cleared");
      window.location.reload();
    } catch {
      toast.error("Failed to clear settings");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="font-serif text-lg italic text-foreground">Privacy</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        BloxMind uses PostHog's standard product analytics with persistent device and session
        identifiers, but events stay anonymous: no person profile is created. Error reports are
        included, with personal file paths, usernames, email addresses and API keys removed. They
        can name the provider and model an error came from. Attached images and files are never
        uploaded.
      </p>

      <div className="mt-6 rounded-lg border bg-card p-3.5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Share AI usage data</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Shares your prompts, AI responses and reasoning, tool calls and their results, code
              changes, instruction files like AGENTS.md, timings, provider and model names, token
              counts, and Roblox place IDs and names, on by default. Turn this off to keep
              conversations and model usage out of analytics. Basic app health events and error
              reports remain enabled.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={detailedAnalyticsEnabled}
            aria-label="Share AI usage data"
            onClick={() => setDetailedAnalyticsEnabled(!detailedAnalyticsEnabled)}
            className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              detailedAnalyticsEnabled ? "bg-foreground" : "bg-border"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                detailedAnalyticsEnabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      <PrivacyDetails />
      {/* Data Management */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Data Management
        </div>
        <div className="space-y-2">
          <button
            onClick={handleExport}
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Configuration (JSON)
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import Configuration (JSON)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImport}
          />
          <button
            onClick={handleClearData}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-red-200 bg-card px-3.5 text-xs text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Clear All Settings
          </button>
        </div>
      </div>
    </div>
  );
}

const PRIVACY_POLICY_URL = "https://bloxmindai.netlify.app/";
const TERMS_URL = "https://bloxmindai.netlify.app/";

function PrivacyDetails() {
  const deviceId = analyticsDeviceId();

  const copyDeviceId = async () => {
    if (!deviceId) return;
    try {
      await navigator.clipboard.writeText(deviceId);
      toast.success("Device ID copied");
    } catch {
      toast.error("Couldn't copy the device ID");
    }
  };

  return (
    <div className="mt-4 space-y-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
      {deviceId && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-foreground">Device ID</div>
            <div className="truncate font-mono">{deviceId}</div>
          </div>
          <button
            type="button"
            onClick={copyDeviceId}
            className="shrink-0 rounded-md border bg-card px-2.5 py-1 text-foreground transition-colors hover:bg-accent"
          >
            Copy
          </button>
        </div>
      )}
      <p>
        Include your device ID when asking Paralov AS to access or delete your data at{" "}
        <span className="select-text text-foreground">hello@paralov.com</span>. Read the{" "}
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Privacy Policy
        </a>{" "}
        and{" "}
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Terms of Service
        </a>
        .
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// About Tab
// ═══════════════════════════════════════════════════════════════════════

type UpdateCheckStatus = "idle" | "checking" | "available" | "downloading" | "up-to-date" | "error";

function AboutTab({ appVersion }: { appVersion: string | null }) {
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatus>("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Hold on to the Update handle so we can download it later
  const updateRef = useRef<UpdateInfo | null>(null);

  async function handleCheckForUpdates() {
    setUpdateStatus("checking");
    setUpdateError(null);
    setUpdateVersion(null);
    try {
      const update = await desktop.checkForUpdate();
      if (!update) {
        setUpdateStatus("up-to-date");
        return;
      }
      updateRef.current = update;
      setUpdateVersion(update.version);
      setUpdateStatus("available");
    } catch (err) {
      console.error("[about] Failed to check for updates:", err);
      setUpdateError(err instanceof Error ? err.message : "Could not reach update server");
      setUpdateStatus("error");
    }
  }

  async function handleInstall() {
    const update = updateRef.current;
    if (!update) return;
    try {
      setUpdateStatus("downloading");
      await desktop.installUpdate();
    } catch (err) {
      console.error("[about] Failed to install update:", err);
      setUpdateError(err instanceof Error ? err.message : "Installation failed");
      setUpdateStatus("error");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="font-serif text-lg italic text-foreground">About BloxMind</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        AI-assisted Roblox development, right from your desktop.
      </p>

      {/* Version & update check */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Version
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">
                BloxMind{appVersion && <span className="font-mono"> v{appVersion}</span>}
              </span>
            </div>
            {updateStatus === "idle" && (
              <button
                onClick={handleCheckForUpdates}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Check for updates
              </button>
            )}
            {updateStatus === "checking" && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <svg
                  className="h-3 w-3 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
                Checking...
              </span>
            )}
            {updateStatus === "up-to-date" && (
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-600">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Up to date
              </span>
            )}
            {updateStatus === "downloading" && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <svg
                  className="h-3 w-3 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
                Installing...
              </span>
            )}
          </div>

          {/* Update available */}
          {updateStatus === "available" && updateVersion && (
            <div className="mt-3 flex items-center justify-between rounded-md border bg-background px-3 py-2">
              <span className="text-xs">
                <span className="font-medium">v{updateVersion}</span>{" "}
                <span className="text-muted-foreground">is available</span>
              </span>
              <button
                onClick={handleInstall}
                className="rounded-md bg-foreground px-3 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
              >
                Install & Restart
              </button>
            </div>
          )}

          {/* Error */}
          {updateStatus === "error" && updateError && (
            <div className="mt-3">
              <p className="rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600 dark:bg-red-950/40 dark:text-red-400">
                {updateError}
              </p>
              <button
                onClick={handleCheckForUpdates}
                className="mt-2 text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Built with */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Built With
        </div>
        <div className="rounded-lg border bg-card">
          {TECHNOLOGIES.map((tech, idx) => (
            <div key={tech.name}>
              {idx > 0 && <div className="mx-3.5 h-px bg-border" />}
              <a
                href={tech.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <span className="text-xs font-medium">{tech.name}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">{tech.description}</span>
                </div>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-muted-foreground"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          ))}
        </div>
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
          BloxMind is powered by these projects. Thank you to the teams behind them.
        </p>
      </div>

      {/* Links */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Links
        </div>
        <div className="space-y-1.5">
          <a
            href="https://BloxMind.ai"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Website
          </a>
          <a
            href="https://github.com/YUouriii"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            My GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

export default Settings;

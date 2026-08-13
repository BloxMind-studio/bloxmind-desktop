import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { POPULAR_PROVIDERS } from "@/components/settings/constants";
import { useCompleteOAuth, useStartOAuth } from "@/hooks/mutations/useOAuth";
import { useDisconnectProvider, useSetApiKey } from "@/hooks/mutations/useSetApiKey";
import { useAllProviders, useAuthMethods, useConnectedProviders } from "@/hooks/useProviders";
import type { ProviderInfo } from "@/types";

// ── Provider-specific metadata for auth UX ───────────────────────────
const PROVIDER_META: Record<string, { placeholder?: string; helpUrl?: string }> = {
  opencode: {
    placeholder: "opencode-...",
    helpUrl: "https://opencode.ai/zen",
  },
  anthropic: {
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
  },
  google: {
    placeholder: "AIza...",
    helpUrl: "https://aistudio.google.com/app/apikey",
  },
  openrouter: {
    placeholder: "sk-or-...",
    helpUrl: "https://openrouter.ai/keys",
  },
};

type ConnectDialogState =
  | { step: "closed" }
  | { step: "methods"; provider: ProviderInfo }
  | {
      step: "oauth";
      provider: ProviderInfo;
      methodIndex: number;
      method: "auto" | "code" | null;
      instructions: string | null;
    }
  | { step: "apikey"; provider: ProviderInfo };

// ═══════════════════════════════════════════════════════════════════════
// Providers Tab — matches OpenCode's two-section layout with connect dialog
// ═══════════════════════════════════════════════════════════════════════

export function ProvidersTab() {
  const allProviders = useAllProviders();
  const connectedProviders = useConnectedProviders();
  const authMethods = useAuthMethods();
  const setApiKeyMutation = useSetApiKey();
  const startOAuthMutation = useStartOAuth();
  const completeOAuthMutation = useCompleteOAuth();
  const disconnectMutation = useDisconnectProvider();

  const [dialog, setDialog] = useState<ConnectDialogState>({ step: "closed" });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [oauthCodeInput, setOauthCodeInput] = useState("");
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const oauthAbortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeDialog = useCallback(() => {
    oauthAbortRef.current?.abort();
    oauthAbortRef.current = null;
    setDialog({ step: "closed" });
    setApiKeyInput("");
    setOauthCodeInput("");
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      oauthAbortRef.current?.abort();
    };
  }, []);

  // Close dialog on click outside
  useEffect(() => {
    if (dialog.step === "closed") return;
    function handleClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        closeDialog();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dialog.step, closeDialog]);

  // Auto-close dialog when provider becomes connected
  const prevConnectedRef = useRef(connectedProviders);
  useEffect(() => {
    const prev = prevConnectedRef.current;
    prevConnectedRef.current = connectedProviders;
    if (dialog.step === "closed") return;
    const providerId = dialog.provider.id;
    if (connectedProviders.includes(providerId) && !prev.includes(providerId)) {
      toast.success(`${dialog.provider.name} connected`);
      closeDialog();
    }
  }, [connectedProviders, dialog, closeDialog]);

  function getOAuthMethodIndex(providerId: string): number | null {
    const methods = authMethods[providerId];
    if (!methods) return null;
    const idx = methods.findIndex((m) => m.type === "oauth");
    return idx >= 0 ? idx : null;
  }

  function hasApiKeyAuth(providerId: string): boolean {
    const methods = authMethods[providerId];
    if (!methods || methods.length === 0) return true;
    return methods.some((m) => m.type === "api");
  }

  function openConnect(provider: ProviderInfo) {
    const oauthIdx = getOAuthMethodIndex(provider.id);
    const apiKey = hasApiKeyAuth(provider.id);

    // If only one method, skip method selection
    if (oauthIdx !== null && !apiKey) {
      startOAuthFlow(provider, oauthIdx);
    } else if (oauthIdx === null && apiKey) {
      setDialog({ step: "apikey", provider });
    } else if (oauthIdx !== null && apiKey) {
      setDialog({ step: "methods", provider });
    } else {
      // No auth methods available
      setError(
        `No authentication methods available. Required env vars: ${provider.env.join(", ")}`,
      );
      setDialog({ step: "methods", provider });
    }
  }

  async function startOAuthFlow(provider: ProviderInfo, methodIndex: number) {
    setDialog({ step: "oauth", provider, methodIndex, method: null, instructions: null });
    setError(null);
    try {
      const authResult = await startOAuthMutation.mutateAsync({
        providerID: provider.id,
        methodIndex,
      });
      if (!authResult) {
        closeDialog();
        return;
      }
      setDialog({
        step: "oauth",
        provider,
        methodIndex,
        method: authResult.method,
        instructions: authResult.instructions ?? null,
      });
      if (authResult.method === "auto") {
        const abort = new AbortController();
        oauthAbortRef.current = abort;
        try {
          const success = await completeOAuthMutation.mutateAsync({
            providerID: provider.id,
            methodIndex,
          });
          if (!abort.signal.aborted) {
            if (success) {
              // Auto-close handled by the connectedProviders effect
            } else {
              setError("Authorization failed. Please try again.");
              setDialog({ step: "methods", provider });
            }
          }
        } catch {
          if (!abort.signal.aborted) {
            setError("Sign-in timed out or was cancelled");
            setDialog({ step: "methods", provider });
          }
        }
      }
    } catch {
      setError("Failed to start sign-in flow");
      setDialog({ step: "methods", provider });
    }
  }

  async function handleOAuthCode(providerId: string) {
    if (dialog.step !== "oauth" || !oauthCodeInput.trim()) return;
    try {
      const success = await completeOAuthMutation.mutateAsync({
        providerID: providerId,
        methodIndex: dialog.methodIndex,
        code: oauthCodeInput.trim(),
      });
      if (!success) {
        setError("Authorization failed. Please try again.");
      }
      // Success auto-closes via connectedProviders effect
    } catch {
      setError("Invalid code. Please try again.");
    }
    setOauthCodeInput("");
  }

  async function handleSaveKey(providerId: string) {
    if (!apiKeyInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await setApiKeyMutation.mutateAsync({ providerID: providerId, key: apiKeyInput.trim() });
      // Success auto-closes via connectedProviders effect
    } catch {
      setError("Invalid key or connection failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(providerId: string) {
    setDisconnecting(providerId);
    try {
      await disconnectMutation.mutateAsync(providerId);
      toast.success("Provider disconnected");
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setDisconnecting(null);
    }
  }

  // Split providers into connected and unconnected
  const connected = allProviders.filter((p) => connectedProviders.includes(p.id));
  const unconnected = allProviders.filter((p) => !connectedProviders.includes(p.id));

  // Sort unconnected: popular first, then alphabetical
  const sortedUnconnected = useMemo(() => {
    const pop: ProviderInfo[] = [];
    const oth: ProviderInfo[] = [];
    for (const p of unconnected) {
      if (POPULAR_PROVIDERS.includes(p.id)) {
        pop.push(p);
      } else {
        oth.push(p);
      }
    }
    pop.sort((a, b) => POPULAR_PROVIDERS.indexOf(a.id) - POPULAR_PROVIDERS.indexOf(b.id));
    oth.sort((a, b) => a.name.localeCompare(b.name));
    return [...pop, ...oth];
  }, [unconnected]);

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Providers</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Connect AI providers to use their models.
      </p>

      {/* Connected providers */}
      {connected.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Connected
          </div>
          <div className="space-y-1.5">
            {connected.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between rounded-lg border bg-card px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{provider.name}</span>
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Connected
                  </span>
                </div>
                {provider.id !== "opencode" && (
                  <button
                    type="button"
                    onClick={() => handleDisconnect(provider.id)}
                    disabled={disconnecting === provider.id}
                    className="text-[11px] text-muted-foreground transition-colors disabled:opacity-50"
                  >
                    {disconnecting === provider.id ? "..." : "Disconnect"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unconnected providers */}
      {sortedUnconnected.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {connected.length > 0 ? "Available" : "Providers"}
          </div>
          <div className="space-y-1.5">
            {sortedUnconnected.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between rounded-lg border bg-card px-3.5 py-2.5"
              >
                <span className="text-sm font-medium">{provider.name}</span>
                <button
                  type="button"
                  onClick={() => openConnect(provider)}
                  className="rounded-md border bg-background px-3 py-1 text-[11px] font-medium transition-colors hover:bg-hover/12"
                >
                  Connect
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {allProviders.length === 0 && (
        <div className="mt-8 py-4 text-center text-xs text-muted-foreground">
          Loading providers...
        </div>
      )}

      {/* Connect dialog overlay */}
      {dialog.step !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            ref={dialogRef}
            className="mx-4 w-full max-w-sm rounded-xl border bg-card p-5 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-semibold">Connect {dialog.provider.name}</h5>
              <button
                type="button"
                onClick={closeDialog}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover/12"
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
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {error && <p className="mt-3 text-[11px] text-destructive">{error}</p>}

            {/* Method selection */}
            {dialog.step === "methods" && (
              <div className="mt-4 space-y-2">
                {getOAuthMethodIndex(dialog.provider.id) !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      const idx = getOAuthMethodIndex(dialog.provider.id);
                      if (idx !== null) {
                        setError(null);
                        startOAuthFlow(dialog.provider, idx);
                      }
                    }}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background text-xs font-medium transition-colors hover:bg-hover/12"
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
                      aria-hidden="true"
                    >
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                      <polyline points="10 17 15 12 10 7" />
                      <line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                    Sign in with {dialog.provider.name}
                  </button>
                )}
                {getOAuthMethodIndex(dialog.provider.id) !== null &&
                  hasApiKeyAuth(dialog.provider.id) && (
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[10px] text-muted-foreground">or</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}
                {hasApiKeyAuth(dialog.provider.id) && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setDialog({ step: "apikey", provider: dialog.provider });
                    }}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background text-xs font-medium transition-colors hover:bg-hover/12"
                  >
                    Use an API key
                  </button>
                )}
              </div>
            )}

            {/* OAuth flow */}
            {dialog.step === "oauth" && (
              <div className="mt-4 space-y-3">
                {!dialog.method && (
                  <div className="flex items-center justify-center py-4">
                    <svg
                      className="h-4 w-4 animate-spin text-muted-foreground"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
                {dialog.method === "auto" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                      <svg
                        className="h-3 w-3 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                      </svg>
                      Waiting for authorization...
                    </div>
                    {dialog.instructions && (
                      <div className="rounded-md border bg-muted/50 p-2.5">
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {dialog.instructions}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            const code = dialog.instructions?.match(/[A-Z0-9]{4,}-[A-Z0-9]{4,}/i);
                            if (code) {
                              navigator.clipboard.writeText(code[0]);
                              toast("Code copied to clipboard");
                            }
                          }}
                          className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-hover/12"
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Copy code
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {dialog.method === "code" && (
                  <div className="space-y-2">
                    {dialog.instructions && (
                      <p className="text-[11px] text-muted-foreground">{dialog.instructions}</p>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={oauthCodeInput}
                        onChange={(e) => setOauthCodeInput(e.target.value)}
                        placeholder="Paste authorization code..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && oauthCodeInput.trim()) {
                            e.preventDefault();
                            handleOAuthCode(dialog.provider.id);
                          }
                        }}
                        className="h-8 flex-1 rounded border bg-background px-2 font-mono text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-hover/40"
                        // biome-ignore lint/a11y/noAutofocus: move focus into the freshly opened connect dialog
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleOAuthCode(dialog.provider.id)}
                        disabled={!oauthCodeInput.trim()}
                        className="h-8 rounded bg-foreground px-3 text-xs font-medium text-background transition-opacity disabled:opacity-40"
                      >
                        Submit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* API key input */}
            {dialog.step === "apikey" && (
              <div className="mt-4 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => {
                      setApiKeyInput(e.target.value);
                      setError(null);
                    }}
                    placeholder={PROVIDER_META[dialog.provider.id]?.placeholder ?? "API key..."}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && apiKeyInput.trim() && !saving) {
                        e.preventDefault();
                        handleSaveKey(dialog.provider.id);
                      }
                    }}
                    className="h-8 flex-1 rounded border bg-background px-2 font-mono text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-hover/40"
                    // biome-ignore lint/a11y/noAutofocus: move focus into the freshly opened connect dialog
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveKey(dialog.provider.id)}
                    disabled={saving || !apiKeyInput.trim()}
                    className="h-8 rounded bg-foreground px-3 text-xs font-medium text-background transition-opacity disabled:opacity-40"
                  >
                    {saving ? "..." : "Save"}
                  </button>
                </div>
                {PROVIDER_META[dialog.provider.id]?.helpUrl && (
                  <a
                    href={PROVIDER_META[dialog.provider.id]?.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-[10px] text-muted-foreground underline"
                  >
                    Get an API key
                  </a>
                )}
                {getOAuthMethodIndex(dialog.provider.id) !== null && (
                  <button
                    type="button"
                    onClick={() => setDialog({ step: "methods", provider: dialog.provider })}
                    className="block text-[11px] text-muted-foreground transition-colors"
                  >
                    Back to sign-in options
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

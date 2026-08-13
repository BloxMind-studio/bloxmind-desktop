import { useRef } from "react";
import { toast } from "sonner";
import { desktop } from "@/lib/desktop";
import { useModelPreferences } from "@/providers/PreferencesProvider";
import { type AppConfig, DEFAULT_APP_CONFIG } from "@/types/desktop";

export function PrivacyTab() {
  const { detailedAnalyticsEnabled, setDetailedAnalyticsEnabled } = useModelPreferences();
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
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Privacy</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        BloxMind uses PostHog's standard product analytics with persistent device and session
        identifiers plus a person profile. Feature flags and other PostHog products use the same
        profile. Detailed usage is always your choice.
      </p>

      <div className="mt-6 rounded-lg border bg-card p-3.5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Share detailed usage analytics</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Additionally shares provider and model names plus aggregate token counts. This switch
              controls those detailed fields; standard PostHog collection remains enabled.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={detailedAnalyticsEnabled}
            aria-label="Share detailed usage analytics"
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

      {/* Data Management */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Data Management
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-hover/12"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Configuration (JSON)
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-hover/12"
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
            type="button"
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
              aria-hidden="true"
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

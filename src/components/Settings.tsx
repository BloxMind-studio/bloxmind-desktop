import { useEffect, useState } from "react";
import { AboutTab } from "@/components/settings/AboutTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { BehaviorTab } from "@/components/settings/BehaviorTab";
import { ConnectionTab } from "@/components/settings/ConnectionTab";
import { EngineTab } from "@/components/settings/EngineTab";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { ModelsTab } from "@/components/settings/ModelsTab";
import { PrivacyTab } from "@/components/settings/PrivacyTab";
import { ProvidersTab } from "@/components/settings/ProvidersTab";
import { ThemeColorsTab } from "@/components/settings/ThemeColorsTab";
import { desktop } from "@/lib/desktop";

type SettingsTab =
  | "general"
  | "providers"
  | "models"
  | "engine"
  | "behavior"
  | "connection"
  | "appearance"
  | "theme-colors"
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4">
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover/12"
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
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h3 className="text-xs font-semibold">Settings</h3>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <div className="flex w-40 shrink-0 flex-col border-r py-3">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Server
          </div>
          <button
            type="button"
            onClick={() => setTab("providers")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "providers"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l-.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0-2.83l-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Providers
          </button>
          <button
            type="button"
            onClick={() => setTab("models")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "models"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Models
          </button>

          <div className="mt-4 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            App
          </div>
          <button
            type="button"
            onClick={() => setTab("general")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "general"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            General
          </button>
          <button
            type="button"
            onClick={() => setTab("engine")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "engine"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            AI Engine
          </button>
          <button
            type="button"
            onClick={() => setTab("behavior")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "behavior"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
            >
              <path d="M12 20V10" />
              <path d="M18 20V4" />
              <path d="M6 20v-4" />
            </svg>
            Behavior
          </button>
          <button
            type="button"
            onClick={() => setTab("connection")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "connection"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            Connection
          </button>
          <button
            type="button"
            onClick={() => setTab("appearance")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "appearance"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            Appearance
          </button>
          <button
            type="button"
            onClick={() => setTab("theme-colors")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "theme-colors"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
            >
              <path d="M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
              <circle cx="8.5" cy="11.5" r="0.5" fill="currentColor" />
              <circle cx="12" cy="7.5" r="0.5" fill="currentColor" />
              <circle cx="15.5" cy="11.5" r="0.5" fill="currentColor" />
            </svg>
            Theme Colors
          </button>
          <button
            type="button"
            onClick={() => setTab("about")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "about"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
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
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "privacy"
                ? "bg-selected/12 font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-hover/12"
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
              aria-hidden="true"
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
          {tab === "engine" && <EngineTab />}
          {tab === "behavior" && <BehaviorTab />}
          {tab === "connection" && <ConnectionTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "theme-colors" && <ThemeColorsTab />}
          {tab === "privacy" && <PrivacyTab />}
          {tab === "about" && <AboutTab appVersion={appVersion} />}
        </div>
      </div>
    </div>
  );
}

export default Settings;

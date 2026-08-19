import {
  SettingsBody,
  SettingsGroupLabel,
  SettingsHeader,
  SettingsShell,
  ToggleRow,
} from "@/components/settings/SettingsControls";
import { useAppsPreferences } from "@/providers/PreferencesProvider";

function AppsSettings({ onClose }: { onClose: () => void }) {
  const {
    appsSettings,
    setAutoPreview,
    setAutoRun,
    setDefaultViewport,
    setShowFileTree,
    setShowLineNumbers,
  } = useAppsPreferences();

  return (
    <SettingsShell>
      <SettingsHeader
        title="Apps Mode Settings"
        icon={
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-label="Apps mode"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
        }
        onClose={onClose}
      />

      <SettingsBody>
        <SettingsGroupLabel>Editor</SettingsGroupLabel>

        <ToggleRow
          title="Auto Preview"
          description="Automatically render the preview when files change"
          checked={appsSettings.autoPreview}
          onChange={setAutoPreview}
        />
        <ToggleRow
          title="Auto Run"
          description="Automatically run the app once the build finishes"
          checked={appsSettings.autoRun}
          onChange={setAutoRun}
        />

        {/* Default Viewport */}
        <div className="rounded-lg border bg-card/50 p-3">
          <div className="text-xs font-medium">Default Preview Viewport</div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            Which device frame to show in the preview
          </div>
          <div className="mt-2 flex gap-2">
            {(["desktop", "mobile"] as const).map((viewport) => (
              <button
                key={viewport}
                type="button"
                onClick={() => setDefaultViewport(viewport)}
                className={`flex-1 rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  appsSettings.defaultViewport === viewport
                    ? "border-selected bg-selected/10 text-selected-foreground"
                    : "border-border bg-background hover:bg-hover/12"
                }`}
              >
                {viewport === "desktop" ? "Desktop" : "Mobile"}
              </button>
            ))}
          </div>
        </div>

        <SettingsGroupLabel className="mt-6">Code Editor</SettingsGroupLabel>

        <ToggleRow
          title="Show File Tree"
          description="Display the file explorer panel"
          checked={appsSettings.showFileTree}
          onChange={setShowFileTree}
        />
        <ToggleRow
          title="Show Line Numbers"
          description="Display line numbers in the code editor"
          checked={appsSettings.showLineNumbers}
          onChange={setShowLineNumbers}
        />
      </SettingsBody>
    </SettingsShell>
  );
}

export { AppsSettings };

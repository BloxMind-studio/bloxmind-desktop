import {
  SettingsBody,
  SettingsGroupLabel,
  SettingsHeader,
  SettingsShell,
  ToggleRow,
} from "@/components/settings/SettingsControls";
import { useGamesPreferences } from "@/providers/PreferencesProvider";

function GamesSettings({ onClose }: { onClose: () => void }) {
  const {
    gamesSettings,
    setAutoPreview,
    setAutoRun,
    setShowControlsHint,
    setShowFileTree,
    setShowLineNumbers,
  } = useGamesPreferences();

  return (
    <SettingsShell>
      <SettingsHeader
        title="Games Mode Settings"
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
            aria-label="Games mode"
          >
            <line x1="6" y1="11" x2="10" y2="11" />
            <line x1="8" y1="9" x2="8" y2="13" />
            <line x1="15" y1="12" x2="15.01" y2="12" />
            <line x1="18" y1="10" x2="18.01" y2="10" />
            <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
          </svg>
        }
        onClose={onClose}
      />

      <SettingsBody>
        <SettingsGroupLabel>Editor</SettingsGroupLabel>

        <ToggleRow
          title="Auto Preview"
          description="Automatically render the preview when files change"
          checked={gamesSettings.autoPreview}
          onChange={setAutoPreview}
        />
        <ToggleRow
          title="Auto Run"
          description="Automatically start the game once the build finishes"
          checked={gamesSettings.autoRun}
          onChange={setAutoRun}
        />
        <ToggleRow
          title="Show Controls Hint"
          description="Display the WASD / Space / mouse control legend above the preview"
          checked={gamesSettings.showControlsHint}
          onChange={setShowControlsHint}
        />

        <SettingsGroupLabel className="mt-6">Code Editor</SettingsGroupLabel>

        <ToggleRow
          title="Show File Tree"
          description="Display the file explorer panel"
          checked={gamesSettings.showFileTree}
          onChange={setShowFileTree}
        />
        <ToggleRow
          title="Show Line Numbers"
          description="Display line numbers in the code editor"
          checked={gamesSettings.showLineNumbers}
          onChange={setShowLineNumbers}
        />
      </SettingsBody>
    </SettingsShell>
  );
}

export { GamesSettings };

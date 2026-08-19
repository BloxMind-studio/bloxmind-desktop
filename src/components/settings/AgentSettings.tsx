import {
  SettingsBody,
  SettingsGroupLabel,
  SettingsHeader,
  SettingsShell,
  ToggleRow,
} from "@/components/settings/SettingsControls";
import { useAgentPreferences } from "@/providers/PreferencesProvider";

function AgentSettings({ onClose }: { onClose: () => void }) {
  const {
    agentSettings,
    setAutoRunOnCreate,
    setShowWorkflowCanvas,
    setShowAgentSidebar,
    setEnableLogging,
    setAutoSaveDrafts,
  } = useAgentPreferences();

  return (
    <SettingsShell>
      <SettingsHeader
        title="Agent Mode Settings"
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
            aria-label="Agent mode"
          >
            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1.05A7 7 0 0 1 13 21h-2a7 7 0 0 1-7-7H4a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
          </svg>
        }
        onClose={onClose}
      />

      <SettingsBody>
        <SettingsGroupLabel>Workflow</SettingsGroupLabel>

        <ToggleRow
          title="Auto Run on Create"
          description="Start the agent immediately after creation"
          checked={agentSettings.autoRunOnCreate}
          onChange={setAutoRunOnCreate}
        />
        <ToggleRow
          title="Show Workflow Canvas"
          description="Display the workflow canvas in the agent workspace"
          checked={agentSettings.showWorkflowCanvas}
          onChange={setShowWorkflowCanvas}
        />
        <ToggleRow
          title="Show Agent Sidebar"
          description="Show the agent list on the left rail"
          checked={agentSettings.showAgentSidebar}
          onChange={setShowAgentSidebar}
        />

        <SettingsGroupLabel className="mt-6">Logging & Drafts</SettingsGroupLabel>

        <ToggleRow
          title="Enable Run Logging"
          description="Log agent run history and outputs"
          checked={agentSettings.enableLogging}
          onChange={setEnableLogging}
        />
        <ToggleRow
          title="Auto Save Drafts"
          description="Persist in-progress agent configs automatically"
          checked={agentSettings.autoSaveDrafts}
          onChange={setAutoSaveDrafts}
        />
      </SettingsBody>
    </SettingsShell>
  );
}

export { AgentSettings };

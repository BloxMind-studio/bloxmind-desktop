import { Play, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { useAgentStudio } from "@/providers/AgentStudioProvider";

interface AgentCreationSuiteProps {
  draftPrompt: string;
  onDraftPromptChange: (value: string) => void;
  onGenerate: () => void;
  onBlank: () => void;
}

const EXAMPLE_PROMPTS: readonly string[] = [
  "Create an agent that summarizes Roblox player feedback and posts it to Discord",
  "Create an agent that watches a webhook, classifies messages as bug or praise, and posts to Discord",
  "Create an agent that reads the FeedbackStore every 5 minutes, filters for negative feedback, and posts a warning",
];

/**
 * The Agent Creation Suite: a plain-English prompt box that auto-generates a
 * full agent + workflow, plus the underlying agent editor form.
 */
export function AgentCreationSuite({
  draftPrompt,
  onDraftPromptChange,
  onGenerate,
  onBlank,
}: AgentCreationSuiteProps) {
  const { activeAgentId, agents, updateAgent } = useAgentStudio();
  const activeAgent = agents.find((agent) => agent.id === activeAgentId) ?? null;

  const [showPrompts, setShowPrompts] = useState(false);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <Wand2 aria-hidden="true" size={15} className="text-accent" />
          <h4 className="text-sm font-semibold">Describe your agent in plain English</h4>
        </div>
        <textarea
          value={draftPrompt}
          onChange={(event) => onDraftPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onGenerate();
            }
          }}
          rows={3}
          placeholder="e.g. Create an agent that summarizes Roblox player feedback and posts it to Discord"
          className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowPrompts((open) => !open)}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showPrompts}
          >
            <Sparkles aria-hidden="true" size={12} />
            Example prompts
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBlank}
              className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-hover/12"
            >
              Start blank
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={!draftPrompt.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              <Play aria-hidden="true" size={12} fill="currentColor" />
              Generate agent
            </button>
          </div>
        </div>
        {showPrompts && (
          <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onDraftPromptChange(prompt)}
                className="block w-full rounded-md px-2 py-1.5 text-left text-[11.5px] leading-relaxed text-muted-foreground transition-colors hover:bg-hover/12 hover:text-foreground"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>

      {activeAgent && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <h4 className="text-sm font-semibold">Refine your agent</h4>
            <span className="rounded-full border bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
              {activeAgent.workflow.filter((node) => node.enabled).length} steps
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Name</span>
              <input
                value={activeAgent.name}
                onChange={(event) => updateAgent({ ...activeAgent, name: event.target.value })}
                className="h-8 w-full rounded-md border bg-background px-2.5 text-xs focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Role</span>
              <input
                value={activeAgent.role}
                onChange={(event) => updateAgent({ ...activeAgent, role: event.target.value })}
                placeholder="e.g. Feedback analyst"
                className="h-8 w-full rounded-md border bg-background px-2.5 text-xs placeholder:text-muted-foreground/50 focus:outline-none"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                System instructions
              </span>
              <textarea
                value={activeAgent.systemInstructions}
                onChange={(event) =>
                  updateAgent({ ...activeAgent, systemInstructions: event.target.value })
                }
                rows={2}
                className="w-full resize-none rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed focus:outline-none"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

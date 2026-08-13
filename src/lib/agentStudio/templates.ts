import type { AgentTemplate } from "./types";

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: "feedback-summarizer",
    name: "Feedback Summarizer",
    description: "Pulls Roblox player feedback and posts a tidy summary to Discord.",
    icon: "message-square",
    accent: "emerald",
    prompt:
      "Create an agent that summarizes Roblox player feedback every hour and posts the summary to Discord.",
  },
  {
    id: "support-triage",
    name: "Support Triage",
    description: "Classifies incoming tickets and routes bugs to one channel, praise to another.",
    icon: "tags",
    accent: "indigo",
    prompt:
      "Create an agent that watches a webhook, classifies each message as bug, feature, or praise, and posts the result to Discord.",
  },
  {
    id: "data-watchdog",
    name: "Data Watchdog",
    description: "Watches a DataStore key and notifies when the value changes.",
    icon: "database",
    accent: "sky",
    prompt:
      "Create an agent that reads the Roblox FeedbackStore every 5 minutes, filters for negative feedback, and posts a warning to Discord.",
  },
  {
    id: "empty-agent",
    name: "Blank Agent",
    description: "Start from scratch with a Trigger node only.",
    icon: "file-plus",
    accent: "zinc",
    prompt: "",
  },
];

export const AGENT_TEMPLATE_BY_ID = new Map(
  AGENT_TEMPLATES.map((template) => [template.id, template]),
);

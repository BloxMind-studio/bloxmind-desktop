import type { ToolDefinition } from "./types";

/**
 * Built-in node/tool registry for the Agent Studio.
 *
 * Each entry powers both the visual palette (icon + name), the node's config
 * form (fields), and the underlying Python/Node script generator (scriptArgs
 * renders each step into idiomatic code).
 */
export const TOOLS: readonly ToolDefinition[] = [
  {
    id: "trigger.schedule",
    name: "Schedule / Cron",
    description: "Runs the workflow on a recurring interval or cron schedule.",
    category: "trigger",
    icon: "clock",
    accent: "violet",
    fields: [
      {
        key: "schedule",
        label: "Interval",
        type: "select",
        options: ["every 5 minutes", "every hour", "every day", "every week"],
        required: true,
      },
    ],
    defaultConfig: { schedule: "every hour" },
    scriptArgs: [{ describe: (c) => `schedule("${c.schedule ?? "every hour"}")` }],
  },
  {
    id: "trigger.webhook",
    name: "Webhook",
    description: "Starts the workflow when an incoming webhook fires.",
    category: "trigger",
    icon: "webhook",
    accent: "violet",
    fields: [{ key: "path", label: "Webhook path", placeholder: "/feedback" }],
    defaultConfig: { path: "/feedback" },
    scriptArgs: [{ describe: (c) => `webhook("${c.path ?? "/"}")` }],
  },
  {
    id: "trigger.robloxEvent",
    name: "Roblox Event",
    description: "Starts the workflow when a Roblox Studio event or player action occurs.",
    category: "trigger",
    icon: "gamepad-2",
    accent: "violet",
    fields: [
      {
        key: "event",
        label: "Event",
        type: "select",
        options: ["PlayerJoined", "PlayerChatted", "NewFeedback", "ServerStart"],
        required: true,
      },
    ],
    defaultConfig: { event: "PlayerJoined" },
    scriptArgs: [{ describe: (c) => `on_roblox_event("${c.event ?? "PlayerJoined"}")` }],
  },
  {
    id: "fetch.httpRequest",
    name: "HTTP Request",
    description: "Fetches data from a REST API or JSON endpoint.",
    category: "fetch",
    icon: "globe",
    accent: "sky",
    fields: [
      { key: "url", label: "URL", placeholder: "https://api.example.com/data", required: true },
      { key: "method", label: "Method", type: "select", options: ["GET", "POST"] },
    ],
    defaultConfig: { url: "", method: "GET" },
    scriptArgs: [{ describe: (c) => `http_get("${c.url ?? ""}")` }],
  },
  {
    id: "fetch.robloxData",
    name: "Roblox DataStore",
    description: "Reads a key from a Roblox Ordered/DataStore.",
    category: "fetch",
    icon: "database",
    accent: "sky",
    fields: [
      { key: "store", label: "DataStore name", placeholder: "FeedbackStore", required: true },
    ],
    defaultConfig: { store: "FeedbackStore" },
    scriptArgs: [{ describe: (c) => `datastore_get("${c.store ?? "FeedbackStore"}")` }],
  },
  {
    id: "fetch.webSearch",
    name: "Web Search",
    description: "Searches the web and returns the top ranked results.",
    category: "fetch",
    icon: "search",
    accent: "sky",
    fields: [
      { key: "query", label: "Query", placeholder: "roblox studio tutorials", required: true },
    ],
    defaultConfig: { query: "" },
    scriptArgs: [{ describe: (c) => `web_search("${c.query ?? ""}")` }],
  },
  {
    id: "process.aiSummarize",
    name: "AI Summarize",
    description: "Uses the selected model to summarize the incoming payload.",
    category: "process",
    icon: "sparkles",
    accent: "emerald",
    fields: [
      {
        key: "instructions",
        label: "Instructions",
        type: "textarea",
        placeholder: "Summarize the key points in under 3 sentences.",
      },
    ],
    defaultConfig: { instructions: "Summarize the key points in under 3 sentences." },
    scriptArgs: [{ describe: () => `ai.summarize(payload)` }],
  },
  {
    id: "process.aiClassify",
    name: "AI Classify",
    description: "Sorts the payload into one of the provided categories.",
    category: "process",
    icon: "tags",
    accent: "emerald",
    fields: [
      { key: "labels", label: "Categories (comma separated)", placeholder: "bug, feature, praise" },
    ],
    defaultConfig: { labels: "bug, feature, praise" },
    scriptArgs: [
      {
        describe: (c) =>
          `ai.classify(payload, ${JSON.stringify(c.labels?.split(",").map((s) => s.trim()) ?? [])})`,
      },
    ],
  },
  {
    id: "process.filter",
    name: "Filter",
    description: "Passes the payload through only when a condition matches.",
    category: "process",
    icon: "filter",
    accent: "emerald",
    fields: [
      { key: "field", label: "Field", placeholder: "sentiment", required: true },
      { key: "equals", label: "Equals", placeholder: "negative" },
    ],
    defaultConfig: { field: "", equals: "" },
    scriptArgs: [
      {
        describe: (c) =>
          `filter(lambda p: p.get("${c.field ?? ""}") == ${JSON.stringify(c.equals ?? "")})`,
      },
    ],
  },
  {
    id: "action.discordPost",
    name: "Post to Discord",
    description: "Sends the final payload to a Discord webhook.",
    category: "action",
    icon: "message-square",
    accent: "indigo",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://discord.com/api/webhooks/...",
        required: true,
      },
    ],
    defaultConfig: { webhookUrl: "" },
    scriptArgs: [{ describe: (c) => `discord_post("${c.webhookUrl ?? ""}", payload)` }],
  },
  {
    id: "action.delay",
    name: "Delay",
    description: "Pauses the workflow before continuing to the next step.",
    category: "action",
    icon: "timer",
    accent: "amber",
    fields: [{ key: "seconds", label: "Seconds", type: "number", placeholder: "10" }],
    defaultConfig: { seconds: "10" },
    scriptArgs: [{ describe: (c) => `delay(${Number(c.seconds ?? 10) || 10})` }],
  },
  {
    id: "action.log",
    name: "Log Output",
    description: "Prints the payload to the run log.",
    category: "action",
    icon: "terminal",
    accent: "amber",
    fields: [],
    defaultConfig: {},
    scriptArgs: [{ describe: () => `log(payload)` }],
  },
];

export const TOOL_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

export const TOOLS_BY_CATEGORY = {
  trigger: TOOLS.filter((tool) => tool.category === "trigger"),
  fetch: TOOLS.filter((tool) => tool.category === "fetch"),
  process: TOOLS.filter((tool) => tool.category === "process"),
  action: TOOLS.filter((tool) => tool.category === "action"),
} satisfies Record<ToolDefinition["category"], readonly ToolDefinition[]>;

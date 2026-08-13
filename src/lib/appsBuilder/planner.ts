import { accentFor } from "./blockClasses";
import type { AppBlock, AppBlockType, AppSpec, AppTarget, AppThemeMode } from "./types";

export function makeAppBlockId(): string {
  return `b-${Math.random().toString(36).slice(2, 10)}`;
}

interface BlockSeed {
  type: AppBlockType;
  props: Record<string, string>;
}

interface AppPattern {
  name: string;
  description: string;
  target: AppTarget;
  theme: AppThemeMode;
  accent?: string;
  blocks: BlockSeed[];
}

const PATTERNS: ReadonlyArray<[RegExp, AppPattern]> = [
  [
    /weather|forecast|temperature|sunny|rain/i,
    {
      name: "Weather",
      description: "dark-mode mobile weather forecast",
      target: "mobile",
      theme: "dark",
      accent: "#38bdf8",
      blocks: [
        { type: "heading", props: { text: "Weather" } },
        { type: "stat", props: { value: "21°", label: "San Francisco · Mostly sunny" } },
        { type: "card", props: { title: "Today", body: "21° / 14° · Light breeze, 12 km/h." } },
        { type: "list", props: { items: "Today  21°\nTomorrow  23°\nWed  19°\nThu  24°" } },
        { type: "button", props: { text: "Forecast" } },
      ],
    },
  ],
  [
    /todo|task|checklist|to-do/i,
    {
      name: "Todo List",
      description: "a minimal task tracker",
      target: "mobile",
      theme: "dark",
      accent: "#a78bfa",
      blocks: [
        { type: "heading", props: { text: "My Tasks" } },
        { type: "input", props: { label: "New task", placeholder: "Buy groceries…" } },
        { type: "list", props: { items: "Finish report\nCall the dentist\nWater plants" } },
        { type: "button", props: { text: "Add Task" } },
      ],
    },
  ],
  [
    /chat|messenger|message|dm|conversation/i,
    {
      name: "Chat",
      description: "a modern messaging interface",
      target: "mobile",
      theme: "dark",
      accent: "#34d399",
      blocks: [
        { type: "heading", props: { text: "Alex" } },
        { type: "card", props: { title: "Alex · 09:41", body: "Shipping the demo today 🚀" } },
        { type: "card", props: { title: "You · 09:42", body: "Nice! Let me know when it's live." } },
        { type: "input", props: { label: "Message", placeholder: "Type a message…" } },
        { type: "button", props: { text: "Send" } },
      ],
    },
  ],
  [
    /shop|store|e-commerce|ecommerce|product|buy|cart/i,
    {
      name: "Store",
      description: "a clean product catalog",
      target: "desktop",
      theme: "light",
      accent: "#f59e0b",
      blocks: [
        { type: "heading", props: { text: "New In" } },
        { type: "card", props: { title: "Classic Tee", body: "$24.00 · Soft cotton, everyday fit." } },
        { type: "card", props: { title: "Hoodie", body: "$58.00 · Warm, cozy, sustainable." } },
        { type: "card", props: { title: "Cap", body: "$18.00 · Adjustable, embroidered." } },
        { type: "button", props: { text: "Add to Cart" } },
      ],
    },
  ],
  [
    /login|sign ?in|sign ?up|auth|account|password/i,
    {
      name: "Sign In",
      description: "a focused authentication screen",
      target: "desktop",
      theme: "light",
      accent: "#6366f1",
      blocks: [
        { type: "heading", props: { text: "Welcome back" } },
        { type: "text", props: { text: "Sign in to continue to your workspace." } },
        { type: "input", props: { label: "Email", placeholder: "you@example.com" } },
        { type: "input", props: { label: "Password", placeholder: "••••••••" } },
        { type: "button", props: { text: "Sign In" } },
      ],
    },
  ],
  [
    /dashboard|analytics|stats|metric|kpi|report/i,
    {
      name: "Dashboard",
      description: "a data-heavy analytics dashboard",
      target: "desktop",
      theme: "dark",
      accent: "#22d3ee",
      blocks: [
        { type: "heading", props: { text: "Overview" } },
        { type: "list", props: { items: "Revenue  $128k\nUsers  4,021\nChurn  2.1%" } },
        { type: "card", props: { title: "Weekly trend", body: "Up 12% vs. last week." } },
        { type: "button", props: { text: "Download Report" } },
      ],
    },
  ],
  [
    /music|player|song|playlist|audio/i,
    {
      name: "Player",
      description: "a streaming music player",
      target: "mobile",
      theme: "dark",
      accent: "#c084fc",
      blocks: [
        { type: "heading", props: { text: "Night Drive" } },
        { type: "card", props: { title: "Now Playing", body: "Midnight City — M83" } },
        { type: "list", props: { items: "▶  Midnight City\nIntro\nOutro" } },
        { type: "button", props: { text: "Play" } },
      ],
    },
  ],
  [
    /fitness|health|workout|gym|steps|calories/i,
    {
      name: "Fitness",
      description: "a daily activity tracker",
      target: "mobile",
      theme: "light",
      accent: "#f43f5e",
      blocks: [
        { type: "heading", props: { text: "This Week" } },
        { type: "stat", props: { value: "8,412", label: "Steps today" } },
        { type: "stat", props: { value: "482", label: "Calories (kcal)" } },
        { type: "list", props: { items: "Monday  6h 12m\nTuesday  5h 48m\nWednesday  7h 02m" } },
        { type: "button", props: { text: "Start Workout" } },
      ],
    },
  ],
  [
    /portfolio|resume|profile|about me/i,
    {
      name: "Portfolio",
      description: "a personal portfolio landing page",
      target: "desktop",
      theme: "light",
      accent: "#10b981",
      blocks: [
        { type: "heading", props: { text: "Hi, I'm Alex" } },
        { type: "text", props: { text: "Designer & engineer building delightful interfaces." } },
        { type: "list", props: { items: "Frontend at Acme (2023–now)\nFreelance (2021–2023)\nCS degree (2017–2021)" } },
        { type: "button", props: { text: "Get in Touch" } },
      ],
    },
  ],
  [
    /news|blog|article|feed|latest/i,
    {
      name: "News",
      description: "a scrolling article feed",
      target: "desktop",
      theme: "light",
      accent: "#0ea5e9",
      blocks: [
        { type: "heading", props: { text: "The Latest" } },
        { type: "card", props: { title: "WebAssembly hits 1.0", body: "A faster web is here." } },
        { type: "card", props: { title: "React 19 stable", body: "What changed, and why it matters." } },
        { type: "card", props: { title: "Tailwind v4 ships", body: "CSS-first configuration." } },
        { type: "button", props: { text: "Load More" } },
      ],
    },
  ],
  [
    /timer|clock|countdown|pomodoro/i,
    {
      name: "Timer",
      description: "a clean countdown timer",
      target: "mobile",
      theme: "dark",
      accent: "#fbbf24",
      blocks: [
        { type: "heading", props: { text: "Pomodoro" } },
        { type: "stat", props: { value: "24:59", label: "Focus session" } },
        { type: "list", props: { items: "Focus  25:00\nShort break  05:00\nLong break  15:00" } },
        { type: "button", props: { text: "Start" } },
      ],
    },
  ],
];

const FALLBACK: AppPattern = {
  name: "Landing Page",
  description: "a modern landing page",
  target: "desktop",
  theme: "dark",
  accent: "#8b5cf6",
  blocks: [
    { type: "heading", props: { text: "Build something people love" } },
    { type: "text", props: { text: "A short, punchy tagline explaining the value." } },
    { type: "button", props: { text: "Get Started" } },
    { type: "card", props: { title: "Fast", body: "Loads in milliseconds." } },
    { type: "card", props: { title: "Reliable", body: "Backed by an SLA you can trust." } },
    { type: "button", props: { text: "Learn More" } },
  ],
};

function seedToBlock(seed: BlockSeed): AppBlock {
  return { id: makeAppBlockId(), type: seed.type, props: { ...seed.props } };
}

function goalFor(prompt: string): string | null {
  const match = /(build|create|make|give me|i want|generate)\s+(?:an?|a)?\s*([a-z0-9 -]{2,40})/i.exec(
    prompt.trim(),
  );
  return match?.[2] ? match[2].trim() : null;
}

/**
 * Convert a plain-English prompt into a concrete app blueprint (name, target,
 * theme, accent, and content blocks). Matched against heuristic patterns so
 * non-coders get a working app in one click — the blueprint then drives BOTH
 * the live preview and the generated project files.
 */
export function planAppFromPrompt(prompt: string): { spec: AppSpec; matched: string | null } {
  const trimmed = prompt.trim();
  const pattern = PATTERNS.find(([re]) => re.test(trimmed));
  const app = pattern?.[1] ?? FALLBACK;
  const goal = goalFor(trimmed);

  const spec: AppSpec = {
    name: goal && !PATTERNS.some(([re]) => re.test(goal)) ? toTitleCase(goal) : app.name,
    description: app.description,
    target: app.target,
    theme: app.theme,
    accent: accentFor(app.theme, app.accent),
    screens: [
      {
        id: "scr-home",
        name: "Home",
        blocks: app.blocks.map(seedToBlock),
      },
    ],
  };
  return { spec, matched: pattern?.[0].source ?? null };
}

function toTitleCase(value: string): string {
  return value.replace(/(^|[\s-])([a-z])/g, (_, sep, letter: string) =>
    `${sep}${letter.toUpperCase()}`,
  );
}
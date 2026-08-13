import { APP_COMPONENT_BY_KIND } from "./components";
import type { AppComponentInstance, AppComponentKind } from "./types";

export function makeAppComponentId(): string {
  return `app-${Math.random().toString(36).slice(2, 10)}`;
}

interface AppSkeleton {
  name: string;
  components: Array<{
    kind: AppComponentKind;
    props: Record<string, string>;
  }>;
}

const PATTERNS: ReadonlyArray<[RegExp, AppSkeleton]> = [
  [
    /todo|to-do|task|checklist|list of|bucket list/i,
    {
      name: "Todo List App",
      components: [
        { kind: "heading", props: { text: "My Todo List" } },
        { kind: "input", props: { placeholder: "Add a new task…", label: "New task" } },
        {
          kind: "list",
          props: { items: "Buy groceries\nFinish report\nCall the dentist" },
        },
        { kind: "button", props: { text: "Add Task" } },
      ],
    },
  ],
  [
    /login|sign ?in|sign ?up|authenticat|auth|account/,
    {
      name: "Sign In",
      components: [
        { kind: "heading", props: { text: "Welcome back" } },
        { kind: "input", props: { placeholder: "you@example.com", label: "Email" } },
        { kind: "input", props: { placeholder: "••••••••", label: "Password" } },
        { kind: "button", props: { text: "Sign In" } },
      ],
    },
  ],
  [
    /contact|feedback|message us|get in touch/i,
    {
      name: "Contact Form",
      components: [
        { kind: "heading", props: { text: "Contact us" } },
        { kind: "input", props: { placeholder: "Your name", label: "Name" } },
        { kind: "input", props: { placeholder: "you@example.com", label: "Email" } },
        { kind: "input", props: { placeholder: "How can we help?", label: "Message" } },
        { kind: "button", props: { text: "Send Message" } },
      ],
    },
  ],
  [
    /pricing|plans? to|price card|choose a plan/i,
    {
      name: "Pricing Page",
      components: [
        { kind: "heading", props: { text: "Simple pricing" } },
        {
          kind: "card",
          props: { title: "Starter", body: "$9 / month. Perfect for trying things out." },
        },
        {
          kind: "card",
          props: { title: "Pro", body: "$29 / month. Best for growing teams." },
        },
        {
          kind: "card",
          props: { title: "Enterprise", body: "Custom pricing. Contact us for a demo." },
        },
        { kind: "button", props: { text: "Get Started" } },
      ],
    },
  ],
  [
    /landing|hero|marketing|home ?page|startup|product page/i,
    {
      name: "Landing Page",
      components: [
        { kind: "heading", props: { text: "Build something people love" } },
        {
          kind: "text",
          props: { text: "A short, punchy subtitle describing the value proposition." },
        },
        { kind: "button", props: { text: "Get Started" } },
        {
          kind: "card",
          props: { title: "Why us?", body: "Fast, simple, and reliably built with React." },
        },
      ],
    },
  ],
  [
    /blog|article|story|post/i,
    {
      name: "Blog",
      components: [
        { kind: "heading", props: { text: "The Latest" } },
        {
          kind: "card",
          props: { title: "Hello World", body: "Our very first post goes here." },
        },
        {
          kind: "card",
          props: { title: "A Second Post", body: "More tips and updates from the team." },
        },
        { kind: "button", props: { text: "Read More" } },
      ],
    },
  ],
  [
    /portfolio|resume|about me|profile/i,
    {
      name: "Portfolio",
      components: [
        { kind: "heading", props: { text: "Hi, I'm Alex" } },
        {
          kind: "text",
          props: { text: "I design and build delightful web experiences." },
        },
        { kind: "image", props: { caption: "Project showcase", url: "" } },
        {
          kind: "list",
          props: { items: "Frontend engineer\nUI/UX design\nOpen source contributor" },
        },
      ],
    },
  ],
  [
    /ecommerce|shop|store|product/i,
    {
      name: "Shop",
      components: [
        { kind: "heading", props: { text: "Fresh picks" } },
        {
          kind: "card",
          props: { title: "Classic Tee", body: "$24 — soft cotton, everyday fit." },
        },
        {
          kind: "card",
          props: { title: "Hoodie", body: "$58 — warm, cozy, sustainably made." },
        },
        { kind: "button", props: { text: "Add to Cart" } },
      ],
    },
  ],
];

/**
 * Convert a plain-English description into a concrete app canvas. Prompts are
 * matched against heuristic patterns (+ a generic fallback) so non-coders get
 * a working app in one click; every tile is still editable afterwards.
 */
export function generateAppFromPrompt(prompt: string): AppComponentInstance[] {
  const trimmed = prompt.trim();
  const pattern = PATTERNS.find(([re]) => re.test(trimmed));

  const skeleton = pattern?.[1] ?? {
    name: "My App",
    components: [
      { kind: "heading", props: { text: "Welcome" } },
      {
        kind: "text",
        props: { text: trimmed.length > 0 ? trimmed : "Describe the app you want to build." },
      },
      { kind: "button", props: { text: "Let's Go" } },
      {
        kind: "card",
        props: { title: "Did you know?", body: "You can drag in more tiles from the palette." },
      },
    ],
  };

  return skeleton.components.map(({ kind, props }) => {
    const definition = APP_COMPONENT_BY_KIND.get(kind);
    return {
      id: makeAppComponentId(),
      kind,
      label: definition?.name ?? kind,
      props: { ...definition?.defaultProps, ...props },
    };
  });
}

/** Human-readable project name derived from the prompt (falls back to "My App"). */
export function promptToAppName(prompt: string): string {
  const trimmed = prompt.trim();
  const pattern = PATTERNS.find(([re]) => re.test(trimmed));
  return pattern?.[1].name ?? "My App";
}

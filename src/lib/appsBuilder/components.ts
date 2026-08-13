import type { AppComponentKind } from "./types";

export interface AppComponentDefinition {
  kind: AppComponentKind;
  name: string;
  description: string;
  icon: string;
  defaultProps: Record<string, string>;
  propsSchema: ReadonlyArray<{
    key: string;
    label: string;
    type?: "text" | "textarea";
    placeholder?: string;
  }>;
}

export const APP_COMPONENTS: readonly AppComponentDefinition[] = [
  {
    kind: "text",
    name: "Text",
    description: "A heading or paragraph of text.",
    icon: "type",
    defaultProps: { text: "Hello world", size: "16px", weight: "400" },
    propsSchema: [
      { key: "text", label: "Content", type: "textarea" },
      { key: "size", label: "Font size", placeholder: "16px" },
      { key: "weight", label: "Weight", placeholder: "400" },
    ],
  },
  {
    kind: "button",
    name: "Button",
    description: "A tappable action button.",
    icon: "mouse-pointer-click",
    defaultProps: { text: "Click me", color: "#22C55E" },
    propsSchema: [
      { key: "text", label: "Label" },
      { key: "color", label: "Accent color", placeholder: "#22C55E" },
    ],
  },
  {
    kind: "card",
    name: "Card",
    description: "A bordered container that groups content.",
    icon: "square",
    defaultProps: { title: "Card title", body: "Card body text goes here." },
    propsSchema: [
      { key: "title", label: "Title" },
      { key: "body", label: "Body", type: "textarea" },
    ],
  },
  {
    kind: "image",
    name: "Image",
    description: "An image placeholder.",
    icon: "image",
    defaultProps: { caption: "Image caption", url: "" },
    propsSchema: [
      { key: "caption", label: "Caption" },
      { key: "url", label: "Image URL", placeholder: "https://…" },
    ],
  },
  {
    kind: "input",
    name: "Input",
    description: "A text field for user input.",
    icon: "text-cursor-input",
    defaultProps: { placeholder: "Type here…", label: "Field" },
    propsSchema: [
      { key: "label", label: "Label" },
      { key: "placeholder", label: "Placeholder" },
    ],
  },
  {
    kind: "list",
    name: "List",
    description: "A vertical list of items.",
    icon: "list",
    defaultProps: { items: "Item one\nItem two\nItem three" },
    propsSchema: [{ key: "items", label: "Items (one per line)", type: "textarea" }],
  },
];

export const APP_COMPONENT_BY_KIND = new Map(
  APP_COMPONENTS.map((definition) => [definition.kind, definition]),
);

export type AppComponentKind = "text" | "button" | "card" | "image" | "input" | "list";

export interface AppComponentInstance {
  id: string;
  kind: AppComponentKind;
  label: string;
  props: Record<string, string>;
}

export interface AppCanvasNode {
  root: AppComponentInstance;
  children: readonly AppComponentInstance[];
}

export type AppTarget = "mobile" | "desktop";

export type AppThemeMode = "dark" | "light";

export type AppBlockType =
  | "heading"
  | "text"
  | "stat"
  | "button"
  | "input"
  | "card"
  | "list";

export interface AppBlock {
  id: string;
  type: AppBlockType;
  /** All block props are strings; flags/numbers are encoded (e.g. weight="700"). */
  props: Record<string, string>;
}

export interface AppScreen {
  id: string;
  name: string;
  blocks: AppBlock[];
}

/** The full blueprint of a generated app, produced by the AI planner. */
export interface AppSpec {
  name: string;
  description: string;
  target: AppTarget;
  theme: AppThemeMode;
  accent: string;
  screens: AppScreen[];
}

export interface AppChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

/** A single entry in the agent's build log (e.g. "Creating src/App.tsx…"). */
export interface AppBuildAction {
  id: string;
  file: string | null;
  label: string;
}

/** A single generated source file inside the exported project. */
export interface AppGeneratedFile {
  path: string;
  content: string;
}
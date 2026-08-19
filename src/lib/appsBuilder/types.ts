export type AppTarget = "mobile" | "desktop";

export type AppThemeMode = "dark" | "light";

/** Rendering stack a generated app runs on: 2D web app or 3D R3F game. */
export type AppEngine = "web" | "3d";

export interface AppChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

/** A single generated source file inside the exported project. */
export interface AppGeneratedFile {
  path: string;
  content: string;
}

/**
 * A fully generated app project produced by the AI: a complete Vite + React +
 * TypeScript file map (package.json, index.html, src/*, optional server/*)
 * that can be previewed in-app and exported as a runnable project zip.
 */
export interface AppProject {
  name: string;
  description: string;
  target: AppTarget;
  theme: AppThemeMode;
  /** Rendering stack: "web" for 2D apps, "3d" for React Three Fiber games. */
  engine: AppEngine;
  /** Module that bootstraps the app (defaults to src/main.tsx). */
  entry: string;
  files: AppGeneratedFile[];
}

/** Lifecycle state shown in the apps gallery. */
export type AppStatus = "in-progress" | "completed";

/** A saved app: the generated project plus the AI-agent chat that produced it. */
export interface SavedApp {
  id: string;
  name: string;
  description: string;
  status: AppStatus;
  createdAt: number;
  updatedAt: number;
  project: AppProject;
  messages: AppChatMessage[];
  /**
   * The persistent AI session that wrote this app's `apps/<sessionID>` folder
   * on disk. Reopened apps reuse it so later edits keep working in place.
   */
  sessionID?: string;
}

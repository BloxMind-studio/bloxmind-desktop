export type NodeKind = "trigger" | "fetch" | "process" | "action";

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  toolId: string;
  label: string;
  config: Record<string, string>;
  enabled: boolean;
}

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  systemInstructions: string;
  trigger: string;
  workflow: WorkflowNode[];
  createdAt: number;
  updatedAt: number;
  /**
   * Optional explicit pipes between workflow steps. When absent (or empty),
   * the 3D canvas falls back to the sequential workflow order. Present but
   * non-empty means the user has re-wired steps by dragging anchor ports.
   */
  connections?: WorkflowConnection[];
}

/** A directed pipe between two workflow steps. */
export interface WorkflowConnection {
  from: string;
  to: string;
}

/** A dragged block position on the isometric floor plane. */
export interface IsoWorldPos {
  x: number;
  z: number;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "stopped";

export type RunLogLevel = "info" | "success" | "warn" | "error" | "script";

export interface RunLog {
  id: string;
  time: number;
  level: RunLogLevel;
  message: string;
  nodeId?: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  trigger: string;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  logs: RunLog[];
  script: string;
  nodeStates: Record<string, RunStatus>;
}

export interface ToolField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "select" | "textarea";
  options?: readonly string[];
  required?: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: "trigger" | "fetch" | "process" | "action";
  icon: string;
  accent: string;
  fields: readonly ToolField[];
  defaultConfig: Record<string, string>;
  scriptArgs: ReadonlyArray<{
    describe: (config: Record<string, string>) => string;
  }>;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  accent: string;
  prompt: string;
}

export interface NodeDefinition {
  tool: ToolDefinition;
  kind: NodeKind;
}

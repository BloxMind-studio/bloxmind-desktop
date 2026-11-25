export const qk = {
  sessions: ["sessions"] as const,
  session: (id: string) => ["sessions", id] as const,
  messages: (id: string) => ["sessions", id, "messages"] as const,
  sessionError: (id: string) => ["sessions", id, "error"] as const,
  compaction: (id: string) => ["sessions", id, "compaction"] as const,
  todos: (id: string) => ["sessions", id, "todos"] as const,
  statuses: ["session-statuses"] as const,
  providers: ["providers"] as const,
  agents: ["agents"] as const,
  commands: ["commands"] as const,
  questions: (id: string) => ["sessions", id, "questions"] as const,
  permissions: (id: string) => ["sessions", id, "permissions"] as const,
  config: ["config"] as const,
  mcpStatus: ["mcp-status"] as const,
  studioConnection: ["studio-connection"] as const,
  studioMcpStatus: ["studio-mcp-status"] as const,
  projectIndex: ["project-index"] as const,
  blenderTools: ["blender-tools"] as const,
  // Studio can hand the same key to another place, so the place's ID and name count too.
  uploadAccess: (
    studio: { key: string; placeId?: string | null; label?: string } | null,
    modelUrl: string | null,
  ) =>
    [
      "upload-access",
      studio ? JSON.stringify([studio.key, studio.placeId ?? null, studio.label]) : null,
      modelUrl,
    ] as const,
  modelFile: (url: string) => ["model-file", url] as const,
};

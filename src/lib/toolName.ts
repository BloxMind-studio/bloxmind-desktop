/**
 * The bare name of a tool part, with any `mcp_<server>_` prefix stripped.
 * Tool views switch on this so MCP-provided tools render like their builtin
 * counterparts.
 */

/** Builtin tool names the chat knows how to render. */
const BUILTIN_TOOL_NAMES = [
  "bash",
  "edit",
  "read",
  "write",
  "glob",
  "grep",
  "task",
  "webfetch",
  "todowrite",
  "inspect_instance",
] as const;

export function baseToolName(tool: string): string {
  if (!tool.startsWith("mcp_")) return tool;
  const rest = tool.slice("mcp_".length);
  // MCP tool ids are `mcp_<server>_<tool>`, but the server name is user-chosen
  // and may contain underscores, so the split point is ambiguous. Match a known
  // tool name as the suffix instead of guessing where the server ends; the
  // longest match wins so `..._todowrite` is preferred over `..._write`.
  let match = "";
  for (const name of BUILTIN_TOOL_NAMES) {
    const isToolName = rest === name || rest.endsWith(`_${name}`);
    if (isToolName && name.length > match.length) match = name;
  }
  return match || tool;
}

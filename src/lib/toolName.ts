/**
 * The bare name of a tool part, with any `mcp_<server>_` prefix stripped.
 * Tool views switch on this so MCP-provided tools render like their builtin
 * counterparts.
 */
export function baseToolName(tool: string): string {
  return tool.replace(/^mcp_[^_]+_/, "");
}

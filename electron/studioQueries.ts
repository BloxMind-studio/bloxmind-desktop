import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { StudioTarget, StudioTargetDiscovery } from "../src/types/studioTarget";

export type CallStudioTool = (
  name: string,
  args: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<CallToolResult>;

// Studio MCP can put a note such as "Note: Output limited to N nodes" before the JSON.
function parseMcpText(text: string): any {
  try {
    return JSON.parse(text);
  } catch {}
  const starts = [text.indexOf("["), text.indexOf("{")].filter((index) => index > 0);
  if (starts.length > 0) {
    try {
      return JSON.parse(text.slice(Math.min(...starts)));
    } catch {}
  }
  return text;
}

export function mcpData(result: CallToolResult): any {
  for (const part of result.content ?? []) {
    if ((part as any).type === "json") return (part as any).json;
    if (part.type === "text") return parseMcpText(part.text);
  }
  return null;
}

export function mcpError(result: CallToolResult): string | null {
  if (result.isError !== true) return null;
  const text = (result.content ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
  return text || "Studio returned an error";
}

function identifier(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function toTarget(studio: any): StudioTarget | null {
  const key = identifier(studio?.studio_id ?? studio?.studioId ?? studio?.id);
  if (!key) return null;
  const reportedPlaceId = identifier(studio?.place_id ?? studio?.placeId);
  const placeId = reportedPlaceId === "0" ? null : reportedPlaceId;
  const label = studio?.name ?? studio?.place_name ?? studio?.placeName;
  return {
    key,
    label: typeof label === "string" && label ? label : key,
    detail: placeId ? `Place ${placeId}` : "Local place",
    placeId: placeId ?? null,
  };
}

async function listStudios(callTool: CallStudioTool): Promise<StudioTarget[]> {
  const result = await callTool("list_roblox_studios", {});
  const error = mcpError(result);
  if (error) throw new Error(error);
  const data = mcpData(result) ?? {};
  const studios: unknown[] = Array.isArray(data) ? data : Array.isArray(data.studios) ? data.studios : [];
  return studios.flatMap((studio) => toTarget(studio) ?? []);
}

export async function discoverStudioTargets(
  callTool: CallStudioTool,
): Promise<StudioTargetDiscovery> {
  return { targets: await listStudios(callTool), selectedKey: null };
}

/** Runs a script in whichever data model is open. Studio rejects "Edit" during a playtest. */
export async function runScript(
  callTool: CallStudioTool,
  studioId: string,
  code: string,
): Promise<CallToolResult> {
  let response: CallToolResult = { content: [] };
  for (const datamodelType of ["Edit", "Server", "Client"]) {
    response = await callTool("execute_luau", {
      studio_id: studioId,
      datamodel_type: datamodelType,
      code,
    });
    if (!mcpError(response)) break;
  }
  return response;
}

const IN_PLAYTEST = /not available in \w+ mode/i;
export const STOP_PLAYTEST = "Stop the playtest first";
export const PLACE_CHANGED = "The place changed";

/** Puts an uploaded model in the place, and returns where it went. */
export async function insertUploadedModel(
  callTool: CallStudioTool,
  studioId: string,
  assetId: string,
  name: string,
  placeId?: string,
): Promise<string> {
  const assetName = name.replace(/[^\p{L}\p{N}_]+/gu, "");
  // An insert whose answer never came back still leaves its model, linked to the asset until the
  // cleanup below runs. Finding one means that model is the answer, not a second copy.
  const leftover = await callTool("execute_luau", {
    studio_id: studioId,
    datamodel_type: "Edit",
    code: `${placeId ? `if game.PlaceId ~= ${Number(placeId)} then return "moved" end\n` : ""}for _, child in workspace:GetChildren() do
  local link = child:FindFirstChildOfClass("PackageLink")
  if link and string.match(link.PackageId, "%d+$") == ${JSON.stringify(assetId)} then
    link:Destroy()
    return "game." .. child:GetFullName()
  end
end
return "none"`,
  });
  const lookupError = mcpError(leftover);
  if (lookupError) throw new Error(IN_PLAYTEST.test(lookupError) ? STOP_PLAYTEST : lookupError);
  const found = mcpData(leftover);
  if (found === "moved") throw new Error(PLACE_CHANGED);
  if (typeof found === "string" && found.startsWith("game.")) return found;
  if (found !== "none") throw new Error("Studio couldn't say what the place already has");
  const result = await callTool("insert_asset", {
    studio_id: studioId,
    assetId,
    assetName: assetName || "Model",
    assetType: "Model",
  });
  const error = mcpError(result);
  if (error) throw new Error(error);
  const inserted = mcpData(result)?.insertedInstances?.[0]?.fullPath;
  if (typeof inserted !== "string") throw new Error("Studio returned an unreadable answer");
  await callTool("execute_luau", {
    studio_id: studioId,
    datamodel_type: "Edit",
    code: `local children = workspace:GetChildren()
for index = #children, 1, -1 do
  if children[index].Name == ${JSON.stringify(assetName || "Model")} then
    local link = children[index]:FindFirstChildOfClass("PackageLink")
    if link then link:Destroy() end
    break
  end
end`,
  }).catch(() => {});
  return inserted;
}

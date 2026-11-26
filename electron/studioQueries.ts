import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { AttributeType, ExplorerEdit, ExplorerEditResult } from "../src/lib/explorer";
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

/** Studio's default Explorer service set; less common services stay hidden. */
export const VISIBLE_SERVICES = new Set([
  "Workspace",
  "Players",
  "Lighting",
  "MaterialService",
  "ReplicatedFirst",
  "ReplicatedStorage",
  "ServerScriptService",
  "ServerStorage",
  "StarterGui",
  "StarterPack",
  "StarterPlayer",
  "Teams",
  "SoundService",
  "TextChatService",
]);

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

export const VALUE_FROM_TEXT_LUAU = `local function doesNotFit() error("That value doesn't fit this field") end
local function numbersIn(text, count)
  local numbers = {}
  for word in string.gmatch(text, "[^%s,;{}%[%]()]+") do
    local number = tonumber(word)
    if number == nil then doesNotFit() end
    table.insert(numbers, number)
  end
  if count and #numbers ~= count then doesNotFit() end
  return table.unpack(numbers)
end
local function objectAt(path)
  if path == "game" then return game end
  local found = {}
  local function look(parent, rest)
    for _, child in parent:GetChildren() do
      if child.Name == rest then table.insert(found, child) end
      if string.sub(rest, 1, #child.Name + 1) == child.Name .. "." then
        look(child, string.sub(rest, #child.Name + 2))
      end
    end
  end
  look(game, (string.gsub(path, "^game%.", "")))
  if #found ~= 1 then doesNotFit() end
  return found[1]
end
local function wordsIn(text)
  local words = {}
  for word in string.gmatch(text, "[%w_]+") do table.insert(words, word) end
  return words
end
local function enumItemsNamed(enum, text)
  local items = {}
  for _, word in wordsIn(text) do
    local item = (enum :: any):FromName(word)
    if item == nil then doesNotFit() end
    table.insert(items, item)
  end
  return items
end
local function keypoints(text, size)
  local numbers = { numbersIn(text) }
  if #numbers == 0 or #numbers % size ~= 0 then doesNotFit() end
  return numbers
end
local FROM_TEXT = {
  string = function(_, text) return text end,
  number = function(_, text) return numbersIn(text, 1) end,
  boolean = function(_, text)
    if text == "true" then return true end
    if text == "false" then return false end
    doesNotFit()
  end,
  EnumItem = function(current, text)
    local itemName = string.match(text, "([^.]+)$")
    for _, item in current.EnumType:GetEnumItems() do
      if item.Name == itemName then return item end
    end
    doesNotFit()
  end,
  BrickColor = function(_, text)
    local color = BrickColor.new(text)
    -- BrickColor.new falls back to grey for a name it doesn't know.
    if color.Name ~= text then doesNotFit() end
    return color
  end,
  Vector3 = function(_, text) return Vector3.new(numbersIn(text, 3)) end,
  Vector3int16 = function(_, text) return Vector3int16.new(numbersIn(text, 3)) end,
  Vector2 = function(_, text) return Vector2.new(numbersIn(text, 2)) end,
  Vector2int16 = function(_, text) return Vector2int16.new(numbersIn(text, 2)) end,
  Color3 = function(_, text) return Color3.new(numbersIn(text, 3)) end,
  UDim = function(_, text) return UDim.new(numbersIn(text, 2)) end,
  UDim2 = function(_, text) return UDim2.new(numbersIn(text, 4)) end,
  Rect = function(_, text) return Rect.new(numbersIn(text, 4)) end,
  NumberRange = function(_, text) return NumberRange.new(numbersIn(text, 2)) end,
  CFrame = function(current, text)
    local px, py, pz, rx, ry, rz = numbersIn(text, 6)
    local position = CFrame.new(px, py, pz)
    if current then
      local cx, cy, cz = current:ToOrientation()
      -- The text may come from another reader, so it can differ in its last digits.
      if math.abs(math.deg(cx) - rx) < 1e-3 and math.abs(math.deg(cy) - ry) < 1e-3 and math.abs(math.deg(cz) - rz) < 1e-3 then
        return position * current.Rotation
      end
    end
    return position * CFrame.fromOrientation(math.rad(rx), math.rad(ry), math.rad(rz))
  end,
  PhysicalProperties = function(_, text)
    if text == "" then return nil end
    return PhysicalProperties.new(numbersIn(text, 6))
  end,
  NumberSequence = function(_, text)
    local numbers = keypoints(text, 3)
    local points = {}
    for index = 1, #numbers, 3 do
      table.insert(points, NumberSequenceKeypoint.new(numbers[index], numbers[index + 1], numbers[index + 2]))
    end
    return NumberSequence.new(points)
  end,
  ColorSequence = function(_, text)
    local numbers = keypoints(text, 5)
    local points = {}
    for index = 1, #numbers, 5 do
      local color = Color3.new(numbers[index + 1], numbers[index + 2], numbers[index + 3])
      table.insert(points, ColorSequenceKeypoint.new(numbers[index], color))
    end
    return ColorSequence.new(points)
  end,
  Faces = function(_, text) return Faces.new(table.unpack(enumItemsNamed(Enum.NormalId, text))) end,
  Axes = function(_, text) return Axes.new(table.unpack(enumItemsNamed(Enum.Axis, text))) end,
  Font = function(_, text)
    local family, weight, style = string.match(text, "^%s*(.-)%s*,%s*(%w+)%s*,%s*(%w+)%s*$")
    if not family then doesNotFit() end
    return Font.new(family, (Enum.FontWeight :: any):FromName(weight), (Enum.FontStyle :: any):FromName(style))
  end,
  Instance = function(_, text)
    if text == "" then return nil end
    return objectAt(text)
  end,
  Content = function(_, text)
    if text == "" then return Content.none end
    return Content.fromUri(text)
  end,
  SecurityCapabilities = function(_, text)
    return SecurityCapabilities.new(table.unpack(enumItemsNamed(Enum.SecurityCapability, text)))
  end,
}
local function valueFromText(kind, current, text)
  local convert = FROM_TEXT[kind]
  if not convert then error("BloxBot can't edit this kind of value") end
  return convert(current, text)
end`;

const STRUCTURE_GUARD_LUAU = `if instance.Parent == game then error("Services can't be changed") end
`;

const ATTRIBUTE_DEFAULTS: Record<AttributeType, string> = {
  string: '""',
  boolean: "false",
  number: "0",
  Vector3: "Vector3.zero",
  Vector2: "Vector2.zero",
  Color3: "Color3.new(1, 1, 1)",
  BrickColor: 'BrickColor.new("Medium stone grey")',
  CFrame: "CFrame.new()",
  UDim: "UDim.new()",
  UDim2: "UDim2.new()",
  NumberRange: "NumberRange.new(0, 1)",
  Rect: "Rect.new(0, 0, 1, 1)",
  NumberSequence: "NumberSequence.new(0)",
  ColorSequence: "ColorSequence.new(Color3.new(1, 1, 1))",
};

const KEEP_NAME_LUAU = "local name = instance.Name";

const EDIT_LUAU: Record<ExplorerEdit["action"], (edit: any) => string> = {
  rename: ({ name }) => `${STRUCTURE_GUARD_LUAU}instance.Name = ${JSON.stringify(name)}
${KEEP_NAME_LUAU}`,
  // A duplicate needs its own name: the tree shows objects sharing a path as one row.
  duplicate: () => `${STRUCTURE_GUARD_LUAU}local copy = instance:Clone()
if not copy then error("This object can't be duplicated") end
-- Roblox allows 100 characters, so a long name gives way to what makes this one different.
local function withSuffix(suffix)
  local stop = utf8.offset(instance.Name, 101 - #suffix)
  return (stop and string.sub(instance.Name, 1, stop - 1) or instance.Name) .. suffix
end
local name = withSuffix("Copy")
local number = 1
while instance.Parent:FindFirstChild(name) do
  number += 1
  name = withSuffix("Copy" .. number)
end
copy.Name = name
copy.Parent = instance.Parent`,
  // Not Destroy(), which locks the object for good, so Studio's undo can put it back.
  delete: () => `${STRUCTURE_GUARD_LUAU}${KEEP_NAME_LUAU}
instance.Parent = nil`,
  setField: ({ kind, field, value, valueType }) => {
    const fieldName = JSON.stringify(field);
    const type = JSON.stringify(valueType);
    const text = JSON.stringify(value);
    const write =
      kind === "attribute"
        ? `local current = instance:GetAttribute(${fieldName})
if current == nil then error("This attribute is gone") end
instance:SetAttribute(${fieldName}, valueFromText(typeof(current), current, ${text}))`
        : field === "Pivot"
          ? `if instance:IsA("PVInstance") then
  instance:PivotTo(valueFromText("CFrame", instance:GetPivot(), ${text}))
else
  error("This object has no pivot")
end`
          : `instance[${fieldName}] = valueFromText(${type}, instance[${fieldName}], ${text})`;
    return `${VALUE_FROM_TEXT_LUAU}
${write}
${KEEP_NAME_LUAU}`;
  },
  addAttribute: ({ field, valueType }: { field: string; valueType: AttributeType }) => {
    const fieldName = JSON.stringify(field);
    return `if instance:GetAttribute(${fieldName}) ~= nil then error("This attribute already exists") end
instance:SetAttribute(${fieldName}, ${ATTRIBUTE_DEFAULTS[valueType]})
${KEEP_NAME_LUAU}`;
  },
  removeAttribute: ({ field }) => `instance:SetAttribute(${JSON.stringify(field)}, nil)
${KEEP_NAME_LUAU}`,
  addTag: ({ field }) => `instance:AddTag(${JSON.stringify(field)})
${KEEP_NAME_LUAU}`,
  removeTag: ({ field }) => `instance:RemoveTag(${JSON.stringify(field)})
${KEEP_NAME_LUAU}`,
};

/** Runs as one call, which Studio records as a change. A playtest's changes wouldn't last, so it's Edit only. */
export async function editExplorerObject(
  callTool: CallStudioTool,
  studioId: string,
  edit: ExplorerEdit,
): Promise<ExplorerEditResult> {
  const result = await callTool("execute_luau", {
    studio_id: studioId,
    datamodel_type: "Edit",
    code: `${findObjectLuau(edit)}
${EDIT_LUAU[edit.action](edit)}
return game:GetService("HttpService"):JSONEncode({ name = name })`,
  });
  const error = mcpError(result);
  if (error) {
    throw new Error(IN_PLAYTEST.test(error) ? STOP_PLAYTEST : error);
  }
  const name = mcpData(result)?.name;
  if (typeof name !== "string") throw new Error("Studio returned an unreadable answer");
  return { name };
}

function findMatchesLuau(path: string) {
  return `local matches = {}
local function find(parent, rest)
  for _, child in parent:GetChildren() do
    if child.Name == rest then table.insert(matches, child) end
    if string.sub(rest, 1, #child.Name + 1) == child.Name .. "." then
      find(child, string.sub(rest, #child.Name + 2))
    end
  end
end
find(game, ${JSON.stringify(path.replace(/^game\./, ""))})`;
}

/** The object one row stands for. If the place no longer matches the tree, nothing gets touched. */
function findObjectLuau(target: {
  path: string;
  className: string;
  occurrence?: number;
  occurrences?: number;
}) {
  return `${findMatchesLuau(target.path)}
if #matches ~= ${target.occurrences ?? 1} then error("Found " .. #matches .. " objects at this path") end
local instance = matches[${(target.occurrence ?? 0) + 1}]
if instance.ClassName ~= ${JSON.stringify(target.className)} then error("Found 0 objects at this path") end`;
}

const HISTORY_STATE_PATH = "CoreGui.BloxBotHistoryState";
const HISTORY_STATE_MAX_AGE_SECONDS = 5;

// Says whether Studio has anything to redo and counts changes to the tree, where inspect_instance
// can read them without a script. It lives in CoreGui, which isn't part of the place: it isn't saved
// and doesn't touch undo history.
const WATCH_HISTORY_LUAU = `local CoreGui = game:GetService("CoreGui")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local previous = CoreGui:FindFirstChild("BloxBotHistoryState")
if previous then previous:Destroy() end
local state = Instance.new("StringValue")
state.Name = "BloxBotHistoryState"
state.Archivable = false
state.Parent = CoreGui
local generation = (_G.__bloxbotHistoryWatch or 0) + 1
_G.__bloxbotHistoryWatch = generation
local visible = { ${[...VISIBLE_SERVICES].map((name) => `${name} = true`).join(", ")} }
local treeVersion = 0
local function noteChange(instance)
  local top = instance
  while top.Parent and top.Parent ~= game do top = top.Parent end
  if visible[top.Name] then treeVersion += 1 end
end
local connections = {
  game.DescendantAdded:Connect(noteChange),
  game.DescendantRemoving:Connect(noteChange),
  game.ItemChanged:Connect(function(instance, property)
    if property == "Name" or property == "Parent" then noteChange(instance) end
  end),
}
task.spawn(function()
  while state.Parent and _G.__bloxbotHistoryWatch == generation do
    state.Value = tostring(ChangeHistoryService:GetCanRedo()) .. " " .. os.time() .. " " .. treeVersion
    task.wait(0.2)
  end
  for _, connection in connections do connection:Disconnect() end
end)
return "ok"`;

type RedoState = "nothing-to-redo" | "can-redo" | "unknown";

/** Null for the tree's version means Studio won't say when the tree changes. */
export async function readHistoryState(
  callTool: CallStudioTool,
  studioId: string,
): Promise<{ redo: RedoState; treeVersion: string | null }> {
  const unknown = { redo: "unknown" as const, treeVersion: null };
  const result = await callTool("inspect_instance", {
    studio_id: studioId,
    path: HISTORY_STATE_PATH,
  });
  if (mcpError(result)) return unknown;
  const state = /^(true|false) (\d+)(?: (\d+))?$/.exec(
    String(mcpData(result)?.properties?.Value ?? ""),
  );
  if (!state) return unknown;
  // A value that stopped updating means the watcher is gone, for example after a plugin reload.
  const age = Math.abs(Date.now() / 1000 - Number(state[2]));
  if (age > HISTORY_STATE_MAX_AGE_SECONDS) return unknown;
  return {
    redo: state[1] === "true" ? "can-redo" : "nothing-to-redo",
    treeVersion: state[3] ?? null,
  };
}


/** Installs CoreGui's redo/change watcher so later reads can avoid clearing Studio's redo stack. */
export async function startHistoryWatcher(
  callTool: CallStudioTool,
  studioId: string,
): Promise<boolean> {
  const result = await callTool("execute_luau", {
    studio_id: studioId,
    datamodel_type: "Edit",
    code: WATCH_HISTORY_LUAU,
  });
  return mcpError(result) === null;
}
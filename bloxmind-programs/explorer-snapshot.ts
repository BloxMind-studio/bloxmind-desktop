async function run({ input, callTool }: { input: { studioId: string }; callTool: (name: string, args: Record<string, unknown>) => Promise<unknown> }) {
  const studioId = typeof input?.studioId === "string" ? input.studioId : "";
  if (!studioId) throw new Error("A Studio target is required");
  // Studio caps max_depth at 10; use that ceiling and a generous result cap so
  // ordinary places are collected in one pass. Studio requires datamodel_type:
  // "Edit" normally, and it rejects "Edit" during a playtest, so fall back to
  // the server data model then, and to the client one when Studio can't reach
  // the server (Play Solo on recent Studio builds). Attempts that only say a
  // data model "is not available in … mode" add nothing, so they're left out
  // of the error.
  let raw: any = null;
  let usedModel = "Edit";
  const errors: Array<[string, string]> = [];
  for (const datamodelType of ["Edit", "Server", "Client"]) {
    const result = await callTool("search_game_tree", {
      studio_id: studioId,
      datamodel_type: datamodelType,
      max_depth: 10,
      head_limit: 100000,
    });
    const error = mcpErrorText(result);
    if (error) {
      errors.push([datamodelType, error]);
      continue;
    }
    raw = normalizeMcpResult(result);
    usedModel = datamodelType;
    break;
  }
  if (raw === null) {
    const [[, first] = ["", ""], ...rest] = errors;
    const details = rest
      .filter(([, error]) => error !== first && !/not available in \w+ mode/i.test(error))
      .map(([type, error]) => `${type.toLowerCase()} data model: ${error}`);
    const message = details.length > 0 ? `${first} (${details.join("; ")})` : first;
    throw new Error(message || "Studio did not return an instance tree");
  }
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.instances) ? raw.instances : [];
  // Match Studio Explorer's default service set. Studio hides less commonly
  // edited engine services unless the user explicitly enables them.
  const visibleServices = new Set([
    "Workspace", "Players", "Lighting", "MaterialService", "ReplicatedFirst",
    "ReplicatedStorage", "ServerScriptService", "ServerStorage", "StarterGui",
    "StarterPack", "StarterPlayer", "Teams", "SoundService", "TextChatService",
  ]);
  const byPath = new Map<string, any>();
  const needsExpand = new Set<string>();
  let placeName = "Roblox Studio";
  for (const row of rows) {
    if (row?.className === "DataModel" && typeof row?.name === "string" && row.name) {
      placeName = row.name;
      continue;
    }
    const path = typeof row?.fullPath === "string" ? row.fullPath : typeof row?.path === "string" ? row.path : "";
    if (!path) continue;
    if (Number(row?.unexploredChildCount ?? 0) > 0) needsExpand.add(path.startsWith("game.") ? path : "game." + path);
    const topLevel = path.split(".")[0];
    if (!visibleServices.has(topLevel)) continue;
    const properties = row?.properties && typeof row.properties === "object" ? row.properties : {};
    const instanceName =
      typeof properties.Name === "string" && properties.Name ? properties.Name :
      typeof row.Name === "string" && row.Name ? row.Name :
      typeof row.name === "string" && row.name ? row.name :
      path.split(".").at(-1) ?? path;
    byPath.set(path, {
      name: instanceName,
      className: typeof row.className === "string" ? row.className : "Instance",
      path: path.startsWith("game.") ? path : "game." + path,
      hasChildren: Number(row.unexploredChildCount ?? 0) > 0,
      properties: [], attributes: [], children: [],
    });
  }
  // Studio's tree read leaves properties empty on services and Terrain. Read
  // those with inspect_instance so the inspector has something useful to show.
  // Everything else keeps the cheap tree-only read, and a tool that isn't
  // available in this Studio never stops the snapshot.
  const inspectTargets = [...byPath.values()].filter(
    (node: any) =>
      visibleServices.has(String(node.path).split(".")[1] ?? "") ||
      node.className === "Terrain",
  );
  const numbersIn = (text: string): string[] =>
    String(text)
      .split(/[\s,;{}()]+/)
      .filter(Boolean);
  const infer = (text: string, name = ""): any => {
    const numbers = numbersIn(text);
    return {
      value: text,
      ...(/^Enum\.\w+\.\w+$/.test(text) ? { type: "EnumItem" } : {}),
      ...(/^Content[<(]/.test(text) ? { type: "Content" } : {}),
      ...(/brickcolor/i.test(name) ? { type: "BrickColor" } : {}),
      ...(/color/i.test(name) && numbers.length === 3 ? { type: "Color3" } : {}),
      ...(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i.test(text) ? { numeric: true } : {}),
    };
  };
  const fieldValue = (value: any, name = ""): any => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return infer(String(value), name);
    }
    if (value && typeof value === "object") {
      if (typeof value.Position === "string" && typeof value.Rotation === "string") {
        return {
          value: [...numbersIn(value.Position), ...numbersIn(value.Rotation)].join(", "),
          type: "CFrame",
          numeric: true,
        };
      }
      if (Array.isArray(value)) return infer(value.map((item) => String(item)).join(", "), name);
      return infer(JSON.stringify(value), name);
    }
    return infer("", name);
  };
  const fieldsOf = (values: any, limit: number): any[] => {
    if (!values || typeof values !== "object" || Array.isArray(values)) return [];
    return Object.entries(values)
      .filter(([name]) => name !== "UniqueId")
      .map(([name, raw]) => ({ name, ...fieldValue(raw, String(name)) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .slice(0, limit);
  };
  for (const node of inspectTargets) {
    try {
      const result = await callTool("inspect_instance", {
        studio_id: studioId,
        path: node.path,
      });
      if (mcpErrorText(result)) continue;
      const data = normalizeMcpResult(result);
      const match = Array.isArray(data?.matches) ? data.matches[0] : data;
      if (!match) continue;
      node.properties = fieldsOf(match.properties, 16);
      node.attributes = fieldsOf(match.attributes, 24);
    } catch {
      // The tree is still useful without details from one instance.
    }
  }
  // Studio caps a single read at max_depth 10. Fill in anything still marked as
  // unexplored by reading again from that object; each extra read has its own
  // ten levels, so deep places stay visible.
  const expandQueue = [...needsExpand];
  let expandCalls = 0;
  while (expandQueue.length > 0 && expandCalls < 200) {
    const parentPath = expandQueue.shift();
    if (!parentPath) continue;
    const parent = byPath.get(parentPath);
    if (!parent) continue;
    const hasChild = [...byPath.values()].some(
      (node: any) => node.path !== parentPath && parentPath.startsWith(String(node.path)),
    );
    if (hasChild) continue;
    expandCalls += 1;
    try {
      const extraResult = await callTool("search_game_tree", {
        studio_id: studioId,
        datamodel_type: usedModel,
        path: parentPath,
        max_depth: 10,
        head_limit: 100000,
      });
      if (mcpErrorText(extraResult)) continue;
      const extra = normalizeMcpResult(extraResult);
      const extraRows = Array.isArray(extra)
        ? extra
        : Array.isArray(extra?.instances)
          ? extra.instances
          : [];
      for (const row of extraRows) {
        const path = typeof row?.fullPath === "string" ? row.fullPath : typeof row?.path === "string" ? row.path : "";
        if (!path || byPath.has(path) || !visibleServices.has(path.split(".")[0])) continue;
        const gamePath = path.startsWith("game.") ? path : "game." + path;
        const properties = row?.properties && typeof row.properties === "object" ? row.properties : {};
        const name =
          typeof properties.Name === "string" && properties.Name ? properties.Name :
          typeof row.Name === "string" && row.Name ? row.Name :
          typeof row.name === "string" && row.name ? row.name :
          gamePath.split(".").at(-1) ?? gamePath;
        byPath.set(gamePath, {
          name,
          className: typeof row.className === "string" ? row.className : "Instance",
          path: gamePath,
          hasChildren: Number(row.unexploredChildCount ?? 0) > 0,
          properties: [], attributes: [], children: [],
        });
        if (Number(row.unexploredChildCount ?? 0) > 0) expandQueue.push(gamePath);
      }
    } catch {
      // The rest of the place is still useful if one deep branch can't be read.
    }
  }

  const roots: any[] = [];
  for (const [path, node] of byPath) {
    const parentPath = path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : "";
    const parent = byPath.get(parentPath);
    if (parent) { parent.children.push(node); parent.hasChildren = true; }
    else roots.push(node);
  }
  return { placeName, capturedAt: new Date().toISOString(), roots };
}

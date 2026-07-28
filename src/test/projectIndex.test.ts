import { describe, expect, it } from "vitest";

import {
  buildDependencyGraph,
  type ProjectModule,
  parseRequireCalls,
} from "@/lib/projectIndex";

// ── parseRequireCalls ────────────────────────────────────────────────────

describe("parseRequireCalls", () => {
  it("parses simple require(ModuleScript) references", () => {
    const source = `
local Util = require(script.Parent.Util)
local Config = require(game.ServerScriptService.Config)
    `;
    const deps = parseRequireCalls(source);
    expect(deps).toEqual(["script.Parent.Util", "game.ServerScriptService.Config"]);
  });

  it("parses require() with game:GetService() calls", () => {
    const source = `
local Data = require(game:GetService("ReplicatedStorage").Shared.Data)
local UI = require(game:GetService("ServerScriptService").UI.Main)
    `;
    const deps = parseRequireCalls(source);
    expect(deps).toEqual([
      "game.ReplicatedStorage.Shared.Data",
      "game.ServerScriptService.UI.Main",
    ]);
  });

  it("parses string literal require paths", () => {
    const source = `
local Mod = require("path.to.Module")
    `;
    const deps = parseRequireCalls(source);
    expect(deps).toEqual(["path.to.Module"]);
  });

  it("parses single-quoted string literal require paths", () => {
    const source = `
local Mod = require('path.to.Module')
    `;
    const deps = parseRequireCalls(source);
    expect(deps).toEqual(["path.to.Module"]);
  });

  it("tags variable references with var: prefix", () => {
    const source = `
local Module = require(someVariable)
    `;
    const deps = parseRequireCalls(source);
    expect(deps).toEqual(["var:someVariable"]);
  });

  it("parses require() at top level of source", () => {
    const source = `require(ReplicatedStorage.Shared.Util)`;
    const deps = parseRequireCalls(source);
    expect(deps).toEqual(["game.ReplicatedStorage.Shared.Util"]);
  });

  it("handles require() with no arguments gracefully", () => {
    const source = "local x = require()";
    const deps = parseRequireCalls(source);
    expect(deps).toEqual([]);
  });

  it("handles empty source", () => {
    expect(parseRequireCalls("")).toEqual([]);
  });

  it("does not match non-require function calls", () => {
    const source = `
local result = someFunction(require)
local x = requested(module)
    `;
    const deps = parseRequireCalls(source);
    expect(deps).toEqual([]);
  });

  it("handles complex nested expressions with whitespace", () => {
    const source = `
local X = require( game : GetService ( "ReplicatedStorage" ) . Module )
    `;
    const deps = parseRequireCalls(source);
    expect(deps).toEqual(["game.ReplicatedStorage.Module"]);
  });

  it("finds all require calls in a real-world Luau script", () => {
    const source = `
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Signal = require(ReplicatedStorage.Shared.Signal)
local Config = require(ReplicatedStorage.Shared.Config)
local Network = require(ReplicatedStorage.Network)

local function setup()
  local Data = require(script.Parent.Data)
  Data.init()
end

return require(ReplicatedStorage.Shared.Module)
    `;
    const deps = parseRequireCalls(source);
    // ReplicatedStorage starts with uppercase, so it's treated as an absolute path
    expect(deps).toContain("game.ReplicatedStorage.Shared.Signal");
    expect(deps).toContain("game.ReplicatedStorage.Shared.Config");
    expect(deps).toContain("game.ReplicatedStorage.Network");
    expect(deps).toContain("script.Parent.Data");
    expect(deps).toContain("game.ReplicatedStorage.Shared.Module");
    expect(deps).toHaveLength(5);
  });
});

// ── buildDependencyGraph ─────────────────────────────────────────────────

describe("buildDependencyGraph", () => {
  it("returns empty arrays for empty module list", () => {
    const { entryPoints, circularDependencies } = buildDependencyGraph([]);
    expect(entryPoints).toEqual([]);
    expect(circularDependencies).toEqual([]);
  });

  it("identifies entry points for a linear dependency chain", () => {
    const modules: ProjectModule[] = [
      {
        path: "game.ServerScriptService.Entry",
        name: "Entry",
        className: "Script",
        sourceLength: 100,
        dependencies: ["game.ServerScriptService.Util"],
      },
      {
        path: "game.ServerScriptService.Util",
        name: "Util",
        className: "ModuleScript",
        sourceLength: 200,
        dependencies: ["game.ReplicatedStorage.Config"],
      },
      {
        path: "game.ReplicatedStorage.Config",
        name: "Config",
        className: "ModuleScript",
        sourceLength: 50,
        dependencies: [],
      },
    ];

    const { entryPoints, circularDependencies } = buildDependencyGraph(modules);
    // Entry is the top-level script that nothing depends on
    expect(entryPoints).toContain("game.ServerScriptService.Entry");
    expect(entryPoints).not.toContain("game.ServerScriptService.Util");
    expect(entryPoints).not.toContain("game.ReplicatedStorage.Config");
    expect(circularDependencies).toEqual([]);
  });

  it("marks all modules as entry points when they have no dependents", () => {
    const modules: ProjectModule[] = [
      {
        path: "game.ServerScriptService.A",
        name: "A",
        className: "Script",
        sourceLength: 100,
        dependencies: [],
      },
      {
        path: "game.ServerScriptService.B",
        name: "B",
        className: "Script",
        sourceLength: 100,
        dependencies: [],
      },
    ];

    const { entryPoints } = buildDependencyGraph(modules);
    expect(entryPoints).toEqual(expect.arrayContaining([
      "game.ServerScriptService.A",
      "game.ServerScriptService.B",
    ]));
  });

  it("detects direct circular dependencies", () => {
    const modules: ProjectModule[] = [
      {
        path: "game.ServerScriptService.A",
        name: "A",
        className: "ModuleScript",
        sourceLength: 100,
        dependencies: ["game.ServerScriptService.B"],
      },
      {
        path: "game.ServerScriptService.B",
        name: "B",
        className: "ModuleScript",
        sourceLength: 100,
        dependencies: ["game.ServerScriptService.A"],
      },
    ];

    const { circularDependencies } = buildDependencyGraph(modules);
    // DFS visits A -> B -> A (cycle detected at B -> A)
    expect(circularDependencies).toContainEqual(["game.ServerScriptService.B", "game.ServerScriptService.A"]);
  });

  it("detects indirect circular dependencies", () => {
    const modules: ProjectModule[] = [
      {
        path: "game.ServerScriptService.A",
        name: "A",
        className: "ModuleScript",
        sourceLength: 100,
        dependencies: ["game.ServerScriptService.B"],
      },
      {
        path: "game.ServerScriptService.B",
        name: "B",
        className: "ModuleScript",
        sourceLength: 100,
        dependencies: ["game.ServerScriptService.C"],
      },
      {
        path: "game.ServerScriptService.C",
        name: "C",
        className: "ModuleScript",
        sourceLength: 100,
        dependencies: ["game.ServerScriptService.A"],
      },
    ];

    const { circularDependencies } = buildDependencyGraph(modules);
    expect(circularDependencies.length).toBeGreaterThan(0);
    expect(circularDependencies).toContainEqual(["game.ServerScriptService.C", "game.ServerScriptService.A"]);
  });

  it("ignores unresolved dependency references", () => {
    const modules: ProjectModule[] = [
      {
        path: "game.ServerScriptService.A",
        name: "A",
        className: "Script",
        sourceLength: 100,
        dependencies: ["game.ServerScriptService.MissingModule"],
      },
    ];

    const { entryPoints, circularDependencies } = buildDependencyGraph(modules);
    // A should still be an entry point since the missing module doesn't exist
    expect(entryPoints).toContain("game.ServerScriptService.A");
    expect(circularDependencies).toEqual([]);
  });

  it("handles a complex real-world project structure", () => {
    const modules: ProjectModule[] = [
      {
        path: "game.ServerScriptService.Main",
        name: "Main",
        className: "Script",
        sourceLength: 500,
        dependencies: ["game.ReplicatedStorage.Shared.Util", "game.ServerScriptService.Config"],
      },
      {
        path: "game.ServerScriptService.Config",
        name: "Config",
        className: "ModuleScript",
        sourceLength: 200,
        dependencies: ["game.ReplicatedStorage.Shared.Util"],
      },
      {
        path: "game.ReplicatedStorage.Shared.Util",
        name: "Util",
        className: "ModuleScript",
        sourceLength: 300,
        dependencies: [],
      },
      {
        path: "game.StarterGui.UI",
        name: "UI",
        className: "LocalScript",
        sourceLength: 400,
        dependencies: ["game.ReplicatedStorage.Shared.Util"],
      },
    ];

    const { entryPoints, circularDependencies } = buildDependencyGraph(modules);
    // Main and UI are entry points since nothing depends on them
    expect(entryPoints).toEqual(
      expect.arrayContaining(["game.ServerScriptService.Main", "game.StarterGui.UI"]),
    );
    expect(entryPoints).not.toContain("game.ReplicatedStorage.Shared.Util");
    expect(entryPoints).not.toContain("game.ServerScriptService.Config");
    expect(circularDependencies).toEqual([]);
  });
});
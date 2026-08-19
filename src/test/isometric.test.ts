import { describe, expect, it } from "vitest";
import {
  blockGeometry,
  faceColors,
  inverseIsoProject,
  isoProject,
  LIFT_BY_KIND,
  layoutWorkflowIso,
  resolveWorkflowEdges,
  shadeColor,
} from "@/lib/agentStudio/isometric";
import type { WorkflowNode } from "@/lib/agentStudio/types";

const node = (id: string, kind: WorkflowNode["kind"], enabled = true): WorkflowNode => ({
  id,
  kind,
  toolId: `tool.${id}`,
  label: id,
  config: {},
  enabled,
});

describe("isoProject", () => {
  it("projects the origin to the origin", () => {
    expect(isoProject(0, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("applies the 2:1 isometric factors", () => {
    // ScreenX = (x - z) * cos(30°), ScreenY = (x + z) * sin(30°) - y
    expect(isoProject(100, 0, 0).x).toBeCloseTo(86.6, 1);
    expect(isoProject(0, 100, 0).x).toBeCloseTo(-86.6, 1);
    expect(isoProject(100, 100, 0).y).toBeCloseTo(100, 1);
    expect(isoProject(0, 0, 50).y).toBeCloseTo(-50, 1);
  });
});

describe("layoutWorkflowIso", () => {
  const nodes = [
    node("a", "trigger"),
    node("b", "fetch"),
    node("c", "process"),
    node("d", "action"),
  ];

  it("arranges in a serpentine pattern", () => {
    const six = [
      node("a", "trigger"),
      node("b", "fetch"),
      node("c", "process"),
      node("d", "action"),
      node("e", "fetch"),
      node("f", "action"),
    ];
    const layout = layoutWorkflowIso(six);
    expect(layout.map((entry) => entry.node.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    // Row 0 steps left → right, row 1 mirrors right → left
    expect(layout[0].x).toBeLessThan(layout[1].x);
    expect(layout[1].x).toBeLessThan(layout[2].x);
    expect(layout[3].x).toBeGreaterThan(layout[4].x);
    expect(layout[4].x).toBeGreaterThan(layout[5].x);
    expect(layout[0].z).toBeLessThan(layout[3].z);
  });

  it("lifts process nodes highest and action nodes lowest", () => {
    const layout = layoutWorkflowIso(nodes);
    const lifts = Object.fromEntries(layout.map((entry) => [entry.node.id, entry.lift]));
    expect(lifts.c).toBe(LIFT_BY_KIND.process);
    expect(lifts.d).toBe(LIFT_BY_KIND.action);
    expect(lifts.c).toBeGreaterThan(lifts.d);
  });
});

describe("blockGeometry", () => {
  it("keeps the exit socket in front of the entry socket for flow direction", () => {
    const [entry] = layoutWorkflowIso([node("a", "trigger")]);
    const geo = blockGeometry(entry);
    expect(geo.entry.y).toBeLessThan(geo.exit.y);
    // Painter's order key grows toward the viewer
    expect(geo.sortKey).toBe(entry.x + entry.z);
  });

  it("anchors the side handles dead-center on the cube's left and right faces", () => {
    const [entry] = layoutWorkflowIso([node("a", "trigger")]);
    const geo = blockGeometry(entry);
    // Output handle sits on the right side, input on the left…
    expect(geo.portOut.x).toBeGreaterThan(0);
    expect(geo.portIn.x).toBeLessThan(0);
    // …mirrored and at the same height so both read as symmetric mid-face anchors
    expect(geo.portOut.x).toBeCloseTo(-geo.portIn.x, 5);
    expect(geo.portOut.y).toBeCloseTo(geo.portIn.y, 5);
    // Both lie within the vertical span of the extruded body
    const bodyTop = Math.min(geo.top.y, geo.right.y, geo.front.y, geo.left.y);
    const bodyBottom = Math.max(geo.leftDown.y, geo.rightDown.y, geo.frontDown.y);
    expect(geo.portIn.y).toBeGreaterThan(bodyTop);
    expect(geo.portIn.y).toBeLessThan(bodyBottom);
    expect(geo.portOut.y).toBeGreaterThan(bodyTop);
    expect(geo.portOut.y).toBeLessThan(bodyBottom);
  });
});

describe("inverseIsoProject", () => {
  it("round-trips isoProject for points on the floor plane", () => {
    for (const [x, z] of [
      [0, 0],
      [100, 0],
      [0, 100],
      [240, 120],
      [-80, 60],
    ] as const) {
      const screen = isoProject(x, z, 0);
      const back = inverseIsoProject(screen.x, screen.y);
      expect(back.x).toBeCloseTo(x, 5);
      expect(back.z).toBeCloseTo(z, 5);
    }
  });
});

describe("resolveWorkflowEdges", () => {
  const nodes = [
    node("a", "trigger"),
    node("b", "fetch"),
    node("c", "process"),
    node("d", "action"),
  ];

  it("falls back to the sequential pipeline when no connections exist", () => {
    expect(resolveWorkflowEdges(nodes)).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
    ]);
  });

  it("drops pipes touching a disabled step in the sequential fallback", () => {
    const partial = [
      node("a", "trigger"),
      node("b", "fetch", false),
      node("c", "process"),
      node("d", "action"),
    ];
    expect(resolveWorkflowEdges(partial)).toEqual([{ from: "c", to: "d" }]);
  });

  it("renders explicit re-wired connections when present", () => {
    const connections = [
      { from: "a", to: "c" },
      { from: "c", to: "b" },
      { from: "b", to: "d" },
    ];
    expect(resolveWorkflowEdges(nodes, connections)).toEqual(connections);
  });

  it("ignores stale or duplicate connections", () => {
    const connections = [
      { from: "a", to: "zzz" },
      { from: "a", to: "b" },
      { from: "c", to: "b" }, // b already has an incoming edge → skipped
      { from: "b", to: "d" },
    ];
    expect(resolveWorkflowEdges(nodes, connections)).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "d" },
    ]);
  });
});

describe("shading", () => {
  it("lightens tops and darkens left faces", () => {
    const colors = faceColors("#8b5cf6");
    expect(colors.top).not.toBe(colors.right);
    expect(colors.left).not.toBe(colors.right);
  });

  it("round-trips valid hex colors", () => {
    expect(shadeColor("#ffffff", 0)).toBe("#ffffff");
  });
});

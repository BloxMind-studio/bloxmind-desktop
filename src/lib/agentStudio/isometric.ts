import type { NodeKind, WorkflowConnection, WorkflowNode } from "./types";

export interface IsoPoint {
  x: number;
  y: number;
}

export interface IsoLayoutEntry {
  node: WorkflowNode;
  index: number;
  x: number;
  z: number;
  lift: number;
}

/** Standard 2:1 isometric projection factors (30° axes). */
export const ISO_X = Math.cos(Math.PI / 6); // 0.8660…
export const ISO_Y = Math.sin(Math.PI / 6); // 0.5

/** True isometric projection of a world (x, z, y) coordinate to screen space. */
export function isoProject(x: number, z: number, y: number, cx = 0, cy = 0): IsoPoint {
  return {
    x: cx + (x - z) * ISO_X,
    y: cy + (x + z) * ISO_Y - y,
  };
}

/** Inverse projection of a screen offset (in scene space) back to world (x, z). */
export function inverseIsoProject(px: number, py: number): { x: number; z: number } {
  return {
    x: (px / ISO_X + py / ISO_Y) / 2,
    z: (py / ISO_Y - px / ISO_X) / 2,
  };
}

/**
 * Resolves the pipes to render between workflow nodes. Without explicit
 * connections the sequence of enabled steps is used; once the user wires
 * blocks by dragging anchor ports, only those connections render.
 */
export function resolveWorkflowEdges(
  nodes: readonly WorkflowNode[],
  connections?: readonly WorkflowConnection[],
): Array<{ from: string; to: string }> {
  const ids = new Set(nodes.map((node) => node.id));
  if (!connections || connections.length === 0) {
    const out: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < nodes.length - 1; i += 1) {
      if (nodes[i].enabled && nodes[i + 1].enabled) {
        out.push({ from: nodes[i].id, to: nodes[i + 1].id });
      }
    }
    return out;
  }
  const seen = new Set<string>();
  const out: Array<{ from: string; to: string }> = [];
  for (const connection of connections) {
    if (!ids.has(connection.from) || !ids.has(connection.to) || seen.has(connection.to)) continue;
    seen.add(connection.to);
    out.push(connection);
  }
  return out;
}

/** How high each node kind "floats" above the floor grid (world units). */
export const LIFT_BY_KIND: Record<NodeKind, number> = {
  trigger: 30,
  fetch: 22,
  process: 40,
  action: 16,
};

/**
 * Serpentine floor arrangement: steps snake forward in rows of `cols`, so
 * generated pipelines (Often trigger → fetch → process → action) read as a
 * clean flowing path that stays within a compact footprint.
 */
export function layoutWorkflowIso(
  nodes: readonly WorkflowNode[],
  cols = 3,
  spacing = 120,
): IsoLayoutEntry[] {
  return nodes.map((node, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const x = row % 2 === 0 ? col * spacing : (cols - 1 - col) * spacing;
    const z = row * spacing;
    return {
      node,
      index,
      x,
      z,
      lift: LIFT_BY_KIND[node.kind] ?? 16,
    };
  });
}

/** Footprint (world units) and screen-space extrusion depth for a block. */
export const BLOCK_FOOT = 84;
export const BLOCK_EXTRUDE = 52;

export const ISO_KIND_COLORS: Record<NodeKind, string> = {
  trigger: "#8b5cf6",
  fetch: "#0ea5e9",
  process: "#10b981",
  action: "#f59e0b",
};

/** Lighten (amount > 0) or darken (amount < 0) a hex color by amount in [-1, 1]. */
export function shadeColor(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return hex;
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function kindColor(hex: string, amount: number): string {
  return shadeColor(hex, amount);
}

export interface BlockGeometry {
  center: IsoPoint;
  top: IsoPoint;
  right: IsoPoint;
  front: IsoPoint;
  left: IsoPoint;
  rightDown: IsoPoint;
  frontDown: IsoPoint;
  leftDown: IsoPoint;
  exit: IsoPoint;
  entry: IsoPoint;
  /** Input handle socket, dead-center on the visible left vertical face. */
  portIn: IsoPoint;
  /** Output handle socket, dead-center on the visible right vertical face. */
  portOut: IsoPoint;
  shadow: IsoPoint;
  sortKey: number;
}

/**
 * Geometry for one isometric block: the footprint diamond extruded down-screen
 * into a volume, plus anchor points where pipes connect. The entry/exit points
 * sit on top and bottom center for classic pipeline reads, while portIn /
 * portOut are the user-facing handles anchored to the left and right faces of
 * the rendered cube body.
 */
export function blockGeometry(entry: IsoLayoutEntry): BlockGeometry {
  const { x, z, lift } = entry;
  const center = isoProject(x + BLOCK_FOOT / 2, z + BLOCK_FOOT / 2, lift);
  const top = isoProject(x, z, lift);
  const right = isoProject(x + BLOCK_FOOT, z, lift);
  const front = isoProject(x + BLOCK_FOOT, z + BLOCK_FOOT, lift);
  const left = isoProject(x, z + BLOCK_FOOT, lift);
  const down = (p: IsoPoint) => ({ x: p.x, y: p.y + BLOCK_EXTRUDE });
  return {
    center,
    top,
    right,
    front,
    left,
    rightDown: down(right),
    frontDown: down(front),
    leftDown: down(left),
    exit: isoProject(x + BLOCK_FOOT / 2, z + BLOCK_FOOT, lift),
    entry: isoProject(x + BLOCK_FOOT / 2, z, lift),
    // Face-center sockets: same height (lift - 18) so both spheres sit
    // symmetrically in the vertical middle of their side face, and any pipe
    // inherits those exact coordinates for a perfect anchor lock.
    portIn: isoProject(x + BLOCK_FOOT * 0.28, z + BLOCK_FOOT * 0.72, lift - 18),
    portOut: isoProject(x + BLOCK_FOOT * 0.72, z + BLOCK_FOOT * 0.28, lift - 18),
    shadow: isoProject(x + BLOCK_FOOT / 2, z + BLOCK_FOOT / 2, 0),
    sortKey: x + z,
  };
}

/** Helpers for detailed material shading of block faces. */
export function faceColors(base: string) {
  return {
    top: shadeColor(base, 0.28),
    right: base,
    left: shadeColor(base, -0.22),
    edge: shadeColor(base, -0.45),
  };
}

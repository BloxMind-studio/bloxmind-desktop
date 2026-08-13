import { Maximize2, MousePointer2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { iconFor } from "@/lib/agentStudio/icons";
import {
  BLOCK_FOOT,
  blockGeometry,
  faceColors,
  ISO_KIND_COLORS,
  type IsoPoint,
  inverseIsoProject,
  isoProject,
  layoutWorkflowIso,
  resolveWorkflowEdges,
  shadeColor,
} from "@/lib/agentStudio/isometric";
import { TOOL_BY_ID } from "@/lib/agentStudio/tools";
import type { AgentDefinition, IsoWorldPos, WorkflowNode } from "@/lib/agentStudio/types";
import { NodeEditor } from "./NodeEditor";

export interface WorkflowCanvas3DProps {
  agent: AgentDefinition;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  updateNode: (node: WorkflowNode) => void;
  removeNode: (nodeId: string) => void;
  onOpenAdd: () => void;
  /** User-dragged block positions on the floor plane, keyed by node id. */
  positions: Record<string, IsoWorldPos>;
  onPositionsChange: (next: Record<string, IsoWorldPos>) => void;
  /** Rewire pipes: replace any incoming edge to `to` with from → to. */
  onLinkNodes: (from: string, to: string) => void;
  /** Remove a specific pipe. */
  onUnlinkEdge: (from: string, to: string) => void;
}

const VIEW_W = 1000;
const VIEW_H = 640;
const GRID_STEP = 40;
const SELECT_COLOR = "#f43f5e";
const PORT_RADIUS = 7;
const DRAG_THRESHOLD_PX = 4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Pointer capture is not implemented by jsdom, so guard every call. */
function capturePointer(el: Element | null | undefined, pointerId: number) {
  try {
    if (
      el &&
      typeof (el as Element & { setPointerCapture?: unknown }).setPointerCapture === "function"
    ) {
      (el as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(pointerId);
    }
  } catch {
    /* capture is optional — drags still work without it */
  }
}

function polygon(points: readonly IsoPoint[]): string {
  return `${points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ")} Z`;
}

function pipePath(from: IsoPoint, to: IsoPoint): string {
  const dx = to.x - from.x;
  const sag = Math.max(from.y, to.y) + 42;
  const c1 = { x: from.x + dx * 0.35, y: sag };
  const c2 = { x: to.x - dx * 0.35, y: sag };
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface DragState {
  id: string;
  wasSelected: boolean;
  startClientX: number;
  startClientY: number;
  startX: number;
  startZ: number;
  moved: boolean;
}

/**
 * 3D isometric view of the workflow pipeline. Nodes render as volumetric,
 * material-shaded blocks floating over a transparent floor grid, wired
 * together by glowing pulsing pipes. Blocks can be dragged to reposition them,
 * and wires re-wired by dragging a socket onto another block. Zoom (wheel),
 * pan (drag), block selection, and inline property editing are all supported.
 */
export function WorkflowCanvas3D({
  agent,
  selectedNodeId,
  onSelectNode,
  updateNode,
  removeNode,
  onOpenAdd,
  positions,
  onPositionsChange,
  onLinkNodes,
  onUnlinkEdge,
}: WorkflowCanvas3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** Overrides applied live while a block is being dragged. */
  const [livePositions, setLivePositions] = useState<Record<string, IsoWorldPos> | null>(null);
  /** In-progress pipe from a socket to the cursor. */
  const [connectDrag, setConnectDrag] = useState<{
    fromId: string;
    fromPoint: IsoPoint;
    endPoint: IsoPoint;
    targetId: string | null;
  } | null>(null);

  const panStart = useRef<{ x: number; y: number } | null>(null);
  const blockDrag = useRef<DragState | null>(null);

  const layoutEntries = useMemo(() => layoutWorkflowIso(agent.workflow), [agent.workflow]);
  const placedEntries = useMemo(
    () =>
      layoutEntries.map((entry) => {
        const stored = livePositions?.[entry.node.id] ?? positions[entry.node.id];
        return stored ? { ...entry, x: stored.x, z: stored.z } : entry;
      }),
    [layoutEntries, positions, livePositions],
  );
  const geometry = useMemo(
    () => placedEntries.map((entry) => ({ entry, geo: blockGeometry(entry) })),
    [placedEntries],
  );
  const geometryById = useMemo(() => {
    const map = new Map<string, (typeof geometry)[number]>();
    for (const item of geometry) map.set(item.entry.node.id, item);
    return map;
  }, [geometry]);

  const selected = agent.workflow.find((node) => node.id === selectedNodeId) ?? null;
  const edges = useMemo(
    () => resolveWorkflowEdges(agent.workflow, agent.connections),
    [agent.workflow, agent.connections],
  );

  // ── Scene fit: center the layout inside the viewport with a computed base scale.
  const base = useMemo(() => {
    if (geometry.length === 0) {
      return { scale: 1, tx: VIEW_W / 2, ty: VIEW_H / 2 };
    }
    const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const { geo } of geometry) {
      const pts = [
        geo.top,
        geo.right,
        geo.front,
        geo.left,
        geo.rightDown,
        geo.frontDown,
        geo.leftDown,
      ];
      for (const p of pts) {
        bounds.minX = Math.min(bounds.minX, p.x);
        bounds.maxX = Math.max(bounds.maxX, p.x);
        bounds.minY = Math.min(bounds.minY, p.y - 26);
        bounds.maxY = Math.max(bounds.maxY, p.y);
      }
    }
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const scale = clamp(Math.min((VIEW_W - 170) / w, (VIEW_H - 150) / h), 0.3, 1.5);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    return { scale, tx: VIEW_W / 2 - cx * scale, ty: VIEW_H / 2 - cy * scale };
  }, [geometry]);

  /** Convert a client (pointer) coordinate into viewBox scene coordinates. */
  const toScene = useCallback((clientX: number, clientY: number): IsoPoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) * VIEW_W) / rect.width,
      y: ((clientY - rect.top) * VIEW_H) / rect.height,
    };
  }, []);

  // ── Zoom with the mouse wheel, anchored at the cursor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const vx = ((event.clientX - rect.left) * VIEW_W) / rect.width;
      const vy = ((event.clientY - rect.top) * VIEW_H) / rect.height;
      setZoom((current) => {
        const next = clamp(current * (event.deltaY < 0 ? 1.12 : 0.9), 0.45, 3.2);
        const s = base.scale * current;
        const sceneX = (vx - (base.tx + pan.x)) / s;
        const sceneY = (vy - (base.ty + pan.y)) / s;
        const tx = vx - sceneX * base.scale * next - base.tx;
        const ty = vy - sceneY * base.scale * next - base.ty;
        setPan({ x: tx, y: ty });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [base, pan]);

  // ── Escape deselects; Delete/Backspace removes the selected block.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onSelectNode(null);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedNodeId) {
        const node = agent.workflow.find((entry) => entry.id === selectedNodeId);
        if (node) {
          event.preventDefault();
          removeNode(selectedNodeId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelectNode, selectedNodeId, agent.workflow, removeNode]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // ── Pointer lifecycle: pan on empty space, drag blocks, drag wires.
  const handleSvgPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    panStart.current = { x: event.clientX, y: event.clientY };
    capturePointer(event.currentTarget, event.pointerId);
  }, []);

  const handleSvgPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const scale = base.scale * zoom;
      const originX = base.tx + pan.x;
      const originY = base.ty + pan.y;

      if (connectDrag) {
        const scene = toScene(event.clientX, event.clientY);
        const cursorScene = {
          x: (scene.x - originX) / scale,
          y: (scene.y - originY) / scale,
        };
        let targetId: string | null = null;
        for (const { entry, geo } of geometry) {
          if (entry.node.id === connectDrag.fromId || !entry.node.enabled) continue;
          const dx = geo.portIn.x - cursorScene.x;
          const dy = geo.portIn.y - cursorScene.y;
          if (dx * dx + dy * dy < 40 * 40) {
            targetId = entry.node.id;
            break;
          }
        }
        setConnectDrag({
          ...connectDrag,
          endPoint: targetId
            ? (geometryById.get(targetId)?.geo.portIn ?? cursorScene)
            : cursorScene,
          targetId,
        });
        return;
      }

      if (blockDrag.current) {
        const drag = blockDrag.current;
        const dxPx = event.clientX - drag.startClientX;
        const dyPx = event.clientY - drag.startClientY;
        if (!drag.moved && dxPx * dxPx + dyPx * dyPx > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          drag.moved = true;
        }
        if (drag.moved) {
          const delta = inverseIsoProject(dxPx / scale, dyPx / scale);
          setLivePositions({ [drag.id]: { x: drag.startX + delta.x, z: drag.startZ + delta.z } });
        }
        return;
      }

      if (panStart.current) {
        const dx = event.clientX - panStart.current.x;
        const dy = event.clientY - panStart.current.y;
        panStart.current = { x: event.clientX, y: event.clientY };
        setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
      }
    },
    [base, zoom, pan, connectDrag, toScene, geometry, geometryById],
  );

  const handleSvgPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (connectDrag) {
        if (connectDrag.targetId && connectDrag.targetId !== connectDrag.fromId) {
          onLinkNodes(connectDrag.fromId, connectDrag.targetId);
        }
        setConnectDrag(null);
      }

      const drag = blockDrag.current;
      if (drag) {
        if (drag.moved) {
          const live = livePositions?.[drag.id];
          if (live) {
            onPositionsChange({ ...positions, [drag.id]: live });
          }
        } else {
          onSelectNode(drag.wasSelected ? null : drag.id);
        }
        blockDrag.current = null;
        setLivePositions(null);
      }

      panStart.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* capture may already be released */
      }
    },
    [connectDrag, livePositions, positions, onLinkNodes, onPositionsChange, onSelectNode],
  );

  const handleBlockPointerDown = useCallback(
    (event: React.PointerEvent, nodeId: string) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      const target = event.target as SVGElement;
      const port = target.dataset?.port;

      if (port === "exit") {
        const item = geometryById.get(nodeId);
        if (!item) return;
        setConnectDrag({
          fromId: nodeId,
          fromPoint: item.geo.portOut,
          endPoint: item.geo.portOut,
          targetId: null,
        });
        capturePointer(svgRef.current, event.pointerId);
        return;
      }

      const placed = placedEntries.find((entry) => entry.node.id === nodeId);
      if (!placed) return;
      onSelectNode(nodeId);
      blockDrag.current = {
        id: nodeId,
        wasSelected: selectedNodeId === nodeId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: placed.x,
        startZ: placed.z,
        moved: false,
      };
      capturePointer(svgRef.current, event.pointerId);
    },
    [geometryById, placedEntries, onSelectNode, selectedNodeId],
  );

  // ── Floor grid lines in world space.
  const grid = useMemo(() => {
    if (placedEntries.length === 0) return [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const entry of placedEntries) {
      minX = Math.min(minX, entry.x);
      maxX = Math.max(maxX, entry.x + BLOCK_FOOT);
      minZ = Math.min(minZ, entry.z);
      maxZ = Math.max(maxZ, entry.z + BLOCK_FOOT);
    }
    const loX = Math.floor(minX / GRID_STEP) * GRID_STEP - GRID_STEP * 3;
    const hiX = Math.ceil(maxX / GRID_STEP) * GRID_STEP + GRID_STEP * 3;
    const loZ = Math.floor(minZ / GRID_STEP) * GRID_STEP - GRID_STEP * 3;
    const hiZ = Math.ceil(maxZ / GRID_STEP) * GRID_STEP + GRID_STEP * 3;
    const lines: string[] = [];
    for (let x = loX; x <= hiX; x += GRID_STEP) {
      const a = isoProject(x, loZ, 0);
      const b = isoProject(x, hiZ, 0);
      lines.push(`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    }
    for (let z = loZ; z <= hiZ; z += GRID_STEP) {
      const a = isoProject(loX, z, 0);
      const b = isoProject(hiX, z, 0);
      lines.push(`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    }
    return lines;
  }, [placedEntries]);

  const transform = `translate(${(base.tx + pan.x).toFixed(1)} ${(base.ty + pan.y).toFixed(1)}) scale(${(base.scale * zoom).toFixed(3)})`;

  const sorted = useMemo(
    () => [...geometry].sort((a, b) => a.geo.sortKey - b.geo.sortKey),
    [geometry],
  );

  const pipes = useMemo(() => {
    const out: Array<{ from: string; to: string; path: string }> = [];
    for (const edge of edges) {
      const a = geometryById.get(edge.from);
      const b = geometryById.get(edge.to);
      if (!a || !b) continue;
      out.push({
        from: edge.from,
        to: edge.to,
        path: pipePath(a.geo.portOut, b.geo.portIn),
      });
    }
    return out;
  }, [edges, geometryById]);

  const cubeGradients = sorted.map(({ entry }) => {
    const base = ISO_KIND_COLORS[entry.node.kind] ?? "#94a3b8";
    const colors = faceColors(base);
    // Draw the light source from the top-left so the cube reads as volumetric.
    return (
      <linearGradient
        key={`top-${entry.node.id}`}
        id={`cube-top-${entry.node.id}`}
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop offset="0%" stopColor={shadeColor(base, 0.62)} />
        <stop offset="100%" stopColor={colors.top} />
      </linearGradient>
    );
  });

  if (agent.workflow.length === 0) {
    return (
      <div className="flex min-h-[380px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 py-16 text-xs text-muted-foreground">
        This agent has no steps yet.
        <button
          type="button"
          onClick={onOpenAdd}
          className="rounded-md bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-85"
        >
          Add your first step
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="workflow-canvas-3d"
      className="relative h-[460px] overflow-hidden rounded-xl border bg-background"
      style={{
        touchAction: "none",
        isolation: "isolate",
        background: "radial-gradient(ellipse at 50% 40%, var(--card) 0%, var(--background) 62%)",
      }}
    >
      <style>{`
        @keyframes blox-pipe-flow { to { stroke-dashoffset: -28; } }
        .blox-pipe-flow { stroke-dasharray: 7 9; animation: blox-pipe-flow 1.1s linear infinite; }
        @keyframes blox-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .blox-pulse { animation: blox-pulse 1.6s ease-in-out infinite; }
      `}</style>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full cursor-grab select-none active:cursor-grabbing"
        role="img"
        aria-label={`3D isometric workflow view for ${agent.name}`}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
        onPointerCancel={handleSvgPointerUp}
        onDoubleClick={resetView}
      >
        <defs>
          <filter id="blox-pipe-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="blox-shadow-blur" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <filter id="blox-selected" x="-80%" y="-80%" width="260%" height="260%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="9"
              floodColor={SELECT_COLOR}
              floodOpacity="0.9"
            />
          </filter>
          <radialGradient id="blox-port-entry">
            <stop offset="0%" stopColor="#d8b4fe" />
            <stop offset="100%" stopColor="#7c3aed" />
          </radialGradient>
          <radialGradient id="blox-port-exit">
            <stop offset="0%" stopColor="#fdba74" />
            <stop offset="100%" stopColor="#ea580c" />
          </radialGradient>
          {cubeGradients}
          <marker
            id="blox-pipe-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
          </marker>
        </defs>

        <g transform={transform}>
          {grid.map((line, index) => (
            <path
              key={index}
              d={line}
              fill="none"
              stroke="var(--border)"
              strokeOpacity="0.5"
              strokeWidth="1"
            />
          ))}

          {pipes.map((pipe) => (
            <g key={`${pipe.from}->${pipe.to}`} data-testid={`pipe-${pipe.from}-${pipe.to}`}>
              <path
                d={pipe.path}
                fill="none"
                stroke="#38bdf8"
                strokeOpacity="0.28"
                strokeWidth="10"
                filter="url(#blox-pipe-glow)"
              />
              {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click removal is a convenience affordance layered over the visible wire */}
              <path
                d={pipe.path}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2.5"
                strokeLinecap="round"
                markerEnd="url(#blox-pipe-arrow)"
                className="blox-pipe-flow"
                style={{ cursor: "pointer" }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onUnlinkEdge(pipe.from, pipe.to);
                }}
              >
                <title>{`Remove connection ${pipe.from} → ${pipe.to} (double-click)`}</title>
              </path>
            </g>
          ))}

          {connectDrag && (
            <g pointerEvents="none" data-testid="connect-drag-line">
              <path
                d={pipePath(connectDrag.fromPoint, connectDrag.endPoint)}
                fill="none"
                stroke="#38bdf8"
                strokeOpacity="0.3"
                strokeWidth="9"
                filter="url(#blox-pipe-glow)"
              />
              <path
                d={pipePath(connectDrag.fromPoint, connectDrag.endPoint)}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="2"
                strokeDasharray="6 6"
              />
            </g>
          )}

          {sorted.map(({ entry, geo }) => {
            const tool = TOOL_BY_ID.get(entry.node.toolId);
            const baseColor = ISO_KIND_COLORS[entry.node.kind] ?? "#94a3b8";
            const colors = faceColors(baseColor);
            const isSelected = entry.node.id === selectedNodeId;
            const isHovered = entry.node.id === hoveredId;
            const isDisabled = !entry.node.enabled;
            const isConnectTarget = connectDrag?.targetId === entry.node.id;
            const lifted = (isHovered || isSelected || isConnectTarget) && !isDisabled;
            const opacity = isDisabled ? 0.32 : 1;
            const label = (tool?.name ?? entry.node.label).slice(0, 18);
            const Icon = iconFor(tool?.icon);
            const topFace = polygon([geo.top, geo.right, geo.front, geo.left]);
            const topHighlight = shadeColor(baseColor, 0.68);

            return (
              <g
                key={entry.node.id}
                data-node-id={entry.node.id}
                opacity={opacity}
                className="cursor-pointer"
                onPointerDown={(event) => handleBlockPointerDown(event, entry.node.id)}
                onPointerEnter={() => setHoveredId(entry.node.id)}
                onPointerLeave={() =>
                  setHoveredId((current) => (current === entry.node.id ? null : current))
                }
              >
                <title>{`${tool?.name ?? entry.node.label} — ${entry.node.enabled ? "enabled" : "disabled"}${isSelected ? " (selected)" : ""}`}</title>

                <ellipse
                  cx={geo.shadow.x}
                  cy={geo.shadow.y + 4}
                  rx={BLOCK_FOOT * 0.46}
                  ry={BLOCK_FOOT * 0.27}
                  fill="#000"
                  opacity={0.28 - entry.lift * 0.003}
                  filter="url(#blox-shadow-blur)"
                />

                <g
                  transform={lifted ? "translate(0 -7)" : undefined}
                  filter={isSelected ? "url(#blox-selected)" : undefined}
                >
                  {/* Left vertical face */}
                  <path
                    d={polygon([geo.left, geo.front, geo.frontDown, geo.leftDown])}
                    fill={colors.left}
                    stroke={colors.edge}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  {/* Right vertical face */}
                  <path
                    d={polygon([geo.top, geo.right, geo.rightDown, geo.frontDown])}
                    fill={colors.right}
                    stroke={colors.edge}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  {/* Top face with a light reflection gradient */}
                  <path
                    d={topFace}
                    fill={`url(#cube-top-${entry.node.id})`}
                    stroke={colors.edge}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  {/* Reflect the light source along the top-left edge */}
                  <path
                    d={polygon([
                      { x: geo.top.x, y: geo.top.y },
                      { x: geo.right.x, y: geo.right.y },
                      { x: geo.right.x, y: geo.right.y - 4 },
                      { x: geo.top.x, y: geo.top.y - 4 },
                    ])}
                    fill={topHighlight}
                    stroke="none"
                    opacity="0.6"
                  />
                  {/* Etched inner edge for a crisp bevel */}
                  <path
                    d={topFace}
                    fill="none"
                    stroke={colors.top}
                    strokeWidth="0.75"
                    strokeOpacity="0.55"
                    transform="translate(0 -2)"
                  />
                  {isSelected && (
                    <path
                      d={polygon([
                        { x: geo.top.x, y: geo.top.y - 6 },
                        { x: geo.right.x, y: geo.right.y - 4 },
                        { x: geo.front.x, y: geo.front.y },
                        { x: geo.left.x, y: geo.left.y - 4 },
                      ])}
                      fill="none"
                      stroke={SELECT_COLOR}
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                      className="blox-pulse"
                    />
                  )}
                </g>

                {/* Tool icon + title centered on the cube body */}
                <g transform={lifted ? "translate(0 -7)" : undefined} pointerEvents="none">
                  <g
                    transform={`translate(${(geo.center.x - 8).toFixed(1)} ${(geo.center.y + 2).toFixed(1)})`}
                  >
                    <Icon size={16} stroke="#f8fafc" strokeWidth={2} fill="none" />
                  </g>
                  <text
                    x={geo.center.x}
                    y={geo.center.y + 26}
                    textAnchor="middle"
                    fontSize="12.5"
                    fontWeight="600"
                    fill="#f8fafc"
                    stroke="rgba(2, 6, 23, 0.85)"
                    strokeWidth="3"
                    paintOrder="stroke"
                  >
                    {label}
                  </text>
                </g>

                {/* Input + output handles anchored to the cube's side faces */}
                <g transform={lifted ? "translate(0 -7)" : undefined}>
                  <circle
                    cx={geo.portIn.x}
                    cy={geo.portIn.y}
                    r={PORT_RADIUS}
                    fill="url(#blox-port-entry)"
                    stroke="#4c1d95"
                    strokeWidth="1.5"
                    data-port="entry"
                    style={{ cursor: "pointer" }}
                  >
                    <title>Input socket</title>
                  </circle>
                  <circle
                    cx={geo.portOut.x}
                    cy={geo.portOut.y}
                    r={PORT_RADIUS}
                    fill="url(#blox-port-exit)"
                    stroke="#7c2d12"
                    strokeWidth="1.5"
                    data-port="exit"
                    style={{ cursor: "crosshair" }}
                  >
                    <title>Output socket — drag to rewire</title>
                  </circle>
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-2 right-2 z-10 flex items-center gap-1.5">
        <span className="rounded-md border bg-card/80 px-2 py-0.5 text-[10px] text-muted-foreground">
          Drag to pan · scroll to zoom
        </span>
        <button
          type="button"
          onClick={resetView}
          title="Reset view"
          className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md border bg-card/80 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Maximize2 aria-hidden="true" size={12} />
        </button>
      </div>

      {selected && (
        <div className="absolute bottom-2 left-2 top-2 z-30 flex w-[min(24rem,clamp(18rem,80vw,30rem))] flex-col overflow-hidden rounded-xl border bg-card/95 shadow-2xl backdrop-blur">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <MousePointer2
                aria-hidden="true"
                size={12}
                className="shrink-0 text-muted-foreground"
              />
              <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Step properties
              </span>
            </div>
            <button
              type="button"
              onClick={() => onSelectNode(null)}
              title="Close"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X aria-hidden="true" size={13} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <NodeEditor
              node={selected}
              onUpdate={updateNode}
              onDelete={() => removeNode(selected.id)}
            />
          </div>
          <div className="shrink-0 border-t px-3 py-2 text-[10px] leading-relaxed text-muted-foreground/70">
            Drag blocks to reposition them · drag the purple socket to rewire a pipe
            {agent.connections && agent.connections.length > 0 && (
              <span className="block">Double-click a pipe to remove it</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Box,
  Boxes,
  Camera,
  ChevronRight,
  CircleDot,
  CloudSun,
  Code2,
  Database,
  Folder,
  Gamepad2,
  type LucideIcon,
  PanelTop,
  ScrollText,
  Search,
  Server,
  Sparkles,
  Users,
} from "lucide-react";
import posthog from "posthog-js/dist/module.full.no-external.js";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { analyticsProperties, explorerAnalyticsProperties } from "@/lib/analytics";
import { desktop } from "@/lib/desktop";
import {
  ATTRIBUTE_TYPES,
  EXPLORER_LONG_WAIT_NOTICES,
  EXPLORER_WAIT_NOTICES,
  type ExplorerField,
  type ExplorerNode,
  fieldNumbers,
  formatFieldValue,
  nodeId,
  OBJECT_DRAG_NAME_TYPE,
  OBJECT_DRAG_TYPE,
} from "@/lib/explorer";
import {
  useExplorerReference,
  useExplorerTree,
  useExplorerView,
} from "@/providers/ExplorerReferenceProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

interface ExplorerProps {
  collapsed: boolean;
  sessionBusy: boolean;
  onToggle: () => void;
}

interface TreeRowProps {
  node: ExplorerNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: (path: string) => void;
  onSelect: (node: ExplorerNode) => void;
  onContextMenu: (event: React.MouseEvent, node: ExplorerNode) => void;
}

const CLASS_ICONS: ReadonlyArray<[RegExp, LucideIcon]> = [
  [/^(Workspace|WorldRoot)$/, Gamepad2],
  [/^(Players|Player)$/, Users],
  [/^(Lighting|Atmosphere|Sky|Clouds)$/, CloudSun],
  [/^(ReplicatedStorage|ServerStorage|DataStoreService)$/, Database],
  [/^(ServerScriptService|Script|LocalScript|ModuleScript)$/, Code2],
  [/^(StarterGui|ScreenGui|SurfaceGui|BillboardGui|GuiObject|Frame)$/, PanelTop],
  [/^(Folder|Configuration)$/, Folder],
  [/^(Model|PVInstance)$/, Boxes],
  [/^(Part|MeshPart|UnionOperation|SpawnLocation|BasePart)$/, Box],
  [/^(Camera)$/, Camera],
  [/^(ParticleEmitter|Beam|Trail|Highlight)$/, Sparkles],
  [/^(RemoteEvent|RemoteFunction|BindableEvent|BindableFunction)$/, Server],
  [/^(StringValue|NumberValue|BoolValue|ObjectValue|ValueBase)$/, CircleDot],
  [/^(TextLabel|TextButton|TextBox)$/, ScrollText],
];

function iconForClass(className: string): LucideIcon {
  return CLASS_ICONS.find(([pattern]) => pattern.test(className))?.[1] ?? Box;
}

const TreeRow = memo(function TreeRow({
  node,
  depth,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onContextMenu,
}: TreeRowProps) {
  const canExpand = node.hasChildren || node.children.length > 0;
  const InstanceIcon = iconForClass(node.className);

  return (
    <div
      role="treeitem"
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(OBJECT_DRAG_TYPE, node.path);
        event.dataTransfer.setData(OBJECT_DRAG_NAME_TYPE, node.name);
      }}
      aria-selected={isSelected}
      aria-expanded={canExpand ? isExpanded : undefined}
      onClick={() => onSelect(node)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event, node);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node);
        }
      }}
      className={`group flex h-6 cursor-default items-center pr-2 text-[11px] ${isSelected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      title={`${node.path} · ${node.className}`}
    >
      <button
        type="button"
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.name}`}
        disabled={!canExpand}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(node.path);
        }}
        className="flex h-5 w-4 shrink-0 items-center justify-center disabled:opacity-0"
      >
        <ChevronRight
          size={10}
          className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
        />
      </button>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <InstanceIcon
          size={13}
          strokeWidth={1.8}
          className="shrink-0 text-blue-600 dark:text-blue-400"
        />
        <span className="truncate">{node.name}</span>
      </span>
    </div>
  );
});

/** The chain of objects down to the first one at a path, which a link in the chat names. */
function chainToPath(nodes: readonly ExplorerNode[], key: string): ExplorerNode[] | null {
  for (const node of nodes) {
    if (nodeId(node) === key || node.path === key || node.path === `game.${key}`) return [node];
    const rest = chainToPath(node.children, key);
    if (rest) return [node, ...rest];
  }
  return null;
}

function collectPaths(nodes: readonly ExplorerNode[]): Set<string> {
  const paths = new Set<string>();
  const visit = (node: ExplorerNode) => {
    paths.add(nodeId(node));
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return paths;
}

interface FlatTreeRow {
  node: ExplorerNode;
  depth: number;
}

/** Expand the tree into the rows currently visible, in render order. */
function flattenVisibleRows(
  nodes: readonly ExplorerNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
  rows: FlatTreeRow[] = [],
): FlatTreeRow[] {
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.children.length > 0 && expanded.has(nodeId(node))) {
      flattenVisibleRows(node.children, expanded, depth + 1, rows);
    }
  }
  return rows;
}

export default function Explorer({ collapsed, sessionBusy, onToggle }: ExplorerProps) {
  const studioTarget = useStudioTargetOptional();
  const { fontSize } = usePreferences();
  const { referenceObject, focusRequest, consumeFocus } = useExplorerReference();
  const { tree, syncError, waiting, setDemand, requestSync } = useExplorerTree();
  const { expanded, setExpanded, selectedPath, setSelectedPath, search, setSearch, scrollTopRef } =
    useExplorerView();
  const [waitingLong, setWaitingLong] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<{ path: string } | null>(null);

  useEffect(() => {
    posthog.capture(
      collapsed ? "explorer_closed" : "explorer_opened",
      analyticsProperties("explorer", { collapsed }),
    );
  }, [collapsed]);

  // The panel and the composer share one reader, so tell it what we need.
  useEffect(() => {
    setDemand({ open: !collapsed && !!studioTarget?.selected, busy: sessionBusy });
  }, [collapsed, sessionBusy, studioTarget?.selected, setDemand]);

  useEffect(() => {
    setWaitingLong(false);
    if (!waiting) return;
    const timer = window.setTimeout(() => setWaitingLong(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  const roots = tree?.roots ?? [];

  // Newer published programs replace a shipped or published program at the next
  // sync (a working model-written one is kept), and retry a setup that failed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setter is stable and keyed by place
  const toggleNode = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selected = useMemo(
    () => (selectedPath ? (roots.find((node) => nodeId(node) === selectedPath) ?? null) : null),
    [roots, selectedPath],
  );

  const visibleRoots = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return roots;
    const filter = (node: ExplorerNode): ExplorerNode | null => {
      const children = node.children.flatMap((child) => {
        const match = filter(child);
        return match ? [match] : [];
      });
      const matches = `${node.name} ${node.className} ${node.path}`.toLowerCase().includes(query);
      return matches || children.length > 0 ? { ...node, children } : null;
    };
    return roots.flatMap((root) => {
      const match = filter(root);
      return match ? [match] : [];
    });
  }, [roots, search]);
  const visibleExpanded = useMemo(
    () => (search.trim() ? collectPaths(visibleRoots) : expanded),
    [expanded, search, visibleRoots],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: setter is stable and keyed by place
  const handleSelect = useCallback((next: ExplorerNode) => setSelectedPath(nodeId(next)), []);

  const [menu, setMenu] = useState<{ x: number; y: number; node: ExplorerNode } | null>(null);
  const [renaming, setRenaming] = useState<ExplorerNode | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<ExplorerNode | null>(null);
  const [objectBusy, setObjectBusy] = useState(false);

  const resync = useCallback(() => requestSync({ force: true }), [requestSync]);

  const handleObjectAction = useCallback(
    async (action: "rename" | "duplicate" | "delete", node: ExplorerNode, name?: string) => {
      const studioId = studioTarget?.selected?.key;
      if (!studioId) return;
      setObjectBusy(true);
      try {
        await desktop.editExplorerObject(studioId, {
          action,
          ...(name ? { name } : {}),
          path: node.path,
          className: node.className,
        } as Parameters<typeof desktop.editExplorerObject>[1]);
        toast.success(
          action === "rename"
            ? "Object renamed"
            : action === "duplicate"
              ? "Object duplicated"
              : "Object deleted",
        );
        resync();
      } catch (error) {
        toast.error(`Couldn't ${action} the object`, {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setObjectBusy(false);
        setMenu(null);
        setRenaming(null);
        setDeleting(null);
      }
    },
    [resync, studioTarget?.selected?.key],
  );

  const handleReference = useCallback(
    (field?: { kind: "property" | "attribute"; name: string }) => {
      if (!selected) return;
      referenceObject({ name: selected.name, path: selected.path, field });
      posthog.capture(
        "reference_added",
        analyticsProperties(
          "explorer",
          explorerAnalyticsProperties({
            class_category: iconForClass(selected.className) === Box ? "generic" : "known",
            has_attributes: (selected.attributes ?? []).length > 0,
          }),
        ),
      );
      toast.success(`${selected.name} added to your message`);
    },
    [referenceObject, selected],
  );

  // Expanding a big place can produce thousands of visible rows; only the
  // viewport slice is mounted so a poll never lays out the whole tree.
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const treeRows = useMemo(
    () => flattenVisibleRows(visibleRoots, visibleExpanded),
    [visibleRoots, visibleExpanded],
  );
  // `h-6` is 1.5rem, and the root font size follows the font-size preference.
  const treeRowHeight = Math.round(24 * fontSize);
  const treeVirtualizer = useVirtualizer({
    count: treeRows.length,
    getScrollElement: () => treeScrollRef.current,
    estimateSize: () => treeRowHeight,
    overscan: 12,
    initialOffset: () => scrollTopRef.current,
    getItemKey: (index) => (treeRows[index] ? nodeId(treeRows[index].node) : index),
  });
  // Rows have a fixed height, but that height changes with the font-size
  // preference; recompute the offsets instead of keeping the old scale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure only when the row height changes
  useEffect(() => {
    treeVirtualizer.measure();
  }, [treeRowHeight, treeVirtualizer]);

  // A reply can link to an object before this panel's next sync has it, so the
  // request waits until the tree that names it arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setters are stable and keyed by place
  useEffect(() => {
    if (!focusRequest || roots.length === 0) return;
    const chain = chainToPath(roots, focusRequest);
    if (!chain) return;
    consumeFocus();
    setSearch("");
    const ids = chain.map((node) => nodeId(node));
    const last = chain[chain.length - 1];
    setSelectedPath(ids[ids.length - 1] ?? null);
    setScrollTarget({ path: nodeId(last ?? { path: focusRequest }) });
    setExpanded((current) => new Set([...current, ...ids.slice(0, -1)]));
  }, [focusRequest, roots, consumeFocus]);

  // The rows the link expanded arrive with the next render, so scroll then.
  useEffect(() => {
    if (!scrollTarget) return;
    const index = treeRows.findIndex((row) => nodeId(row.node) === scrollTarget.path);
    if (index < 0) return;
    treeVirtualizer.scrollToIndex(index, { align: "auto" });
    setScrollTarget(null);
  }, [scrollTarget, treeRows, treeVirtualizer]);

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l bg-sidebar py-2">
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Open Explorer"
        >
          <Boxes size={15} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-sidebar">
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Explorer
        </h2>
        <button
          type="button"
          onClick={onToggle}
          className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close explorer"
        >
          ×
        </button>
      </header>

      <div className="px-3 pb-2 pt-1">
        <div className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-muted-foreground focus-within:border-ring focus-within:text-foreground">
          <Search aria-hidden="true" size={12} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search instances"
            aria-label="Search Explorer"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {waiting ? (
        <div
          role="status"
          className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <div className="flex items-center justify-between gap-2">
            <span>
              {waitingLong
                ? (EXPLORER_LONG_WAIT_NOTICES[waiting] ?? EXPLORER_WAIT_NOTICES[waiting])
                : EXPLORER_WAIT_NOTICES[waiting]}
            </span>
            <button
              type="button"
              onClick={() => requestSync()}
              className="shrink-0 whitespace-nowrap font-medium underline-offset-2 hover:underline"
            >
              Check now
            </button>
          </div>
        </div>
      ) : syncError ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          Explorer couldn't load this Studio place. Close and reopen Explorer to retry.
        </div>
      ) : null}

      <div
        ref={treeScrollRef}
        onScroll={(event) => {
          scrollTopRef.current = event.currentTarget.scrollTop;
        }}
        className="app-scrollbar min-h-0 flex-1 overflow-y-auto py-1"
        role="tree"
        aria-label="Instance hierarchy"
      >
        {roots.length === 0 && !syncError && !waiting ? <ExplorerLoading /> : null}
        <div
          style={{
            height: `${treeVirtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
          }}
        >
          {treeVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = treeRows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={nodeId(row.node)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <TreeRow
                  node={row.node}
                  depth={row.depth}
                  isExpanded={visibleExpanded.has(nodeId(row.node))}
                  isSelected={selectedPath === nodeId(row.node)}
                  onToggle={toggleNode}
                  onSelect={handleSelect}
                  onContextMenu={(event, node) => {
                    setSelectedPath(node.path);
                    setMenu({ x: event.clientX, y: event.clientY, node });
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {selected ? (
        <Inspector
          node={selected}
          studioId={studioTarget?.selected?.key ?? null}
          onReference={handleReference}
          onReferenceField={(field) => handleReference(field)}
          onChanged={() => requestSync({ force: true })}
        />
      ) : (
        <div className="shrink-0 border-t px-3 py-2 text-[9px] text-muted-foreground">
          Select an object to inspect and reference it.
        </div>
      )}

      {menu ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }}
          />
          <div
            role="menu"
            className="fixed z-50 w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
            style={{
              left: Math.min(menu.x, window.innerWidth - 168),
              top: Math.min(menu.y, window.innerHeight - 140),
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void navigator.clipboard.writeText(menu.node.path).then(
                  () => toast.success("Path copied"),
                  () => toast.error("Couldn't copy the path"),
                );
                setMenu(null);
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
            >
              Copy path
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setRenaming(menu.node);
                setRenameDraft(menu.node.name);
                setMenu(null);
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={objectBusy}
              onClick={() => void handleObjectAction("duplicate", menu.node)}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent disabled:opacity-50"
            >
              Duplicate
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDeleting(menu.node);
                setMenu(null);
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-red-600 hover:bg-accent dark:text-red-400"
            >
              Delete
            </button>
          </div>
        </>
      ) : null}

      {renaming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            className="w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 shadow-lg"
            onSubmit={(event) => {
              event.preventDefault();
              if (renameDraft.trim())
                void handleObjectAction("rename", renaming, renameDraft.trim());
            }}
          >
            <h4 className="text-sm font-medium">Rename {renaming.name}</h4>
            <input
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              className="mt-3 h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenaming(null)}
                className="h-8 rounded-md border px-3 text-xs hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={objectBusy || !renameDraft.trim()}
                className="h-8 rounded-md bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50"
              >
                Rename
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 shadow-lg">
            <h4 className="text-sm font-medium">Delete {deleting.name}?</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              This removes the object and its children in Studio. This can be undone there.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="h-8 rounded-md border px-3 text-xs hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={objectBusy}
                onClick={() => void handleObjectAction("delete", deleting)}
                className="h-8 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

/** The type a value has to be converted back into before Studio accepts an edit. */
function valueTypeFor(field: ExplorerField): string {
  if (field.type) return field.type;
  const value = field.value.trim();
  if (value === "true" || value === "false") return "boolean";
  const numbers = fieldNumbers(value);
  if (
    numbers.length > 0 &&
    numbers.every((part) => /^-?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(part))
  ) {
    if (numbers.length === 1) return "number";
    if (numbers.length === 2) return "Vector2";
    if (numbers.length === 3) return "Vector3";
    if (numbers.length === 6) return "CFrame";
  }
  return "string";
}

function EditableFieldRow({
  field,
  kind,
  node,
  studioId,
  editable,
  onChanged,
  onReference,
}: {
  field: ExplorerField;
  kind: "property" | "attribute";
  node: ExplorerNode;
  studioId: string | null;
  editable: boolean;
  onChanged: () => void;
  onReference: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const committingRef = useRef(false);

  async function commit() {
    if (committingRef.current) return;
    if (!studioId || draft === field.value) {
      setEditing(false);
      return;
    }
    committingRef.current = true;
    setBusy(true);
    try {
      await desktop.editExplorerObject(studioId, {
        action: "setField",
        kind,
        field: field.name,
        value: draft,
        valueType: valueTypeFor(field),
        path: node.path,
        className: node.className,
      });
      toast.success(`${field.name} changed`);
      setEditing(false);
      onChanged();
    } catch (error) {
      toast.error("Couldn't change that value", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      committingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2 text-[10px]"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <dt className="truncate text-muted-foreground" title={field.name}>
        {field.name}
      </dt>
      <dd className="min-w-0 break-words font-mono text-foreground" title={field.value}>
        {editing ? (
          valueTypeFor(field) === "boolean" ? (
            <div className="flex gap-1">
              {["true", "false"].map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!studioId) return;
                    setDraft(value);
                    setEditing(false);
                    void desktop
                      .editExplorerObject(studioId, {
                        action: "setField",
                        kind,
                        field: field.name,
                        value,
                        valueType: "boolean",
                        path: node.path,
                        className: node.className,
                      })
                      .then(onChanged)
                      .catch((error: unknown) =>
                        toast.error("Couldn't change that value", {
                          description: error instanceof Error ? error.message : String(error),
                        }),
                      );
                  }}
                  className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${draft === value ? "bg-foreground text-background" : "bg-background hover:bg-accent"}`}
                >
                  {value}
                </button>
              ))}
            </div>
          ) : fieldNumbers(draft).length > 1 && fieldNumbers(draft).length <= 6 ? (
            <div className="flex gap-0.5">
              {fieldNumbers(draft).map((part, index) => (
                <input
                  key={index}
                  type="number"
                  step="any"
                  value={part}
                  disabled={busy}
                  onChange={(event) => {
                    const parts = fieldNumbers(draft);
                    parts[index] = event.target.value;
                    setDraft(parts.join(", "));
                  }}
                  onBlur={() => void commit()}
                  className="w-full min-w-0 rounded border bg-background px-1 py-0.5 text-[10px] outline-none focus:ring-1 focus:ring-ring"
                />
              ))}
            </div>
          ) : (
            <input
              autoFocus
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commit();
                if (event.key === "Escape") {
                  setDraft(field.value);
                  setEditing(false);
                }
              }}
              className="w-full rounded border bg-background px-1 py-0.5 font-mono text-[10px] text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          )
        ) : (
          <button
            type="button"
            disabled={!editable}
            title={editable ? `${field.value} — click to change` : field.value}
            onClick={() => {
              setDraft(field.value);
              setEditing(true);
            }}
            className="w-full break-words text-left disabled:cursor-default enabled:hover:text-blue-600 enabled:dark:hover:text-blue-400"
          >
            {formatFieldValue(field)}
          </button>
        )}
      </dd>
      {menu ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }}
          />
          <div
            role="menu"
            className="fixed z-50 w-36 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
            style={{
              left: Math.min(menu.x, window.innerWidth - 150),
              top: Math.min(menu.y, window.innerHeight - 80),
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onReference();
                setMenu(null);
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
            >
              Reference field
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void navigator.clipboard.writeText(field.value);
                setMenu(null);
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
            >
              Copy value
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AttributeTags({
  node,
  studioId,
  onChanged,
}: {
  node: ExplorerNode;
  studioId: string | null;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(ATTRIBUTE_TYPES[0] ?? "string");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply(edit: Parameters<typeof desktop.editExplorerObject>[1], message: string) {
    if (!studioId) return;
    setBusy(true);
    try {
      await desktop.editExplorerObject(studioId, edit);
      toast.success(message);
      setName("");
      setTag("");
      setAdding(false);
      onChanged();
    } catch (error) {
      toast.error("Couldn't change that", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  const base = { path: node.path, className: node.className };

  return (
    <section className="border-b px-3 py-2 last:border-b-0">
      <h4 className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        Attributes &amp; tags
      </h4>
      {!adding ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!studioId}
            onClick={() => setAdding(true)}
            className="h-7 rounded-md border px-2 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            Add attribute
          </button>
          <button
            type="button"
            disabled={!studioId}
            onClick={() => setAdding(true)}
            className="h-7 rounded-md border px-2 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            Add tag
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            autoFocus
            value={name || tag}
            onChange={(event) => {
              if (type === "__tag__") setTag(event.target.value);
              else setName(event.target.value);
            }}
            placeholder={type === "__tag__" ? "Tag name" : "Attribute name"}
            className="h-7 w-full rounded-md border bg-background px-2 text-[10px] outline-none focus:ring-1 focus:ring-ring"
          />
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="h-7 w-full rounded-md border bg-background px-2 text-[10px] outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="__tag__">Tag</option>
            {ATTRIBUTE_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="h-7 rounded-md border px-2 text-[10px] hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !(type === "__tag__" ? tag.trim() : name.trim())}
              onClick={() =>
                type === "__tag__"
                  ? void apply({ action: "addTag", field: tag.trim(), ...base }, "Tag added")
                  : void apply(
                      {
                        action: "addAttribute",
                        field: name.trim(),
                        valueType: type as (typeof ATTRIBUTE_TYPES)[number],
                        ...base,
                      },
                      "Attribute added",
                    )
              }
              className="h-7 rounded-md bg-foreground px-2 text-[10px] font-medium text-background disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {(node.attributes ?? []).map((field) => (
          <button
            key={field.name}
            type="button"
            title={`Remove ${field.name}`}
            disabled={!studioId || busy}
            onClick={() =>
              void apply(
                { action: "removeAttribute", field: field.name, ...base },
                "Attribute removed",
              )
            }
            className="rounded-full border px-2 py-0.5 text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {field.name} ×
          </button>
        ))}
      </div>
    </section>
  );
}

function Inspector({
  node,
  studioId,
  onReference,
  onReferenceField,
  onChanged,
}: {
  node: ExplorerNode;
  studioId: string | null;
  onReference: () => void;
  onReferenceField: (field: { kind: "property" | "attribute"; name: string }) => void;
  onChanged: () => void;
}) {
  const InstanceIcon = iconForClass(node.className);
  return (
    <div className="app-scrollbar max-h-[42%] shrink-0 overflow-y-auto border-t bg-card/60">
      <div className="sticky top-0 border-b bg-card/95 p-3 backdrop-blur-sm">
        <div className="flex items-start gap-2">
          <InstanceIcon size={15} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{node.name}</div>
            <div className="truncate font-mono text-[9px] text-muted-foreground" title={node.path}>
              {node.path}
            </div>
          </div>
          <button
            type="button"
            onClick={onReference}
            className="shrink-0 rounded-md bg-foreground px-2 py-1 text-[9px] font-medium text-background hover:opacity-90"
          >
            Reference
          </button>
        </div>
      </div>
      <FieldSection
        title="Properties"
        kind="property"
        node={node}
        studioId={studioId}
        onChanged={onChanged}
        onReferenceField={onReferenceField}
        fields={[{ name: "ClassName", value: node.className }, ...(node.properties ?? [])]}
      />
      {(node.attributes ?? []).length > 0 ? (
        <FieldSection
          title="Attributes"
          kind="attribute"
          node={node}
          studioId={studioId}
          onChanged={onChanged}
          onReferenceField={onReferenceField}
          fields={node.attributes ?? []}
        />
      ) : null}
      <AttributeTags node={node} studioId={studioId} onChanged={onChanged} />
    </div>
  );
}

function FieldSection({
  title,
  kind,
  node,
  studioId,
  fields,
  onChanged,
  onReferenceField,
}: {
  title: string;
  kind: "property" | "attribute";
  node: ExplorerNode;
  studioId: string | null;
  fields: readonly ExplorerField[];
  onChanged: () => void;
  onReferenceField: (field: { kind: "property" | "attribute"; name: string }) => void;
}) {
  return (
    <section className="border-b px-3 py-2 last:border-b-0">
      <h4 className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <dl className="space-y-1">
        {fields.map((field) => (
          <EditableFieldRow
            key={`${field.name}-${field.value}`}
            field={field}
            kind={kind}
            node={node}
            studioId={studioId}
            editable={!!studioId && (kind === "attribute" || field.name !== "ClassName")}
            onChanged={onChanged}
            onReference={() => onReferenceField({ kind, name: field.name })}
          />
        ))}
      </dl>
    </section>
  );
}

function ExplorerLoading() {
  return (
    <div className="space-y-1.5 px-3 py-3">
      {[78, 62, 85, 70, 58, 81].map((width, index) => (
        <div
          key={width}
          className="h-4 animate-pulse rounded bg-muted"
          style={{ width: `${width}%`, marginLeft: `${(index % 3) * 10}px` }}
        />
      ))}
    </div>
  );
}

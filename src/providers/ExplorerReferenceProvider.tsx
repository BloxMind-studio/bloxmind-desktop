import {
  createContext,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ExplorerTreeSync, useExplorerTreeSync } from "@/hooks/useExplorerTreeSync";
import { type ExplorerNode, type ExplorerReference, indexExplorerObjects } from "@/lib/explorer";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

/**
 * Which place a Studio has open. A Place ID survives a rename, and Studio can
 * hand the same key to another place, so the key only counts for an unpublished place.
 */
export function explorerPlaceKey(
  target: ReturnType<typeof useStudioTargetOptional>,
): string | undefined {
  const selected = target?.selected;
  if (!selected) return undefined;
  return selected.placeId && selected.placeId !== "0"
    ? JSON.stringify(["place", selected.placeId])
    : JSON.stringify(["studio", selected.key, selected.label]);
}

export interface ExplorerView {
  expanded: ReadonlySet<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  selectedPath: string | null;
  setSelectedPath: Dispatch<SetStateAction<string | null>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  scrollTopRef: MutableRefObject<number>;
}

const ExplorerViewContext = createContext<ExplorerView | null>(null);
const ExplorerTreeContext = createContext<ExplorerTreeSync | null>(null);

interface ExplorerReferenceContextValue {
  pendingReference: ExplorerReference | null;
  objects: readonly ExplorerNode[];
  objectsLoading: boolean;
  objectsFailed: boolean;
  objectsWaiting: string | null;
  requestSync: ExplorerTreeSync["requestSync"];
  referenceObject: (reference: ExplorerReference) => void;
  consumeReference: () => void;
  objectIndex: ReadonlyMap<string, ExplorerNode | null>;
  focusRequest: string | null;
  focusObject: (path: string) => void;
  consumeFocus: () => void;
}

const ExplorerReferenceContext = createContext<ExplorerReferenceContextValue | null>(null);
const NOTHING_EXPANDED: Set<string> = new Set();

export function ExplorerReferenceProvider({ children }: { children: ReactNode }) {
  const sync = useExplorerTreeSync();
  const placeKey = explorerPlaceKey(useStudioTargetOptional());
  const [expandedByPlace, setExpandedByPlace] = useState<
    ReadonlyMap<string | undefined, Set<string>>
  >(() => new Map());
  const expanded = expandedByPlace.get(placeKey) ?? NOTHING_EXPANDED;
  const setExpanded = useCallback<Dispatch<SetStateAction<Set<string>>>>(
    (action) =>
      setExpandedByPlace((all) => {
        const current = all.get(placeKey) ?? NOTHING_EXPANDED;
        return new Map(all).set(placeKey, typeof action === "function" ? action(current) : action);
      }),
    [placeKey],
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const scrollTopRef = useRef(0);
  const viewPlaceRef = useRef(placeKey);
  useEffect(() => {
    if (!placeKey || viewPlaceRef.current === placeKey) return;
    viewPlaceRef.current = placeKey;
    setSelectedPath(null);
    setSearch("");
    scrollTopRef.current = 0;
  }, [placeKey]);
  const view = useMemo(
    () => ({
      expanded,
      setExpanded,
      selectedPath,
      setSelectedPath,
      search,
      setSearch,
      scrollTopRef,
    }),
    [expanded, setExpanded, selectedPath, search],
  );

  const [pendingReference, setPendingReference] = useState<ExplorerReference | null>(null);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const referenceObject = useCallback(
    (reference: ExplorerReference) => setPendingReference(reference),
    [],
  );
  const consumeReference = useCallback(() => setPendingReference(null), []);
  const consumeFocus = useCallback(() => setFocusRequest(null), []);
  const objectIndex = useMemo(() => indexExplorerObjects(sync.objects), [sync.objects]);
  const value = useMemo(
    () => ({
      pendingReference,
      objects: sync.objects,
      objectsLoading: sync.syncing && sync.objects.length === 0,
      objectsFailed: sync.syncError !== null && sync.objects.length === 0,
      objectsWaiting: sync.objects.length === 0 ? sync.waiting : null,
      requestSync: sync.requestSync,
      referenceObject,
      consumeReference,
      objectIndex,
      focusRequest,
      focusObject: setFocusRequest,
      consumeFocus,
    }),
    [
      pendingReference,
      sync.objects,
      sync.syncing,
      sync.syncError,
      sync.waiting,
      sync.requestSync,
      referenceObject,
      consumeReference,
      objectIndex,
      focusRequest,
      consumeFocus,
    ],
  );

  return (
    <ExplorerTreeContext.Provider value={sync}>
      <ExplorerViewContext.Provider value={view}>
        <ExplorerReferenceContext.Provider value={value}>
          {children}
        </ExplorerReferenceContext.Provider>
      </ExplorerViewContext.Provider>
    </ExplorerTreeContext.Provider>
  );
}

export function useExplorerReference() {
  const value = useContext(ExplorerReferenceContext);
  if (!value) throw new Error("useExplorerReference must be used inside ExplorerReferenceProvider");
  return value;
}

export function useExplorerView() {
  const value = useContext(ExplorerViewContext);
  if (!value) throw new Error("useExplorerView must be used inside ExplorerReferenceProvider");
  return value;
}

export function useExplorerTree() {
  const value = useContext(ExplorerTreeContext);
  if (!value) throw new Error("useExplorerTree must be used inside ExplorerReferenceProvider");
  return value;
}

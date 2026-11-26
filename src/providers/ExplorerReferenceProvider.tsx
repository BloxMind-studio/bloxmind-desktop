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
  /** What someone had opened and searched for, which outlives the panel being closed. */
  scrollTopRef: MutableRefObject<number>;
}

const ExplorerViewContext = createContext<ExplorerView | null>(null);

interface ExplorerReferenceContextValue {
  pendingReference: ExplorerReference | null;
  objects: readonly ExplorerNode[];
  referenceObject: (reference: ExplorerReference) => void;
  consumeReference: () => void;
  publishObjects: (objects: readonly ExplorerNode[]) => void;
  objectIndex: ReadonlyMap<string, ExplorerNode | null>;
  /** The object a click in the chat asked the Explorer to show. */
  focusRequest: string | null;
  focusObject: (path: string) => void;
  consumeFocus: () => void;
}

const ExplorerReferenceContext = createContext<ExplorerReferenceContextValue | null>(null);
const NOTHING_EXPANDED: Set<string> = new Set();

export function ExplorerReferenceProvider({ children }: { children: ReactNode }) {
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
  const [objects, setObjects] = useState<readonly ExplorerNode[]>([]);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const referenceObject = useCallback(
    (reference: ExplorerReference) => setPendingReference(reference),
    [],
  );
  const consumeReference = useCallback(() => setPendingReference(null), []);
  const publishObjects = useCallback((next: readonly ExplorerNode[]) => setObjects(next), []);
  const consumeFocus = useCallback(() => setFocusRequest(null), []);
  const objectIndex = useMemo(() => indexExplorerObjects(objects), [objects]);
  const value = useMemo(
    () => ({
      pendingReference,
      objects,
      referenceObject,
      consumeReference,
      publishObjects,
      objectIndex,
      focusRequest,
      focusObject: setFocusRequest,
      consumeFocus,
    }),
    [
      pendingReference,
      objects,
      referenceObject,
      consumeReference,
      publishObjects,
      objectIndex,
      focusRequest,
      consumeFocus,
    ],
  );

  return (
    <ExplorerViewContext.Provider value={view}>
      <ExplorerReferenceContext.Provider value={value}>
        {children}
      </ExplorerReferenceContext.Provider>
    </ExplorerViewContext.Provider>
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

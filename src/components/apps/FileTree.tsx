import { ChevronRight, FileCode2, FileText, Folder, FolderOpen, Package } from "lucide-react";
import { useMemo, useState } from "react";
import type { AppGeneratedFile } from "@/lib/appsBuilder/types";

interface TreeFile {
  kind: "file";
  name: string;
  path: string;
}

interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

type TreeNode = TreeFile | TreeFolder;

function fileIcon(path: string) {
  if (path.endsWith(".json")) return Package;
  if (path.endsWith(".css")) return FileText;
  return FileCode2;
}

/** Sort directories before files, both alphabetically; root files go last. */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const aIsFolder = a.kind === "folder";
    const bIsFolder = b.kind === "folder";
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Build a nested folder tree from a flat list of generated files. */
function buildTree(files: AppGeneratedFile[]): TreeNode[] {
  const foldersByName = new Map<string, TreeFolder>();
  const root: TreeFolder = { kind: "folder", name: "", path: "", children: [] };

  const rootFiles: TreeFile[] = [];
  for (const file of files) {
    const segments = file.path.split("/");
    const name = segments.pop() ?? file.path;
    let current = root;
    let folderPath = "";
    for (const segment of segments) {
      folderPath = folderPath === "" ? segment : `${folderPath}/${segment}`;
      const key = `${current.path}/${segment}`;
      let child = foldersByName.get(key);
      if (!child) {
        child = {
          kind: "folder",
          name: segment,
          path: folderPath,
          children: [],
        };
        foldersByName.set(key, child);
        current.children.push(child);
      }
      current = child;
    }
    if (segments.length === 0) {
      rootFiles.push({ kind: "file", name, path: file.path });
    } else {
      current.children.push({ kind: "file", name, path: file.path });
    }
  }

  const sortRecursively = (nodes: TreeNode[]): TreeNode[] => {
    const sorted = sortNodes(nodes);
    for (const node of sorted) {
      if (node.kind === "folder") {
        node.children = sortRecursively(node.children);
      }
    }
    return sorted;
  };

  return sortRecursively([...root.children, ...rootFiles]);
}

/**
 * File explorer side panel for the generated app. Displays a clean folder
 * hierarchy (package.json, src/App.tsx, src/components/, README.md, …).
 */
export function FileTree({
  files,
  selectedPath,
  onSelect,
}: {
  files: AppGeneratedFile[];
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r bg-card">
      <div className="flex h-9 items-center border-b px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Project
        </span>
      </div>
      <div className="app-scrollbar flex-1 overflow-y-auto p-2">
        {tree.map((node) => (
          <TreeEntry
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function TreeEntry({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(node.kind === "folder" && node.path === "src");

  if (node.kind === "file") {
    const selected = node.path === selectedPath;
    const Icon = fileIcon(node.path);
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        data-testid={`file-node-${node.path}`}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors ${
          selected ? "bg-accent/20 text-foreground" : "text-muted-foreground hover:bg-hover/12"
        }`}
        style={{ paddingLeft: depth * 12 + 10 }}
      >
        <Icon aria-hidden="true" size={12} className="shrink-0" />
        <span className="truncate text-[11px]">{node.name}</span>
      </button>
    );
  }

  const Icon = open ? FolderOpen : Folder;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Toggle ${node.name}`}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover/12"
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <ChevronRight
          aria-hidden="true"
          size={12}
          className={`shrink-0 text-muted-foreground/60 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Icon aria-hidden="true" size={12} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[11px] font-medium text-foreground">{node.name}</span>
      </button>
      {open && (
        <div>
          {node.children.map((child) => (
            <TreeEntry
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

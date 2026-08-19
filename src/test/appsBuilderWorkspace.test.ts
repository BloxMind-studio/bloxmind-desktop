import { describe, expect, it, vi } from "vitest";
import { appProjectDirectory, readProjectFromWorkspace } from "@/lib/appsBuilder/workspace";

type WorkspaceClient = Parameters<typeof readProjectFromWorkspace>[0];

interface FakeFileApi {
  list: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
}

/**
 * Build a fake client whose file API backs a flat map of workspace nodes.
 * Intermediate directory entries are synthesized from the file paths, and a
 * node with no `content` behaves like a binary file on read.
 */
function fakeClient(nodes: Record<string, { type: "file" | "directory"; content?: string }>) {
  const tree = new Map<string, { type: "file" | "directory"; content?: string }>();
  for (const [key, value] of Object.entries(nodes)) {
    const segments = key.split("/");
    for (let i = 1; i < segments.length - 1; i++) {
      const dirPath = segments.slice(0, i + 1).join("/");
      if (!tree.has(dirPath)) tree.set(dirPath, { type: "directory" });
    }
    tree.set(key, value);
  }

  const file: FakeFileApi = {
    list: vi.fn(async ({ path }: { path: string }) => {
      const prefix = path === "apps" ? "apps/" : `${path}/`;
      const children = new Map<string, { name: string; path: string; type: string }>();
      for (const [key, value] of tree) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0];
        if (!name) continue;
        const isExact = key === `${prefix}${name}`;
        const type = isExact ? value.type : "directory";
        // Real nodes report their own path; synthesized directories are listed
        // under their folder path so the walk can recurse into them.
        const childPath = isExact ? key : `${prefix}${name}`;
        const existing = children.get(name);
        if (existing) continue;
        children.set(name, { name, path: childPath, type });
      }
      return { data: Array.from(children.values()) };
    }),
    read: vi.fn(async ({ path }: { path: string }) => {
      const node = tree.get(path);
      if (!node || node.content === undefined) return { data: { type: "binary", content: "" } };
      return { data: { type: "text", content: node.content } };
    }),
  };
  return { file };
}

const SAMPLE_FILES: Record<string, { type: "file" | "directory"; content?: string }> = {
  "apps/app-1/bloxmind.json": {
    type: "file",
    content: JSON.stringify({
      name: "Task Flow",
      description: "A todo list app",
      target: "mobile",
      theme: "dark",
      engine: "web",
      entry: "src/main.tsx",
    }),
  },
  "apps/app-1/package.json": {
    type: "file",
    content: '{ "name": "task-flow" }',
  },
  "apps/app-1/src/App.tsx": {
    type: "file",
    content: "export default function App() { return <h1>My Tasks</h1>; }",
  },
  "apps/app-1/src/index.css": {
    type: "file",
    content: "body { margin: 0; }",
  },
};

describe("appProjectDirectory", () => {
  it("derives the workspace-relative folder from the app id", () => {
    expect(appProjectDirectory("app-1")).toBe("apps/app-1");
  });
});

describe("readProjectFromWorkspace", () => {
  it("reads files back from the app folder and applies the manifest", async () => {
    const client = fakeClient(SAMPLE_FILES) as WorkspaceClient;
    const project = await readProjectFromWorkspace(client, "app-1");

    expect(project.name).toBe("Task Flow");
    expect(project.description).toBe("A todo list app");
    expect(project.target).toBe("mobile");
    expect(project.theme).toBe("dark");
    expect(project.engine).toBe("web");
    expect(project.entry).toBe("src/main.tsx");
    expect(project.files).toEqual([
      { path: "package.json", content: '{ "name": "task-flow" }' },
      {
        path: "src/App.tsx",
        content: "export default function App() { return <h1>My Tasks</h1>; }",
      },
      { path: "src/index.css", content: "body { margin: 0; }" },
    ]);
    // The manifest is metadata, never a project file.
    expect(project.files.map((f) => f.path)).not.toContain("bloxmind.json");
  });

  it("reads a 3d engine from the manifest for games", async () => {
    const files: Record<string, { type: "file" | "directory"; content?: string }> = {
      "apps/app-2/bloxmind.json": {
        type: "file",
        content: JSON.stringify({ name: "Neon Racer", engine: "3d", entry: "src/main.tsx" }),
      },
      "apps/app-2/src/App.tsx": { type: "file", content: "export default function App() {}" },
    };
    const project = await readProjectFromWorkspace(fakeClient(files) as WorkspaceClient, "app-2");
    expect(project.name).toBe("Neon Racer");
    expect(project.engine).toBe("3d");
  });

  it("falls back to supplied identity when the manifest is missing", async () => {
    const files: Record<string, { type: "file" | "directory"; content?: string }> = {
      "apps/app-1/src/App.tsx": { type: "file", content: "export default function App() {}" },
    };
    const project = await readProjectFromWorkspace(fakeClient(files) as WorkspaceClient, "app-1", {
      name: "Kept Name",
      description: "kept",
      target: "desktop",
      theme: "light",
      entry: "src/main.tsx",
    });
    expect(project.name).toBe("Kept Name");
    expect(project.target).toBe("desktop");
    expect(project.theme).toBe("light");
    expect(project.files).toHaveLength(1);
  });

  it("skips ignored dependency/build directories", async () => {
    const files: Record<string, { type: "file" | "directory"; content?: string }> = {
      "apps/app-1/src/App.tsx": { type: "file", content: "export default function App() {}" },
      "apps/app-1/node_modules/react/index.js": { type: "file", content: "module.exports = {}" },
      "apps/app-1/dist/bundle.js": { type: "file", content: "console.log(1)" },
      "apps/app-1/.git/config": { type: "file", content: "[core]" },
      "apps/app-1/.opencode/something.ts": { type: "file", content: "export {}" },
    };
    const project = await readProjectFromWorkspace(fakeClient(files) as WorkspaceClient, "app-1");
    expect(project.files.map((f) => f.path)).toEqual(["src/App.tsx"]);
  });

  it("throws a transient-eligible empty response when the folder has no text files", async () => {
    await expect(
      readProjectFromWorkspace(
        fakeClient({ "apps/app-1/blob.bin": { type: "file" } }) as WorkspaceClient,
        "app-1",
      ),
    ).rejects.toThrow("The generator returned an empty response.");
  });

  it("throws a transient-eligible empty response when the folder is missing", async () => {
    await expect(
      readProjectFromWorkspace(fakeClient({}) as WorkspaceClient, "missing-app"),
    ).rejects.toThrow("The generator returned an empty response.");
  });

  it("tolerates a corrupted manifest and defaults its fields", async () => {
    const files: Record<string, { type: "file" | "directory"; content?: string }> = {
      "apps/app-1/bloxmind.json": { type: "file", content: "not json" },
      "apps/app-1/src/App.tsx": { type: "file", content: "export default function App() {}" },
    };
    const project = await readProjectFromWorkspace(fakeClient(files) as WorkspaceClient, "app-1");
    expect(project.name).toBe("Generated App");
    expect(project.target).toBe("desktop");
    expect(project.theme).toBe("dark");
    expect(project.entry).toBe("src/main.tsx");
  });

  it("sorts files for a stable explorer order", async () => {
    const client = fakeClient(SAMPLE_FILES) as WorkspaceClient;
    const project = await readProjectFromWorkspace(client, "app-1");
    const paths = project.files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
  });
});

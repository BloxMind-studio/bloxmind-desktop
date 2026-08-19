import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findDisallowedImports,
  imported3DHostModules,
  mountAppPreview,
  needs3DHostModules,
} from "@/lib/appsBuilder/preview";
import type { AppGeneratedFile } from "@/lib/appsBuilder/types";

const MAIN_TSX = `
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;

const APP_TSX = `
import { useState } from "react";
import { Check } from "lucide-react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <Check data-testid="icon" />
      <h1>Hello Preview</h1>
      <button type="button" onClick={() => setCount(count + 1)}>{count}</button>
    </div>
  );
}
`;

function mountFiles(overrides: Partial<Record<string, string>> = {}) {
  const base: Array<[string, string]> = [
    ["package.json", "{}"],
    ["src/main.tsx", MAIN_TSX],
    ["src/App.tsx", APP_TSX],
    ["src/index.css", "h1 { color: red; }"],
  ];
  const merged = new Map<string, string>(base);
  for (const [path, content] of Object.entries(overrides)) {
    if (content === undefined) merged.delete(path);
    else merged.set(path, content);
  }
  return [...merged].map(([path, content]) => ({ path, content }));
}

function mountTarget(): HTMLElement {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  return root;
}

async function mountApp(files: AppGeneratedFile[]) {
  const container = mountTarget();
  await act(async () => {
    await mountAppPreview({ files, container, targetWindow: window });
  });
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-bloxmind-app]").forEach((style) => {
    style.remove();
  });
});

describe("needs3DHostModules", () => {
  it("detects the R3F stack from generated imports", () => {
    expect(
      needs3DHostModules([
        { path: "src/App.tsx", content: 'import { Canvas } from "@react-three/fiber";' },
      ]),
    ).toBe(true);
    expect(
      needs3DHostModules([
        { path: "src/App.tsx", content: 'import { Box } from "@react-three/drei";' },
      ]),
    ).toBe(true);
    expect(
      needs3DHostModules([
        { path: "src/App.tsx", content: 'import { RigidBody } from "@react-three/rapier";' },
      ]),
    ).toBe(true);
    expect(
      needs3DHostModules([{ path: "src/App.tsx", content: 'import { Vector3 } from "three";' }]),
    ).toBe(true);
  });

  it("leaves plain web apps alone", () => {
    expect(
      needs3DHostModules([
        { path: "src/App.tsx", content: 'import { useState } from "react";' },
        { path: "src/App.tsx", content: 'import { Check } from "lucide-react";' },
      ]),
    ).toBe(false);
  });
});

describe("imported3DHostModules", () => {
  it("returns only the 3D modules actually imported", () => {
    expect(
      imported3DHostModules([{ path: "src/App.tsx", content: 'import { Vector3 } from "three";' }]),
    ).toEqual(new Set(["three"]));

    expect(
      imported3DHostModules([
        { path: "src/App.tsx", content: 'import { Canvas } from "@react-three/fiber";' },
      ]),
    ).toEqual(new Set(["@react-three/fiber"]));
  });

  it("includes several modules when all are referenced and matches subpaths", () => {
    expect(
      imported3DHostModules([
        {
          path: "src/App.tsx",
          content:
            'import { Canvas } from "@react-three/fiber";\nimport { RigidBody } from "@react-three/rapier";',
        },
      ]),
    ).toEqual(new Set(["@react-three/fiber", "@react-three/rapier"]));
    expect(
      imported3DHostModules([
        {
          path: "src/App.tsx",
          content: 'import * as THREE from "three/examples/jsm/controls/OrbitControls.js";',
        },
      ]),
    ).toEqual(new Set(["three"]));
  });
});

describe("findDisallowedImports", () => {
  it("flags unsupported bare modules with a file + specifier", () => {
    const results = findDisallowedImports([
      { path: "src/App.tsx", content: 'import { Button } from "antd";\nimport "./styles.css";\n' },
      { path: "src/api.ts", content: 'export { default } from "axios";' },
    ]);
    expect(results).toContainEqual({ file: "src/App.tsx", specifier: "antd" });
    expect(results).toContainEqual({ file: "src/api.ts", specifier: "axios" });
  });

  it("ignores relative imports, allowed bare modules, and CSS/JSON", () => {
    const results = findDisallowedImports([
      {
        path: "src/App.tsx",
        content:
          'import { useState } from "react";\nimport { Check } from "lucide-react";\nimport { Canvas } from "@react-three/fiber";\nimport App from "./App";\nimport { lazy } from "react";\nconst Lazy = lazy(() => import("./Lazy"));',
      },
      { path: "src/theme.css", content: '@import url("https://fonts.example.com/x.css");' },
      { path: "data.json", content: '{"key": "value"}' },
    ]);
    expect(results).toEqual([]);
  });

  it("does not duplicate the same file+specifier pair", () => {
    const results = findDisallowedImports([
      {
        path: "src/App.tsx",
        content: 'import "moment"; import moment from "moment";',
      },
    ]);
    expect(results).toEqual([{ file: "src/App.tsx", specifier: "moment" }]);
  });
});

describe("mountAppPreview", () => {
  it("compiles and runs a generated React app with interactions, icons, and CSS", async () => {
    const container = await mountApp(mountFiles());

    expect(document.querySelector("h1")?.textContent).toBe("Hello Preview");
    expect(document.querySelector("svg")).toBeTruthy();
    expect(document.querySelector("style[data-bloxmind-app]")?.textContent).toContain("color: red");

    const button = document.querySelector("button");
    expect(button?.textContent).toBe("0");
    act(() => button?.click());
    act(() => button?.click());
    expect(button?.textContent).toBe("2");

    expect(container.childElementCount).toBeGreaterThan(0);
  });

  it("surfaces a readable error when the app throws at runtime", async () => {
    const container = mountTarget();
    // No main.tsx: the runtime mounts App.tsx itself and flushSync propagates
    // render errors synchronously.
    const files = mountFiles({
      "src/main.tsx": undefined,
      "src/App.tsx": 'export default function App() { throw new Error("boom"); }',
    });
    await expect(mountAppPreview({ files, container, targetWindow: window })).rejects.toThrow(
      /boom/,
    );
  });

  it("rejects when a generated module imports something unsupported", async () => {
    const container = mountTarget();
    const files = mountFiles({
      "src/App.tsx":
        'import axios from "axios"; const client = axios; export default function App() { return client ? null : null; }',
    });
    // The pre-flight import check gives precise, early guidance instead of a
    // boot-time "Cannot resolve" crash.
    await expect(mountAppPreview({ files, container, targetWindow: window })).rejects.toThrow(
      /preview can't run[\s\S]*axios/,
    );
  });

  it("rejects when the project has no entry point", async () => {
    const container = mountTarget();
    await expect(
      mountAppPreview({
        files: [{ path: "README.md", content: "hi" }],
        container,
        targetWindow: window,
      }),
    ).rejects.toThrow(/entry point/);
  });

  it("falls back to src/App.tsx when there is no main.tsx", async () => {
    await mountApp(mountFiles({ "src/main.tsx": undefined }));
    expect(document.querySelector("h1")?.textContent).toBe("Hello Preview");
  });

  it("loads the 3D game stack host modules for R3F apps", async () => {
    const container = mountTarget();
    const files = mountFiles({
      "src/App.tsx": `
import { Canvas } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
export default function App() {
  return <Canvas><RigidBody><mesh /></RigidBody></Canvas>;
}`,
    });
    // jsdom can't provide WebGL, but R3F's Canvas recovers internally and the
    // mount still resolves — which is exactly the proof we want: the three /
    // fiber / rapier host modules loaded and no "Cannot resolve" was thrown.
    const cleanup = await mountAppPreview({ files, container, targetWindow: window });
    cleanup();
    expect(container).toBeTruthy();
  });
});

describe("mountAppPreview compile metrics", () => {
  it("reports compiled modules and reuses the cache on an identical second mount", async () => {
    const onCompile = vi.fn();
    // Unique content so the first mount is guaranteed to compile (the cache is
    // module-level and earlier tests in this file already cached the fixtures).
    const token = `metric-token-${Math.random().toString(36).slice(2)}`;
    const files = mountFiles({
      "src/App.tsx": `export default function App() { return <h1>${token}</h1>; }`,
    });

    async function mountInto() {
      const container = mountTarget();
      await act(async () => {
        await mountAppPreview({ files, container, targetWindow: window, onCompile });
      });
      return container;
    }

    await mountInto();
    const first = onCompile.mock.calls[0][0] as {
      compiled: number;
      cacheHits: number;
      elapsedMs: number;
    };
    expect(first.compiled).toBeGreaterThan(0);
    expect(typeof first.elapsedMs).toBe("number");

    // Second, identical mount is served entirely from the cross-build cache.
    onCompile.mockClear();
    await mountInto();
    const second = onCompile.mock.calls[0][0] as { compiled: number; cacheHits: number };
    expect(second.compiled).toBe(0);
    expect(second.cacheHits).toBeGreaterThanOrEqual(first.compiled);
  });
});

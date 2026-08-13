import { describe, expect, it } from "vitest";
import {
  componentNames,
  generatePackageFiles,
  generateProjectFiles,
  renderComponentSource,
  slugify,
  toPascalCase,
} from "@/lib/appsBuilder/codegen";
import type { AppGeneratedFile } from "@/lib/appsBuilder/types";

function contentOf(files: AppGeneratedFile[], path: string): string {
  const file = files.find((entry) => entry.path === path);
  if (!file) throw new Error(`Missing generated file: ${path}`);
  return file.content;
}

function instance(kind: "heading" | "text" | "button" | "card" | "image" | "input" | "list") {
  const defaults: Record<string, Record<string, string>> = {
    heading: { text: "My App", size: "24px", weight: "700" },
    text: { text: "Hello world", size: "16px", weight: "400" },
    button: { text: "Click me", color: "#22C55E" },
    card: { title: "Card title", body: "Body text" },
    image: { caption: "Image", url: "" },
    input: { placeholder: "Type here…", label: "Field" },
    list: { items: "One\nTwo" },
  };
  return {
    id: `app-${kind}`,
    kind,
    label: kind === "input" ? "Input" : kind === "list" ? "List" : kind,
    props: defaults[kind],
  };
}

describe("slugify", () => {
  it("lowercases and hyphenates into a safe npm name", () => {
    expect(slugify("Todo List App")).toBe("todo-list-app");
    expect(slugify("  Nice! App (v2)  ")).toBe("nice-app-v2");
  });

  it("falls back to my-app when empty", () => {
    expect(slugify("")).toBe("my-app");
    expect(slugify("!!")).toBe("my-app");
  });
});

describe("toPascalCase", () => {
  it("converts labels into exported component names", () => {
    expect(toPascalCase("hello world")).toBe("HelloWorld");
    expect(toPascalCase("card")).toBe("Card");
    expect(toPascalCase("!!")).toBe("Component");
  });
});

describe("componentNames", () => {
  it("deduplicates conflicting labels", () => {
    const canvas = [
      { ...instance("button"), id: "a", label: "Click" },
      { ...instance("button"), id: "b", label: "Click" },
    ];
    expect(componentNames(canvas)).toEqual(["Click", "Click2"]);
  });
});

describe("renderComponentSource", () => {
  it("emits an idiomatic typed component", () => {
    const source = renderComponentSource(instance("button"), "ClickMe");
    expect(source).toContain("export interface ClickMeProps");
    expect(source).toContain("text: string");
    expect(source).toContain('className="app-button"');
    expect(source).toContain("{ text, color }");
  });
});

describe("generateProjectFiles", () => {
  it("produces a runnable Vite + React project", () => {
    const files = generateProjectFiles([instance("heading"), instance("button")]);

    const paths = files.map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "package.json",
        "vite.config.ts",
        "tsconfig.json",
        "index.html",
        "src/main.tsx",
        "src/App.tsx",
        "src/styles.css",
        "src/components/Heading.tsx",
        "src/components/Button.tsx",
        "README.md",
        ".gitignore",
      ]),
    );

    const packageJson = JSON.parse(contentOf(files, "package.json")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(packageJson.scripts.build).toContain("vite build");
    expect(packageJson.dependencies.react).toBeDefined();
    expect(packageJson.dependencies.react).toBeDefined();

    const appTsx = contentOf(files, "src/App.tsx");
    expect(appTsx).toContain('import { Heading } from "./components/Heading";');
    expect(appTsx).toContain('import { Button } from "./components/Button";');
    expect(appTsx).toContain('<main className="app">');
  });

  it("escapes user text safely into props", () => {
    const rich = {
      ...instance("text"),
      id: "a",
      props: { text: 'Quote " inside\nNewline', size: "16px", weight: "400" },
    };
    const files = generateProjectFiles([rich]);
    const appTsx = contentOf(files, "src/App.tsx");
    expect(appTsx).toContain('text={"Quote \\" inside\\nNewline"}');
  });
});

describe("generatePackageFiles", () => {
  it("emits a publishable package with index.ts and a build script", () => {
    const files = generatePackageFiles([instance("button")], "Todo App");

    const paths = files.map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "package.json",
        "tsconfig.json",
        "src/index.ts",
        "src/components/Button.tsx",
        "README.md",
      ]),
    );

    const packageJson = JSON.parse(contentOf(files, "package.json")) as {
      name: string;
      scripts: Record<string, string>;
      main: string;
    };
    expect(packageJson.name).toBe("todo-app");
    expect(packageJson.main).toBe("dist/index.js");
    expect(packageJson.scripts.build).toBe("tsc");

    const index = contentOf(files, "src/index.ts");
    expect(index).toContain('export { Button } from "./components/Button";');
  });
});

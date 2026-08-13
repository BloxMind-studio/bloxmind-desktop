import { APP_COMPONENT_BY_KIND } from "./components";
import type { AppComponentInstance, AppGeneratedFile } from "./types";

const REACT_VERSION = "^18.3.1";
const TYPESCRIPT_VERSION = "~5.6.2";
const VITE_VERSION = "^5.4.8";
const PLUGIN_REACT_VERSION = "^4.3.1";

/** Convert an arbitrary string into a safe, lowercase npm package name. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "my-app";
}

/** Convert an arbitrary string into an exported PascalCase component name. */
export function toPascalCase(value: string): string {
  const words = value.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!words) return "Component";
  return words
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** Assign a unique exported component name per canvas instance (label-derived). */
export function componentNames(canvas: AppComponentInstance[]): string[] {
  const used = new Set<string>();
  return canvas.map((instance) => {
    const base = toPascalCase(instance.label) || toPascalCase(instance.kind);
    let name = base;
    let counter = 1;
    while (used.has(name)) {
      counter += 1;
      name = `${base}${counter}`;
    }
    used.add(name);
    return name;
  });
}

function propsKeys(kind: AppComponentInstance["kind"]): string[] {
  const definition = APP_COMPONENT_BY_KIND.get(kind);
  if (!definition) return [];
  return definition.propsSchema.map((prop) => prop.key);
}

function propDefault(kind: AppComponentInstance["kind"], key: string): string {
  return APP_COMPONENT_BY_KIND.get(kind)?.defaultProps[key] ?? "";
}

/** Render the fixed JSX body of a single generated component. */
function renderBody(kind: AppComponentInstance["kind"]): string {
  switch (kind) {
    case "heading":
      return `<h1 className="app-heading" style={{ fontSize: size, fontWeight: weight }}>{text}</h1>`;
    case "text":
      return `<p className="app-text" style={{ fontSize: size, fontWeight: weight }}>{text}</p>`;
    case "button":
      return `<button className="app-button" type="button" style={{ backgroundColor: color }}>{text}</button>`;
    case "card":
      return `<div className="app-card">
<h3 className="app-card-title">{title}</h3>
<p className="app-card-body">{body}</p>
</div>`;
    case "image":
      return `url ? (
<img className="app-image" src={url} alt={caption} />
) : (
<div className="app-image-placeholder">{caption || "Image"}</div>
)`;
    case "input":
      return `<label className="app-field">
<span className="app-field-label">{label}</span>
<input className="app-input" placeholder={placeholder} />
</label>`;
    case "list":
      return `<ul className="app-list">
{items.split("\\n").filter(Boolean).map((item, index) => (
<li key={index}>{item}</li>
))}
</ul>`;
    default:
      return `<p>Unsupported component</p>`;
  }
}

/** Write a single generated component as an idiomatic functional React component. */
export function renderComponentSource(instance: AppComponentInstance, name: string): string {
  const { kind } = instance;
  const keys = propsKeys(kind);

  const params = keys.map((key) => key).join(", ");
  const typeBody = keys.map((key) => `  ${key}: string`).join(";\n");
  const body = renderBody(kind);

  return `export interface ${name}Props {
${typeBody}
}

export function ${name}({ ${params} }: ${name}Props) {
  return (
${indent(body, 4)}
  );
}
`;
}

function indent(value: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.trim() === "" ? line : pad + line))
    .join("\n");
}

/** Render one instance as a JSX element with all its props passed through. */
function renderInstanceElement(instance: AppComponentInstance, name: string): string {
  const keys = propsKeys(instance.kind);
  const attributes = keys
    .map((key) => {
      const value = instance.props[key] ?? propDefault(instance.kind, key);
      return `      ${key}={${JSON.stringify(value)}}`;
    })
    .join("\n");
  return `      <${name}\n${attributes}\n      />`;
}

/** Render the top-level App.tsx that composes every canvas instance. */
function renderAppSource(canvas: AppComponentInstance[], names: string[]): string {
  const imports = names.map((name) => `import { ${name} } from "./components/${name}";`).join("\n");
  const body = canvas
    .map((instance, index) => renderInstanceElement(instance, names[index]))
    .join("\n\n");

  return `import "./styles.css";
${imports}

export default function App() {
  return (
    <main className="app">
${body}
    </main>
  );
}
`;
}

const STYLES_CSS = `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f8fafc;
  color: #0f172a;
}

.app {
  max-width: 640px;
  margin: 0 auto;
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.app-heading {
  margin: 0;
}

.app-text {
  margin: 0;
  color: #475569;
}

.app-button {
  border: 0;
  border-radius: 8px;
  padding: 10px 16px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}

.app-card {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  background: #fff;
}

.app-card-title {
  margin: 0 0 4px;
  font-size: 16px;
}

.app-card-body {
  margin: 0;
  font-size: 14px;
  color: #475569;
}

.app-image {
  max-width: 100%;
  border-radius: 12px;
}

.app-image-placeholder {
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  color: #94a3b8;
}

.app-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.app-field-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}

.app-input {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  font-family: inherit;
}

.app-list {
  margin: 0;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.8;
  color: #334155;
}
`;

function indexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

const MAIN_TSX = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

const VITE_CONFIG_TS = `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
});
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`;

const TSCONFIG_NODE_JSON = `{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
`;

const GITIGNORE = `node_modules
dist
*.local
.DS_Store
`;

function readme(name: string, packageMode = false): string {
  const setup = packageMode ? `npm install && npm run build` : `npm install && npm run dev`;
  return `# ${name}

A React + TypeScript ${packageMode ? "package" : "app"} generated by **BloxMind Apps Builder**.

## Getting started

\`\`\`bash
${setup}
\`\`\`

${packageMode ? "The built package is emitted to `dist/` and ready to publish with `npm publish`." : "The app boots a local Vite dev server on `src/main.tsx`."}

## Structure

\`\`\`text
src/
  App.tsx        # Composes every placed component
  components/    # One small component per canvas tile
  styles.css     # Shared app styles
\`\`\`
`;
}

function projectPackageJson(): string {
  return `${JSON.stringify(
    {
      name: "my-app",
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: REACT_VERSION,
        "react-dom": REACT_VERSION,
      },
      devDependencies: {
        "@types/react": "^18.3.1",
        "@types/react-dom": "^18.3.1",
        "@vitejs/plugin-react": PLUGIN_REACT_VERSION,
        typescript: TYPESCRIPT_VERSION,
        vite: VITE_VERSION,
      },
    },
    null,
    2,
  )}\n`;
}

function npmPackageJson(slug: string, name: string): string {
  return `${JSON.stringify(
    {
      name: slug,
      version: "0.1.0",
      description: `${name} — generated with BloxMind Apps Builder`,
      type: "module",
      main: "dist/index.js",
      module: "dist/index.js",
      types: "dist/index.d.ts",
      files: ["dist"],
      scripts: {
        build: "tsc",
        prepublishOnly: "npm run build",
      },
      peerDependencies: {
        react: ">=17",
        "react-dom": ">=17",
      },
      devDependencies: {
        "@types/react": "^18.3.1",
        "@types/react-dom": "^18.3.1",
        typescript: TYPESCRIPT_VERSION,
      },
    },
    null,
    2,
  )}\n`;
}

const PACKAGE_TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`;

function packageIndexSource(names: string[]): string {
  const exports = names.map((name) => `export { ${name} } from "./components/${name}";`).join("\n");
  const typeExports = names
    .map((name) => `export type { ${name}Props } from "./components/${name}";`)
    .join("\n");
  return `${exports}

${typeExports}
`;
}

/**
 * Generate a runnable Vite + React + TypeScript app (ready for `npm install`)
 * as a path→content file map.
 */
export function generateProjectFiles(canvas: AppComponentInstance[]): AppGeneratedFile[] {
  const names = componentNames(canvas);
  const files: AppGeneratedFile[] = [];

  const push = (path: string, content: string) => files.push({ path, content });

  push("package.json", projectPackageJson());
  push("vite.config.ts", VITE_CONFIG_TS);
  push("tsconfig.json", TSCONFIG_JSON);
  push("tsconfig.node.json", TSCONFIG_NODE_JSON);
  push("index.html", indexHtml("My App"));
  push(".gitignore", GITIGNORE);
  push("README.md", readme("My App"));
  push("src/main.tsx", MAIN_TSX);
  push("src/styles.css", STYLES_CSS);

  canvas.forEach((instance, index) => {
    push(`src/components/${names[index]}.tsx`, renderComponentSource(instance, names[index]));
  });

  push("src/App.tsx", renderAppSource(canvas, names));
  return files;
}

/**
 * Generate a publishable npm package (index.ts entry, tsc build script,
 * package.json) as a path→content file map.
 */
export function generatePackageFiles(
  canvas: AppComponentInstance[],
  appName = "My App",
): AppGeneratedFile[] {
  const names = componentNames(canvas);
  const files: AppGeneratedFile[] = [];

  const push = (path: string, content: string) => files.push({ path, content });

  push("package.json", npmPackageJson(slugify(appName), appName));
  push("tsconfig.json", PACKAGE_TSCONFIG_JSON);
  push(".gitignore", GITIGNORE);
  push("README.md", readme(appName, true));
  push("src/index.ts", packageIndexSource(names));

  canvas.forEach((instance, index) => {
    push(`src/components/${names[index]}.tsx`, renderComponentSource(instance, names[index]));
  });

  return files;
}

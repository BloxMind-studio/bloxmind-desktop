import { Braces, Code2, Download, LayoutTemplate, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileTree } from "@/components/apps/FileTree";
import HighlightedCode from "@/components/apps/HighlightedCode";
import { generatePackageFiles, generateProjectFiles, slugify } from "@/lib/appsBuilder/codegen";
import { APP_COMPONENT_BY_KIND, APP_COMPONENTS } from "@/lib/appsBuilder/components";
import { generateAppFromPrompt, promptToAppName } from "@/lib/appsBuilder/generator";
import { iconFor } from "@/lib/appsBuilder/iconMap";
import type { AppComponentInstance, AppGeneratedFile } from "@/lib/appsBuilder/types";
import { downloadZip } from "@/lib/appsBuilder/zip";

type AppsView = "visual" | "code";

/**
 * Apps Builder Mode workspace. A visual component palette on the left, a
 * WYSIWYG canvas in the center, and a properties inspector on the right.
 * The canvas doubles as a real code generator: switch to Code Preview to
 * browse the generated Vite + React project, or export it as a runnable
 * project/package. An AI prompt bar builds an app from a plain-English
 * description.
 */
export function AppsBuilder() {
  const [canvas, setCanvas] = useState<AppComponentInstance[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<AppsView>("visual");
  const [selectedFile, setSelectedFile] = useState<string>("src/App.tsx");
  const [appName, setAppName] = useState("My App");
  const [prompt, setPrompt] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  const selected = useMemo(
    () => canvas.find((component) => component.id === selectedId) ?? null,
    [canvas, selectedId],
  );

  const projectFiles = useMemo(() => generateProjectFiles(canvas), [canvas]);
  const packageFiles = useMemo(() => generatePackageFiles(canvas, appName), [canvas, appName]);

  function add(kind: AppComponentInstance["kind"]) {
    const definition = APP_COMPONENT_BY_KIND.get(kind);
    if (!definition) return;
    const component: AppComponentInstance = {
      id: `app-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      label: definition.name,
      props: { ...definition.defaultProps },
    };
    setCanvas((prev) => [...prev, component]);
    setSelectedId(component.id);
  }

  function updateSelected(patch: Partial<AppComponentInstance>) {
    if (!selectedId) return;
    setCanvas((prev) =>
      prev.map((component) =>
        component.id === selectedId ? { ...component, ...patch } : component,
      ),
    );
  }

  function removeSelected() {
    if (!selectedId) return;
    setCanvas((prev) => prev.filter((component) => component.id !== selectedId));
    setSelectedId(null);
  }

  function generateFromPrompt() {
    const generated = generateAppFromPrompt(prompt);
    setCanvas(generated);
    setSelectedId(null);
    setAppName(promptToAppName(prompt));
    setView("visual");
    setPrompt("");
    toast.success(generated.length > 0 ? "App generated" : "Describe an app to generate one");
  }

  function handleExport(kind: "project" | "package") {
    const slug = slugify(appName);
    try {
      if (kind === "project") {
        downloadZip(projectFiles, `${slug}-app.zip`);
        toast.success("Project zip exported — ready for npm install");
      } else {
        downloadZip(packageFiles, `${slug}-npm-package.zip`);
        toast.success("npm package exported");
      }
    } catch {
      toast.error("Export failed");
    }
    setExportOpen(false);
  }

  function selectFile(path: string) {
    setSelectedFile(path);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card px-3">
        <span className="text-[11px] font-semibold text-foreground">
          Apps Builder
          <span className="ml-1.5 font-normal text-muted-foreground">· {appName}</span>
        </span>

        <div className="mx-auto flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5">
          <button
            type="button"
            data-testid="view-visual"
            onClick={() => setView("visual")}
            className={`flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors ${
              view === "visual"
                ? "bg-accent/20 text-foreground"
                : "text-muted-foreground hover:bg-hover/12"
            }`}
          >
            <LayoutTemplate aria-hidden="true" size={12} />
            Visual Builder
          </button>
          <button
            type="button"
            data-testid="view-code"
            onClick={() => {
              setView("code");
              setSelectedFile("src/App.tsx");
            }}
            className={`flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors ${
              view === "code"
                ? "bg-accent/20 text-foreground"
                : "text-muted-foreground hover:bg-hover/12"
            }`}
          >
            <Code2 aria-hidden="true" size={12} />
            Code Preview
          </button>
        </div>

        <div className="relative">
          <button
            type="button"
            data-testid="export-app"
            onClick={() => setExportOpen((prev) => !prev)}
            className="flex h-6 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-hover/12"
            title="Export the generated app"
          >
            <Download aria-hidden="true" size={12} />
            Export App
          </button>
          {exportOpen && (
            <div
              role="menu"
              data-testid="export-menu"
              className="animate-fade-in-up absolute right-0 top-8 z-50 w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                data-testid="export-project-zip"
                onClick={() => handleExport("project")}
                className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover/12"
              >
                <span className="text-[11px] font-medium">Export Project Zip</span>
                <span className="text-[10px] text-muted-foreground">
                  Runnable Vite + React project, ready for `npm install`
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="export-npm-package"
                onClick={() => handleExport("package")}
                className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover/12"
              >
                <span className="text-[11px] font-medium">Create npm Package</span>
                <span className="text-[10px] text-muted-foreground">
                  Publishable package with index.ts and a tsc build script
                </span>
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {view === "visual" ? (
          <VisualBuilder
            canvas={canvas}
            selected={selected}
            selectedId={selectedId}
            onAdd={add}
            onSelect={setSelectedId}
            onUpdate={updateSelected}
            onRemove={removeSelected}
          />
        ) : (
          <CodePreview files={projectFiles} selectedFile={selectedFile} onSelectFile={selectFile} />
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border/60 bg-card px-3 py-2">
        <Sparkles aria-hidden="true" size={14} className="shrink-0 text-accent" />
        <input
          data-testid="app-prompt-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") generateFromPrompt();
          }}
          placeholder="Describe the app or component you want to build…"
          className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button
          type="button"
          data-testid="generate-app"
          onClick={generateFromPrompt}
          disabled={prompt.trim().length === 0}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[11px] font-semibold text-accent-foreground transition-opacity disabled:opacity-40"
        >
          <Braces aria-hidden="true" size={12} />
          Generate
        </button>
      </footer>
    </div>
  );
}

function VisualBuilder({
  canvas,
  selected,
  selectedId,
  onAdd,
  onSelect,
  onUpdate,
  onRemove,
}: {
  canvas: AppComponentInstance[];
  selected: AppComponentInstance | null;
  selectedId: string | null;
  onAdd: (kind: AppComponentInstance["kind"]) => void;
  onSelect: (id: string) => void;
  onUpdate: (patch: Partial<AppComponentInstance>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-48 shrink-0 flex-col border-r bg-card">
        <div className="flex h-9 items-center border-b px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Components
          </span>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {APP_COMPONENTS.map((definition) => {
            const Icon = iconFor(definition.icon);
            return (
              <button
                key={definition.kind}
                type="button"
                onClick={() => onAdd(definition.kind)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover/12"
                title={definition.description}
              >
                <Icon aria-hidden="true" size={13} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium">{definition.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {definition.description}
                  </span>
                </span>
                <Plus aria-hidden="true" size={12} className="shrink-0 text-muted-foreground/60" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-9 items-center justify-between border-b px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Canvas
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {canvas.length} {canvas.length === 1 ? "component" : "components"}
          </span>
        </div>
        <div className="app-scrollbar flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-3 rounded-xl border bg-card/40 p-4">
            {canvas.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
                <p className="text-xs font-medium text-foreground">Drop a component to begin</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Pick one from the palette, or describe an app below and hit Generate.
                </p>
              </div>
            ) : (
              canvas.map((component) => (
                <CanvasPreview
                  key={component.id}
                  component={component}
                  selected={component.id === selectedId}
                  onSelect={() => onSelect(component.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex w-56 shrink-0 flex-col border-l bg-card">
        <div className="flex h-9 items-center justify-between border-b px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Properties
          </span>
          {selected && (
            <button
              type="button"
              onClick={onRemove}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="Remove component"
            >
              <Trash2 aria-hidden="true" size={12} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {selected ? (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Component
                </span>
                <input
                  value={selected.label}
                  onChange={(event) => onUpdate({ label: event.target.value })}
                  className="h-8 w-full rounded-md border bg-background px-2.5 text-xs focus:outline-none"
                />
              </label>
              <div className="border-t border-border/60 pt-3">
                {APP_COMPONENT_BY_KIND.get(selected.kind)?.propsSchema.map((prop) => (
                  <label
                    key={prop.key}
                    htmlFor={`prop-${selected.id}-${prop.key}`}
                    className="mb-2 block"
                  >
                    <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      {prop.label}
                    </span>
                    {prop.type === "textarea" ? (
                      <textarea
                        id={`prop-${selected.id}-${prop.key}`}
                        value={selected.props[prop.key] ?? ""}
                        onChange={(event) =>
                          onUpdate({
                            props: { ...selected.props, [prop.key]: event.target.value },
                          })
                        }
                        rows={3}
                        className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none"
                      />
                    ) : (
                      <input
                        id={`prop-${selected.id}-${prop.key}`}
                        value={selected.props[prop.key] ?? ""}
                        onChange={(event) =>
                          onUpdate({
                            props: { ...selected.props, [prop.key]: event.target.value },
                          })
                        }
                        placeholder={prop.placeholder}
                        className="h-8 w-full rounded-md border bg-background px-2.5 text-xs placeholder:text-muted-foreground/40 focus:outline-none"
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Select a component on the canvas to edit its properties.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CodePreview({
  files,
  selectedFile,
  onSelectFile,
}: {
  files: AppGeneratedFile[];
  selectedFile: string;
  onSelectFile: (path: string) => void;
}) {
  const active = files.find((file) => file.path === selectedFile) ?? files[0];

  return (
    <div className="flex min-h-0 flex-1">
      <FileTree files={files} selectedPath={active?.path ?? ""} onSelect={onSelectFile} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
          <span className="text-[11px] font-medium text-foreground">{active?.path}</span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {files.length} {files.length === 1 ? "file" : "files"} · read-only
          </span>
        </div>
        {active ? (
          <HighlightedCode path={active.path} code={active.content} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            Add components to generate project files.
          </div>
        )}
      </div>
    </div>
  );
}

function CanvasPreview({
  component,
  selected,
  onSelect,
}: {
  component: AppComponentInstance;
  selected: boolean;
  onSelect: () => void;
}) {
  const ring = selected
    ? "ring-2 ring-accent/60 border-accent/60"
    : "border-border hover:border-accent/40";
  const style = {
    fontSize: component.props.size,
    fontWeight: component.props.weight,
    color: component.props.color,
    backgroundColor: component.props.bg,
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border bg-background text-left transition-shadow ${ring}`}
    >
      <div className="px-3 py-2.5" style={style}>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {component.label}
        </p>
        <PreviewBody component={component} />
      </div>
    </button>
  );
}

function PreviewBody({ component }: { component: AppComponentInstance }) {
  switch (component.kind) {
    case "heading":
      return (
        <p style={{ fontSize: component.props.size, fontWeight: component.props.weight }}>
          {component.props.text}
        </p>
      );
    case "text":
      return (
        <p style={{ fontSize: component.props.size, fontWeight: component.props.weight }}>
          {component.props.text}
        </p>
      );
    case "button":
      return (
        <span
          className="inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
          style={{ backgroundColor: component.props.color }}
        >
          {component.props.text}
        </span>
      );
    case "card":
      return (
        <div className="rounded-md border border-border/60 bg-background/70 p-3">
          <p className="text-xs font-semibold">{component.props.title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{component.props.body}</p>
        </div>
      );
    case "image":
      return (
        <div className="rounded-md border border-dashed border-border/70 bg-background/50 px-3 py-4 text-center">
          <p className="text-[11px] text-muted-foreground">{component.props.caption || "Image"}</p>
        </div>
      );
    case "input":
      return (
        <div>
          <p className="mb-1 text-[10px] text-muted-foreground">{component.props.label}</p>
          <div className="h-7 rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground/60">
            {component.props.placeholder}
          </div>
        </div>
      );
    case "list":
      return (
        <ul className="space-y-1">
          {(component.props.items ?? "")
            .split("\n")
            .filter(Boolean)
            .map((item, index) => (
              <li key={index} className="text-[11px] text-muted-foreground">
                {item}
              </li>
            ))}
        </ul>
      );
  }
}

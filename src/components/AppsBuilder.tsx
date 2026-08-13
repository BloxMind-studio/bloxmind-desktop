import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { APP_COMPONENT_BY_KIND, APP_COMPONENTS } from "@/lib/appsBuilder/components";
import { iconFor } from "@/lib/appsBuilder/iconMap";
import type { AppComponentInstance } from "@/lib/appsBuilder/types";

/**
 * Apps Builder Mode workspace. A visual component palette on the left, a
 * WYSIWYG canvas in the center, and a properties inspector on the right.
 */
export function AppsBuilder() {
  const [canvas, setCanvas] = useState<AppComponentInstance[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => canvas.find((component) => component.id === selectedId) ?? null,
    [canvas, selectedId],
  );

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
                onClick={() => add(definition.kind)}
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
                  Pick one from the palette on the left.
                </p>
              </div>
            ) : (
              canvas.map((component) => (
                <CanvasPreview
                  key={component.id}
                  component={component}
                  selected={component.id === selectedId}
                  onSelect={() => setSelectedId(component.id)}
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
              onClick={removeSelected}
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
                  onChange={(event) => updateSelected({ label: event.target.value })}
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
                          updateSelected({
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
                          updateSelected({
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useAllModels, useConnectedProviders } from "@/hooks/useProviders";
import { useModelPreferences } from "@/providers/PreferencesProvider";
import type { ModelInfo } from "@/types";

/**
 * Compact model switcher for tool surfaces (e.g. the App Studio's AI chat).
 * Mirrors the model picker in the Roblox chat: provider-grouped, searchable,
 * with status badges, filtered to connected providers.
 */
export function ModelPicker({
  align = "start",
  size = "md",
  placement = "up",
}: {
  /** Dropdown alignment relative to the trigger. */
  align?: "start" | "end";
  size?: "sm" | "md";
  /** Whether the dropdown opens above or below the trigger. */
  placement?: "up" | "down";
}) {
  const allModels = useAllModels();
  const connectedProviders = useConnectedProviders();
  const { selectedModel, hiddenModels, setSelectedModel } = useModelPreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  const groups = useMemo(() => {
    const POPULAR = [
      "opencode",
      "anthropic",
      "github-copilot",
      "openai",
      "google",
      "openrouter",
      "vercel",
    ];
    const q = query.toLowerCase().trim();
    const grouped: Record<string, { providerName: string; models: ModelInfo[] }> = {};
    for (const model of allModels) {
      if (!connectedProviders.includes(model.providerId)) continue;
      const modelKey = `${model.providerId}/${model.id}`;
      if (hiddenModels.has(modelKey)) continue;
      if (q) {
        const haystack = `${model.name} ${model.id} ${model.providerName}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      if (!grouped[model.providerId]) {
        grouped[model.providerId] = { providerName: model.providerName, models: [] };
      }
      grouped[model.providerId].models.push(model);
    }
    for (const group of Object.values(grouped)) {
      group.models.sort((a, b) => a.name.localeCompare(b.name));
    }
    const entries = Object.entries(grouped);
    entries.sort(([aId], [bId]) => {
      const aIdx = POPULAR.indexOf(aId);
      const bIdx = POPULAR.indexOf(bId);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return grouped[aId].providerName.localeCompare(grouped[bId].providerName);
    });
    return entries;
  }, [allModels, connectedProviders, hiddenModels, query]);

  const modelDisplay = selectedModel
    ? (selectedModel.split("/").pop() ?? selectedModel)
    : "Select model";

  function select(model: ModelInfo) {
    setSelectedModel(`${model.providerId}/${model.id}`);
    setOpen(false);
    setQuery("");
  }

  const compact = size === "sm";

  return (
    <div className="relative" ref={pickerRef} data-testid="model-picker">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 rounded-lg text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-hover/12 ${
          compact ? "px-2 py-1" : "px-2.5 py-1.5"
        }`}
      >
        <svg
          width={compact ? 9 : 10}
          height={compact ? 9 : 10}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
        </svg>
        <span className="max-w-32 truncate">{modelDisplay}</span>
        <svg
          width={compact ? 8 : 9}
          height={compact ? 8 : 9}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          data-testid="model-picker-dropdown"
          className={`absolute z-50 flex flex-col rounded-lg border bg-popover shadow-lg ${
            align === "end" ? "right-0" : "left-0"
          }`}
          style={
            placement === "down"
              ? { top: "calc(100% + 4px)", width: 256, maxHeight: 320 }
              : { bottom: "calc(100% + 4px)", width: 256, maxHeight: 320 }
          }
        >
          <div className="shrink-0 border-b px-2 py-1.5">
            <div className="flex items-center gap-1.5 rounded-md border bg-background px-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-muted-foreground/50"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models..."
                className="h-7 w-full bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none focus-visible:outline-none! focus-visible:ring-0! focus:shadow-none"
                // biome-ignore lint/a11y/noAutofocus: focus the search field when the picker opens
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground"
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {groups.map(([providerId, group]) => (
              <div key={providerId}>
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.providerName}
                  </span>
                </div>
                {group.models.map((model) => {
                  const fullId = `${model.providerId}/${model.id}`;
                  const isSelected = selectedModel === fullId;
                  return (
                    <button
                      key={fullId}
                      type="button"
                      onClick={() => select(model)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                        isSelected
                          ? "bg-selected/12 font-medium text-selected-foreground"
                          : "text-muted-foreground hover:bg-hover/12"
                      }`}
                    >
                      <span className="truncate">{model.name}</span>
                      {statusBadge(model.status)}
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                No models matching "{query}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function statusBadge(status?: ModelInfo["status"]) {
  if (status === "beta")
    return (
      <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
        beta
      </span>
    );
  if (status === "alpha")
    return (
      <span className="shrink-0 rounded bg-purple-100 px-1 text-[9px] font-medium text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
        alpha
      </span>
    );
  if (status === "deprecated")
    return (
      <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-medium text-muted-foreground">
        deprecated
      </span>
    );
  return null;
}

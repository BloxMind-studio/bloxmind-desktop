import { useEffect, useMemo, useRef, useState } from "react";
import { POPULAR_PROVIDERS } from "@/components/settings/constants";
import { useAllModels, useConnectedProviders } from "@/hooks/useProviders";
import { useModelPreferences } from "@/providers/PreferencesProvider";
import type { ModelInfo } from "@/types";

export function ModelsTab() {
  const allModels = useAllModels();
  const connectedProviders = useConnectedProviders();
  const { hiddenModels, toggleModelVisibility } = useModelPreferences();

  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Group models by provider (only connected providers), filtered by search
  const modelsByProvider = useMemo(() => {
    const query = search.toLowerCase().trim();
    const groups: Record<string, { providerName: string; models: ModelInfo[] }> = {};

    for (const model of allModels) {
      // Only show models from connected providers
      if (!connectedProviders.includes(model.providerId)) continue;

      // Filter by search
      if (query) {
        const haystack = `${model.name} ${model.id} ${model.providerName}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }

      if (!groups[model.providerId]) {
        groups[model.providerId] = {
          providerName: model.providerName,
          models: [],
        };
      }
      groups[model.providerId].models.push(model);
    }

    // Sort models within each group
    for (const group of Object.values(groups)) {
      group.models.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Sort provider groups: popular first, then alphabetical
    const entries = Object.entries(groups);
    entries.sort(([aId], [bId]) => {
      const aPopular = POPULAR_PROVIDERS.includes(aId);
      const bPopular = POPULAR_PROVIDERS.includes(bId);
      if (aPopular && !bPopular) return -1;
      if (!aPopular && bPopular) return 1;
      if (aPopular && bPopular) {
        return POPULAR_PROVIDERS.indexOf(aId) - POPULAR_PROVIDERS.indexOf(bId);
      }
      return groups[aId].providerName.localeCompare(groups[bId].providerName);
    });

    return entries;
  }, [allModels, connectedProviders, search]);

  const totalModels = allModels.filter((m) => connectedProviders.includes(m.providerId)).length;

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Models</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Toggle which models appear in the model selector.
      </p>

      {/* Search */}
      <div className="mt-4">
        <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5">
          <svg
            width="13"
            height="13"
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            className="h-8 flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none focus-visible:outline-none! focus-visible:ring-0! focus:shadow-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
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

      {/* Model groups */}
      <div className="mt-5 space-y-6">
        {modelsByProvider.map(([providerId, group]) => (
          <div key={providerId}>
            <div className="flex items-center gap-2 pb-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-selected/12 text-[10px] font-semibold text-selected-foreground">
                {group.providerName.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm font-medium">{group.providerName}</span>
            </div>
            <div className="rounded-lg border bg-card">
              {group.models.map((model, idx) => {
                const modelKey = `${model.providerId}/${model.id}`;
                const isVisible = !hiddenModels.has(modelKey);
                return (
                  <div key={modelKey}>
                    {idx > 0 && <div className="mx-3.5 h-px bg-border" />}
                    <button
                      type="button"
                      onClick={() => toggleModelVisibility(modelKey)}
                      className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
                    >
                      <span className="truncate text-xs">{model.name}</span>
                      {/* Toggle switch */}
                      <span
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          isVisible ? "bg-foreground" : "bg-border"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                            isVisible ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {modelsByProvider.length === 0 && totalModels > 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            No models matching &quot;{search}&quot;
          </div>
        )}

        {totalModels === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            Connect a provider to see available models.
          </div>
        )}
      </div>
    </div>
  );
}

import posthog from "posthog-js/dist/module.full.no-external.js";
import { useState } from "react";
import { toast } from "sonner";
import { useEnhanceMapBrief } from "@/hooks/mutations/useEnhanceMapBrief";
import { useSendMessage } from "@/hooks/mutations/useSendMessage";
import {
  analyticsProperties,
  detailedAnalyticsProperties,
  errorAnalyticsProperties,
} from "@/lib/analytics";
import { formatMapPrompt, MAP_MODES, type MapMode, type MapRequest } from "@/lib/mapRequest";
import { splitModelKey } from "@/lib/splitModelKey";
import { useModelPreferences } from "@/providers/PreferencesProvider";

function mapErrorCategory(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (error.message.includes("chat")) return "no_chat_context";
  if (error.message.includes("invalid") || error.message.includes("empty")) return "invalid_brief";
  if (error.message.includes("start")) return "map_start_failed";
  return "map_failed";
}

function ChipRow<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: readonly { id: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {items.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            title={option.hint}
            className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              value === option.id
                ? "border-foreground bg-foreground text-background"
                : "bg-background text-foreground hover:bg-hover/12"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .flatMap((line) => line.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function MapPanel({ onClose }: { onClose: () => void }) {
  const sendMessage = useSendMessage();
  const enhance = useEnhanceMapBrief();
  const { selectedModel } = useModelPreferences();
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<MapMode>("arena");
  const [playerCount, setPlayerCount] = useState("");
  const [traversalTime, setTraversalTime] = useState("");
  const [themePillars, setThemePillars] = useState("");
  const [landmarks, setLandmarks] = useState("");
  const [zones, setZones] = useState("");
  const [notes, setNotes] = useState("");

  const [provider, model] = selectedModel ? splitModelKey(selectedModel) : [undefined, undefined];

  async function enhanceBrief() {
    if (!brief.trim() || enhance.isPending) return;
    const startedAt = performance.now();
    posthog.capture(
      "map_enhance_started",
      analyticsProperties("map", detailedAnalyticsProperties({ provider, model, mode })),
    );
    try {
      const enhanced = await enhance.mutateAsync({ brief, mode });
      if ("brief" in enhanced) setBrief(enhanced.brief);
      if (enhanced.playerCount) setPlayerCount(enhanced.playerCount);
      if (enhanced.traversalTime) setTraversalTime(enhanced.traversalTime);
      if (enhanced.themePillars) setThemePillars(enhanced.themePillars);
      if (enhanced.landmarks) setLandmarks(enhanced.landmarks);
      if (enhanced.zones) setZones(enhanced.zones);
      if (enhanced.notes) setNotes(enhanced.notes);
      posthog.capture(
        "map_enhance_succeeded",
        analyticsProperties(
          "map",
          detailedAnalyticsProperties({
            outcome: "success",
            provider,
            model,
            duration_ms: Math.round(performance.now() - startedAt),
          }),
        ),
      );
    } catch (error) {
      posthog.capture(
        "map_enhance_failed",
        errorAnalyticsProperties(
          "map",
          "brief_enhancement",
          error,
          detailedAnalyticsProperties({
            provider,
            model,
            duration_ms: Math.round(performance.now() - startedAt),
            error_category: mapErrorCategory(error),
          }),
        ),
      );
      toast.error("Couldn't enhance the description", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  }

  function generateMapPlan() {
    if (!brief.trim()) {
      toast.error("Describe the map before generating a plan.");
      return;
    }
    const request: MapRequest = {
      brief,
      mode,
      playerCount,
      traversalTime,
      themePillars: splitLines(themePillars),
      landmarks: splitLines(landmarks),
      zones: splitLines(zones),
      notes,
    };
    posthog.capture(
      "map_plan_generation_started",
      analyticsProperties("map", detailedAnalyticsProperties({ provider, model, mode })),
    );
    sendMessage.mutate(
      { text: formatMapPrompt(request) },
      {
        onSuccess: () => {
          posthog.capture(
            "map_plan_generation_succeeded",
            analyticsProperties(
              "map",
              detailedAnalyticsProperties({ outcome: "success", provider, model, mode }),
            ),
          );
          onClose();
        },
        onError: (error) => {
          posthog.capture(
            "map_plan_generation_failed",
            errorAnalyticsProperties(
              "map",
              "map_plan_request",
              error,
              detailedAnalyticsProperties({
                provider,
                model,
                mode,
                error_category: mapErrorCategory(error),
              }),
            ),
          );
          toast.error("Map request not sent", {
            description: error instanceof Error ? error.message : "Try again.",
          });
        },
      },
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-sidebar" aria-label="Map planning">
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Map
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted-foreground hover:bg-hover/12"
          aria-label="Close map planner"
        >
          X
        </button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Map brief
          </span>
          <textarea
            aria-label="Map brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="A dusk-lit neon arena with a central tower and safe outer lanes..."
            className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-ring"
          />
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            Give the player fantasy first, then let the plan turn it into zones and flow.
          </p>
          <button
            type="button"
            onClick={enhanceBrief}
            disabled={enhance.isPending || !brief.trim()}
            className="mt-2 text-[11px] font-medium text-muted-foreground transition-colors disabled:opacity-50"
          >
            {enhance.isPending ? "Enhancing..." : "Enhance with AI"}
          </button>
        </div>

        <ChipRow label="Map mode" items={MAP_MODES} value={mode} onChange={setMode} />

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Player count
          </span>
          <input
            aria-label="Player count"
            value={playerCount}
            onChange={(event) => setPlayerCount(event.target.value)}
            placeholder="8 players, 20 players, solo, etc."
            className="w-full rounded-md border bg-background px-2.5 py-2 text-xs outline-none focus:border-ring"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Traversal time
          </span>
          <input
            aria-label="Traversal time"
            value={traversalTime}
            onChange={(event) => setTraversalTime(event.target.value)}
            placeholder="2-3 minutes, 45 seconds, long loop"
            className="w-full rounded-md border bg-background px-2.5 py-2 text-xs outline-none focus:border-ring"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Theme pillars
          </span>
          <textarea
            aria-label="Theme pillars"
            value={themePillars}
            onChange={(event) => setThemePillars(event.target.value)}
            placeholder="overgrown ruins, neon dusk, glass water"
            className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-ring"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Landmarks
          </span>
          <textarea
            aria-label="Landmarks"
            value={landmarks}
            onChange={(event) => setLandmarks(event.target.value)}
            placeholder="central tower, broken bridge, spawn vista"
            className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-ring"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Zones
          </span>
          <textarea
            aria-label="Zones"
            value={zones}
            onChange={(event) => setZones(event.target.value)}
            placeholder="spawn, intro vista, main loop, high ground, secret route"
            className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-ring"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Notes
          </span>
          <textarea
            aria-label="Map notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Make the main route readable from spawn; keep the arena fair for 4v4."
            className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-ring"
          />
        </label>
      </div>
      <footer className="border-t px-5 py-4">
        <p className="mb-3 text-[11px] leading-4 text-muted-foreground">
          BloxMind will tell the agent to plan the world before any blockout or terrain work starts.
        </p>
        <button
          type="button"
          onClick={generateMapPlan}
          disabled={sendMessage.isPending || enhance.isPending}
          className="w-full rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {sendMessage.isPending ? "Sending..." : "Generate map plan"}
        </button>
      </footer>
    </aside>
  );
}

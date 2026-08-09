import posthog from "posthog-js/dist/module.full.no-external.js";
import { useState } from "react";
import { toast } from "sonner";
import { useEnhanceMeshBrief } from "@/hooks/mutations/useEnhanceMeshBrief";
import { useSendMessage } from "@/hooks/mutations/useSendMessage";
import {
  analyticsProperties,
  detailedAnalyticsProperties,
  errorAnalyticsProperties,
} from "@/lib/analytics";
import { formatMeshPrompt, MESH_STYLES, type MeshRequest, type MeshStyle } from "@/lib/meshRequest";
import { splitModelKey } from "@/lib/splitModelKey";
import { useModelPreferences } from "@/providers/PreferencesProvider";

function enhanceErrorCategory(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (error.message.includes("chat")) return "no_chat_context";
  if (error.message.includes("invalid") || error.message.includes("empty")) {
    return "invalid_enhancement";
  }
  if (error.message.includes("start")) return "enhancer_start_failed";
  return "enhancement_failed";
}

export default function MeshPanel({ onClose }: { onClose: () => void }) {
  const sendMessage = useSendMessage();
  const enhance = useEnhanceMeshBrief();
  const { selectedModel } = useModelPreferences();
  const [brief, setBrief] = useState("");
  const [style, setStyle] = useState<MeshStyle>("blocky");
  const [maxSize, setMaxSize] = useState("");
  const [segments, setSegments] = useState("");

  const [provider, model] = selectedModel ? splitModelKey(selectedModel) : [undefined, undefined];

  async function enhanceBrief() {
    if (!brief.trim() || enhance.isPending) return;
    const startedAt = performance.now();
    posthog.capture(
      "mesh_enhance_started",
      analyticsProperties("mesh", detailedAnalyticsProperties({ provider, model, style })),
    );
    try {
      const enhanced = await enhance.mutateAsync({ brief, style });
      setBrief(enhanced);
      posthog.capture(
        "mesh_enhance_succeeded",
        analyticsProperties(
          "mesh",
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
        "mesh_enhance_failed",
        errorAnalyticsProperties(
          "mesh",
          "brief_enhancement",
          error,
          detailedAnalyticsProperties({
            provider,
            model,
            duration_ms: Math.round(performance.now() - startedAt),
            error_category: enhanceErrorCategory(error),
          }),
        ),
      );
      toast.error("Couldn't enhance the description", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  }

  function generateMesh() {
    if (!brief.trim()) {
      toast.error("Describe the mesh before generating it.");
      return;
    }
    const request: MeshRequest = {
      brief,
      style,
      maxSize,
      segments: segments
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean),
    };
    posthog.capture(
      "mesh_generation_started",
      analyticsProperties("mesh", detailedAnalyticsProperties({ provider, model, style })),
    );
    sendMessage.mutate(
      { text: formatMeshPrompt(request) },
      {
        onSuccess: onClose,
        onError: (error) =>
          toast.error("Mesh request not sent", {
            description: error instanceof Error ? error.message : "Try again.",
          }),
      },
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-sidebar" aria-label="Mesh generator">
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Mesh
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close mesh generator"
        >
          ×
        </button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </span>
          <textarea
            aria-label="Mesh description"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="A cute cartoon alien with a big head and glowing eyes…"
            className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-ring"
          />
          <button
            type="button"
            onClick={enhanceBrief}
            disabled={enhance.isPending || !brief.trim()}
            className="mt-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {enhance.isPending ? "Enhancing…" : "Enhance with AI"}
          </button>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Style
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {MESH_STYLES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setStyle(option.id)}
                aria-pressed={style === option.id}
                title={option.hint}
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  style === option.id
                    ? "border-foreground bg-foreground text-background"
                    : "bg-background text-foreground hover:bg-accent"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Approximate size (optional)
          </span>
          <input
            aria-label="Approximate size"
            value={maxSize}
            onChange={(event) => setMaxSize(event.target.value)}
            placeholder="2 studs tall"
            className="w-full rounded-md border bg-background px-2.5 py-2 text-xs outline-none focus:border-ring"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Segments (optional)
          </span>
          <input
            aria-label="Segments"
            value={segments}
            onChange={(event) => setSegments(event.target.value)}
            placeholder="body, head, arms"
            className="w-full rounded-md border bg-background px-2.5 py-2 text-xs outline-none focus:border-ring"
          />
          <span className="mt-1.5 block text-[11px] leading-4 text-muted-foreground">
            Named parts make the mesh easier for the agent to rig or script later.
          </span>
        </label>
      </div>
      <footer className="border-t px-5 py-4">
        <p className="mb-3 text-[11px] leading-4 text-muted-foreground">
          Mesh generation can take a few minutes. BloxMind instructs the agent to verify results
          instead of blindly retrying after a timeout.
        </p>
        <button
          type="button"
          onClick={generateMesh}
          disabled={sendMessage.isPending || enhance.isPending}
          className="w-full rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {sendMessage.isPending ? "Sending…" : "Generate mesh"}
        </button>
      </footer>
    </aside>
  );
}

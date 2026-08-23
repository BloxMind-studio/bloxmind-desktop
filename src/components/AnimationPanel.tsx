import posthog from "posthog-js/dist/module.full.no-external.js";
import { useState } from "react";
import { toast } from "sonner";
import { useEnhanceAnimationBrief } from "@/hooks/mutations/useEnhanceAnimationBrief";
import { useSendMessage } from "@/hooks/mutations/useSendMessage";
import {
  analyticsProperties,
  detailedAnalyticsProperties,
  errorAnalyticsProperties,
} from "@/lib/analytics";
import {
  ANIMATION_KINDS,
  ANIMATION_RIGS,
  type AnimationKind,
  type AnimationRig,
  formatAnimationPrompt,
} from "@/lib/animationRequest";
import { splitModelKey } from "@/lib/splitModelKey";
import { useModelPreferences } from "@/providers/PreferencesProvider";

function animationErrorCategory(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (error.message.includes("chat")) return "no_chat_context";
  if (error.message.includes("invalid") || error.message.includes("empty")) {
    return "invalid_brief";
  }
  if (error.message.includes("start")) return "animation_start_failed";
  return "animation_failed";
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

export default function AnimationPanel({ onClose }: { onClose: () => void }) {
  const sendMessage = useSendMessage();
  const enhance = useEnhanceAnimationBrief();
  const { selectedModel } = useModelPreferences();
  const [brief, setBrief] = useState("");
  const [kind, setKind] = useState<AnimationKind>("combat combo");
  const [rig, setRig] = useState<AnimationRig>("r15");
  const [duration, setDuration] = useState("");
  const [loop, setLoop] = useState(false);
  const [beats, setBeats] = useState("");
  const [notes, setNotes] = useState("");

  const [provider, model] = selectedModel ? splitModelKey(selectedModel) : [undefined, undefined];

  async function enhanceBrief() {
    if (!brief.trim() || enhance.isPending) return;
    const startedAt = performance.now();
    posthog.capture(
      "animation_enhance_started",
      analyticsProperties("animation", detailedAnalyticsProperties({ provider, model, kind, rig })),
    );
    try {
      const enhanced = await enhance.mutateAsync({ brief, kind, rig });
      if ("brief" in enhanced) setBrief(enhanced.brief);
      if (enhanced.duration) setDuration(enhanced.duration);
      if (enhanced.beats) setBeats(enhanced.beats);
      if (enhanced.notes) setNotes(enhanced.notes);
      posthog.capture(
        "animation_enhance_succeeded",
        analyticsProperties(
          "animation",
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
        "animation_enhance_failed",
        errorAnalyticsProperties(
          "animation",
          "brief_enhancement",
          error,
          detailedAnalyticsProperties({
            provider,
            model,
            duration_ms: Math.round(performance.now() - startedAt),
            error_category: animationErrorCategory(error),
          }),
        ),
      );
      toast.error("Couldn't enhance the description", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  }

  function generateAnimation() {
    if (!brief.trim()) {
      toast.error("Describe the animation before generating it.");
      return;
    }
    const request = {
      brief,
      kind,
      rig,
      duration,
      loop,
      beats: beats
        .split("\n")
        .flatMap((line) => line.split(","))
        .map((beat) => beat.trim())
        .filter(Boolean),
      notes,
    };
    posthog.capture(
      "animation_generation_started",
      analyticsProperties("animation", detailedAnalyticsProperties({ provider, model, kind, rig })),
    );
    sendMessage.mutate(
      { text: formatAnimationPrompt(request) },
      {
        onSuccess: () => {
          posthog.capture(
            "animation_generation_succeeded",
            analyticsProperties(
              "animation",
              detailedAnalyticsProperties({ outcome: "success", provider, model, kind, rig }),
            ),
          );
          onClose();
        },
        onError: (error) => {
          posthog.capture(
            "animation_generation_failed",
            errorAnalyticsProperties(
              "animation",
              "animation_request",
              error,
              detailedAnalyticsProperties({
                provider,
                model,
                kind,
                rig,
                error_category: animationErrorCategory(error),
              }),
            ),
          );
          toast.error("Animation request not sent", {
            description: error instanceof Error ? error.message : "Try again.",
          });
        },
      },
    );
  }

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l bg-sidebar"
      aria-label="Animation authoring"
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Animation
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted-foreground hover:bg-hover/12"
          aria-label="Close animation panel"
        >
          X
        </button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            What should it do?
          </span>
          <textarea
            aria-label="Animation brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="A fast dagger combo with a heavy finisher and a clean recovery pose..."
            className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-ring"
          />
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            Be concrete about the motion and the intended gameplay feel.
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

        <ChipRow label="Animation type" items={ANIMATION_KINDS} value={kind} onChange={setKind} />

        <ChipRow label="Rig target" items={ANIMATION_RIGS} value={rig} onChange={setRig} />

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Duration
          </span>
          <input
            aria-label="Duration"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            placeholder="1.2s, 24 frames, or 3 beats"
            className="w-full rounded-md border bg-background px-2.5 py-2 text-xs outline-none focus:border-ring"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-xs">
          <span className="font-medium text-foreground">Loop animation</span>
          <button
            type="button"
            onClick={() => setLoop(!loop)}
            aria-pressed={loop}
            className={`inline-flex h-6 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              loop ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
            }`}
          >
            {loop ? "On" : "Off"}
          </button>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Key beats
          </span>
          <textarea
            aria-label="Key beats"
            value={beats}
            onChange={(event) => setBeats(event.target.value)}
            placeholder="Wind-up, impact, recover\nAdd a pose hold before the finisher"
            className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-ring"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Notes
          </span>
          <textarea
            aria-label="Animation notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Camera-facing pose, no root motion, keep feet planted..."
            className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-ring"
          />
        </label>
      </div>
      <footer className="border-t px-5 py-4">
        <p className="mb-3 text-[11px] leading-4 text-muted-foreground">
          BloxMind will tell the agent to author KeyframeSequences, verify playback, and report the
          rig-specific result.
        </p>
        <button
          type="button"
          onClick={generateAnimation}
          disabled={sendMessage.isPending || enhance.isPending}
          className="w-full rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {sendMessage.isPending ? "Sending..." : "Generate animation"}
        </button>
      </footer>
    </aside>
  );
}

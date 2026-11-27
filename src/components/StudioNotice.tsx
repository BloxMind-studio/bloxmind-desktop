import posthog from "posthog-js/dist/module.full.no-external.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { analyticsProperties } from "@/lib/analytics";
import { desktop } from "@/lib/desktop";
import { placeName, useStudioTargetOptional } from "@/providers/StudioTargetProvider";

const LINK = "shrink-0 text-foreground underline underline-offset-2 hover:opacity-80";

/** Says why this chat has no Studio to work in, right where someone is about to ask it for something. */
export default function StudioNotice({
  onOpenSetup,
  onOpenPicker,
  onWorkedWithoutStudio,
  quiet = false,
}: {
  onOpenSetup: () => void;
  onOpenPicker: () => void;
  onWorkedWithoutStudio?: () => void;
  /**
   * Under way without a Studio, or Studio was skipped: this chat is about something else, so this
   * stays out of it unless there's a place at stake.
   */
  quiet?: boolean;
}) {
  const studioTarget = useStudioTargetOptional();
  const status = studioTarget?.status ?? "loading";
  const selected = studioTarget?.selected ?? null;
  const missing = studioTarget?.missing ?? null;
  const openCount = studioTarget?.targets.length ?? 0;
  const canChoose = openCount > 0;
  const unknownPlace = studioTarget?.unknownPlace ?? false;
  const twins = studioTarget?.twins ?? 0;
  const nameMatch = studioTarget?.nameMatch ?? null;
  const hidden =
    !studioTarget ||
    status === "loading" ||
    selected !== null ||
    studioTarget.withoutStudio ||
    !!studioTarget.selectingKey ||
    (quiet && !missing && !unknownPlace) ||
    // One Studio and no choice yet is the moment before it's picked up.
    (openCount === 1 && !missing && !unknownPlace);

  // The notice going away says nothing to a screen reader, so a return gets said out loud.
  const [returned, setReturned] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState<string | null>(null);
  const autoOpenedRef = useRef<string | null>(null);
  const openTimerRef = useRef<number | undefined>(undefined);
  const wasMissing = useRef(false);

  // A chat remembers the place it worked in. When Studio is connected but
  // that place is closed, reopen it rather than asking someone to find it.
  const reopen = useCallback((target: { placeId?: string | null; label: string } | null) => {
    if (!target?.placeId) return;
    setOpenFailed(null);
    void desktop.openUrl(`roblox://placeId=${encodeURIComponent(target.placeId)}`).catch(() => {});
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => setOpenFailed(target.label), 8_000);
  }, []);

  useEffect(() => {
    if (!missing) {
      autoOpenedRef.current = null;
      setOpenFailed(null);
      window.clearTimeout(openTimerRef.current);
      return;
    }
    if (missing.placeId && autoOpenedRef.current !== missing.placeId) {
      autoOpenedRef.current = missing.placeId;
      reopen(missing);
    }
  }, [missing, reopen]);

  useEffect(() => () => window.clearTimeout(openTimerRef.current), []);
  useEffect(() => {
    if (missing) {
      wasMissing.current = true;
      setReturned(null);
    } else if (selected && wasMissing.current) {
      wasMissing.current = false;
      setReturned(`${placeName(selected.label)} is connected.`);
      // The notice went away with whatever had focus in it.
      if (document.activeElement === document.body) {
        document.querySelector<HTMLElement>('[aria-label="Message"]')?.focus();
      }
    }
  }, [missing, selected]);

  const place = missing ? placeName(missing.label) : null;
  // Studios listed before a failed check can't say the place is closed.
  const unreachable =
    place !== null && (status === "error" || (studioTarget?.discoveryFailed ?? false));
  const message = hidden
    ? null
    : unreachable
      ? "Couldn't reach Studio."
      : openFailed && place
        ? `Couldn't open ${place}. It may be deleted or unavailable.`
        : place && twins > 1
          ? `${twins} places named ${place} are open.`
          : place && nameMatch
            ? `Is the open ${place} this chat's place?`
            : place
              ? canChoose
                ? `${place} isn't open. Reopen it or choose another.`
                : `${place} isn't open. Reopen it to use Studio again.`
              : unknownPlace
                ? canChoose
                  ? "Choose which Studio this chat worked in."
                  : "This chat worked in a Studio that isn't open."
                : canChoose
                  ? "Several Studios are open."
                  : "No Studio connected.";

  // Once each time Show me how appears, so following it always has a showing to count against.
  const offersSteps = message !== null && !canChoose;
  const stepsShown = useRef(false);
  useEffect(() => {
    if (!offersSteps) {
      stepsShown.current = false;
      return;
    }
    if (stepsShown.current) return;
    stepsShown.current = true;
    posthog.capture(
      "studio_target_guidance_shown",
      analyticsProperties("studio_target", { trigger: "notice", status }),
    );
  }, [offersSteps, status]);

  const openSetup = () => {
    posthog.capture(
      "studio_target_guidance_followed",
      analyticsProperties("studio_target", { trigger: "notice", status }),
    );
    onOpenSetup();
  };
  const useMatch = () => {
    if (!nameMatch) return;
    // This button goes away with the question, so focus moves to what comes next.
    void studioTarget?.select(nameMatch).then(() => {
      document.querySelector<HTMLElement>('[aria-label="Message"]')?.focus();
    });
  };
  const workWithoutStudio = () => {
    posthog.capture(
      "studio_target_work_without",
      analyticsProperties("studio_target", { status, had_place: place !== null }),
    );
    studioTarget?.workWithoutStudio();
    setReturned("Working without Studio.");
    onWorkedWithoutStudio?.();
    document.querySelector<HTMLElement>('[aria-label="Message"]')?.focus();
  };

  return (
    <>
      {/* Always in the page, so a screen reader announces it when the words arrive. */}
      <output className="sr-only">{message ?? returned}</output>
      {message ? (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 pb-2 text-xs text-muted-foreground">
          <span aria-hidden="true" className="text-center">
            {message}
          </span>
          {nameMatch && !unreachable ? (
            <button type="button" onClick={useMatch} className={LINK}>
              Use it
            </button>
          ) : null}
          {nameMatch && !unreachable && openCount === 1 ? null : canChoose ? (
            <button type="button" onClick={onOpenPicker} className={LINK}>
              {nameMatch || (place && twins === 0) ? "Choose another" : "Choose one"}
            </button>
          ) : place && !canChoose && !nameMatch ? (
            <button type="button" onClick={() => reopen(missing)} className={LINK}>
              Reopen {place}
            </button>
          ) : (
            <button type="button" onClick={openSetup} className={LINK}>
              {place ? "Open the place in Studio" : "Show me how"}
            </button>
          )}
          <button type="button" onClick={workWithoutStudio} className={LINK}>
            Work without Studio
          </button>
          {studioTarget?.error && status !== "error" && !unreachable ? (
            <p role="alert" className="w-full text-center text-destructive">
              {studioTarget.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

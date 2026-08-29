import { useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import findMcpImage from "@/assets/studio-setup/find-mcp.jpg";
import flipSwitchImage from "@/assets/studio-setup/flip-switch.jpg";
import openAssistantImage from "@/assets/studio-setup/open-assistant.jpg";
import openPlaceImage from "@/assets/studio-setup/open-place.jpg";

const STEPS = [
  {
    title: "Open a place",
    description: "Open any place in Roblox Studio.",
    image: openPlaceImage,
    alt: "The Baseplate template on the Roblox Studio home screen",
    cursorX: 360,
    cursorY: 320,
  },
  {
    title: "Assistant",
    description: "Click Assistant in the top-right corner.",
    image: openAssistantImage,
    alt: "An open Roblox Studio place with the Assistant button in the top-right corner",
    cursorX: 780,
    cursorY: 180,
  },
  {
    title: "Manage MCP Servers",
    description: "Open the ••• menu, then click Manage MCP Servers.",
    image: findMcpImage,
    alt: "The Roblox Studio Assistant menu with Manage MCP Servers selected",
    cursorX: 220,
    cursorY: 400,
  },
  {
    title: "Enable Studio as MCP server",
    description: "Turn on Enable Studio as MCP server.",
    image: flipSwitchImage,
    alt: "Roblox Studio Assistant Settings with Enable Studio as MCP server turned on",
    cursorX: 420,
    cursorY: 240,
  },
] as const;

interface StudioSetupProps {
  connected: boolean;
  checking: boolean;
  onCheck: () => void;
  onContinue: () => void;
}

function StudioSetup({ connected, checking, onCheck, onContinue }: StudioSetupProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  if (connected) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-5">
        <section className="animate-scale-in flex max-w-md flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m5 12 4 4L19 6" />
            </svg>
          </div>
          <h1 className="mt-5 font-serif text-3xl italic">Studio connected</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            BloxMind is in the driver&apos;s seat. You&apos;re ready to build.
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="mt-6 inline-flex h-10 items-center rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Let&apos;s build
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-5">
      <section className="animate-fade-in-up w-full max-w-2xl" aria-labelledby="studio-setup-title">
        <header className="flex items-center gap-4">
          <BloxMindFace />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              One tiny setup
            </p>
            <h1 id="studio-setup-title" className="font-serif text-2xl italic">
              Let&apos;s connect Studio
            </h1>
          </div>
        </header>

        <div className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Step {stepIndex + 1} of {STEPS.length}
              </p>
              <h2 className="mt-0.5 text-base font-semibold">{step.title}</h2>
            </div>
            <div className="flex gap-1.5" aria-hidden="true">
              {STEPS.map((item, index) => (
                <span
                  key={item.title}
                  className={`h-1.5 rounded-full transition-all ${
                    index === stepIndex ? "w-6 bg-foreground" : "w-1.5 bg-foreground/15"
                  }`}
                />
              ))}
            </div>
          </div>

          <StudioScreenshot
            step={stepIndex}
            image={step.image}
            alt={step.alt}
            cursorX={step.cursorX}
            cursorY={step.cursorY}
          />

          <div className="flex items-center justify-between gap-4 border-t px-5 py-3.5">
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {step.description}
            </p>
            <div className="flex shrink-0 gap-2">
              {stepIndex > 0 && (
                <button
                  type="button"
                  onClick={() => setStepIndex((current) => current - 1)}
                  className="h-9 rounded-lg border px-4 text-xs font-medium transition-colors hover:bg-muted"
                >
                  Back
                </button>
              )}
              {stepIndex < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setStepIndex((current) => current + 1)}
                  className="h-9 rounded-lg bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-90"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onCheck}
                  disabled={checking}
                  aria-busy={checking}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {checking && (
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeWidth="3"
                      />
                      <path
                        className="opacity-90"
                        fill="currentColor"
                        d="M21 12a9 9 0 0 0-9-9v3a6 6 0 0 1 6 6h3Z"
                      />
                    </svg>
                  )}
                  {checking ? "Checking..." : "Check again"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          Looking for Roblox Studio
        </div>
      </section>
    </div>
  );
}

function StudioScreenshot({
  step,
  image,
  alt,
  cursorX,
  cursorY,
}: {
  step: number;
  image: string;
  alt: string;
  cursorX: number;
  cursorY: number;
}) {
  const isDev = import.meta.env.DEV;
  const screenshotRef = useRef<HTMLDivElement | null>(null);

  // Dev-only calibration: click anywhere on the screenshot to copy the exact
  // cursorX/cursorY for this step to the clipboard, ready to paste into STEPS.
  // Attached via ref/addEventListener so production keeps zero interactive
  // surface on the static screenshot.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const node = screenshotRef.current;
    if (!node) return;
    const onClick = (event: MouseEvent) => {
      const rect = node.getBoundingClientRect();
      const x = Math.round(event.clientX - rect.left);
      const y = Math.round(event.clientY - rect.top);
      const snippet = `cursorX: ${x},\n    cursorY: ${y},`;
      navigator.clipboard
        ?.writeText(snippet)
        .then(() => toast.success(`Step ${step + 1}: copied ${x}, ${y} — paste into STEPS`))
        .catch(() => toast.info(`Step ${step + 1} cursor: ${x}, ${y}`));
    };
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, [step]);

  return (
    <div
      ref={screenshotRef}
      className={`studio-screenshot studio-screenshot--${step}${isDev ? " cursor-crosshair" : ""}`}
      title={isDev ? "Click to copy the cursor hotspot coordinates" : undefined}
    >
      <div key={image} className="studio-screenshot-camera">
        <img src={image} alt={alt} />
      </div>
      <span
        key={`cursor-${step}`}
        className="studio-screenshot-cursor"
        style={{ left: cursorX, top: cursorY }}
        aria-hidden="true"
      >
        <i />
        <svg width="22" height="26" viewBox="0 0 22 26" fill="none" aria-hidden="true">
          <path
            d="M2.3 1.9 19.2 15c.8.6.4 1.9-.6 2l-7 .7-3.4 6.1c-.5.9-1.8.7-2-.3L.6 3.1c-.3-1.1.8-1.9 1.7-1.2Z"
            fill="white"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}

function BloxMindFace() {
  return (
    <svg
      width="52"
      height="52"
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="BloxMind-face shrink-0"
      aria-hidden="true"
    >
      <g transform="rotate(-15 256 256)">
        <rect x="64" y="64" width="384" height="384" rx="64" fill="currentColor" />
        <rect
          className="BloxMind-eye"
          x="148"
          y="140"
          width="56"
          height="56"
          rx="18"
          fill="var(--background)"
        />
        <rect
          className="BloxMind-eye"
          x="308"
          y="140"
          width="56"
          height="56"
          rx="18"
          fill="var(--background)"
        />
        <path
          d="M172 296C172 296 204 336 256 336C308 336 340 296 340 296"
          stroke="var(--background)"
          strokeWidth="26"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export default StudioSetup;

import { createContext, memo, useContext, useEffect, useMemo, useState } from "react";

// ── Image lightbox ───────────────────────────────────────────────────────

interface LightboxState {
  urls: string[];
  index: number;
}

interface LightboxApi {
  open: (urls: string[], index: number) => void;
}

const LightboxContext = createContext<LightboxApi | null>(null);

export function useLightbox(): LightboxApi {
  const ctx = useContext(LightboxContext);
  return ctx ?? { open: () => {} };
}

export const LightboxProvider = memo(function LightboxProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<LightboxState | null>(null);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const isOpen = state !== null;

  const api = useMemo<LightboxApi>(
    () => ({ open: (urls, index) => setState({ urls, index }) }),
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setState(null);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setState((s) => {
          if (!s || s.urls.length <= 1) return s;
          setSlideDir("left");
          setAnimKey((k) => k + 1);
          return { ...s, index: (s.index + 1) % s.urls.length };
        });
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setState((s) => {
          if (!s || s.urls.length <= 1) return s;
          setSlideDir("right");
          setAnimKey((k) => k + 1);
          return { ...s, index: (s.index - 1 + s.urls.length) % s.urls.length };
        });
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  function goNext() {
    setSlideDir("left");
    setAnimKey((k) => k + 1);
    setState((s) => s && { ...s, index: (s.index + 1) % s.urls.length });
  }

  function goPrev() {
    setSlideDir("right");
    setAnimKey((k) => k + 1);
    setState((s) => s && { ...s, index: (s.index - 1 + s.urls.length) % s.urls.length });
  }

  const slideClass =
    slideDir === "left"
      ? "animate-lightbox-slide-left"
      : slideDir === "right"
        ? "animate-lightbox-slide-right"
        : "animate-lightbox-image";

  return (
    <LightboxContext.Provider value={api}>
      {children}
      {state && (
        <div className="animate-lightbox-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-[#161616]/75 backdrop-blur-sm">
          {/* Backdrop layer: clicking outside the image closes the lightbox.
              Escape + arrow keys are handled by the window listener above. */}
          <button
            type="button"
            aria-label="Close image preview"
            tabIndex={-1}
            onClick={() => setState(null)}
            className="absolute inset-0 h-full w-full cursor-default"
          />
          <button
            type="button"
            aria-label="Close"
            onClick={() => setState(null)}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {state.urls.length > 1 && (
            <button
              type="button"
              aria-label="Previous image"
              onClick={goPrev}
              className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          <img
            key={animKey}
            src={state.urls[state.index]}
            alt={`Attachment ${state.index + 1} of ${state.urls.length}`}
            className={`relative max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl ${slideClass}`}
          />

          {state.urls.length > 1 && (
            <button
              type="button"
              aria-label="Next image"
              onClick={goNext}
              className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}

          {state.urls.length > 1 && (
            <div className="animate-fade-in-up absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-[#161616]/70 px-3 py-1 text-xs font-medium text-[#E6E6E6]/90 backdrop-blur-sm">
              {state.index + 1} / {state.urls.length}
            </div>
          )}
        </div>
      )}
    </LightboxContext.Provider>
  );
});

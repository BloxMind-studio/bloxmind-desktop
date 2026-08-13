import type { Part } from "@opencode-ai/sdk/v2/client";
import { memo } from "react";
import { useLightbox } from "@/components/chat/Lightbox";

// ── User message parts ──────────────────────────────────────────────────

export const UserPartsView = memo(
  function UserPartsView({ parts }: { parts: Part[] }) {
    const { open } = useLightbox();
    const fileParts: Extract<Part, { type: "file" }>[] = [];
    const textParts: Extract<Part, { type: "text" }>[] = [];
    for (const p of parts) {
      if (p.type === "file") fileParts.push(p as Extract<Part, { type: "file" }>);
      else if (p.type === "text") textParts.push(p as Extract<Part, { type: "text" }>);
    }
    const fileUrls = fileParts.map((p) => p.url);
    return (
      <div className="select-text text-[13px] leading-relaxed">
        {fileParts.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {fileParts.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => open(fileUrls, i)}
                className="block cursor-zoom-in overflow-hidden rounded-lg border border-white/20 transition-opacity hover:opacity-80"
              >
                <img
                  src={p.url}
                  alt={p.filename ?? "attachment"}
                  className="max-h-32 max-w-[200px] object-cover"
                />
              </button>
            ))}
          </div>
        )}
        {textParts.map((p) => (
          <span key={p.id} className="whitespace-pre-wrap">
            {p.text}
          </span>
        ))}
        {parts.length === 0 && <span className="italic opacity-50">...</span>}
      </div>
    );
  },
  (prev, next) => prev.parts === next.parts,
);

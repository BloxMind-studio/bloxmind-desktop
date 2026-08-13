import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { memo } from "react";
import type { MessageWithParts } from "@/types";

// ── Inline BloxMind thinking indicator ────────────────────────────────────

export function BloxMindThinking({ label = "Thinking..." }: { label?: string }) {
  return (
    <div className="glass-panel flex min-h-[21px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed text-muted-foreground">
      <svg
        width="20"
        height="20"
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="BloxMind-face-think shrink-0"
        aria-hidden="true"
      >
        <g transform="rotate(-15 256 256)">
          <rect
            x="64"
            y="64"
            width="384"
            height="384"
            rx="64"
            fill="currentColor"
            className="text-foreground"
          />
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
      <span>{label}</span>
      <span className="flex gap-0.5">
        <span className="BloxMind-dot h-1 w-1 rounded-full bg-foreground/20" />
        <span className="BloxMind-dot h-1 w-1 rounded-full bg-foreground/20 [animation-delay:150ms]" />
        <span className="BloxMind-dot h-1 w-1 rounded-full bg-foreground/20 [animation-delay:300ms]" />
      </span>
    </div>
  );
}

export const BusyThinkingIndicator = memo(function BusyThinkingIndicator({
  status,
  lastMessage,
}: {
  status: SessionStatus | undefined;
  lastMessage: MessageWithParts | undefined;
}) {
  if (status?.type !== "busy" || !lastMessage || lastMessage.info.role !== "user") return null;
  return <BloxMindThinking />;
});

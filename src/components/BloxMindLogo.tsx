import type React from "react";
import { cn } from "@/lib/utils";

interface BloxMindLogoProps {
  /** Size of the logo in pixels (width & height) */
  size?: number;
  /** Custom Tailwind CSS classes to override or add styles */
  className?: string;
  /** Set to true to trigger the active/thinking pulse animation */
  isThinking?: boolean;
}

export const BloxMindLogo: React.FC<BloxMindLogoProps> = ({
  size = 18,
  className,
  isThinking = false,
}) => {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(
        "shrink-0 BloxMind-face text-foreground",
        isThinking && "animate-pulse opacity-80",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Rotated rounded square (Roblox CheezIt shape) */}
      <g transform="rotate(-15 256 256)">
        {/* Solid outer body — no center cutout */}
        <rect x="64" y="64" width="384" height="384" rx="64" fill="currentColor" />

        {/* Left eye */}
        <rect
          className="BloxMind-eye"
          x="148"
          y="140"
          width="56"
          height="56"
          rx="18"
          fill="var(--background)"
        />

        {/* Right eye */}
        <rect
          className="BloxMind-eye"
          x="308"
          y="140"
          width="56"
          height="56"
          rx="18"
          fill="var(--background)"
        />

        {/* Smile — centered on the solid body */}
        <path
          d="M172 296C172 296 204 336 256 336C308 336 340 296 340 296"
          stroke="var(--background)"
          strokeWidth="26"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
};

export default BloxMindLogo;

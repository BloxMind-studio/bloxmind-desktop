import { Bot, Gamepad2, LayoutTemplate } from "lucide-react";
import { useAppMode } from "@/providers/ModeProvider";
import type { AppMode } from "@/types/desktop";

const MODES: ReadonlyArray<{
  mode: AppMode;
  label: string;
  icon: typeof Gamepad2;
}> = [
  { mode: "roblox", label: "Roblox", icon: Gamepad2 },
  { mode: "apps", label: "Apps", icon: LayoutTemplate },
  { mode: "agent", label: "Agent", icon: Bot },
];

/**
 * Global mode switcher shown in the top bar. Switches the entire workspace
 * between Roblox Studio Mode, Apps Builder Mode, and Agent Mode.
 */
export function ModeSwitcher() {
  const { mode, setMode } = useAppMode();

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg border bg-card/80 p-0.5"
      role="tablist"
      aria-label="Workspace mode"
    >
      {MODES.map(({ mode: candidate, label, icon: Icon }) => {
        const active = mode === candidate;
        return (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${label} mode`}
            onClick={() => setMode(candidate)}
            className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-hover/12 hover:text-foreground"
            }`}
          >
            <Icon aria-hidden="true" size={12} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

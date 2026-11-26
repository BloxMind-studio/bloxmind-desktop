import { CircleAlert, CircleCheck, Pause, Play, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SessionGoal } from "@/lib/opencode/types";

const STATUS = {
  active: { label: "Goal", icon: Target, tone: "" },
  paused: { label: "Goal paused", icon: CircleAlert, tone: "text-amber-600 dark:text-amber-400" },
  complete: {
    label: "Goal met",
    icon: CircleCheck,
    tone: "text-emerald-600 dark:text-emerald-400",
  },
} as const;

type GoalCommand = "pause" | "resume" | "clear";

const ACTION =
  "flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/** The chat's /goal above the composer: its status, and what you can do with it. */
export default function GoalPill({
  goal,
  onCommand,
}: {
  goal: SessionGoal;
  onCommand: (command: GoalCommand) => void;
}) {
  const [open, setOpen] = useState(false);
  const status = STATUS[goal.status] ?? STATUS.active;

  function run(command: GoalCommand) {
    setOpen(false);
    onCommand(command);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${status.tone}`}
          title={goal.objective}
        >
          <status.icon aria-hidden="true" size={14} className="shrink-0" />
          {status.label}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-2">
        <p className="px-1 break-words text-[12px] text-foreground">{goal.objective}</p>
        {goal.reason ? (
          <p className="px-1 pt-1 break-words text-[11px] text-muted-foreground">{goal.reason}</p>
        ) : null}
        <div className="flex justify-end gap-1 pt-2">
          {goal.status === "active" ? (
            <button type="button" className={ACTION} onClick={() => run("pause")}>
              <Pause aria-hidden="true" size={13} />
              Pause
            </button>
          ) : null}
          {goal.status === "paused" ? (
            <button type="button" className={ACTION} onClick={() => run("resume")}>
              <Play aria-hidden="true" size={13} />
              Resume
            </button>
          ) : null}
          <button type="button" className={ACTION} onClick={() => run("clear")}>
            <Trash2 aria-hidden="true" size={13} />
            Clear
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

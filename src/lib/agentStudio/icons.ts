import {
  Clock,
  Database,
  FilePlus,
  Filter,
  Gamepad2,
  Globe,
  type LucideIcon,
  MessageSquare,
  Search,
  Sparkles,
  Tags,
  Terminal,
  Timer,
  Webhook,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  clock: Clock,
  webhook: Webhook,
  "gamepad-2": Gamepad2,
  globe: Globe,
  database: Database,
  search: Search,
  sparkles: Sparkles,
  tags: Tags,
  filter: Filter,
  "message-square": MessageSquare,
  timer: Timer,
  terminal: Terminal,
  "file-plus": FilePlus,
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name ? ICON_MAP[name] : undefined) ?? Sparkles;
}

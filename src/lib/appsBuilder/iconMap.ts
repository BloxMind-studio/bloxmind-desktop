import {
  Heading1,
  Image,
  List,
  type LucideIcon,
  MousePointerClick,
  Square,
  TextCursorInput,
  Type,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  heading: Heading1,
  type: Type,
  "mouse-pointer-click": MousePointerClick,
  square: Square,
  image: Image,
  "text-cursor-input": TextCursorInput,
  list: List,
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name ? ICON_MAP[name] : undefined) ?? Type;
}

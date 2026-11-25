import type { Command } from "@/lib/opencode/types";

/** Same as OpenCode's desktop app: the message starts with "/", and the name ends at whitespace. */
export function parseSlashCommand(text: string): { name: string; input: string } | null {
  const message = text.trim();
  if (!message.startsWith("/")) return null;
  const separator = message.search(/\s/);
  return {
    name: message.slice(1, separator === -1 ? undefined : separator),
    input: separator === -1 ? "" : message.slice(separator).trim(),
  };
}

function clientCommand(name: string, description: string): Command {
  return { name, description, template: "", hints: [] };
}

/**
 * OpenCode's desktop commands that act on the app, not on the model. They run
 * here even while a reply streams, and need no Studio.
 */
export const CLIENT_COMMANDS: readonly Command[] = [
  clientCommand("new", "start a new chat"),
  clientCommand("undo", "take back the last message and put it in the box"),
  clientCommand("redo", "bring back what you undid"),
  clientCommand("compact", "summarize this chat to free up context"),
  clientCommand("fork", "continue from here in a new chat"),
  clientCommand("export", "save this chat as a JSON file"),
  clientCommand("model", "choose a model"),
  clientCommand("connect", "connect a provider"),
  clientCommand("reload", "reload config, commands and skills"),
];

export function mergeCommands(catalog: readonly Command[]): Command[] {
  const clientNames = new Set(CLIENT_COMMANDS.map(({ name }) => name));
  return [...catalog.filter(({ name }) => !clientNames.has(name)), ...CLIENT_COMMANDS];
}

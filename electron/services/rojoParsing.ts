import { exec } from "node:child_process";

export const DEFAULT_ROJO_PORT = 34872;
// Rojo 6.x prints "listening on http://localhost:34872/"; Rojo 7.x prints
// "Rojo server listening:". Match both so we don't wait for a string that
// never appears and then kill a healthy server.
const ROJO_PORT_REGEX = /(?:port|serving)[:\s]*([0-9]{2,5})/i;
export const ROJO_CLIENT_CONNECTED_REGEX = /client connected|session opened|room joined/i;
export const ROJO_CLIENT_DISCONNECTED_REGEX = /client disconnected|session closed|room left/i;
export const ROJO_LISTENING_REGEX = /(?:rojo server listening|listening on +https?:\/\/[^\s]+)/i;
export const ROJO_ERROR_REGEX = /(?:error|failed|cannot|unable to|port already in use)/i;

/** Remove ANSI color/control sequences that Rojo emits when stdout is a pipe. */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CSI sequences begin with ESC by design
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/**
 * Detect whether Roblox Studio (or any client) is currently connected to the
 * Rojo server by parsing `netstat -ano` output. `systeminformation` only
 * reports LISTEN sockets on Windows, so we parse netstat directly to catch
 * ESTABLISHED connections from Roblox Studio. This is far more reliable than
 * parsing Rojo's log output, which varies between versions and can be
 * ANSI-encoded or buffered.
 */
export async function hasClientOnPort(port: number): Promise<boolean> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const isWindows = process.platform === "win32";
      exec(isWindows ? "netstat -ano" : "netstat -an", { windowsHide: true }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    const portString = String(port);
    const portCol = `:${portString}`;
    // Match lines like:
    //   TCP  127.0.0.1:34872  127.0.0.1:59913  ESTABLISHED  5140
    // The third column is the remote; an ESTABLISHED connection whose local
    // column is our port means a client is connected. We require a remote
    // peerPort > 0 to exclude the server's own LISTEN socket.
    return stdout.split(/\r?\n/).some((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) return false;
      const localCol = parts[1] ?? "";
      const stateCol = parts[3] ?? "";
      const peerCol = parts[2] ?? "";
      if (!localCol.endsWith(portCol)) return false;
      if (stateCol !== "ESTABLISHED") return false;
      // Peer must be a real client socket, not 0.0.0.0:0.
      const peerPortPart = peerCol.lastIndexOf(":");
      const peerPort = peerPortPart >= 0 ? Number(peerCol.slice(peerPortPart + 1)) : 0;
      return peerPort > 0;
    });
  } catch {
    return false;
  }
}

/** Extract the port Rojo is serving on from its output, or null when absent. */
export function detectPort(output: string): number | null {
  const clean = stripAnsi(output);
  const match = clean.match(ROJO_PORT_REGEX);
  if (match?.[1]) {
    const port = Number.parseInt(match[1], 10);
    if (Number.isInteger(port) && port > 0 && port < 65_536) return port;
  }
  return null;
}

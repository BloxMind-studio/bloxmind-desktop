import { describe, expect, it } from "vitest";
import type { AppGeneratedFile } from "@/lib/appsBuilder/types";
import { buildZip } from "@/lib/appsBuilder/zip";

function files(contents: Record<string, string>): AppGeneratedFile[] {
  return Object.entries(contents).map(([path, content]) => ({ path, content }));
}

/** Naive reader that parses local headers only (STORE method) to verify round-trips. */
function readStoredZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Map<string, string>();
  let offset = 0;
  const decoder = new TextDecoder();
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 22, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = decoder.decode(bytes.subarray(dataStart, dataStart + size));
    result.set(name, data);
    if (method !== 0) throw new Error(`unsupported method ${method}`);
    offset = dataStart + size;
  }
  return result;
}

describe("buildZip", () => {
  it("archives every file with STORE method and round-trips content", () => {
    const entries = files({
      "package.json": '{"name":"demo"}',
      "src/App.tsx": "export default function App() { return <div />; }",
      "README.md": "# Demo",
      ".gitignore": "node_modules\n",
    });

    const zip = buildZip(entries);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);

    const extracted = readStoredZip(zip);
    expect(extracted.get("package.json")).toBe('{"name":"demo"}');
    expect(extracted.get("src/App.tsx")).toBe("export default function App() { return <div />; }");
    expect(extracted.get("README.md")).toBe("# Demo");
    expect(extracted.get(".gitignore")).toBe("node_modules\n");
  });

  it("emits exactly one central directory per entry plus an end record", () => {
    const entries = files({ "a.txt": "a", "b.txt": "b", "c.txt": "c" });
    const zip = buildZip(entries);
    const centralSignature = new Uint8Array([0x50, 0x4b, 0x01, 0x02]);
    const endSignature = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
    const countOf = (signature: Uint8Array) => {
      let count = 0;
      for (let i = 0; i + signature.length <= zip.length; i++) {
        if (zip.subarray(i, i + signature.length).every((byte, j) => byte === signature[j])) {
          count += 1;
        }
      }
      return count;
    };
    expect(countOf(centralSignature)).toBe(3);
    expect(countOf(endSignature)).toBe(1);
  });
});

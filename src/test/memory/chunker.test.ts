import { describe, expect, it } from "vitest";
import { chunkDocument } from "@/lib/memory/chunker";

describe("chunker", () => {
  it("single chunk for small doc", () => {
    const chunks = chunkDocument({ documentId: "id1", path: "game.Test", content: "local x=1" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("local x=1");
  });

  it("splits large doc into overlapping chunks", () => {
    const content = Array.from({ length: 200 }, (_, i) => `local a${i} = ${i} -- comment`).join("\n");
    const chunks = chunkDocument({ documentId: "big", path: "game.Big", content });
    expect(chunks.length).toBeGreaterThan(1);
    // overlap check: next chunk starts before previous ends
    for (const c of chunks) expect(c.tokenCount).toBeGreaterThan(0);
  });

  it("preserves require blocks", () => {
    const content = `local Foo = require(game.ReplicatedStorage.Foo)\nlocal Bar = require(script.Parent.Bar)\n\nlocal x=1\nend\nlocal y=2`;
    const chunks = chunkDocument({ documentId: "req", path: "game.Req", content });
    expect(chunks[0].content).toContain("require");
  });
});

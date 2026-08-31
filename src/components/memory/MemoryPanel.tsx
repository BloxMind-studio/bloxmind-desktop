import { useEffect, useState } from "react";
import { desktop } from "@/lib/desktop";

interface MemoryStats {
  documentCount: number;
  chunkCount: number;
  lastIndexedAt: number | null;
}

export function MemoryPanel() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const s = await desktop.memoryStats().catch(() => null);
      if (s) setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, []);

  const reindex = async () => {
    setBusy(true);
    setError(null);
    try {
      await desktop.memoryReindex();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Project Memory</h3>
        <button
          type="button"
          onClick={reindex}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Indexing..." : "Re-index"}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {stats ? (
        <div className="text-xs space-y-1 text-muted-foreground">
          <div>Documents: {stats.documentCount}</div>
          <div>Chunks: {stats.chunkCount}</div>
          <div>Last indexed: {stats.lastIndexedAt ? new Date(stats.lastIndexedAt).toLocaleString() : "never"}</div>
          <div className="text-[11px]">DB: .bloxmind/memory.db (workspace)</div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Loading memory stats…</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Queries before generation (e.g. “Connect a shop system to my old inventory script”) automatically inject relevant scripts + KG edges.
      </p>
    </div>
  );
}

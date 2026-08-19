# BloxMind Studio — Multi-Repo Staging

Staging repositories for the `BloxMind-studio` GitHub organization. Each folder
is a self-contained git repository (init, remote, push from its own root).

| Folder | Repo | Org package | Contents |
|--------|------|-------------|----------|
| `bloxmind-desktop` | `bloxmind-desktop` | `@bloxmind-studio/desktop` | Electron/Next.js frontend, 3D Canvas, App Builder UI |
| `bloxmind-core-engine` | `bloxmind-core-engine` | `@bloxmind-studio/core` | Private backend APIs, auth, AI orchestration |
| `bloxmind-mcp-server` | `bloxmind-mcp-server` | `@bloxmind-studio/mcp-server` | Luau script bridges, MCP logic |

## Push flow (from each folder root)

```bash
cd repos/bloxmind-desktop
git init -b main
git add .
git commit -m "feat: initial import"
git remote add origin https://github.com/BloxMind-studio/bloxmind-desktop.git
git push -u origin main
```

Repeat for `bloxmind-core-engine` and `bloxmind-mcp-server`.

> **Status:** `bloxmind-desktop` is a full working copy. `bloxmind-core-engine`
> and `bloxmind-mcp-server` contain their extracted services with imports
> re-wired to be self-contained; both pass `pnpm typecheck`.
>
> The core engine vendors the MCP/Rojo modules it orchestrates under
> `src/deps/` (they live primarily in the `bloxmind-mcp-server` repo) — keep
> those two in sync if you change the shared MCP layer.

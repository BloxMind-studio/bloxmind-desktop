# BloxMind Desktop

`@bloxmind-studio/desktop` — Electron/Next.js desktop frontend for BloxMind Studio.

This repository contains the **public-facing** desktop application:
- Electron shell and main-process bridge (`electron/`)
- React/TypeScript UI (`src/`)
- 3D Canvas / isometric viewport (`src/components/agent/`, `src/lib/agentStudio/`)
- App Builder UI & code generation (`src/components/apps/`, `src/lib/appsBuilder/`)
- Shared UI primitives (`@bloxmind-studio/ui`) and shared types (`@bloxmind-studio/types`)

## Talking to the private engine

The desktop app communicates with the **private** core engine (`bloxmind-core-engine`)
through the configured API URL:

```bash
# .env.local
NEXT_PUBLIC_CORE_API_URL=https://<your-core-engine-host>
```

When set at build time, `src/lib/apiConfig.ts` resolves the engine endpoint to
`NEXT_PUBLIC_CORE_API_URL` (cloud mode). When unset, the app falls back to the
local OpenCode engine spawned by the Electron main process.

## Development

```bash
pnpm install
pnpm dev
```

## Key commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run the full app in dev mode |
| `pnpm typecheck` | Type-check app, Electron, and release scripts |
| `pnpm lint` | Lint with Biome |
| `pnpm test` | Run unit + release tests |
| `pnpm package` | Production build and installers |

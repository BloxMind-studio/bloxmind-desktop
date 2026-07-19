# Electron migration

The Electron rewrite is being delivered in vertical slices so each pull request
leaves a runnable app. The Tauri source stays temporarily as a reference and as
the staging location for existing installer icons.

## Why this slice comes first

The open issue cluster is primarily about lifecycle and observability rather
than rendering:

- [#27](https://github.com/paralov/app-bloxbot-ai/issues/27),
  [#22](https://github.com/paralov/app-bloxbot-ai/issues/22), and
  [#21](https://github.com/paralov/app-bloxbot-ai/issues/21) report an indefinite
  “Thinking” or startup state.
- [#23](https://github.com/paralov/app-bloxbot-ai/issues/23) reports an SSE
  timeout after initially connecting.
- [#17](https://github.com/paralov/app-bloxbot-ai/issues/17) and
  [#18](https://github.com/paralov/app-bloxbot-ai/issues/18) show that Studio
  connectivity and setup are not visible enough.
- [#16](https://github.com/paralov/app-bloxbot-ai/issues/16) reports that the
  OpenCode process can survive an in-app update.

This first slice moves ownership of OpenCode into an Effect scoped service. A
single resource now acquires the sidecar, waits for a bounded health check, and
releases it during normal app shutdown or update. The renderer talks through a
small, typed, context-isolated Electron bridge and shows startup failures instead
of polling forever.

## Migration sequence

1. **Shell and lifecycle (this slice):** Electron main/preload processes,
   Effect-scoped OpenCode, safe IPC, config persistence, updates, and packaging.
2. **Connection state:** model OpenCode, SSE, and Roblox Studio health as an
   explicit state machine; expose reconnect/restart controls in the UI.
3. **Distribution hardening:** sign both platforms, publish checksums and build
   provenance, then investigate the unverified report in
   [#29](https://github.com/paralov/app-bloxbot-ai/issues/29) against known
   artifacts.
4. **Remove Tauri:** move shared assets out of `src-tauri/`, delete the Rust
   shell, and update release automation after Electron packages have been tested
   on macOS and Windows.

The SSE transport and Studio status UI remain follow-up work; changing the shell
alone does not resolve provider-specific stream timeouts.

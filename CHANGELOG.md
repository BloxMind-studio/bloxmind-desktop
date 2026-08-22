# Changelog

All notable changes to BloxMind are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.98] - 2026-08-22

### Added

- Added **Roblox sign-in and app licensing**: sign in with your Roblox account via
  OAuth (PKCE + custom `bloxmind://` redirect), a device-bound license check, and
  a background heartbeat that locks the app when the session is revoked.
- Added **durable chat history**: sessions are mirrored to disk and rehydrated on
  launch, so conversations survive the AI engine's in-memory lifecycle.
- Added **per-session isolated workspaces** for Rojo serve, so each session gets a
  clean project tree free of stray references from earlier places.
- Added a rich **Animation request panel** (R15/R6 KeyframeSequence authoring) and
  a **Map request panel** wired to structured AI generation.

### Changed

- Removed the standalone **Apps Builder**, **Games Studio**, and **Agent Studio**
  and re-unified the app around a single focused Roblox chat-to-build flow. The
  shared builder machine and its 3D/agent tooling were rolled back to reduce
  duplication and maintenance surface.
- The default theme accent was retuned to a deep slate profile with custom
  selected/hover color presets.

### Removed

- `@bloxmind-studio/ui` and `@bloxmind-studio/types` workspace packages (no longer
  used by the app).

## [0.9.97] - 2026-08-19

### Added

- Added a full **Games Studio** mode: describe a game and the AI writes a playable
  React Three Fiber 3D game (physics, HUD, full-canvas WebGL preview), saved
  separately from apps.
- Added **runtime self-heal**: when the app/game preview fails, a **Fix with AI**
  button feeds the error straight back to the model to repair the code.
- Added **preview compile metrics** (modules compiled / served from cache / ms) so
  the shared compile cache is visible while building.

### Changed

- The **Apps Builder** is now web-only â€” the 3D-game option was removed; 3D builds
  now live in Games Studio.
- Unified the Apps and Games builders onto one shared engine (`useStudioBuilder`),
  so fixes and features land once instead of twice.
- Added a bounded cross-build compile cache for previews, so unchanged modules are
  not re-transpiled on every update.

## [0.9.96] - 2026-08-13

### Added

- Added **Agent Studio**: design reusable agents as visual node workflows on a 3D isometric canvas (with a 2D fallback), edit nodes, generate a full agent from a short prompt, and run it â€” the engine compiles each workflow into a runnable Python script and streams live execution logs with per-node status.
- Added an **app-mode switcher** (Roblox / Apps / Agent) that persists in `AppConfig` and `localStorage` across restarts.
- Added an **Apps Builder** for assembling apps from a component palette.
- Added broad unit coverage for the agent engine, isometric math, both workflow canvases, and the mode switcher.

### Changed

- The desktop config schema now carries `activeMode`, and the mode choice is kept in sync between `AppConfig` and `localStorage`.
## [0.9.95] - 2026-08-13

### Added

- Added Text Style presets (Quiet, Rounded, Classic, Mono, Serif, Humanist) to the Appearance settings, each with a live font preview.
- Added a "jump to bottom" button that appears in the chat when you scroll up, and new messages now re-sync cleanly while scrolled up instead of forcing the viewport down.
- Sidebar and Explorer panel collapsed state is now persisted across restarts.
- Extended syntax highlighting to CSS, HTML, Python, SQL, and YAML.
- Enabled the agent's Bash tool with `ask` permission, so destructive or network-issue shell commands (commit, push, `rm -rf`, etc.) always require explicit in-app approval.

### Changed

- Refined chat polish: session-switch fade animation, softer context-menu and dialog shadows, and a cleaner thinking-block header.
- Consolidated checkpoint state management by removing the standalone `useRevert` hook in favor of the shared checkpoint-history hook.

### Fixed

- Checkpoint history is hardened against corrupt or truncated `localStorage` â€” malformed cache JSON can no longer crash rendering, and hook outputs are memoized.
- A failed update check now surfaces a single low-key toast per launch instead of failing silently.
## [0.9.94] - 2026-08-11

### Fixed

- Fixed a runtime crash (`Cannot access 'setDetailedAnalyticsEnabled' before initialization`) that occurred when config data first loaded â€” the analytics consent handler is now declared before the effect that references it, avoiding a temporal-dead-zone failure

## [0.9.93] - 2026-08-11

### Fixed

- Fixed CSS @import ordering issue in `src/index.css` that caused PostCSS build errors during Vite compilation
- Fixed Send button color to properly sync with accent color presets by using inline CSS variable instead of gradient with opacity modifier
- Ensured theme mode (light/dark) is preserved when changing accent colors or color presets in Appearance settings

## [0.9.92] - 2026-08-11

### Fixed

- Fixed a bug where changing the Accent Color or Color Preset in the Appearance settings would reset the active theme mode (e.g. reverting from Dark back to System). The `ThemeProvider.setTheme` now mirrors theme changes into the shared React Query cache so preference writes no longer propagate a stale theme value back to the UI.

## [0.9.13] - 2026-08-09

### Fixed

- Resolved biome lint formatting errors in `src/components/chat/Prompts.tsx` and `src/types/desktop.ts` to ensure clean CI builds.

## [0.9.11] - 2026-08-09

### Fixed

- Fixed the thought timing display so elapsed time reflects the agent's actual thinking duration instead of counting while the user reads it.

## [0.9.9] - 2026-08-08

### Added

- Enriched the built-in map-building skill with professional Roblox environment authoring: a JSON blueprint contract that keeps every placement grid-aligned and consistent, authoritative stud proportions for walls/doors/corridors, a curated props asset palette cloned from ServerStorage instead of the Toolbox, Future-technology lighting with Bloom/ColorCorrection/SunRays atmosphere, and clean grouping of finished architecture vs interactive objects for streaming.

## [0.9.8] - 2026-08-08

### Added

- Added Mesh mode: a side panel that turns a short description into a timeout-safe `generate_mesh` request with style, size, and segmentation options.
- Added an "Enhance with AI" option to Mesh mode that rewrites a short idea into a detailed, style-aware mesh generation prompt.
- Added a professional animation skill pack the agent loads on demand for combat combos, hit reactions, eating/drinking, and dance loops on R15 and R6 rigs, covering KeyframeSequence authoring, rig detection, dual-rig variants, pro animation principles, and runtime playback.
- Added a map-making skill pack that makes the agent plan whole maps with a structured build plan (zones, landmarks, flow, scale, budgets) before executing a seven-phase build pipeline: blockout, structure, terrain, props, lighting, gameplay hooks, and polish.

### Changed

- Improved the UI: consistent slim scrollbars across every panel and picker, visible keyboard focus rings, a richer home screen with capability teaser cards, keyboard shortcut hints in the empty chat, the app version in the titlebar, and full reduced-motion support.
- Improved agent quality and speed: the workspace now ships a managed AGENTS.md with always-on efficiency and Luau quality conventions (refreshed on launch without touching user content), focused sampling via `top_p`, and prompt rules that batch related edits into a single pass.
- Extended Biome linting and formatting to the `electron/` and `scripts/` directories and added a dedicated CI job that runs the full unit test suite and type-check on every pull request, so regressions fail fast instead of surfacing in the packaging matrix.
- CI now generates a unit-test coverage report on every pull request and uploads it as an artifact, making coverage trends visible without running anything locally.

### Fixed

- Fixed the agent getting stuck in retry loops while debugging rigs: the animation skill now forbids guessing engine APIs (e.g. the non-existent Humanoid:GetRigInfo()), requires enumerating Motor6D joints via GetDescendants, enforces Pose-to-Motor6D name matching and Animator-based playback, and mandates static Motor6D.Transform verification instead of brute-forcing simulated keyboard input to catch sub-second states.
- Fixed the session list silently going stale if the live event stream dropped and reconnected by adding a slow watchdog poll that reconciles it with the server, matching the existing session-status watchdog.
- Fixed the packaged app reporting "v0.9.5 is available" while already on v0.9.5 â€” the update check now compares versions numerically and respects electron-updater's update-not-available signal, so it correctly shows "Up to date".
- Fixed AI mesh generation timing out after ~60 seconds by raising the Studio MCP request timeout to 10 minutes and teaching the agent to verify the workspace before retrying a timed-out generation.
- Fixed Mesh mode's "Enhance with AI" failing with "invalid mesh description" on models without structured-output support by falling back to parsing the text response and surfacing structured-output errors clearly.
- Fixed "Enhance with AI" pasting raw `<structured_output>` tags into the description by unwrapping leaked tags and accepting renamed JSON keys such as `prompt`.
- Fixed Regenerate to replay the Studio target and project index system context, matching what a fresh send attaches.
- Fixed Regenerate so it never replays legacy injected `[SYSTEM_NOTIFICATION_*]` messages as the prompt.
- Fixed checkpoint restore so the automatic context rewind only runs for full-snapshot checkpoints, protecting user edits preserved by incremental restores.

## [0.9.5] - 2026-08-08

### Added

- Added a Regenerate button for the latest assistant response.

### Fixed

- Fixed the Explorer failing to load by sending the required `datamodel_type: Edit` parameter to Roblox Studio's `search_game_tree` MCP tool.
- Fixed the Explorer getting permanently stuck after a first failed sync by retrying automatically with capped backoff.
- Fixed the Explorer hiding the real failure reason â€” Studio-side errors now surface in the panel banner instead of a generic message.
- Fixed checkpoint restore so the agent's context rewinds automatically, removing the need to send a manual "continue from here" message.

## [0.9.2] - 2026-08-08

### Fixed

- Fixed the Windows app icon by shipping a proper 256x256 icon for electron-builder.

## [0.9.1] - 2026-08-08

### Added

- Added comprehensive settings with General, Appearance, Behavior, Connection, AI Engine, Privacy, and About tabs backed by an extended config schema.
- Added data management to the Privacy tab with export, import, and clear actions.
- Added keyboard shortcuts and exponential-backoff reconnection for the OpenCode event stream.
- Added CSS customization support and a global error boundary for recoverable rendering failures.

### Changed

- Updated the Windows and macOS app icons to the new bloxbot icon set.
- Hardened process lifecycle management with a single-instance lock, a startup sweep of leftover Rojo and OpenCode processes from crashed sessions, and bounded cleanup on quit so the app can no longer hang.

### Fixed

- Replaced hardcoded version strings and scattered magic numbers with shared constants.

## [0.9.0] - 2026-08-06

### Added

- Release v0.9.0.

## [0.8.1] - 2026-07-31

### Changed

- Split the macOS release into separate Apple Silicon (arm64) and Intel (x64) installers, roughly halving each download.

## [0.8.0] - 2026-07-27

### Added

- Added session-scoped Roblox Studio targeting with automatic matching, a responsive Studio picker, and a shared Electron-side MCP broker.
- Added an agent-driven Explorer that automatically synchronizes Roblox Studio's instance tree, supports search, properties and attributes, object references, and Studio-style ordering and filtering.
- Added an agent playtest workflow that can generate editable test plans from chat history and send the completed playtest back into the active session.
- Added snoozed sessions with restore-first interactions, contextual deletion, confirmation inside the application, and animated sidebar transitions.
- Added object mentions and OpenCode-backed slash-command completion to the composer, including argument hints and keyboard completion.

### Changed

- Redesigned reasoning, tool calls, structured output, diffs, shell output, retries, and provider errors as compact inline chat content with collapsible syntax highlighting.
- Reworked Explorer and Playtest as matching embedded side panels with responsive header controls and smooth entrance and exit transitions.
- Refined the composer with an expandable input, aligned attachment and submit actions, an in-composer agent selector, and a popover-based reasoning-effort slider.
- Expanded PostHog events with consistent metadata for Studio targeting, Explorer synchronization, playtesting, composer actions, and session management.

### Fixed

- Prevented Studio discovery refreshes, panel switching, disclosure expansion, and responsive header changes from causing flicker, scroll jumps, clipped controls, or layout shifts.
- Added a bundled typed Studio collector and strict schema runtime so common discovery and Explorer flows work without an initial model request while retaining agent-generated fallback behavior.

## [0.7.1] - 2026-07-26

### Fixed

- Replaced raw HTML in update notifications with a compact, readable release summary while preserving the install-and-restart action.

## [0.7.0] - 2026-07-26

### Added

- Added a suggested workflow for coordinating work across multiple open Roblox Studio places, with agent guidance to discover, select, and verify the intended place before place-specific actions.

## [0.6.7] - 2026-07-26

### Fixed

- Replaced the raw startup stack trace with a clear setup-recovery screen, actionable restart and update options, and collapsible copyable technical details for support.

## [0.6.6] - 2026-07-24

### Fixed

- Unblocked Studio setup across platforms by trusting the connected MCP status instead of inspecting OS-specific processes and sockets.

## [0.6.5] - 2026-07-24

### Changed

- Added visible progress while BloxMind checks the Roblox Studio connection.

### Fixed

- Prevented unavailable Studio tool calls by requiring a live Roblox Studio connection before enabling chat.

## [0.6.4] - 2026-07-23

### Added

- Added clear startup stages plus real percentage and transfer-speed feedback while BloxMind downloads OpenCode.

### Changed

- Tightened the Studio agent instructions around inspecting before editing, making focused changes, validating in Studio, and deferring project-specific rules to each workspace's `AGENTS.md`.

## [0.6.3] - 2026-07-23

### Changed

- Simplified desktop analytics to PostHog's built-in defaults, with persistent device identity, device profiling, person profiles, feature flags, and app screen pageviews enabled.

### Fixed

- Restored desktop analytics by injecting the PostHog EU project token during CI builds and loading PostHog's self-contained Electron renderer bundle.
- Replaced analytics' current page URL with stable `BloxMind://app/<screen>` metadata.

## [0.6.2] - 2026-07-21

### Changed

- Model quota failures now use OpenCode's structured status and action data, with native usage-limit guidance for free models instead of message matching.
- Automatic OpenCode context compaction is enabled by default, and the OpenCode SDK has been updated to its current status schema.
- React Query synchronization now uses scoped cache keys, precise event-driven updates, reconnect reconciliation, and targeted mutation rollback instead of broad invalidation.
- Removed the bundled third-party Gemini OAuth plugin; Google API-key authentication and other supported providers remain available.
- Refined the detailed-analytics consent prompt into a compact decision card with full-width copy and clear actions.

### Fixed

- Prevented stale HTTP snapshots and out-of-order event updates from restoring deleted sessions, reviving stale messages, or leaking drafts between conversations.
- Corrected session mutation failure handling, optional action rendering, sidebar interactions, and related React subscription ownership issues.

## [0.6.1] - 2026-07-21

### Changed

- CI and release publishing now share one reusable build workflow, use current Node runtimes for GitHub Actions, and publish only the installers and files required for automatic updates.
- Releases are now assembled as retryable drafts, verified for the exact updater-safe asset set, and published only after every upload succeeds.
- GitHub Actions are pinned to their latest immutable revisions, and write access is limited to the final release-publishing job.
- macOS releases now use one universal installer for Apple Silicon and Intel Macs.
- Release tooling is now TypeScript-only, and the redundant Makefile has been removed in favor of package scripts.
- PostHog now collects basic privacy-minimized feature analytics by default and asks once before enabling detailed provider, model, and aggregate token usage; detailed sharing remains toggleable in Privacy settings.
- Analytics now use a temporary per-launch identifier and a strict outbound property allowlist that removes URLs, device and session identifiers, user-agent details, profile data, and IP-derived location data.

### Fixed

- Added production app-open and model-usage events so PostHog ingestion and aggregate token usage can be monitored without collecting user content.
- Fixed detailed analytics sending user-defined agent names even though the consent prompt did not request them.

## [0.6.0] - 2026-07-21

### Added

- Added a guided, screenshot-based Roblox Studio connection flow that detects the built-in MCP server and reconnects automatically.
- Added detailed startup progress while BloxMind prepares its workspace, downloads OpenCode, and starts the local AI service.
- Added Light, Dark, and System appearance settings, with System following the operating system theme automatically.
- Added native Electron installers for Apple Silicon and Intel macOS, 64-bit Windows, and 64-bit Debian-based Linux.

### Changed

- Replaced the Tauri and Rust desktop shell with Electron, using a typed, context-isolated bridge between the app and desktop runtime.
- OpenCode is now downloaded on first launch instead of bundled with the app. BloxMind selects the newest compatible stable `1.x` release, caches it per platform, and reuses a verified cached copy when offline.
- Reworked desktop services and startup orchestration around Effect for predictable cleanup, bounded startup failures, and clearer error reporting.
- Closing the final window now fully quits BloxMind and its OpenCode process; on macOS, the Dock icon is hidden as the app exits.
- Updated the build and release pipeline for Electron packages, macOS signing and notarization, GitHub releases, and automatic updates.

### Fixed

- Fixed OpenCode startup races by discovering its actual loopback port and waiting for a successful health check before opening the app.
- Fixed development instances remaining alive after their last window closes.
- Fixed missing Linux package maintainer metadata.
- Improved event-stream cleanup and desktop error handling during startup, shutdown, and updates.

### Security

- OpenCode now runs on a random loopback port with per-launch credentials rather than exposing an unauthenticated local service.
- OpenCode downloads are restricted to official GitHub release assets and verified with SHA-256 digests before installation and on every cache reuse.
- Electron runs with context isolation, renderer sandboxing, Node.js integration disabled, validated IPC payloads, and external navigation blocked.

[Unreleased]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.9.9...HEAD
[0.9.9]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.9.8...v0.9.9
[0.9.8]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.9.5...v0.9.8
[0.9.5]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.9.2...v0.9.5
[0.9.2]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.6.7...v0.7.0
[0.6.7]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.6.6...v0.6.7
[0.6.6]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.5.2...v0.6.0

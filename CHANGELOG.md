# Changelog

All notable changes to BloxMind are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.15.0] - 2026-10-28

### Added

- Context compaction is now visible and controllable. Settings → AI Engine has an Automatic compaction switch for OpenCode's built-in summarization of older messages, and the chat header has a Compact button that summarizes the current conversation on demand; it appears only while automatic compaction is off. While a compaction runs — automatic or manual — a status row above the composer shows that the conversation is being summarized. Compaction parts still appear inline as "Context compacted", and a failed or empty compaction reports a toast instead of doing nothing.

### Fixed

- Project indexing works again. The indexer now passes the selected Studio target and a data model type to Studio, uses Studio's real `script_read` tool, and reports a real error with a Retry action instead of silently showing 0 scripts and 0 modules. Every discovered script is counted even when its source cannot be read, and source reading is bounded so a large place returns a partial map instead of timing out.
- The project map is now useful to the assistant. It carries the scanned place's entry points, hub modules, dependency links and the exact `script_read` paths, warns when the map is partial, and tells the assistant to read the listed scripts instead of rescanning the place. The chat header shows the live script/module count and marks partial or unreadable indexes.

## [0.14.4] - 2026-10-27

### Added

- Settings → Behavior now has a verification level. Choose Off to make changes without any checking, Ask me to have the assistant ask you to try the change in Studio, Quick check to re-read the change and take one screenshot, or Full test to playtest and read the logs before reporting. Quick never simulates clicks or playtests, so it stays fast and cannot mistake a mis-aimed click for a broken feature; all levels now say that a missed click or wrong target is a test mistake, not a bug, and that a failed check is retried at most once before being reported as unverified. Every message carries the chosen level, and you can still ask for a specific test in your own message.

## [0.14.3] - 2026-10-27

### Fixed

- Disconnecting a provider now removes it from the Providers tab right away. Previously the row could stay in the connected list with a working Disconnect button, because the engine still reported the key while it was reinitializing.
- Connected providers once again show Disconnect instead of a "From config" label. That label appeared for every provider BloxMind writes into the engine config for its AI Engine settings, including keys BloxMind stored itself and can remove. Only a key taken from the environment now says "From environment".
- Checkpoints no longer add a saved badge or a Restore files button to turns that only talked or inspected. They now appear only after BloxMind confirms the turn actually changed files on disk.
- Restoring an older turn now restores that turn's checkpoint instead of silently falling back to the newest one.

## [0.14.2] - 2026-10-27

### Changed

- Permission and question prompts now queue in the order they arrive. When the assistant asks two things before you answer, the second no longer replaces the first, and the next one appears as soon as you answer.
- Settings are saved once you stop adjusting them instead of on every keystroke or slider step, so typing a long system prompt no longer rewrites the whole configuration file for each character.
- Checkpoints keep the newest 100 per chat, and file copies they share are stored once, so a long session's saved history no longer grows without limit.
- The chat re-renders only the reply that is actually streaming, and the Explorer updates only the rows Studio reports as changed and mounts only the rows on screen. Long replies, large tool output and big places stay responsive.
- Code blocks read as plain text while a reply is still streaming and are highlighted once it finishes, instead of being re-tokenized on every token.
- Follow-scroll reacts to the size of the conversation rather than every text change, so a long reply keeps scrolling smoothly without watching each character.

### Fixed

- The chat now follows a reply that is streaming into a brand-new chat. Follow-scroll previously did not engage until the second turn.
- The chat no longer flips back to "Working" after a turn finished, when a status check that started earlier resolved late.
- Restoring a checkpoint now fails with a clear message if one of its saved file copies is missing, instead of silently leaving the agent's edit in place.
- Installing an update now stops the assistant engine first, so a running engine can no longer hold files the installer needs to replace.
- A saved Max Tokens value of 4,096 from an older build is migrated to "model's own limit" once instead of being reapplied on every launch.
- Model error cards and provider checks no longer fail to render when the provider leaves out the usual error details.
- Tools provided by a custom MCP server now render like their built-in counterparts even when the server name itself contains underscores.

## [0.14.1] - 2026-10-27

### Added

- Settings → Integrations: add extra MCP servers for the assistant to use, with a one-click Blender preset. Supports local (command) and remote (URL) servers, each with an on/off switch and a live status light; changes apply to the running engine immediately. The preset adds and configures the integration, but Blender setup itself is still yours to do — BloxMind doesn't install Blender, uv, or its add-ons for you.
- A Blender character animation skill ships with the app: once the Blender integration is connected, the assistant can build R6 and R15 animations in Blender, export them, and load them into Studio.
- The assistant can now transfer a premade R15 character from the open Studio place into Blender on its own: it reads the real model through Studio itself — part sizes, placement, every Motor6D joint, and each MeshPart's mesh id — and rebuilds that exact rig for animation, so the old manual "export the rig and pick a file" step is gone for both the classic Part-based and the stock MeshPart-based R15. MeshPart body parts transfer with exact-size box geometry and can pick up FileMesh skinning data when available; accessory-heavy, welded, or new-gen constraint rigs still use the plugin's export path.

### Changed

- The assistant's generated programs no longer run inside the main app. Each one runs in a separate, isolated runtime with no direct access to your files, your settings, or the open Studio session, and a program that runs too long is stopped instead of hanging the app.
- BloxMind now starts from the version of the assistant engine it already has instead of waiting on a network check first, so the window comes up sooner. The check still runs in the background.
- Replies stream in more smoothly and use less CPU, especially in long sessions with large tool output.

### Fixed

- Importing a Studio-exported rig into Blender now rebuilds the armature directly in every session. Previously the rebuild could fail when nothing was pre-selected in Blender, which blocked the R15 animation workflow.
- Restoring a checkpoint now brings back images, meshes, and other binary files exactly as they were; before, those files could be silently rewritten and come back corrupted. Files too large to snapshot are now reported instead of being skipped without a word.
- The local connection to Roblox Studio now requires a per-launch secret that only BloxMind and the engine it starts know, so another program on your machine — or a web page that tries to reach the port — can no longer send commands to your open Studio session. Requests that are too large are rejected, and the number of open sessions is capped.
- BloxMind now refuses to navigate its own window anywhere except its own app page, instead of trusting any page that happened to share its origin.

## [0.14.0] - 2026-10-17

### Added

- BloxMind now ships a Roblox game development skill — Luau helper modules, project templates and reference guides — that the Studio assistant loads on demand while you work.
- The AI engine settings now reach the engine: temperature applies to the selected assistant, "Max output tokens" caps the selected model's replies (0, the default, uses the model's own limit), and a custom API endpoint is used for every connected provider.
- A custom system prompt set in Settings is now included with every message you send.
- Sound effects and desktop notifications preferences now do something: a cue plays when you send a message and when a reply finishes, and a desktop notification appears when a reply finishes while BloxMind is in the background.
- Turning off "Auto-scroll" in Settings now stops the chat from jumping to the newest message.

### Fixed

- Replies are no longer cut off mid-task: the previously non-functional "Max output tokens" default (4,096) no longer caps every reply now that the setting works. It now defaults to the model's own limit, and a cap you choose is clamped to what the model supports. Engine settings are also only sent to the engine when they actually change, instead of on every settings refetch.
- A reply that stopped mid-thought no longer keeps happening after the cap is cleared: clearing "Max output tokens" now also removes the limit left behind in the engine's settings, which used to survive the reset and cut long replies off mid-thought.
- The task list the assistant writes for a turn now stays inline with that turn in the chat history instead of sliding to the bottom when you send the next message.
- Stopping the agent mid-turn no longer leaves a frozen "Thinking…" indicator or leftover reasoning and tool rows on screen. The thinking indicator only shows while the agent is actually working, and a stopped turn that produced no text leaves nothing behind.
- The local connection to Roblox Studio now rejects requests that don't come from this machine, protecting the bridge against DNS-rebinding attacks from a malicious web page.
- The automatic checkpoint badge and "Restore files" action no longer appear while the agent is still working, including while it is retrying a request.
- Checkpoint marks only appear for checkpoints captured during the current session. After restarting the app, previously captured checkpoints are no longer offered for restore.
- Build validation now runs the tools installed in the project itself and skips checks the project doesn't have. Previously the validator could fail to start on Windows, report a "build failure", and silently roll the agent's changes back.
- Validation only runs after a task actually finishes in the current chat. Starting the app or switching chats no longer risks silently restoring files you didn't ask for.
- Capturing a checkpoint skips files it can't read instead of recording them as missing, so restoring a checkpoint can no longer delete a file that was never backed up.
- Restoring files no longer starts an extra model turn; the assistant is updated silently instead.
- The temporary connection-check and playtest-planner chats no longer appear in the chat list.
- Switching models no longer resets your reasoning-effort choice back to the saved default.

## [0.13.8] - 2026-10-16

### Added

- Hovering a model in the model picker now shows its specs: provider, the inputs it accepts, whether it supports reasoning, and its context window.

### Fixed

- The Studio assistant is standalone: it reads and writes the open place only through Studio's MCP tools, never a local sync tool or a `default.project.json`. Leftover live-sync instructions from older versions are removed from your workspace when the app starts.
- The Explorer's project index works again instead of failing with "project-index programs may not call search_game_tree".
- Model context limits are read from the model provider instead of guessed, so the context usage indicator and the model picker show the right window.

## [0.13.7] - 2026-10-01

### Changed

- The Windows installer and app are now signed by Paralov AS.

## [0.13.6] - 2026-09-30

### Fixed

- First-time setup on Windows now tries unpacking OpenCode again when antivirus software locks or removes it for a moment. If it stays blocked, or the drive is nearly full, the setup screen says so and what to do, and the error report says which step failed and why.

## [0.13.5] - 2026-09-30

### Fixed

- BloxBot no longer stops at setup when GitHub refuses or doesn't answer the check for OpenCode updates. It downloads a known-good OpenCode version directly instead, and the error says what went wrong if even that download fails.
- When OpenCode stops during startup or never finishes starting, the error now includes the last lines OpenCode printed, so reports show why.
- When Explorer has the model write its own program and the model returns nothing, BloxBot now reports the model's own error instead of a generic decode error. The model is also kept from calling Studio tools while it writes the program, so it can't stall waiting for an approval.
- BloxBot now finds Studio's MCP helper in the newer Roblox Studio install folder on Windows, so fewer people end up on Studio's broken launcher.
- Updating the BloxBot programs no longer fails when two updates run at the same time, and the saved copy can't be read half written.
- Generating a playtest plan fails less often. When the model answers without a plan, BloxBot reminds it once to return the plan and tries again.

## [0.13.4] - 2026-09-29

### Fixed

- BloxBot now connects to Roblox Studio on Windows even when Studio's own MCP launcher is broken after a Studio update. It finds and starts Studio's MCP helper itself.

## [0.13.3] - 2026-09-29

### Changed

- Check's error reports include the model name again, since it helps tell where an error came from.
- The Privacy settings say that error reports can name the provider and model an error came from, and stay on when Share AI usage data is off.

### Fixed

- When Explorer has the model write its own program, that program works more often. It can call Studio's tools by the names the model sees, the model is told exactly which tools it may use, and BloxBot tries each program once before using it and gives the model one chance to fix a program that fails.
- BloxBot no longer stops at a setup error when it can't reach Roblox Studio's MCP helper at launch. It retries for about 30 seconds, keeps working while it waits, and the Studio setup screen says how to fix it when Studio's MCP helper is missing or keeps closing.
- Generating a playtest plan now works, including on OpenCode's free models. Before, it failed almost every time.
- When plan generation fails, the Playtest panel shows the provider's error instead of saying the plan was invalid.
- Generate from chat is turned off in a chat with no messages yet, with a note that plans are built from the conversation. Write my own still works.

## [0.13.2] - 2026-09-28

### Fixed

- Check in Providers lets you pick the model to test, starting with the model you chat with or the provider's default. It had picked models your key or plan might not include, so working connections showed as failing. The result names the model it checked.
- Error reports also remove email addresses, and Check's error reports leave out model names unless Share AI usage data is on.

## [0.13.1] - 2026-09-28

### Added

- BloxBot reports errors from the app and its background process so we can find and fix them. Personal file paths, usernames and API keys are removed before anything is sent.

### Fixed

- Check in Providers tests the model you chat with, or the provider's default, instead of the cheapest model on the list. It had picked image-only and limited preview models, so working keys and sign-ins showed as failing.

## [0.13.0] - 2026-09-28

### Added

- BloxBot downloads signed updates to the small programs it runs against Roblox Studio (Explorer, and finding and checking the Studio to work in), so a change in Studio's MCP can be fixed without a new BloxBot release. It keeps the last verified copy and falls back to the programs it shipped with.

### Changed

- Programs BloxBot runs against Studio, including ones the model writes, can only use read-only Studio tools.

## [0.12.1] - 2026-09-28

### Fixed

- Explorer loads the Studio place tree again. Roblox Studio's MCP now requires a data model for `search_game_tree`, which BloxBot didn't send, so Explorer had failed for everyone since mid-August. During a playtest it shows the server data model, and it names the place.
- When the built-in Explorer setup fails on first load, BloxBot has the model write one against Studio's current tools instead of giving up.
- Reopening Explorer retries a setup that failed, and a failing Explorer backs off to a retry every few minutes at most instead of every few seconds.

## [0.12.0] - 2026-09-28

### Added

- Sign in to OpenAI with a device code as well as in the browser, so a ChatGPT Plus or Pro plan still connects when the browser sign-in can't finish.
- Settings → Providers shows provider logos, says how each provider connects, and has a search box.
- Providers that ask a question before signing in, such as GitHub Enterprise for Copilot, now ask it.
- Check any connected provider from Settings → Providers. BloxBot sends one short test message through its cheapest model and shows whether the key or sign-in works, with a Reconnect link when the key is rejected. The toast after connecting offers the same check.
- OpenCode Zen is listed as its own provider in Settings → Providers, separate from the free models. Connect it with a Zen key, and remove the key to go back to the free models.
- Settings → Providers recommends OpenCode Go ($10/month, or Go Plus at $40/month) to people using only the free models, and walks through setting it up.

### Fixed

- A failed sign-in explains what went wrong and suggests the method most likely to work, instead of "Failed to start sign-in flow".
- A sign-in that stalls offers a way back to the other methods and a link to reopen the sign-in page.
- Signing in, saving a key or removing one no longer shows as failed when refreshing the provider list afterwards fails.
- Closing the dialog or going back while a sign-in is starting no longer opens the browser or resumes the abandoned sign-in.
- Replacing the key of an already connected provider closes the dialog instead of leaving it open.
- The models BloxBot includes for free show as "Free models" in Settings and the model picker, rather than "OpenCode Zen", until a Zen key is added.
- Settings no longer squeezes its content into a sliver in narrow windows. When space is tight, its sections become a row of tabs on top.

## [0.11.1] - 2026-09-24

### Added

- Settings → Privacy links to the Privacy Policy and Terms of Service, and shows your device ID for data requests.

## [0.11.0] - 2026-09-24

### Changed

- Usage data now includes your AI chats and tool activity to help improve BloxBot. Turn it off in Settings → Privacy.

## [0.10.0] - 2026-08-20

### Added

- Updated multi-Studio routing for Roblox Studio MCP's stateless `studio_id` contract, including Place ID disambiguation, per-session target restoration, and BloxBot identification in Studio's connected AI client list.

### Fixed

- Removed the obsolete `set_active_studio` flow and now routes chat and Explorer tool calls to the selected Studio explicitly.

## [0.9.1] - 2026-08-09

### Fixed

- Fixed first-run setup failing with `StudioMcpBrokerError` (`spawn cmd.exe ENOENT`) by creating the `~/BloxBot` workspace before launching the Roblox Studio MCP helper; on fresh installs the workspace did not exist yet and Node reports a missing spawn `cwd` as ENOENT on the executable. ([#76](https://github.com/paralov/app-bloxbot-ai/issues/76))

## [0.9.0] - 2026-08-07

### Changed

- Turned model usage metrics into an opt-out setting with a one-time in-app notice; choices recorded under the previous opt-in prompt do not carry over, and the Settings → Privacy toggle remains authoritative.
- Anonymized analytics: events no longer create a person profile. A random device identifier is retained for aggregate counts.

### Fixed

- Fixed a startup failure on Windows when the system `PATH` does not include `System32` by resolving `cmd.exe` through `ComSpec` before launching the Roblox Studio MCP helper. ([#73](https://github.com/paralov/app-bloxbot-ai/issues/73))
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

[Unreleased]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.14.2...HEAD
[0.14.2]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.13.8...v0.14.0
[0.13.8]: https://github.com/BloxMind-studio/bloxmind-desktop/compare/v0.13.7...v0.13.8
[0.13.7]: https://github.com/paralov/app-bloxbot-ai/compare/v0.13.6...v0.13.7
[0.13.6]: https://github.com/paralov/app-bloxbot-ai/compare/v0.13.5...v0.13.6
[0.13.5]: https://github.com/paralov/app-bloxbot-ai/compare/v0.13.4...v0.13.5
[0.13.4]: https://github.com/paralov/app-bloxbot-ai/compare/v0.13.3...v0.13.4
[0.13.3]: https://github.com/paralov/app-bloxbot-ai/compare/v0.13.2...v0.13.3
[0.13.2]: https://github.com/paralov/app-bloxbot-ai/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/paralov/app-bloxbot-ai/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/paralov/app-bloxbot-ai/compare/v0.12.1...v0.13.0
[0.12.1]: https://github.com/paralov/app-bloxbot-ai/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/paralov/app-bloxbot-ai/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/paralov/app-bloxbot-ai/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/paralov/app-bloxbot-ai/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/paralov/app-bloxbot-ai/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/paralov/app-bloxbot-ai/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/paralov/app-bloxbot-ai/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/paralov/app-bloxbot-ai/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/paralov/app-bloxbot-ai/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/paralov/app-bloxbot-ai/compare/v0.6.7...v0.7.0
[0.6.7]: https://github.com/paralov/app-bloxbot-ai/compare/v0.6.6...v0.6.7
[0.6.6]: https://github.com/paralov/app-bloxbot-ai/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/paralov/app-bloxbot-ai/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/paralov/app-bloxbot-ai/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/paralov/app-bloxbot-ai/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/paralov/app-bloxbot-ai/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/paralov/app-bloxbot-ai/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/paralov/app-bloxbot-ai/compare/v0.5.2...v0.6.0

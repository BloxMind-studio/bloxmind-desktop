//! OpenCode server management.
//!
//! Starts the OpenCode server as a child process on app launch and emits
//! Tauri events when its status changes. The frontend never polls -- it
//! just listens for `opencode-status-changed` events.
//!
//! All process spawning goes through `tauri-plugin-shell`, which provides
//! sidecar resolution, event-based stdout/stderr, and cross-platform
//! process management (including hiding console windows on Windows).

use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

/// BloxBot's reserved port range within the IANA dynamic/private range
/// (49152-65535). The block is 10 ports; the app binds to the first
/// available port in the block.
///
/// 59200-59209: OpenCode server (HTTP API)
const OC_PORT_START: u16 = 59200;
const PORT_RANGE: u16 = 10;

/// All servers bind to IPv4 loopback. Using `"localhost"` is **not**
/// safe because macOS resolves it to `[::1]` (IPv6), causing our IPv4
/// health checks to fail with "connection refused".
pub const LOOPBACK: &str = "127.0.0.1";

/// Shared HTTP client — reuses connections across poll calls.
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(800))
            .build()
            .unwrap_or_default()
    })
}

// ── Status ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub enum OpenCodeStatus {
    Stopped,
    Starting,
    Running,
    Error(String),
}

/// Payload emitted with the `opencode-status-changed` event.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StatusPayload {
    pub status: OpenCodeStatus,
    pub port: u16,
}

// ── State ───────────────────────────────────────────────────────────────

pub struct OpenCodeState {
    pub status: OpenCodeStatus,
    pub port: u16,
    pub(crate) child: Option<CommandChild>,
}

impl Default for OpenCodeState {
    fn default() -> Self {
        Self {
            status: OpenCodeStatus::Stopped,
            port: 0,
            child: None,
        }
    }
}

pub type SharedOpenCodeState = Arc<Mutex<OpenCodeState>>;

// ── Helpers ─────────────────────────────────────────────────────────────

/// Emit a status change event to the frontend.
fn emit_status(app: &AppHandle, status: &OpenCodeStatus, port: u16) {
    let _ = app.emit(
        "opencode-status-changed",
        StatusPayload {
            status: status.clone(),
            port,
        },
    );
}

/// Update the state and emit the event in one step.
async fn set_status(state: &SharedOpenCodeState, app: &AppHandle, status: OpenCodeStatus) {
    let port;
    {
        let mut s = state.lock().await;
        s.status = status.clone();
        port = s.port;
    }
    emit_status(app, &status, port);
}

/// Find the first available TCP port starting from `start`, trying
/// up to `PORT_RANGE` consecutive ports. All servers bind to `LOOPBACK`
/// (127.0.0.1), so we only need to probe that address.
async fn find_available_port(start: u16) -> u16 {
    for port in start..start.saturating_add(PORT_RANGE) {
        if tokio::net::TcpListener::bind((LOOPBACK, port))
            .await
            .is_ok()
        {
            return port;
        }
        log::debug!("Port {port} unavailable, skipping");
    }
    log::error!("All ports {start}-{} are unavailable!", start.saturating_add(PORT_RANGE - 1));
    start // fallback — let the spawn surface the real error
}

/// Strip the Windows extended-length path prefix (`\\?\`) from a path string.
/// These prefixes are returned by `std::fs::canonicalize` / Tauri resource resolution
/// but break when used in the `PATH` env var or passed to other programs.
#[cfg(windows)]
fn strip_win_prefix(p: &std::path::Path) -> String {
    let s = p.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

// ── Studio MCP binary resolution ────────────────────────────────────────

/// Returns the command array for launching the official Roblox Studio MCP
/// server. The binary ships with Roblox Studio itself — no separate
/// download required.
///
/// macOS:   ["/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP"]
/// Windows: ["cmd.exe", "/c", "%LOCALAPPDATA%\\Roblox\\mcp.bat"]
fn studio_mcp_command() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        vec!["/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP".to_string()]
    }
    #[cfg(target_os = "windows")]
    {
        let local_app = dirs::data_local_dir()
            .map(|p| p.join("Roblox").join("mcp.bat"))
            .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Users\Default\AppData\Local\Roblox\mcp.bat"));
        vec![
            "cmd.exe".to_string(),
            "/c".to_string(),
            local_app.to_string_lossy().to_string(),
        ]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Fallback for unsupported platforms
        vec!["studio-mcp".to_string()]
    }
}

// ── Startup cleanup ─────────────────────────────────────────────────────

/// Kill any stale processes listening on our reserved port range
/// (59200-59209). This handles the case where BloxBot crashed or was
/// force-quit, leaving orphan processes holding ports.
///
/// Uses platform-specific commands:
/// - macOS/Linux: `lsof -ti tcp:PORT` to find PIDs, then `kill -9`
/// - Windows: `netstat -ano` to find PIDs, then `taskkill /F /PID`
pub fn cleanup_stale_processes() {
    let start = OC_PORT_START; // 59200
    let end = OC_PORT_START + PORT_RANGE; // 59210
    log::info!("Checking for stale processes on ports {start}-{}", end - 1);

    #[cfg(unix)]
    {
        let mut killed = 0u32;
        for port in start..end {
            let output = std::process::Command::new("lsof")
                .args(["-ti", &format!("tcp:{port}")])
                .output();

            if let Ok(out) = output {
                let pids = String::from_utf8_lossy(&out.stdout);
                for pid_str in pids.split_whitespace() {
                    if let Ok(pid) = pid_str.trim().parse::<u32>() {
                        log::info!("Killing stale process PID {pid} on port {port}");
                        let _ = std::process::Command::new("kill")
                            .args(["-9", &pid.to_string()])
                            .output();
                        killed += 1;
                    }
                }
            }
        }
        if killed > 0 {
            log::info!("Killed {killed} stale process(es)");
        } else {
            log::info!("No stale processes found");
        }
    }

    #[cfg(windows)]
    {
        // Parse netstat output to find PIDs listening on our ports.
        let output = std::process::Command::new("netstat")
            .args(["-ano", "-p", "TCP"])
            .output();

        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for port in start..end {
                let needle = format!("{}:{}", LOOPBACK, port);
                for line in text.lines() {
                    if line.contains(&needle) && line.contains("LISTENING") {
                        // Last column is the PID
                        if let Some(pid_str) = line.split_whitespace().last() {
                            if let Ok(pid) = pid_str.parse::<u32>() {
                                if pid > 0 {
                                    log::info!("Killing stale process PID {pid} on port {port}");
                                    let _ = std::process::Command::new("taskkill")
                                        .args(["/F", "/PID", &pid.to_string()])
                                        .output();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Core lifecycle ──────────────────────────────────────────────────────

/// Start the OpenCode server. Called automatically on app launch.
///
/// Uses `tauri-plugin-shell` sidecar support to spawn the bundled
/// `opencode` binary. stdout/stderr and process exit are handled via
/// the shell plugin's event channel, replacing manual BufReader capture
/// and polling-based exit monitoring.
pub async fn start_opencode_server(
    state: SharedOpenCodeState,
    app: AppHandle,
) -> Result<u16, String> {
    // Guard: don't double-start
    {
        let current = state.lock().await;
        if matches!(
            current.status,
            OpenCodeStatus::Running | OpenCodeStatus::Starting
        ) {
            return Ok(current.port);
        }
    }

    let nodejs_bin_dir = match crate::paths::bundled_nodejs_bin_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::error!("Failed to find Node.js: {e}");
            set_status(&state, &app, OpenCodeStatus::Error(e.clone())).await;
            return Err(e);
        }
    };
    log::info!("Node.js bin: {}", nodejs_bin_dir.display());

    set_status(&state, &app, OpenCodeStatus::Starting).await;

    // Run the actual startup logic. If anything fails after this point,
    // transition status to Error so the frontend can show a retry button
    // instead of being stuck on "Starting up..." forever.
    match do_start(&state, &app, &nodejs_bin_dir).await {
        Ok(port) => Ok(port),
        Err(e) => {
            set_status(&state, &app, OpenCodeStatus::Error(e.clone())).await;
            Err(e)
        }
    }
}

/// Inner startup logic extracted so that any `?` failure is caught by the
/// caller and translated into an `Error` status transition.
async fn do_start(
    state: &SharedOpenCodeState,
    app: &AppHandle,
    nodejs_bin_dir: &std::path::Path,
) -> Result<u16, String> {
    // Kill any stale processes from a previous crash/force-quit before
    // probing ports. This ensures find_available_port gets clean ports.
    cleanup_stale_processes();
    // Brief pause so the OS can release the TCP sockets after killing processes.
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    let port = find_available_port(OC_PORT_START).await;
    log::info!("OpenCode port: {port}");

    {
        let mut s = state.lock().await;
        s.port = port;
    }

    // Resolve the official Roblox Studio MCP binary path.
    // The built-in MCP server ships with Roblox Studio itself:
    //   macOS:   /Applications/RobloxStudio.app/Contents/MacOS/StudioMCP
    //   Windows: %LOCALAPPDATA%/Roblox/mcp.bat
    let studio_mcp_cmd = studio_mcp_command();
    log::info!("Studio MCP command: {:?}", studio_mcp_cmd);

    let mcp_config = serde_json::json!({
        "plugin": [
            "opencode-gemini-auth@latest"
        ],
        "mcp": {
            "roblox-studio": {
                "type": "local",
                "command": studio_mcp_cmd,
                "enabled": true
            }
        },
        "default_agent": "studio",
        "agent": {
            "build": {
                "description": "Executes tools based on the conversation"
            },
            "studio": {
                "mode": "primary",
                "description": "Roblox Studio development assistant",
                "prompt": concat!(
                    "You are BloxBot, an expert Roblox game developer working directly inside Roblox Studio via the official built-in MCP server. ",
                    "You build games by using MCP tools to read, write, and execute code in the live Studio session — never by showing code snippets for the user to paste.\n\n",

                    // ── Workflow ──────────────────────────────────────────
                    "## Workflow\n",
                    "1. **Explore first.** Use `search_game_tree` (depth 5-10), `inspect_instance`, `script_search`, and `script_read` to understand the project before changing anything. Never guess at paths or names.\n",
                    "2. **Edit with tools.** Use `multi_edit` for script changes and `execute_luau` for instance creation, property changes, and batch operations. Never tell the user to paste code.\n",
                    "3. **Verify after.** Re-read scripts with `script_read` and confirm DataModel changes with `inspect_instance` or `search_game_tree`.\n",
                    "4. **Debug with playtests.** Instrument code → `start_stop_play(\"start\")` → simulate input or ask the user to act → `console_output()` + `execute_luau` to probe live state → `start_stop_play(\"stop\")` → fix → repeat.\n\n",

                    // ── Project awareness ─────────────────────────────────
                    "## Project Awareness\n",
                    "At the start of a session, scan the codebase to learn its architecture. Use `search_game_tree` with high depth, then read key scripts. Identify:\n",
                    "- **Frameworks**: Knit, AeroGameFramework, Rojo, Nevermore, Fusion, Roact/React-lua, Rodux, ProfileService, DataStore2, etc. All new code must follow existing patterns.\n",
                    "- **Folder conventions**: How are scripts organized? Place new code where it belongs.\n",
                    "- **Module patterns**: Return table, OOP metatables, functional? Match the style.\n",
                    "- **Communication patterns**: Direct RemoteEvents, or wrapped (Knit, BridgeNet2, Red)? Use the same approach.\n",
                    "- **Naming conventions**: PascalCase, camelCase, prefix systems? Be consistent.\n\n",
                    "Carry this context throughout the session. Do not introduce new frameworks or architectural styles unless the user explicitly asks.\n\n",

                    // ── Tool guide ────────────────────────────────────────
                    "## Tool Guide\n\n",

                    "### Scripts\n",
                    "- `script_read(path)` — Read script content using dot-notation (e.g. `game.ServerScriptService.MyScript`). Supports `start_line`/`end_line` for ranges. Always read before editing.\n",
                    "- `multi_edit(path, edits[])` — Atomic sequential edits using exact string matching. Copy the exact text from `script_read` output as the match target. Prefer narrow, targeted edits over full rewrites. Can create new scripts if the path doesn't exist.\n",
                    "- `script_search(query)` — Fuzzy search script names (max 10 results).\n",
                    "- `script_grep(pattern)` — Search all script contents for a string pattern (max 50 matches). Use to find references, remote names, API usage.\n\n",

                    "### Data Model\n",
                    "- `search_game_tree(path?, instance_type?, keyword?, depth?)` — Explore the instance hierarchy as flat JSON. Default depth 3, max 10.\n",
                    "- `inspect_instance(path)` — All readable properties, custom attributes, children count, descendants. Always inspect before modifying properties via Luau.\n\n",

                    "### Code Execution\n",
                    "`execute_luau(code)` — Execute Luau directly in Studio. This is your primary tool for:\n",
                    "- **Creating instances**: `Instance.new(\"Part\", workspace)`\n",
                    "- **Setting properties**: `workspace.Part.Color = Color3.new(1, 0, 0)`\n",
                    "- **Batch operations**: Updating many objects, building folder structures, migrations\n",
                    "- **Runtime inspection**: Querying live state during playtests\n",
                    "- **Anything the focused tools don't cover**\n\n",
                    "Keep `execute_luau` code minimal and explicit. Print or return confirmation data. Prefer idempotent operations.\n\n",

                    "### Playtesting & Debugging\n",
                    "- `start_stop_play(\"start\")` / `start_stop_play(\"stop\")` — Start/stop playtesting.\n",
                    "- `console_output()` — Retrieve console logs. Check immediately after starting a playtest or triggering a feature.\n",
                    "- **Always stop playtesting before making structural edits** to ensure changes persist in the Edit session.\n\n",
                    "Debug loop:\n",
                    "1. Add strategic print/warn statements to trace execution\n",
                    "2. Start playtest\n",
                    "3. Trigger the behavior — use input simulation or ask the user\n",
                    "4. `console_output()` to read logs + `execute_luau` to probe live state\n",
                    "5. Stop playtest\n",
                    "6. Apply minimal fix\n",
                    "7. Repeat until resolved\n\n",

                    "### Input Simulation\n",
                    "Use during active playtests to validate gameplay and UI:\n",
                    "- `character_navigation(target)` — Move player to a position or instance path\n",
                    "- `keyboard_input(action, key)` — Key presses, holds, text input\n",
                    "- `mouse_input(action, position?)` — Clicks, movement, scrolling\n\n",

                    "### Session Management\n",
                    "- `list_roblox_studios()` — List connected Studio instances\n",
                    "- `set_active_studio(studio_id)` — Target a specific instance before making changes\n\n",

                    // ── Roblox architecture ───────────────────────────────
                    "## Roblox Architecture\n\n",

                    "**DataModel**: game → Services → Instances. Key services:\n",
                    "- `Workspace` — 3D world. BaseParts, Models, Terrain, Camera. Replicated.\n",
                    "- `ServerScriptService` — Server Scripts. Never accessible from client.\n",
                    "- `ServerStorage` — Server-only assets and data. Not replicated.\n",
                    "- `ReplicatedStorage` — Shared modules, RemoteEvents, RemoteFunctions, assets.\n",
                    "- `StarterPlayerScripts` / `StarterCharacterScripts` — LocalScripts cloned per player.\n",
                    "- `StarterGui` — ScreenGuis/LocalScripts cloned to PlayerGui.\n",
                    "- `Players`, `Lighting`, `SoundService` — as named.\n",
                    "- Access all services via `:GetService()`.\n\n",

                    "**Client-server model**: Server is authoritative. Clients see a replicated subset. Communicate via RemoteEvents (fire-and-forget) and RemoteFunctions (request-response). ",
                    "**Never trust the client.** Validate all inputs server-side.\n\n",

                    "**Script types**: `Script` (server), `LocalScript` (client), `ModuleScript` (shared via `require()`). Place them in the correct service.\n\n",

                    // ── Luau style ────────────────────────────────────────
                    "## Luau Style\n",
                    "- Idiomatic Luau: type annotations, string interpolation, `if-then-else` expressions.\n",
                    "- Descriptive names: `player` not `p`, `character` not `char`, `humanoid` not `hum`.\n",
                    "- PascalCase for services/instances/properties/methods. camelCase for locals.\n",
                    "- `:GetService()` for services. `:WaitForChild()` on client for instances that may not have replicated.\n",
                    "- `task.spawn`, `task.defer`, `task.delay`, `task.wait` — never legacy `spawn`/`wait`/`delay`.\n",
                    "- Clean up: disconnect connections, destroy clones, cancel threads.\n\n",

                    // ── Safety & communication ────────────────────────────
                    "## Safety\n",
                    "- Never overwrite large scripts unless necessary. Prefer targeted `multi_edit`.\n",
                    "- Never invent paths, remotes, or instances without verifying they exist.\n",
                    "- Never claim a fix works until verified with `script_read`, `inspect_instance`, or playtesting.\n",
                    "- If a change is risky or destructive, say so and proceed carefully.\n\n",

                    "## Communication\n",
                    "Be concise and practical. State what you did, not how to do it — the tools already did it. ",
                    "Explain *why* when it's non-obvious. When console errors appear, immediately read the relevant script to diagnose. ",
                    "If a request is outside what the tools can do (publishing, Team Create, marketplace), say so clearly."
                )
            }
        }
    });
    let config_content = serde_json::to_string_pretty(&mcp_config)
        .map_err(|e| format!("Failed to serialize OpenCode config: {e}"))?;

    log::debug!("Config: {config_content}");

    let workspace = crate::paths::workspace_dir()?;

    // Create isolated XDG directories under ~/BloxBot/.opencode/
    // This prevents the bundled OpenCode from reading/writing to the user's
    // global ~/.config/opencode, ~/.local/share/opencode, etc.
    let opencode_home = workspace.join(".opencode");
    let xdg_data = opencode_home.join("data");
    let xdg_config = opencode_home.join("config");
    let xdg_cache = opencode_home.join("cache");
    let xdg_state = opencode_home.join("state");

    // Create directories if they don't exist
    for dir in [&xdg_data, &xdg_config, &xdg_cache, &xdg_state] {
        if !dir.exists() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create directory {}: {e}", dir.display()))?;
        }
    }

    // Write the config file that OpenCode actually reads on startup.
    // OPENCODE_CONFIG_CONTENT env var is ignored — OpenCode loads from
    // {XDG_CONFIG_HOME}/opencode/opencode.json instead.
    let config_dir = xdg_config.join("opencode");
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config dir: {e}"))?;
    let config_file = config_dir.join("opencode.json");
    std::fs::write(&config_file, &config_content)
        .map_err(|e| format!("Failed to write OpenCode config: {e}"))?;
    log::info!("Wrote OpenCode config to {}", config_file.display());

    // Build a minimal PATH with our bundled Node.js bin directory first,
    // then essential system paths. This ensures npx/npm use our bundled Node.js.
    //
    // On Windows, Tauri resolves resource paths with the \\?\ extended-length prefix
    // (from std::fs::canonicalize). This prefix breaks PATH lookups and child process
    // resolution, so we strip it.
    let sidecar_dir = crate::paths::sidecar_dir()?;

    #[cfg(unix)]
    let nodejs_bin = nodejs_bin_dir.to_string_lossy().to_string();
    #[cfg(windows)]
    let nodejs_bin = strip_win_prefix(nodejs_bin_dir);

    #[cfg(unix)]
    let sidecar_path_str = sidecar_dir.to_string_lossy().to_string();
    #[cfg(windows)]
    let sidecar_path_str = strip_win_prefix(&sidecar_dir);

    #[cfg(unix)]
    let minimal_path = format!(
        "{}:{}:/usr/bin:/bin:/usr/sbin:/sbin",
        nodejs_bin, sidecar_path_str
    );
    #[cfg(windows)]
    let minimal_path = format!(
        "{};{};C:\\Windows\\System32;C:\\Windows",
        nodejs_bin, sidecar_path_str
    );

    // Spawn the sidecar via the shell plugin. This automatically resolves
    // the binary from the `externalBin` config in tauri.conf.json.
    let (rx, child) = app
        .shell()
        .sidecar("opencode")
        .map_err(|e| {
            let msg = format!("Failed to create sidecar command: {e}");
            log::error!("{msg}");
            msg
        })?
        .args([
            "serve",
            "--port",
            &port.to_string(),
            "--hostname",
            LOOPBACK,
            "--print-logs",
            "--log-level",
            "DEBUG",
        ])
        .current_dir(&workspace)
        // Isolated XDG directories
        .env("XDG_DATA_HOME", &xdg_data)
        .env("XDG_CONFIG_HOME", &xdg_config)
        .env("XDG_CACHE_HOME", &xdg_cache)
        .env("XDG_STATE_HOME", &xdg_state)
        // Minimal PATH with bundled node/npm/npx first
        .env("PATH", &minimal_path)
        .spawn()
        .map_err(|e| {
            let msg = format!("Failed to start OpenCode server: {e}");
            log::error!("{msg}");
            msg
        })?;

    log::info!("Isolated environment: {}", opencode_home.display());
    log::debug!("PATH: {}", minimal_path);

    {
        let mut s = state.lock().await;
        s.child = Some(child);
    }

    // Spawn an event handler for stdout, stderr, and process exit.
    // This replaces both the BufReader capture tasks and the polling-based
    // spawn_exit_monitor from the old tokio::process implementation.
    spawn_event_handler(rx, Arc::clone(state), app.clone());

    // Wait for the server to be ready by polling the health endpoint.
    // If the process exits (detected via the event handler setting the
    // status to Error), bail out immediately instead of waiting the full
    // timeout — this avoids a ~35 second hang when the binary crashes on
    // launch.
    let health_url = format!("http://{LOOPBACK}:{port}/global/health");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_default();

    let mut healthy = false;
    for _ in 0..15 {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Check if the process already exited (the event handler sets
        // child to None and status to Error on termination).
        {
            let s = state.lock().await;
            if s.child.is_none() {
                // Process is gone — return whatever error the event
                // handler already set, or a generic message.
                if let OpenCodeStatus::Error(ref msg) = s.status {
                    let err = msg.clone();
                    log::error!("Process exited before becoming healthy: {err}");
                    return Err(err);
                }
                let err = "OpenCode process exited before becoming healthy".to_string();
                log::error!("{err}");
                drop(s);
                set_status(state, app, OpenCodeStatus::Error(err.clone())).await;
                return Err(err);
            }
        }

        if let Ok(resp) = client.get(&health_url).send().await {
            if resp.status().is_success() {
                healthy = true;
                break;
            }
        }
    }

    if healthy {
        log::info!("Server healthy on port {port}");
        set_status(state, app, OpenCodeStatus::Running).await;
        Ok(port)
    } else {
        // One final check: the process may have died on the last iteration.
        let s = state.lock().await;
        if let OpenCodeStatus::Error(ref msg) = s.status {
            let err = msg.clone();
            log::error!("Process exited during health check: {err}");
            return Err(err);
        }
        drop(s);

        let err = "OpenCode server started but health check timed out".to_string();
        log::error!("{err}");
        set_status(state, app, OpenCodeStatus::Error(err.clone())).await;
        Err(err)
    }
}

/// Spawn an event handler task that processes stdout/stderr and handles
/// process termination logging.
///
/// Runs on a dedicated OS thread with its own tokio runtime because the
/// shell plugin's `CommandEvent` receiver is not `Send`.
fn spawn_event_handler(
    rx: tauri::async_runtime::Receiver<CommandEvent>,
    state: SharedOpenCodeState,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                log::error!("Failed to build tokio runtime for event handler: {e}");
                return;
            }
        };

        rt.block_on(async move {
            process_events(rx, &state, &app).await;
        });
    });
}

/// Sidecar stderr lines matching these substrings are high-frequency
/// noise (polling, per-request logs, bus events, tool registry chatter)
/// that add no diagnostic value at normal log levels.
const NOISY_PATTERNS: &[&str] = &[
    "path=/mcp request",
    "path=/global/health request",
    "service=server method=",
    "service=server status=",
    "service=bus type=",
    "service=tool.registry",
    "service=permission",
];

/// Parse the sidecar's own log level from its structured output.
/// Lines look like: `INFO  2026-02-12T... message` or `DEBUG ...`.
/// Returns the extracted level and the original line (for logging).
fn parse_sidecar_level(line: &str) -> log::Level {
    let trimmed = line.trim_start();
    if trimmed.starts_with("ERROR") {
        log::Level::Error
    } else if trimmed.starts_with("WARN") {
        log::Level::Warn
    } else if trimmed.starts_with("DEBUG") {
        log::Level::Debug
    } else if trimmed.starts_with("INFO") {
        log::Level::Info
    } else {
        // Unstructured line (e.g. stack trace, raw output) — default to warn
        log::Level::Warn
    }
}

/// Returns `true` if the line is high-frequency noise that should be
/// suppressed at normal verbosity.
fn is_noisy_sidecar_line(line: &str) -> bool {
    NOISY_PATTERNS.iter().any(|p| line.contains(p))
}

/// Process shell plugin events until the process terminates.
async fn process_events(
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    state: &SharedOpenCodeState,
    app: &AppHandle,
) {
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                let trimmed = text.trim_end();
                if is_noisy_sidecar_line(trimmed) {
                    log::trace!(target: "opencode::stdout", "{trimmed}");
                } else {
                    log::info!(target: "opencode::stdout", "{trimmed}");
                }
            }
            CommandEvent::Stderr(line) => {
                let text = String::from_utf8_lossy(&line);
                let trimmed = text.trim_end();
                if trimmed.is_empty() {
                    continue;
                }
                if is_noisy_sidecar_line(trimmed) {
                    log::trace!(target: "opencode::stderr", "{trimmed}");
                } else {
                    match parse_sidecar_level(trimmed) {
                        log::Level::Error => log::error!(target: "opencode::stderr", "{trimmed}"),
                        log::Level::Warn => log::warn!(target: "opencode::stderr", "{trimmed}"),
                        log::Level::Info => log::info!(target: "opencode::stderr", "{trimmed}"),
                        log::Level::Debug => log::debug!(target: "opencode::stderr", "{trimmed}"),
                        _ => log::debug!(target: "opencode::stderr", "{trimmed}"),
                    }
                }
            }
            CommandEvent::Terminated(payload) => {
                handle_process_exit(state, app, &payload).await;
                return;
            }
            _ => {}
        }
    }
}

/// Handle process termination. Sets the appropriate status so the
/// frontend can show an error with a manual retry button.
async fn handle_process_exit(
    state: &SharedOpenCodeState,
    app: &AppHandle,
    payload: &tauri_plugin_shell::process::TerminatedPayload,
) {
    let mut s = state.lock().await;
    s.child = None;

    if payload.code == Some(0) {
        log::info!("Process exited cleanly");
        s.status = OpenCodeStatus::Stopped;
        emit_status(app, &s.status, s.port);
        return;
    }

    let raw_msg = format!(
        "Exited with code {:?} (signal {:?})",
        payload.code, payload.signal
    );
    log::warn!("Process exited: {raw_msg}");

    // Present a human-friendly message to the user; the raw details
    // are already in the log for debugging.
    let user_msg = match payload.code {
        Some(code) => format!("The server exited unexpectedly (code {code})."),
        None => match payload.signal {
            Some(sig) => format!("The server was terminated by signal {sig}."),
            None => "The server stopped unexpectedly.".to_string(),
        },
    };
    s.status = OpenCodeStatus::Error(user_msg);
    emit_status(app, &s.status, s.port);
}

/// Gracefully stop the OpenCode sidecar process.
pub async fn stop_all(state: &SharedOpenCodeState, app: &AppHandle) {
    let has_child = {
        let s = state.lock().await;
        s.child.is_some()
    };

    if !has_child {
        return;
    }

    let mut s = state.lock().await;
    if let Some(child) = s.child.take() {
        let _ = child.kill();
    }
    s.status = OpenCodeStatus::Stopped;
    s.port = 0;
    emit_status(app, &s.status, 0);
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Get the current OpenCode server status. Used for the initial status
/// check when the frontend first loads (in case it missed earlier events).
#[tauri::command]
pub async fn get_opencode_status(
    state: tauri::State<'_, SharedOpenCodeState>,
) -> Result<(OpenCodeStatus, u16), String> {
    let s = state.lock().await;
    Ok((s.status.clone(), s.port))
}

/// Restart the OpenCode server. Gracefully tears down all processes
/// (MCP + sidecar) then starts fresh. Called from the frontend retry button.
#[tauri::command]
pub async fn restart_opencode(
    state: tauri::State<'_, SharedOpenCodeState>,
    app: AppHandle,
) -> Result<u16, String> {
    // Stop everything first (no-op if already stopped)
    stop_all(state.inner(), &app).await;
    // Clean up any orphans that survived
    cleanup_stale_processes();
    // Small delay for ports to be released by the OS
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    // Start fresh
    start_opencode_server(state.inner().clone(), app).await
}

/// Poll the Studio MCP server status via the OpenCode server's /mcp
/// endpoint. The official Studio MCP binary handles the actual connection
/// to Roblox Studio — we just ask OpenCode for its status.
#[tauri::command]
pub async fn poll_studio_status(
    state: tauri::State<'_, SharedOpenCodeState>,
) -> Result<StudioStatusResult, String> {
    let oc_port = {
        let s = state.lock().await;
        if !matches!(s.status, OpenCodeStatus::Running) {
            return Ok(StudioStatusResult {
                status: "unknown".into(),
                error: None,
            });
        }
        s.port
    };
    let workspace = crate::paths::workspace_dir()?;
    let client = http_client();

    let workspace_str = workspace.to_string_lossy().to_string();
    let mcp_url = format!("http://{LOOPBACK}:{oc_port}/mcp");

    match client
        .get(&mcp_url)
        .header("x-opencode-directory", &workspace_str)
        .query(&[("directory", &workspace_str)])
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                log::trace!("OpenCode /mcp response: {body}");
                if let Some(rs) = body.get("roblox-studio") {
                    let status_str = rs
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");

                    match status_str {
                        "connected" => Ok(StudioStatusResult {
                            status: "connected".into(),
                            error: None,
                        }),
                        "failed" => {
                            let err = rs.get("error").and_then(|v| v.as_str()).map(String::from);
                            Ok(StudioStatusResult {
                                status: "failed".into(),
                                error: err,
                            })
                        }
                        "disabled" => Ok(StudioStatusResult {
                            status: "disabled".into(),
                            error: None,
                        }),
                        "needs_auth" | "needs_client_registration" => Ok(StudioStatusResult {
                            status: "needs_auth".into(),
                            error: None,
                        }),
                        _ => Ok(StudioStatusResult {
                            status: "disconnected".into(),
                            error: None,
                        }),
                    }
                } else {
                    Ok(StudioStatusResult {
                        status: "unknown".into(),
                        error: None,
                    })
                }
            } else {
                Ok(StudioStatusResult {
                    status: "unknown".into(),
                    error: None,
                })
            }
        }
        Ok(resp) => {
            log::warn!("OpenCode /mcp returned HTTP {}", resp.status());
            Ok(StudioStatusResult {
                status: "unknown".into(),
                error: None,
            })
        }
        Err(e) => {
            log::warn!("OpenCode /mcp request failed: {e}");
            Ok(StudioStatusResult {
                status: "unknown".into(),
                error: None,
            })
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StudioStatusResult {
    pub status: String,
    pub error: Option<String>,
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── OpenCodeStatus & OpenCodeState ────────────────────────────────

    #[test]
    fn default_state_is_stopped_port_zero() {
        let state = OpenCodeState::default();
        assert!(matches!(state.status, OpenCodeStatus::Stopped));
        assert_eq!(state.port, 0);
        assert!(state.child.is_none());
    }

    #[test]
    fn status_serializes_to_expected_json() {
        let stopped = serde_json::to_value(&OpenCodeStatus::Stopped).unwrap();
        assert_eq!(stopped, serde_json::json!("Stopped"));

        let starting = serde_json::to_value(&OpenCodeStatus::Starting).unwrap();
        assert_eq!(starting, serde_json::json!("Starting"));

        let running = serde_json::to_value(&OpenCodeStatus::Running).unwrap();
        assert_eq!(running, serde_json::json!("Running"));

        let error = serde_json::to_value(&OpenCodeStatus::Error("boom".into())).unwrap();
        assert_eq!(error, serde_json::json!({"Error": "boom"}));
    }

    #[test]
    fn status_payload_serializes_correctly() {
        let payload = StatusPayload {
            status: OpenCodeStatus::Running,
            port: 59200,
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["port"], 59200);
        assert_eq!(json["status"], "Running");
    }

    // ── Constants ────────────────────────────────────────────────────

    #[test]
    fn port_range_within_iana_dynamic_range() {
        assert!(OC_PORT_START >= 49152);
        assert!((OC_PORT_START + PORT_RANGE) as u32 <= 65535);
    }

    #[test]
    fn loopback_is_ipv4() {
        assert_eq!(LOOPBACK, "127.0.0.1");
    }

    // ── parse_sidecar_level ──────────────────────────────────────────

    #[test]
    fn parse_sidecar_level_error() {
        assert_eq!(
            parse_sidecar_level("ERROR 2026-03-22T12:00:00 something broke"),
            log::Level::Error
        );
    }

    #[test]
    fn parse_sidecar_level_warn() {
        assert_eq!(
            parse_sidecar_level("WARN  2026-03-22T12:00:00 deprecated usage"),
            log::Level::Warn
        );
    }

    #[test]
    fn parse_sidecar_level_info() {
        assert_eq!(
            parse_sidecar_level("INFO  2026-03-22T12:00:00 server started"),
            log::Level::Info
        );
    }

    #[test]
    fn parse_sidecar_level_debug() {
        assert_eq!(
            parse_sidecar_level("DEBUG 2026-03-22T12:00:00 tick"),
            log::Level::Debug
        );
    }

    #[test]
    fn parse_sidecar_level_unknown_defaults_to_warn() {
        assert_eq!(
            parse_sidecar_level("some random stack trace line"),
            log::Level::Warn
        );
    }

    #[test]
    fn parse_sidecar_level_leading_whitespace() {
        assert_eq!(
            parse_sidecar_level("  ERROR trailing text"),
            log::Level::Error
        );
    }

    // ── is_noisy_sidecar_line ────────────────────────────────────────

    #[test]
    fn noisy_patterns_detected() {
        assert!(is_noisy_sidecar_line("path=/mcp request id=123"));
        assert!(is_noisy_sidecar_line("path=/global/health request"));
        assert!(is_noisy_sidecar_line("service=server method=GET"));
        assert!(is_noisy_sidecar_line("service=server status=200"));
        assert!(is_noisy_sidecar_line("service=bus type=event"));
        assert!(is_noisy_sidecar_line("service=tool.registry loading"));
        assert!(is_noisy_sidecar_line("service=permission check=true"));
    }

    #[test]
    fn non_noisy_lines_pass_through() {
        assert!(!is_noisy_sidecar_line("ERROR something important"));
        assert!(!is_noisy_sidecar_line("server listening on port 59200"));
        assert!(!is_noisy_sidecar_line(""));
    }

    // ── studio_mcp_command ───────────────────────────────────────────

    #[test]
    fn studio_mcp_command_returns_non_empty_vec() {
        let cmd = studio_mcp_command();
        assert!(!cmd.is_empty());
        // On macOS, first element should be the StudioMCP path
        #[cfg(target_os = "macos")]
        assert!(cmd[0].contains("StudioMCP"));
        // On Windows, first element should be cmd.exe
        #[cfg(target_os = "windows")]
        assert_eq!(cmd[0], "cmd.exe");
    }

    // ── StudioStatusResult ───────────────────────────────────────────

    #[test]
    fn studio_status_result_serializes() {
        let result = StudioStatusResult {
            status: "connected".into(),
            error: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["status"], "connected");
        assert!(json["error"].is_null());

        let result_err = StudioStatusResult {
            status: "failed".into(),
            error: Some("timeout".into()),
        };
        let json_err = serde_json::to_value(&result_err).unwrap();
        assert_eq!(json_err["error"], "timeout");
    }

    // ── find_available_port ──────────────────────────────────────────

    #[tokio::test]
    async fn find_available_port_returns_port_in_range() {
        let port = find_available_port(OC_PORT_START).await;
        assert!(port >= OC_PORT_START);
        assert!(port < OC_PORT_START + PORT_RANGE);
    }

    #[tokio::test]
    async fn find_available_port_skips_occupied_port() {
        // Bind the first port so find_available_port must skip it
        let listener = tokio::net::TcpListener::bind((LOOPBACK, OC_PORT_START))
            .await
            .expect("failed to bind test port");
        let port = find_available_port(OC_PORT_START).await;
        assert!(port > OC_PORT_START, "should skip the occupied port");
        assert!(port < OC_PORT_START + PORT_RANGE);
        drop(listener);
    }

    // ── strip_win_prefix (Windows only) ──────────────────────────────

    #[cfg(windows)]
    #[test]
    fn strip_win_prefix_removes_extended_prefix() {
        let path = std::path::Path::new(r"\\?\C:\Users\test\bin");
        assert_eq!(strip_win_prefix(path), r"C:\Users\test\bin");
    }

    #[cfg(windows)]
    #[test]
    fn strip_win_prefix_no_op_for_normal_paths() {
        let path = std::path::Path::new(r"C:\Users\test\bin");
        assert_eq!(strip_win_prefix(path), r"C:\Users\test\bin");
    }
}


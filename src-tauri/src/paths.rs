use std::path::PathBuf;

// ── Sidecar binary resolution ───────────────────────────────────────────
//
// Tauri's `externalBin` places sidecar binaries next to the main executable
// (e.g. `YourApp.app/Contents/MacOS/` on macOS). At runtime we resolve them
// via `current_exe().parent().join(name)`. During `cargo tauri dev` this
// also works because the binaries are copied into the target directory.

/// Returns the directory containing the main executable (and all sidecars).
pub(crate) fn sidecar_dir() -> Result<PathBuf, String> {
    let exe = tauri::utils::platform::current_exe()
        .map_err(|e| format!("Could not determine current executable path: {e}"))?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Current executable has no parent directory".to_string())
}

/// Resolves a sidecar binary by name. The name should match the filename
/// portion of the `externalBin` entry (without the target-triple suffix).
#[allow(dead_code)]
fn sidecar_path(name: &str) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let bin_name = format!("{name}.exe");
    #[cfg(not(target_os = "windows"))]
    let bin_name = name.to_string();

    let path = sidecar_dir()?.join(&bin_name);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!(
            "Sidecar binary '{}' not found at: {}",
            name,
            path.display()
        ))
    }
}

/// Returns the path to the bundled Node.js bin directory from resources.
/// This directory contains node, npm, and npx.
///
/// Production macOS: `<App>/Contents/Resources/resources/nodejs/bin/`
/// Production Windows: `<App>/resources/nodejs/bin/`
/// Dev: `src-tauri/resources/nodejs/bin`
pub fn bundled_nodejs_bin_dir() -> Result<PathBuf, String> {
    let sidecar = sidecar_dir()?;

    // With Tauri array-format resources, the directory `resources/nodejs` is
    // placed under the app's resource directory preserving its relative path.
    //
    // macOS production:  <App>/Contents/MacOS/../Resources/resources/nodejs/bin
    // Windows production: <exe_dir>/resources/nodejs/bin
    #[cfg(target_os = "macos")]
    let prod_path = sidecar
        .parent()
        .map(|p| {
            p.join("Resources")
                .join("resources")
                .join("nodejs")
                .join("bin")
        })
        .unwrap_or_default();
    #[cfg(not(target_os = "macos"))]
    let prod_path = sidecar.join("resources").join("nodejs").join("bin");

    if prod_path.exists() {
        return Ok(prod_path);
    }

    // Dev layout: during `cargo tauri dev`, sidecar is at src-tauri/target/debug/
    // We need to go up to src-tauri/ then into resources/
    // sidecar/../../resources/nodejs/bin
    let dev_path = sidecar
        .parent() // target/
        .and_then(|p| p.parent()) // src-tauri/
        .map(|p| p.join("resources").join("nodejs").join("bin"))
        .unwrap_or_default();

    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err(format!(
        "Bundled Node.js not found. Checked:\n  {}\n  {}",
        prod_path.display(),
        dev_path.display()
    ))
}

/// Returns the path to the bundled OpenCode sidecar binary.
#[allow(dead_code)]
pub fn bundled_opencode_path() -> Result<PathBuf, String> {
    sidecar_path("opencode")
}

/// Returns the BloxBot workspace directory (`~/BloxBot`), creating it if
/// it does not exist. This is where OpenCode sessions operate.
pub fn workspace_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let workspace = home.join("BloxBot");
    if !workspace.exists() {
        std::fs::create_dir_all(&workspace)
            .map_err(|e| format!("Failed to create BloxBot workspace: {e}"))?;
    }
    Ok(workspace)
}

// ── Tauri commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_workspace_dir() -> Result<String, String> {
    workspace_dir().map(|p| p.to_string_lossy().to_string())
}

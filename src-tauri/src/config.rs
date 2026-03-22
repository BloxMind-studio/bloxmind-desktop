//! Centralised application settings.
//!
//! All user-facing preferences live in a single `config.json` file inside
//! the Tauri app-data directory. The Rust backend owns the file and exposes
//! it to the frontend through two Tauri commands:
//!
//! - `get_config`  — returns the full `AppConfig` as JSON
//! - `set_config`  — accepts a partial JSON object and merges it in
//!
//! This replaces the previous approach where settings were scattered across
//! the Tauri store plugin (frontend-only) and Rust constants, making it
//! impossible for the backend to read user preferences at startup.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

// ── Schema ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Whether the user has completed the welcome/onboarding screen.
    #[serde(default)]
    pub has_launched: bool,

    /// Last globally selected AI model (`"providerID/modelID"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_model: Option<String>,

    /// Model keys the user has hidden from the picker.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden_models: Vec<String>,
}

// ── File path ───────────────────────────────────────────────────────────

const CONFIG_FILENAME: &str = "config.json";

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    Ok(dir.join(CONFIG_FILENAME))
}

// ── In-memory cache ─────────────────────────────────────────────────────

static CONFIG: OnceLock<Mutex<AppConfig>> = OnceLock::new();

fn cache() -> &'static Mutex<AppConfig> {
    CONFIG.get_or_init(|| Mutex::new(AppConfig::default()))
}

// ── Public API (used by other Rust modules) ─────────────────────────────

/// Load config from disk into memory. Call once during app setup.
/// If the file doesn't exist, creates it with defaults.
pub fn load(app: &AppHandle) -> Result<(), String> {
    let path = config_path(app)?;
    let cfg = if path.exists() {
        let bytes =
            std::fs::read(&path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
        serde_json::from_slice::<AppConfig>(&bytes).unwrap_or_else(|e| {
            log::warn!("Corrupt config, using defaults: {e}");
            AppConfig::default()
        })
    } else {
        let cfg = AppConfig::default();
        // Write defaults so the file exists for next launch
        save_to_disk(&path, &cfg);
        cfg
    };

    log::info!("Config loaded: has_launched={}", cfg.has_launched);

    let mut guard = cache().lock().unwrap();
    *guard = cfg;
    Ok(())
}

/// Read a snapshot of the current config. Lock-free clone.
pub fn get() -> AppConfig {
    cache().lock().unwrap().clone()
}

fn save_to_disk(path: &PathBuf, cfg: &AppConfig) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(cfg) {
        Ok(json) => {
            if let Err(e) = std::fs::write(path, json) {
                log::error!("Failed to write config: {e}");
            }
        }
        Err(e) => log::error!("Failed to serialize config: {e}"),
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn get_config() -> AppConfig {
    get()
}

/// Accepts a partial JSON object and merges it into the current config.
/// Only the fields present in the input are updated; the rest stay as-is.
#[tauri::command]
pub fn set_config(app: AppHandle, patch: serde_json::Value) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    let mut guard = cache().lock().unwrap();

    // Serialize current state → JSON value → merge patch → deserialize back
    let mut current =
        serde_json::to_value(&*guard).map_err(|e| format!("Config serialization failed: {e}"))?;
    if let (Some(base), Some(patch_obj)) = (current.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            base.insert(k.clone(), v.clone());
        }
    }
    let updated: AppConfig =
        serde_json::from_value(current).map_err(|e| format!("Invalid config values: {e}"))?;

    save_to_disk(&path, &updated);
    *guard = updated.clone();
    Ok(updated)
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── AppConfig defaults ───────────────────────────────────────────

    #[test]
    fn default_config_values() {
        let cfg = AppConfig::default();
        assert!(!cfg.has_launched);
        assert!(cfg.last_model.is_none());
        assert!(cfg.hidden_models.is_empty());
    }

    // ── Serde round-trip ─────────────────────────────────────────────

    #[test]
    fn serde_round_trip_default() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let restored: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg.has_launched, restored.has_launched);
        assert_eq!(cfg.last_model, restored.last_model);
        assert_eq!(cfg.hidden_models, restored.hidden_models);
    }

    #[test]
    fn serde_round_trip_populated() {
        let cfg = AppConfig {
            has_launched: true,
            last_model: Some("anthropic/claude-opus-4-6".into()),
            hidden_models: vec!["old-model".into(), "deprecated-model".into()],
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let restored: AppConfig = serde_json::from_str(&json).unwrap();
        assert!(restored.has_launched);
        assert_eq!(restored.last_model.as_deref(), Some("anthropic/claude-opus-4-6"));
        assert_eq!(restored.hidden_models.len(), 2);
    }

    // ── camelCase field names ────────────────────────────────────────

    #[test]
    fn serializes_camel_case_fields() {
        let cfg = AppConfig {
            has_launched: true,
            last_model: Some("test".into()),
            hidden_models: vec!["a".into()],
        };
        let val = serde_json::to_value(&cfg).unwrap();
        assert!(val.get("hasLaunched").is_some());
        assert!(val.get("lastModel").is_some());
        assert!(val.get("hiddenModels").is_some());
        // Snake case keys should NOT be present
        assert!(val.get("has_launched").is_none());
        assert!(val.get("last_model").is_none());
        assert!(val.get("hidden_models").is_none());
    }

    // ── Deserialization from partial JSON ────────────────────────────

    #[test]
    fn deserialize_empty_object_uses_defaults() {
        let cfg: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(!cfg.has_launched);
        assert!(cfg.last_model.is_none());
        assert!(cfg.hidden_models.is_empty());
    }

    #[test]
    fn deserialize_partial_object() {
        let cfg: AppConfig =
            serde_json::from_str(r#"{"hasLaunched": true}"#).unwrap();
        assert!(cfg.has_launched);
        assert!(cfg.last_model.is_none());
        assert!(cfg.hidden_models.is_empty());
    }

    // ── skip_serializing_if behavior ────────────────────────────────

    #[test]
    fn none_and_empty_fields_omitted_from_json() {
        let cfg = AppConfig::default();
        let val = serde_json::to_value(&cfg).unwrap();
        // lastModel (None) and hiddenModels (empty) should be omitted
        assert!(val.get("lastModel").is_none());
        assert!(val.get("hiddenModels").is_none());
        // hasLaunched is always present (no skip_serializing_if)
        assert!(val.get("hasLaunched").is_some());
    }

    // ── JSON merge patch logic (unit-level) ──────────────────────────

    #[test]
    fn merge_patch_updates_only_provided_fields() {
        let base = AppConfig {
            has_launched: false,
            last_model: Some("old-model".into()),
            hidden_models: vec!["a".into()],
        };
        let mut base_val = serde_json::to_value(&base).unwrap();
        let patch: serde_json::Value =
            serde_json::from_str(r#"{"hasLaunched": true}"#).unwrap();

        if let (Some(base_obj), Some(patch_obj)) =
            (base_val.as_object_mut(), patch.as_object())
        {
            for (k, v) in patch_obj {
                base_obj.insert(k.clone(), v.clone());
            }
        }

        let merged: AppConfig = serde_json::from_value(base_val).unwrap();
        assert!(merged.has_launched); // updated
        assert_eq!(merged.last_model.as_deref(), Some("old-model")); // unchanged
        assert_eq!(merged.hidden_models, vec!["a".to_string()]); // unchanged
    }

    // ── save_to_disk / filesystem ────────────────────────────────────

    #[test]
    fn save_to_disk_creates_parent_dirs_and_writes() {
        let tmp = std::env::temp_dir().join("bloxbot_config_test");
        let path = tmp.join("nested").join("config.json");
        // Clean up from previous runs
        let _ = std::fs::remove_dir_all(&tmp);

        let cfg = AppConfig {
            has_launched: true,
            last_model: Some("test/model".into()),
            hidden_models: vec![],
        };
        save_to_disk(&path, &cfg);

        assert!(path.exists());
        let contents = std::fs::read_to_string(&path).unwrap();
        let restored: AppConfig = serde_json::from_str(&contents).unwrap();
        assert!(restored.has_launched);
        assert_eq!(restored.last_model.as_deref(), Some("test/model"));

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

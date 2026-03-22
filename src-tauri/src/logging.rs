//! Application logging system.
//!
//! Implements the `log` crate's `Log` trait with stderr output.
//! No files are written to disk.

// ── Public API ──────────────────────────────────────────────────────────

/// Initialise the global logger. Call once, before any `log::` macros.
pub fn init() {
    let _ = log::set_logger(&AppLogger);
    log::set_max_level(log::LevelFilter::Debug);
}

// ── log::Log implementation ─────────────────────────────────────────────

struct AppLogger;

impl log::Log for AppLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Debug
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let level_str = match record.level() {
            log::Level::Error => "ERROR",
            log::Level::Warn => "WARN",
            log::Level::Info => "INFO",
            log::Level::Debug => "DEBUG",
            log::Level::Trace => "TRACE",
        };

        let message = format!("{}", record.args());
        let ts = format_time();
        eprintln!("[{ts}][{level_str}] {message}");
    }

    fn flush(&self) {}
}

/// Format current time as `HH:MM:SS` (UTC) for stderr output.
fn format_time() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let secs = (millis / 1000) % 86400;
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    format!("{h:02}:{m:02}:{s:02}")
}

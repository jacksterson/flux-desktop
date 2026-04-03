use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EngineConfig {
    #[serde(default)]
    pub engine: EngineSection,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EngineSection {
    #[serde(default = "default_interval")]
    pub broadcast_interval_ms: u64,
    #[serde(default)]
    pub active_modules: Vec<String>,
    #[serde(default)]
    pub start_on_login: bool,
    #[serde(default = "default_true")]
    pub battery_saver: bool,
    #[serde(default = "default_battery_interval")]
    pub battery_interval_ms: u64,
}

fn default_interval() -> u64 { 2000 }
fn default_true() -> bool { true }
fn default_battery_interval() -> u64 { 5000 }

impl Default for EngineSection {
    fn default() -> Self {
        Self {
            broadcast_interval_ms: default_interval(),
            active_modules: Vec::new(),
            start_on_login: false,
            battery_saver: true,
            battery_interval_ms: default_battery_interval(),
        }
    }
}

impl Default for EngineConfig {
    fn default() -> Self { Self { engine: EngineSection::default() } }
}

/// Read config from `path`. Returns default if the file is missing or unparseable.
pub fn read_config(path: &Path) -> EngineConfig {
    match std::fs::read_to_string(path) {
        Ok(s) => toml::from_str(&s).unwrap_or_else(|e| {
            eprintln!("[flux] Warning: could not parse config ({}), using defaults", e);
            EngineConfig::default()
        }),
        Err(_) => EngineConfig::default(),
    }
}

/// Write config to `path` atomically (write to .tmp then rename).
pub fn write_config(path: &Path, config: &EngineConfig) -> io::Result<()> {
    let s = toml::to_string_pretty(config)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, &s)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// Returns true when the config file exists (used for first-run detection).
pub fn config_exists(path: &Path) -> bool { path.exists() }

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn default_config_values() {
        let c = EngineConfig::default();
        assert_eq!(c.engine.broadcast_interval_ms, 2000);
        assert!(c.engine.active_modules.is_empty());
    }

    #[test]
    fn roundtrip_preserves_values() {
        let mut c = EngineConfig::default();
        c.engine.broadcast_interval_ms = 3000;
        c.engine.active_modules = vec!["system-stats".into(), "time-date".into()];
        let tmp = temp_dir().join(format!("flux_config_test_roundtrip_{}.toml", std::process::id()));
        write_config(&tmp, &c).expect("write failed");
        let loaded = read_config(&tmp);
        assert_eq!(loaded.engine.broadcast_interval_ms, 3000);
        assert_eq!(loaded.engine.active_modules, vec!["system-stats", "time-date"]);
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn missing_file_returns_defaults() {
        let tmp = temp_dir().join(format!("flux_config_test_missing_{}.toml", std::process::id()));
        let c = read_config(&tmp);
        assert_eq!(c.engine.broadcast_interval_ms, 2000);
        assert!(c.engine.active_modules.is_empty());
    }

    #[test]
    fn config_exists_reflects_file_presence() {
        let tmp = temp_dir().join(format!("flux_config_test_exists_{}.toml", std::process::id()));
        let _ = std::fs::remove_file(&tmp);
        assert!(!config_exists(&tmp));
        write_config(&tmp, &EngineConfig::default()).unwrap();
        assert!(config_exists(&tmp));
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn battery_saver_defaults_to_true() {
        let c = EngineConfig::default();
        assert!(c.engine.battery_saver);
        assert_eq!(c.engine.battery_interval_ms, 5000);
    }

    #[test]
    fn battery_saver_roundtrip() {
        let mut c = EngineConfig::default();
        c.engine.battery_saver = false;
        c.engine.battery_interval_ms = 3000;
        let tmp = temp_dir().join(format!("flux_config_test_battery_{}.toml", std::process::id()));
        write_config(&tmp, &c).expect("write failed");
        let loaded = read_config(&tmp);
        assert!(!loaded.engine.battery_saver);
        assert_eq!(loaded.engine.battery_interval_ms, 3000);
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn old_config_without_battery_fields_uses_defaults() {
        let tmp = temp_dir().join(format!("flux_config_test_old_{}.toml", std::process::id()));
        std::fs::write(&tmp, "[engine]\nbroadcast_interval_ms = 2000\n").unwrap();
        let loaded = read_config(&tmp);
        assert!(loaded.engine.battery_saver);
        assert_eq!(loaded.engine.battery_interval_ms, 5000);
        let _ = std::fs::remove_file(&tmp);
    }
}

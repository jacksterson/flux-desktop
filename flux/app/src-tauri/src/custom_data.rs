use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// ── Data Types ────────────────────────────────────────────────────────────────
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomSourceDef {
    pub name: String,
    #[serde(rename = "type")]
    pub source_type: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub platform_overrides: HashMap<String, String>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub json_path: String,
    pub interval_secs: u64,
}

// ── JSON path extraction ──────────────────────────────────────────────────────
pub fn extract_json_path(json: &str, path: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("invalid JSON: {}", e))?;
    let mut current = &value;
    for key in path.split('.') {
        current = current.get(key)
            .ok_or_else(|| format!("key '{}' not found in path '{}'", key, path))?;
    }
    Ok(match current {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b)   => b.to_string(),
        serde_json::Value::Null      => "null".to_string(),
        v => v.to_string(),
    })
}

// ── Shell execution ───────────────────────────────────────────────────────────
fn resolve_shell_command<'a>(def: &'a CustomSourceDef) -> &'a str {
    #[cfg(target_os = "windows")]
    if let Some(cmd) = def.platform_overrides.get("windows") { return cmd; }
    #[cfg(target_os = "macos")]
    if let Some(cmd) = def.platform_overrides.get("macos") { return cmd; }
    #[cfg(target_os = "linux")]
    if let Some(cmd) = def.platform_overrides.get("linux") { return cmd; }
    &def.command
}

fn fetch_shell(def: &CustomSourceDef) -> Result<String, String> {
    let cmd_str = resolve_shell_command(def);
    if cmd_str.is_empty() { return Err("empty command".to_string()); }
    #[cfg(target_os = "windows")]
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", cmd_str])
        .output().map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .args(["-c", cmd_str])
        .output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("command failed: {}", stderr.trim()));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().next().unwrap_or("").trim().to_string())
}

// ── HTTP execution ────────────────────────────────────────────────────────────
fn fetch_http(def: &CustomSourceDef, client: Option<&reqwest::blocking::Client>) -> Result<String, String> {
    if def.url.is_empty() { return Err("empty URL".to_string()); }
    let owned;
    let c = match client {
        Some(c) => c,
        None => {
            owned = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(10))
                .build().map_err(|e| e.to_string())?;
            &owned
        }
    };
    let body = c.get(&def.url).send().map_err(|e| e.to_string())?.text().map_err(|e| e.to_string())?;
    if def.json_path.is_empty() { return Ok(body.trim().to_string()); }
    extract_json_path(&body, &def.json_path)
}

// ── Public fetch_value ────────────────────────────────────────────────────────
pub fn fetch_value(def: &CustomSourceDef) -> Result<String, String> {
    match def.source_type.as_str() {
        "shell" => fetch_shell(def),
        "http"  => fetch_http(def, None),
        t => Err(format!("unknown source type: {}", t)),
    }
}

// ── Polling broker ────────────────────────────────────────────────────────────
pub struct CustomDataBroker {
    stop_flags: Mutex<Vec<Arc<AtomicBool>>>,
}

impl CustomDataBroker {
    pub fn new() -> Self {
        CustomDataBroker { stop_flags: Mutex::new(Vec::new()) }
    }

    pub fn register(&self, app: AppHandle, sources: Vec<CustomSourceDef>) -> Result<(), String> {
        // Check for duplicate names
        let mut seen = std::collections::HashSet::new();
        for def in &sources {
            if !seen.insert(def.name.clone()) {
                return Err(format!("duplicate custom source name: '{}'", def.name));
            }
        }
        self.stop_all()?;
        let mut flags = self.stop_flags.lock().map_err(|e| e.to_string())?;
        for def in sources {
            let stop = Arc::new(AtomicBool::new(false));
            flags.push(stop.clone());
            let app_clone = app.clone();
            thread::spawn(move || run_source(app_clone, def, stop));
        }
        Ok(())
    }

    pub fn stop_all(&self) -> Result<(), String> {
        let mut flags = self.stop_flags.lock().map_err(|e| e.to_string())?;
        for flag in flags.iter() {
            flag.store(true, Ordering::Relaxed); // Relaxed: we're signaling stop, no data crosses this boundary
        }
        flags.clear();
        Ok(())
    }
}

impl Drop for CustomDataBroker {
    fn drop(&mut self) {
        let _ = self.stop_all();
    }
}

fn run_source(app: AppHandle, def: CustomSourceDef, stop: Arc<AtomicBool>) {
    let client = if def.source_type == "http" {
        reqwest::blocking::Client::builder().timeout(Duration::from_secs(10)).build().ok()
    } else { None };
    loop {
        if stop.load(Ordering::Relaxed) { // Relaxed: reading stop signal only
            break;
        }
        match if def.source_type == "http" { fetch_http(&def, client.as_ref()) } else { fetch_shell(&def) } {
            Ok(val) => { let _ = app.emit(&format!("custom-data:{}", def.name), &val); }
            Err(e)  => { eprintln!("[custom-data:{}] error: {}", def.name, e); }
        }
        let total_ms = (def.interval_secs * 1000).max(1000); // floor at 1s
        let mut elapsed = 0u64;
        while elapsed < total_ms {
            if stop.load(Ordering::Relaxed) { // Relaxed: reading stop signal only
                return;
            }
            thread::sleep(Duration::from_millis(100));
            elapsed += 100;
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_path_nested() {
        let json = r#"{"current":{"temperature_2m":23.5}}"#;
        assert_eq!(extract_json_path(json, "current.temperature_2m").unwrap(), "23.5");
    }

    #[test]
    fn extract_json_path_string_value() {
        let json = r#"{"artist":"Radiohead"}"#;
        assert_eq!(extract_json_path(json, "artist").unwrap(), "Radiohead");
    }

    #[test]
    fn extract_json_path_missing_key() {
        let json = r#"{"a":1}"#;
        assert!(extract_json_path(json, "b").is_err());
    }

    #[test]
    fn extract_json_path_invalid_json() {
        assert!(extract_json_path("not json", "key").is_err());
    }

    #[test]
    fn fetch_shell_echo() {
        let def = CustomSourceDef {
            name: "test".to_string(),
            source_type: "shell".to_string(),
            command: "echo hello".to_string(),
            platform_overrides: HashMap::new(),
            url: String::new(),
            json_path: String::new(),
            interval_secs: 5,
        };
        assert_eq!(fetch_value(&def).unwrap(), "hello");
    }

    #[test]
    fn fetch_unknown_source_type_errors() {
        let def = CustomSourceDef {
            name: "t".to_string(),
            source_type: "ftp".to_string(),
            command: String::new(),
            platform_overrides: HashMap::new(),
            url: String::new(),
            json_path: String::new(),
            interval_secs: 1,
        };
        assert!(fetch_value(&def).is_err());
    }
}

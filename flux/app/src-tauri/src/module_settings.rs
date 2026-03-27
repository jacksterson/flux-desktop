use std::collections::HashMap;
use std::fs;
use std::path::Path;
use crate::SettingDef;

/// Read module settings from `path`, falling back to schema defaults for any missing key.
pub fn read_settings(path: &Path, schema: &[SettingDef]) -> HashMap<String, serde_json::Value> {
    // Start with schema defaults
    let mut result: HashMap<String, serde_json::Value> = schema
        .iter()
        .map(|s| (s.key.clone(), s.default.clone()))
        .collect();

    // Overlay with saved values from TOML file
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(table) = toml::from_str::<toml::Table>(&content) {
            for (k, v) in table {
                result.insert(k, toml_to_json(v));
            }
        }
    }
    result
}

/// Write a single key-value pair to the module settings file.
/// Reads existing file, merges, writes back atomically.
pub fn write_setting(path: &Path, key: &str, value: &serde_json::Value) -> std::io::Result<()> {
    let mut table: toml::Table = if let Ok(content) = fs::read_to_string(path) {
        toml::from_str(&content).unwrap_or_default()
    } else {
        toml::Table::new()
    };

    if let Some(tv) = json_to_toml(value) {
        table.insert(key.to_string(), tv);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let s = toml::to_string(&table)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let tmp = path.with_extension("toml.tmp");
    fs::write(&tmp, &s)?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

fn toml_to_json(v: toml::Value) -> serde_json::Value {
    match v {
        toml::Value::String(s) => serde_json::Value::String(s),
        toml::Value::Integer(i) => serde_json::json!(i),
        toml::Value::Float(f) => serde_json::json!(f),
        toml::Value::Boolean(b) => serde_json::Value::Bool(b),
        _ => serde_json::Value::Null,
    }
}

fn json_to_toml(v: &serde_json::Value) -> Option<toml::Value> {
    match v {
        serde_json::Value::String(s) => Some(toml::Value::String(s.clone())),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(toml::Value::Integer(i))
            } else {
                n.as_f64().map(toml::Value::Float)
            }
        }
        serde_json::Value::Bool(b) => Some(toml::Value::Boolean(*b)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("flux_settings_{}_{}.toml", name, std::process::id()))
    }

    fn make_schema() -> Vec<crate::SettingDef> {
        vec![
            crate::SettingDef {
                key: "interval".to_string(),
                label: "Interval".to_string(),
                field_type: "range".to_string(),
                default: serde_json::json!(2000),
                min: Some(500.0), max: Some(10000.0), step: Some(100.0),
                options: vec![],
            },
            crate::SettingDef {
                key: "units".to_string(),
                label: "Units".to_string(),
                field_type: "select".to_string(),
                default: serde_json::json!("metric"),
                min: None, max: None, step: None,
                options: vec!["metric".to_string(), "imperial".to_string()],
            },
        ]
    }

    #[test]
    fn read_returns_defaults_when_file_missing() {
        let path = tmp_path("missing");
        let _ = std::fs::remove_file(&path);
        let schema = make_schema();
        let settings = read_settings(&path, &schema);
        assert_eq!(settings["interval"], serde_json::json!(2000));
        assert_eq!(settings["units"], serde_json::json!("metric"));
    }

    #[test]
    fn write_and_read_roundtrip() {
        let path = tmp_path("roundtrip");
        let _ = std::fs::remove_file(&path);
        let schema = make_schema();
        write_setting(&path, "interval", &serde_json::json!(3000)).unwrap();
        let settings = read_settings(&path, &schema);
        assert_eq!(settings["interval"], serde_json::json!(3000));
        assert_eq!(settings["units"], serde_json::json!("metric"));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn write_string_value() {
        let path = tmp_path("string");
        let _ = std::fs::remove_file(&path);
        let schema = make_schema();
        write_setting(&path, "units", &serde_json::json!("imperial")).unwrap();
        let settings = read_settings(&path, &schema);
        assert_eq!(settings["units"], serde_json::json!("imperial"));
        std::fs::remove_file(&path).ok();
    }
}

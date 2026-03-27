# Phase 2 — Wizard, Archive Install, Per-Module Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-run wizard, zip/7z/tar.gz theme archive installation, and per-module settings panel to the Command Center.

**Architecture:** Three independent subsystems sharing infrastructure (paths, manifest types). Archive logic lives in `archive.rs`, settings helpers in `module_settings.rs`, wizard commands in `lib.rs`. All frontend is plain HTML/CSS/JS served via `flux-module://_flux/`. No npm, no bundler.

**Tech Stack:** Rust/Tauri 2, `zip` crate, `tar`+`flate2` crates, `sevenz-rust` crate, `tauri-plugin-dialog` for native file picker, `serde_json`, `toml`.

---

## Codebase Context

- `flux/app/src-tauri/src/lib.rs` — 1184 lines, all Tauri commands, URI handler, setup
- `flux/app/src-tauri/src/paths.rs` — path helpers (`flux_user_themes_dir()`, `ensure_flux_dirs()`, etc.)
- `flux/app/src-tauri/src/config.rs` — `EngineConfig` struct, `read_config`/`write_config`
- `flux/app/runtime/command-center/` — `index.html`, `style.css`, `app.js`
- `flux/app/runtime/widget-api.js` — auto-injected into module index.html files
- `flux/themes/bridges/theme.json` — theme manifest format (JSON with `id`, `name`, `modules[]`)
- `flux/themes/bridges/modules/*/module.json` — module manifest format (JSON)
- `flux/app/src-tauri/capabilities/default.json` — Tauri capabilities

**Key existing types:**
```rust
// lib.rs
pub struct ModuleManifest { pub id, name, author, version, entry: String, pub window: ModuleWindowConfig, pub permissions: Vec<String>, pub active: bool }
pub struct ThemeManifest { pub id, name, description, version: String, pub modules: Vec<String>, pub preview: Option<String> }
pub struct ThemeInfo { pub id, name, description, version, source: String, pub preview_url: Option<String>, pub modules: Vec<ModuleInfo> }
pub struct AppState { pub config: Mutex<EngineConfig>, pub config_path: PathBuf, pub active_modules: Mutex<HashMap<String, ModuleManifest>>, ... }
```

**Key existing functions:**
```rust
fn launch_module_window(id: &str, app: &AppHandle, state: &AppState) -> Result<(), String>
fn build_command_center_window(app: &AppHandle) -> Result<(), String>
fn write_config(path: &Path, config: &EngineConfig) -> io::Result<()>
pub fn flux_user_themes_dir() -> PathBuf   // ~/.local/share/flux/themes
pub fn flux_user_data_dir() -> PathBuf     // ~/.local/share/flux
pub fn ensure_flux_dirs() -> io::Result<()>
```

**First-run detection (lib.rs line ~923):**
```rust
if is_first_run {
    build_command_center_window(&handle)?;
} else {
    for id in &active_on_start { launch_module_window(...) }
}
```

This will change in Task 6 to open the wizard instead.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `flux/app/src-tauri/Cargo.toml` | Modify | Add `zip`, `flate2`, `tar`, `sevenz-rust`, `tauri-plugin-dialog` |
| `flux/app/src-tauri/capabilities/default.json` | Modify | Add `dialog:allow-open`, expand to all windows |
| `flux/app/src-tauri/src/paths.rs` | Modify | Add `flux_module_settings_dir()`, update `ensure_flux_dirs()` |
| `flux/app/src-tauri/src/archive.rs` | Create | Archive extraction + zip-slip protection + theme validation |
| `flux/app/src-tauri/src/module_settings.rs` | Create | Per-module settings read/write helpers |
| `flux/app/src-tauri/src/lib.rs` | Modify | Add `SettingDef` struct, extend `ModuleManifest`, add wizard/archive/settings commands, update first-run |
| `flux/app/runtime/wizard/index.html` | Create | Wizard window HTML (4-step shell) |
| `flux/app/runtime/wizard/style.css` | Create | Wizard styles |
| `flux/app/runtime/wizard/app.js` | Create | Wizard step logic, close interception |
| `flux/app/runtime/command-center/index.html` | Modify | Add install button, drag-drop overlay, status area, settings panel |
| `flux/app/runtime/command-center/style.css` | Modify | Add install/status/panel styles |
| `flux/app/runtime/command-center/app.js` | Modify | Add install, drag-drop, settings panel logic |
| `flux/app/runtime/widget-api.js` | Modify | Add `getSettings()` to `WidgetAPI` |

---

## Task 1: Add Cargo dependencies and capabilities

**Files:**
- Modify: `flux/app/src-tauri/Cargo.toml`
- Modify: `flux/app/src-tauri/capabilities/default.json`

- [ ] **Step 1: Write failing test** (verifies crate compiles)

No separate test — the build in Step 3 is the verification.

- [ ] **Step 2: Update Cargo.toml**

Open `flux/app/src-tauri/Cargo.toml`. Replace the `[dependencies]` section with:

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-opener = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
sysinfo = "0.38.4"
nvml-wrapper = "0.12.0"
dirs = "5"
zip = "2"
flate2 = "1"
tar = "0.4"
sevenz-rust = "0.6"
```

- [ ] **Step 3: Update capabilities to cover all windows and add dialog:allow-open**

Replace `flux/app/src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for all Flux windows",
  "windows": ["*"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:allow-open"
  ]
}
```

- [ ] **Step 4: Run cargo check to verify deps resolve**

```bash
cd flux/app/src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors (may show warnings). If `sevenz-rust` fails to resolve, try `sevenz-rust2 = { package = "sevenz-rust", version = "0.6" }`.

- [ ] **Step 5: Commit**

```bash
cd flux/app && git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/default.json
git commit -m "chore: add archive extraction and dialog deps for Phase 2"
```

---

## Task 2: Add settings dir to paths.rs

**Files:**
- Modify: `flux/app/src-tauri/src/paths.rs`
- Test: inline in `paths.rs`

- [ ] **Step 1: Write the failing test**

At the bottom of `flux/app/src-tauri/src/paths.rs`, inside `mod tests`, add:

```rust
#[test]
fn flux_module_settings_dir_is_under_local_share_flux() {
    let result = flux_module_settings_dir();
    let data = flux_user_data_dir();
    assert!(result.starts_with(&data), "settings dir {:?} should be under {:?}", result, data);
    assert_eq!(result.file_name().unwrap(), "settings");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd flux/app/src-tauri && cargo test flux_module_settings_dir 2>&1 | tail -5
```

Expected: compile error — `flux_module_settings_dir` not found.

- [ ] **Step 3: Add function and update ensure_flux_dirs**

In `flux/app/src-tauri/src/paths.rs`, add after `flux_config_path`:

```rust
/// Returns ~/.local/share/flux/settings — where per-module settings files live.
pub fn flux_module_settings_dir() -> PathBuf {
    flux_user_data_dir().join("settings")
}
```

Replace `ensure_flux_dirs`:

```rust
/// Creates ~/Flux/modules, ~/Flux/skins, ~/.local/share/flux/themes, and
/// ~/.local/share/flux/settings if they do not exist.
/// Called once at app startup.
pub fn ensure_flux_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(flux_modules_dir())?;
    std::fs::create_dir_all(flux_skins_dir())?;
    std::fs::create_dir_all(flux_user_themes_dir())?;
    std::fs::create_dir_all(flux_module_settings_dir())?;
    Ok(())
}
```

- [ ] **Step 4: Update test for ensure_flux_dirs to also check settings dir**

Replace the existing `ensure_flux_dirs_creates_directories` test with:

```rust
#[test]
fn ensure_flux_dirs_creates_directories() {
    ensure_flux_dirs().expect("ensure_flux_dirs should not fail");
    assert!(flux_modules_dir().exists(), "modules dir should exist after ensure_flux_dirs");
    assert!(flux_skins_dir().exists(), "skins dir should exist after ensure_flux_dirs");
    assert!(flux_module_settings_dir().exists(), "settings dir should exist after ensure_flux_dirs");
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd flux/app/src-tauri && cargo test --lib paths 2>&1 | tail -10
```

Expected: all `paths::tests::*` pass.

- [ ] **Step 6: Commit**

```bash
cd flux/app && git add src-tauri/src/paths.rs
git commit -m "feat: add flux_module_settings_dir() to paths"
```

---

## Task 3: Add SettingDef struct and extend ModuleManifest

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs` (near the top, around line 57)

- [ ] **Step 1: Write failing test**

In `flux/app/src-tauri/src/lib.rs` `mod tests`, add:

```rust
#[test]
fn module_manifest_parses_settings_array() {
    let json = r#"{
        "id": "t", "name": "T", "author": "a", "version": "1.0.0",
        "entry": "index.html",
        "window": { "width": 400, "height": 300, "transparent": false,
                    "decorations": true, "windowLevel": "desktop", "resizable": true },
        "permissions": [],
        "settings": [
            { "key": "interval", "label": "Interval", "type": "range",
              "default": 2000, "min": 500, "max": 10000, "step": 100, "options": [] }
        ]
    }"#;
    let m: ModuleManifest = serde_json::from_str(json).unwrap();
    assert_eq!(m.settings.len(), 1);
    assert_eq!(m.settings[0].key, "interval");
    assert_eq!(m.settings[0].field_type, "range");
    assert_eq!(m.settings[0].default, serde_json::json!(2000));
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd flux/app/src-tauri && cargo test module_manifest_parses_settings 2>&1 | tail -5
```

Expected: compile error — `SettingDef` not found, `settings` field not on `ModuleManifest`.

- [ ] **Step 3: Add SettingDef struct**

In `flux/app/src-tauri/src/lib.rs`, after the `ThemeInfo` struct definition (around line 102), add:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SettingDef {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub default: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(default)]
    pub options: Vec<String>,
}
```

- [ ] **Step 4: Add settings field to ModuleManifest**

In the existing `ModuleManifest` struct (around line 57), add after `pub active: bool`:

```rust
    #[serde(default)]
    pub settings: Vec<SettingDef>,
```

The struct should now look like:

```rust
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub entry: String,
    pub window: ModuleWindowConfig,
    pub permissions: Vec<String>,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub settings: Vec<SettingDef>,
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd flux/app/src-tauri && cargo test module_manifest_parses_settings 2>&1 | tail -5
```

Expected: `test module_manifest_parses_settings_array ... ok`

- [ ] **Step 6: Commit**

```bash
cd flux/app && git add src-tauri/src/lib.rs
git commit -m "feat: add SettingDef struct and settings field to ModuleManifest"
```

---

## Task 4: Create archive.rs — extraction with zip-slip protection

**Files:**
- Create: `flux/app/src-tauri/src/archive.rs`

- [ ] **Step 1: Write failing tests**

Create `flux/app/src-tauri/src/archive.rs` with only the tests (no implementation yet):

```rust
// archive.rs

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip_with_manifest(dir: &std::path::Path, theme_id: &str) -> std::path::PathBuf {
        let zip_path = dir.join("test.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("theme.json", opts).unwrap();
        let manifest = format!(r#"{{"id":"{}","name":"Test Theme","modules":[]}}"#, theme_id);
        zip.write_all(manifest.as_bytes()).unwrap();
        zip.finish().unwrap();
        zip_path
    }

    #[test]
    fn detect_kind_zip() {
        assert!(matches!(detect_kind(std::path::Path::new("a.zip")), Some(ArchiveKind::Zip)));
    }

    #[test]
    fn detect_kind_tar_gz() {
        assert!(matches!(detect_kind(std::path::Path::new("a.tar.gz")), Some(ArchiveKind::TarGz)));
        assert!(matches!(detect_kind(std::path::Path::new("a.tgz")), Some(ArchiveKind::TarGz)));
    }

    #[test]
    fn detect_kind_7z() {
        assert!(matches!(detect_kind(std::path::Path::new("a.7z")), Some(ArchiveKind::SevenZ)));
    }

    #[test]
    fn detect_kind_unsupported() {
        assert!(detect_kind(std::path::Path::new("a.txt")).is_none());
    }

    #[test]
    fn extract_zip_and_validate_returns_id() {
        let tmp = tempfile_dir("flux_arc_test_ok");
        let zip_path = make_zip_with_manifest(&tmp, "my-theme");
        let extract_dir = extract_to_temp(&zip_path).unwrap();
        let (id, _name) = validate_extracted(&extract_dir).unwrap();
        assert_eq!(id, "my-theme");
        std::fs::remove_dir_all(&extract_dir).ok();
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn validate_fails_when_no_manifest() {
        let tmp = tempfile_dir("flux_arc_test_no_manifest");
        let err = validate_extracted(&tmp).unwrap_err();
        assert!(err.contains("missing theme.json"), "got: {}", err);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn validate_fails_when_id_missing() {
        let tmp = tempfile_dir("flux_arc_test_no_id");
        std::fs::write(tmp.join("theme.json"), r#"{"name":"Foo","modules":[]}"#).unwrap();
        let err = validate_extracted(&tmp).unwrap_err();
        assert!(err.contains("no 'id' field"), "got: {}", err);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn zip_slip_rejected() {
        let tmp = tempfile_dir("flux_arc_test_slip");
        let zip_path = tmp.join("evil.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("../../evil.txt", opts).unwrap();
        zip.write_all(b"pwned").unwrap();
        zip.finish().unwrap();
        let result = extract_to_temp(&zip_path);
        assert!(result.is_err(), "zip-slip should be rejected");
        std::fs::remove_dir_all(&tmp).ok();
    }

    fn tempfile_dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd flux/app/src-tauri && cargo test --lib archive 2>&1 | tail -5
```

Expected: compile error — `detect_kind`, `ArchiveKind`, `extract_to_temp`, `validate_extracted` not defined.

- [ ] **Step 3: Write the implementation**

Replace the entire `flux/app/src-tauri/src/archive.rs` with:

```rust
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub enum ArchiveKind {
    Zip,
    TarGz,
    SevenZ,
}

pub fn detect_kind(path: &Path) -> Option<ArchiveKind> {
    let s = path.to_string_lossy().to_lowercase();
    if s.ends_with(".zip") {
        Some(ArchiveKind::Zip)
    } else if s.ends_with(".tar.gz") || s.ends_with(".tgz") {
        Some(ArchiveKind::TarGz)
    } else if s.ends_with(".7z") {
        Some(ArchiveKind::SevenZ)
    } else {
        None
    }
}

/// Extract archive to a fresh temp directory. Caller must delete it when done.
pub fn extract_to_temp(path: &Path) -> Result<PathBuf, String> {
    let kind = detect_kind(path).ok_or_else(|| "Unsupported archive type".to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = std::env::temp_dir().join(format!("flux-extract-{}-{}", ts, std::process::id()));
    fs::create_dir_all(&dest).map_err(|e| format!("Could not create temp dir: {}", e))?;
    match kind {
        ArchiveKind::Zip => extract_zip(path, &dest),
        ArchiveKind::TarGz => extract_tar_gz(path, &dest),
        ArchiveKind::SevenZ => extract_7z(path, &dest),
    }?;
    Ok(dest)
}

/// Guard against zip-slip: reject any entry whose name contains "..".
fn safe_entry_path(dest: &Path, entry_name: &str) -> Result<PathBuf, String> {
    let entry_name = entry_name.trim_start_matches('/');
    if entry_name.contains("..") {
        return Err(format!("archive entry '{}' contains path traversal (..), rejected", entry_name));
    }
    Ok(dest.join(entry_name))
}

fn extract_zip(src: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(src).map_err(|e| format!("Could not open archive: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Could not extract archive: {}", e))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let out_path = safe_entry_path(dest, entry.name())?;
        if entry.name().ends_with('/') {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn extract_tar_gz(src: &Path, dest: &Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    let file = fs::File::open(src).map_err(|e| format!("Could not open archive: {}", e))?;
    let gz = GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);
    for entry in archive.entries().map_err(|e| format!("Could not extract archive: {}", e))? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path().map_err(|e| e.to_string())?;
        let entry_str = entry_path.to_string_lossy();
        if entry_str.contains("..") {
            return Err(format!("archive entry '{}' contains path traversal (..), rejected", entry_str));
        }
        entry.unpack_in(dest).map_err(|e| format!("Could not extract archive: {}", e))?;
    }
    Ok(())
}

fn extract_7z(src: &Path, dest: &Path) -> Result<(), String> {
    sevenz_rust::decompress_file(src, dest).map_err(|e| format!("Could not extract archive: {}", e))
}

/// Validate an extracted theme directory.
/// Requires `theme.json` at the root with a non-empty `id` field.
/// Returns `(theme_id, theme_name)`.
pub fn validate_extracted(dir: &Path) -> Result<(String, String), String> {
    let manifest_path = dir.join("theme.json");
    if !manifest_path.exists() {
        return Err("Invalid theme: missing theme.json".to_string());
    }
    let content = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&content)
        .map_err(|_| "Invalid theme: theme.json is not valid JSON".to_string())?;
    let id = v.get("id")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Invalid theme: theme.json has no 'id' field".to_string())?
        .to_string();
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid theme: theme id contains invalid characters".to_string());
    }
    let name = v.get("name")
        .and_then(|x| x.as_str())
        .unwrap_or(&id)
        .to_string();
    Ok((id, name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip_with_manifest(dir: &Path, theme_id: &str) -> PathBuf {
        let zip_path = dir.join("test.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("theme.json", opts).unwrap();
        let manifest = format!(r#"{{"id":"{}","name":"Test Theme","modules":[]}}"#, theme_id);
        zip.write_all(manifest.as_bytes()).unwrap();
        zip.finish().unwrap();
        zip_path
    }

    #[test]
    fn detect_kind_zip() {
        assert!(matches!(detect_kind(Path::new("a.zip")), Some(ArchiveKind::Zip)));
    }

    #[test]
    fn detect_kind_tar_gz() {
        assert!(matches!(detect_kind(Path::new("a.tar.gz")), Some(ArchiveKind::TarGz)));
        assert!(matches!(detect_kind(Path::new("a.tgz")), Some(ArchiveKind::TarGz)));
    }

    #[test]
    fn detect_kind_7z() {
        assert!(matches!(detect_kind(Path::new("a.7z")), Some(ArchiveKind::SevenZ)));
    }

    #[test]
    fn detect_kind_unsupported() {
        assert!(detect_kind(Path::new("a.txt")).is_none());
    }

    #[test]
    fn extract_zip_and_validate_returns_id() {
        let tmp = tempfile_dir("flux_arc_test_ok");
        let zip_path = make_zip_with_manifest(&tmp, "my-theme");
        let extract_dir = extract_to_temp(&zip_path).unwrap();
        let (id, _name) = validate_extracted(&extract_dir).unwrap();
        assert_eq!(id, "my-theme");
        fs::remove_dir_all(&extract_dir).ok();
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn validate_fails_when_no_manifest() {
        let tmp = tempfile_dir("flux_arc_test_no_manifest");
        let err = validate_extracted(&tmp).unwrap_err();
        assert!(err.contains("missing theme.json"), "got: {}", err);
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn validate_fails_when_id_missing() {
        let tmp = tempfile_dir("flux_arc_test_no_id");
        fs::write(tmp.join("theme.json"), r#"{"name":"Foo","modules":[]}"#).unwrap();
        let err = validate_extracted(&tmp).unwrap_err();
        assert!(err.contains("no 'id' field"), "got: {}", err);
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn zip_slip_rejected() {
        let tmp = tempfile_dir("flux_arc_test_slip");
        let zip_path = tmp.join("evil.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("../../evil.txt", opts).unwrap();
        zip.write_all(b"pwned").unwrap();
        zip.finish().unwrap();
        let result = extract_to_temp(&zip_path);
        assert!(result.is_err(), "zip-slip should be rejected");
        fs::remove_dir_all(&tmp).ok();
    }

    fn tempfile_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("{}-{}", name, std::process::id()));
        fs::create_dir_all(&d).unwrap();
        d
    }
}
```

- [ ] **Step 4: Register archive module in lib.rs**

At the top of `flux/app/src-tauri/src/lib.rs`, after the existing `mod` declarations (around line 1), add:

```rust
mod archive;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd flux/app/src-tauri && cargo test --lib archive 2>&1 | tail -10
```

Expected: 8 tests pass. Note: `zip_slip_rejected` test creates an evil zip — extraction must fail.

- [ ] **Step 6: Commit**

```bash
cd flux/app && git add src-tauri/src/archive.rs src-tauri/src/lib.rs
git commit -m "feat: add archive.rs — zip/tar.gz/7z extraction with zip-slip protection"
```

---

## Task 5: Create module_settings.rs

**Files:**
- Create: `flux/app/src-tauri/src/module_settings.rs`

- [ ] **Step 1: Write failing tests**

Create `flux/app/src-tauri/src/module_settings.rs` with only the tests:

```rust
// module_settings.rs

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
        // units still default
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd flux/app/src-tauri && cargo test --lib module_settings 2>&1 | tail -5
```

Expected: compile error — `read_settings`, `write_setting` not found.

- [ ] **Step 3: Write the implementation**

Replace `flux/app/src-tauri/src/module_settings.rs` with:

```rust
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
```

- [ ] **Step 4: Register module in lib.rs**

At the top of `flux/app/src-tauri/src/lib.rs`, after `mod archive;`, add:

```rust
mod module_settings;
```

- [ ] **Step 5: Run tests**

```bash
cd flux/app/src-tauri && cargo test --lib module_settings 2>&1 | tail -10
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
cd flux/app && git add src-tauri/src/module_settings.rs src-tauri/src/lib.rs
git commit -m "feat: add module_settings.rs — per-module settings read/write"
```

---

## Task 6: Add wizard Tauri commands and update first-run detection

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

The wizard needs three commands:
- `wizard_launch(active_modules: Vec<String>)` — writes config, opens modules, closes wizard
- `wizard_escape(active_modules: Vec<String>)` — writes config (may be empty), opens CC, closes wizard
- `open_wizard` — focus-or-create wizard window (for future use; also used from tray if needed)

Also adds `build_wizard_window` and updates the first-run branch to open the wizard instead of CC.

- [ ] **Step 1: Write failing test**

In `flux/app/src-tauri/src/lib.rs` `mod tests`, add:

```rust
#[test]
fn wizard_launch_writes_config_and_active_modules() {
    // This tests that write_config produces a file with the expected modules.
    // It doesn't test the Tauri command directly (no AppHandle in unit tests),
    // but verifies the config-writing logic used by the command.
    use config::{write_config, read_config, EngineConfig};
    let tmp = std::env::temp_dir().join(format!("flux_wizard_test_{}.toml", std::process::id()));
    let mut cfg = EngineConfig::default();
    cfg.engine.active_modules = vec!["system-stats".to_string(), "time-date".to_string()];
    write_config(&tmp, &cfg).unwrap();
    let loaded = read_config(&tmp);
    assert_eq!(loaded.engine.active_modules, vec!["system-stats", "time-date"]);
    std::fs::remove_file(&tmp).ok();
}
```

- [ ] **Step 2: Run test to verify it passes immediately** (it should — it's testing existing code)

```bash
cd flux/app/src-tauri && cargo test wizard_launch_writes_config 2>&1 | tail -5
```

Expected: `test tests::wizard_launch_writes_config_and_active_modules ... ok`

- [ ] **Step 3: Add build_wizard_window function**

In `flux/app/src-tauri/src/lib.rs`, after `build_command_center_window` (around line 520), add:

```rust
fn build_wizard_window(app: &AppHandle) -> Result<(), String> {
    let url = WebviewUrl::CustomProtocol(
        "flux-module://_flux/wizard/index.html".parse::<tauri::Url>()
            .map_err(|e| e.to_string())?
    );
    WebviewWindowBuilder::new(app, "wizard", url)
        .title("Welcome to Flux")
        .inner_size(720.0, 520.0)
        .min_inner_size(640.0, 480.0)
        .decorations(true)
        .transparent(false)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Add wizard Tauri commands**

In `lib.rs`, after `open_command_center` (around line 388), add:

```rust
#[tauri::command]
fn open_wizard(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("wizard") {
        let _ = win.show();
        let _ = win.set_focus();
        Ok(())
    } else {
        build_wizard_window(&app)
    }
}

#[tauri::command]
fn wizard_launch(app: AppHandle, state: State<'_, AppState>, active_modules: Vec<String>) -> Result<(), String> {
    // Write config with selected modules
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.engine.active_modules = active_modules.clone();
        write_config(&state.config_path, &cfg).map_err(|e| e.to_string())?;
    }
    // Open each selected module window
    for id in &active_modules {
        if let Err(e) = launch_module_window(id, &app, &state) {
            eprintln!("[flux] Warning: could not launch '{}' from wizard: {}", id, e);
        }
    }
    // Close wizard
    if let Some(win) = app.get_webview_window("wizard") {
        let _ = win.close();
    }
    Ok(())
}

#[tauri::command]
fn wizard_escape(app: AppHandle, state: State<'_, AppState>, active_modules: Vec<String>) -> Result<(), String> {
    // Write config with whatever was selected (may be empty)
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.engine.active_modules = active_modules;
        write_config(&state.config_path, &cfg).map_err(|e| e.to_string())?;
    }
    // Open Command Center as fallback
    open_command_center(app.clone())?;
    // Close wizard
    if let Some(win) = app.get_webview_window("wizard") {
        let _ = win.close();
    }
    Ok(())
}
```

- [ ] **Step 5: Update first-run branch in setup**

In `lib.rs` around line 923, find:

```rust
if is_first_run {
    build_command_center_window(&handle)?;
} else {
```

Replace with:

```rust
if is_first_run {
    build_wizard_window(&handle)?;
} else {
```

- [ ] **Step 6: Register new commands in invoke_handler**

In `lib.rs`, in `tauri::generate_handler![...]`, add `open_wizard, wizard_launch, wizard_escape` to the list. The full handler list should now be:

```rust
.invoke_handler(tauri::generate_handler![
    drag_window, list_modules, toggle_module,
    open_module_settings, close_window, move_module,
    is_layer_shell_window,
    list_themes,
    activate_theme, deactivate_theme,
    open_themes_folder, open_command_center, get_config,
    open_wizard, wizard_launch, wizard_escape,
    metrics::system_cpu,
    metrics::system_memory,
    metrics::system_disk,
    metrics::system_network,
    metrics::system_gpu,
    metrics::system_battery,
    metrics::system_uptime,
    metrics::system_os,
    metrics::system_disk_io,
])
```

- [ ] **Step 7: Add plugin init for tauri-plugin-dialog**

In `lib.rs`, in the builder chain, after `.plugin(tauri_plugin_opener::init())`, add:

```rust
.plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 8: Compile to verify**

```bash
cd flux/app/src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
cd flux/app && git add src-tauri/src/lib.rs
git commit -m "feat: add wizard Tauri commands and update first-run to open wizard"
```

---

## Task 7: Create wizard runtime files

**Files:**
- Create: `flux/app/runtime/wizard/index.html`
- Create: `flux/app/runtime/wizard/style.css`
- Create: `flux/app/runtime/wizard/app.js`

The wizard has 4 steps. All 4 step panes exist in the DOM simultaneously; CSS `display:none` hides inactive ones. JS swaps the active step.

- [ ] **Step 1: Create index.html**

Create `flux/app/runtime/wizard/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Flux</title>
  <link rel="stylesheet" href="flux-module://_flux/wizard/style.css">
</head>
<body>
  <div class="wizard-shell">
    <div class="progress-bar">
      <div class="progress-step active" data-step="1">1</div>
      <div class="progress-line"></div>
      <div class="progress-step" data-step="2">2</div>
      <div class="progress-line"></div>
      <div class="progress-step" data-step="3">3</div>
      <div class="progress-line"></div>
      <div class="progress-step" data-step="4">4</div>
    </div>

    <!-- Step 1: Welcome -->
    <div class="step-pane active" id="step-1">
      <div class="step-content center">
        <div class="logo">Flux</div>
        <p class="tagline">Your desktop, your widgets.</p>
        <p class="step-desc">Install and manage widget themes directly from your desktop.</p>
        <button class="btn-primary" id="btn-start">Get Started →</button>
      </div>
    </div>

    <!-- Step 2: Choose theme -->
    <div class="step-pane" id="step-2">
      <div class="step-header">
        <h2>Choose a theme</h2>
        <p class="step-desc">A theme is a collection of widgets with a shared style.</p>
      </div>
      <div class="step-body" id="theme-grid">
        <p class="loading">Loading themes…</p>
      </div>
      <div class="step-footer">
        <button class="btn-ghost" id="btn-skip-theme">Skip →</button>
        <button class="btn-primary" id="btn-next-2" disabled>Next →</button>
      </div>
    </div>

    <!-- Step 3: Pick modules -->
    <div class="step-pane" id="step-3">
      <div class="step-header">
        <h2>Pick your modules</h2>
        <p class="step-desc">Choose which widgets to start. All are on by default.</p>
        <div class="module-shortcuts">
          <button class="btn-link" id="btn-all">Select all</button>
          <span class="sep">·</span>
          <button class="btn-link" id="btn-none">None</button>
        </div>
      </div>
      <div class="step-body" id="module-list"></div>
      <div class="step-footer">
        <button class="btn-secondary" id="btn-back-3">← Back</button>
        <button class="btn-primary" id="btn-next-3" disabled>Next →</button>
      </div>
    </div>

    <!-- Step 4: Launch -->
    <div class="step-pane" id="step-4">
      <div class="step-content center">
        <div class="launch-summary" id="launch-summary">Starting 0 modules</div>
        <button class="btn-launch" id="btn-launch">Launch Flux</button>
        <button class="btn-secondary" id="btn-back-4">← Back</button>
      </div>
    </div>
  </div>

  <script src="flux-module://_flux/wizard/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create style.css**

Create `flux/app/runtime/wizard/style.css`:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0e0e0e;
  --surface: #1a1a1a;
  --border: #2a2a2a;
  --text: #e0e0e0;
  --text-dim: #888;
  --accent: #4a9eff;
  --accent-hover: #6ab3ff;
  --radius: 8px;
  --transition: 0.15s ease;
}

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.wizard-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 28px;
  gap: 20px;
}

/* ── Progress bar ── */
.progress-bar {
  display: flex;
  align-items: center;
  gap: 0;
  justify-content: center;
}

.progress-step {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background var(--transition), border-color var(--transition), color var(--transition);
}

.progress-step.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.progress-step.done {
  background: #1a3a1a;
  border-color: #2d5a2d;
  color: #4caf50;
}

.progress-line {
  flex: 1;
  max-width: 80px;
  height: 1px;
  background: var(--border);
}

/* ── Step panes ── */
.step-pane { display: none; flex: 1; flex-direction: column; gap: 16px; overflow: hidden; }
.step-pane.active { display: flex; }

.step-header { flex-shrink: 0; }
.step-header h2 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
.step-desc { color: var(--text-dim); font-size: 13px; }

.step-body { flex: 1; overflow-y: auto; }
.step-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

/* ── Center layout (steps 1 and 4) ── */
.step-content.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
}

.logo {
  font-size: 48px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}

.tagline { font-size: 18px; font-weight: 500; color: var(--text); }
.launch-summary { font-size: 16px; color: var(--text-dim); }

/* ── Buttons ── */
button {
  cursor: pointer;
  border: none;
  border-radius: var(--radius);
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 500;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
  white-space: nowrap;
}

.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-secondary { background: transparent; color: var(--text-dim); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--surface); color: var(--text); }

.btn-ghost { background: transparent; color: var(--text-dim); padding: 8px 12px; }
.btn-ghost:hover { color: var(--text); }

.btn-link { background: none; color: var(--accent); padding: 0; font-size: 12px; text-decoration: underline; }
.btn-link:hover { color: var(--accent-hover); }

.btn-launch {
  background: var(--accent);
  color: #fff;
  padding: 14px 48px;
  font-size: 16px;
  font-weight: 700;
  border-radius: 10px;
}
.btn-launch:hover { background: var(--accent-hover); }

.sep { color: var(--text-dim); font-size: 12px; }

/* ── Module shortcuts row ── */
.module-shortcuts { display: flex; align-items: center; gap: 8px; margin-top: 8px; }

/* ── Theme grid ── */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  padding-bottom: 8px;
}

.theme-card {
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--transition);
}

.theme-card:hover { border-color: #444; }
.theme-card.selected { border-color: var(--accent); }

.theme-preview {
  width: 100%;
  aspect-ratio: 16/9;
  background: #111;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 12px;
  overflow: hidden;
}

.theme-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }

.theme-info { padding: 10px 12px; }
.theme-info h3 { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.theme-info p { font-size: 11px; color: var(--text-dim); }

/* ── Module list ── */
.module-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.module-toggle-row:last-child { border-bottom: none; }
.module-label { font-size: 13px; color: var(--text); }

.toggle {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.toggle input { opacity: 0; width: 0; height: 0; position: absolute; }

.toggle-track {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 20px;
  cursor: pointer;
  transition: background var(--transition);
}

.toggle input:checked + .toggle-track { background: var(--accent); }

.toggle-track::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  top: 3px;
  left: 3px;
  transition: transform var(--transition);
  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}

.toggle input:checked + .toggle-track::after { transform: translateX(16px); }

.loading { color: var(--text-dim); padding: 40px 0; text-align: center; font-size: 13px; }
.empty { color: var(--text-dim); padding: 40px 0; text-align: center; font-size: 13px; }
```

- [ ] **Step 3: Create app.js**

Create `flux/app/runtime/wizard/app.js`:

```javascript
if (!window.__TAURI__) {
  document.body.textContent = 'Tauri IPC not available';
  throw new Error('[Wizard] window.__TAURI__ not available');
}

const { invoke } = window.__TAURI__.core;
const appWindow = window.__TAURI__.window.getCurrentWindow();

// ── State ──
let currentStep = 1;
let selectedThemeId = null;       // null = skipped
let allThemes = [];
let selectedModules = new Set();  // module id strings

// ── Close interception ──
// When user clicks X or presses Esc (via keydown), run escape path.
(async () => {
  await appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    await runEscapePath();
  });
})();

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') await runEscapePath();
});

async function runEscapePath() {
  try {
    await invoke('wizard_escape', { activeModules: [...selectedModules] });
  } catch (err) {
    console.error('[Wizard] wizard_escape failed:', err);
  }
}

// ── Step navigation ──
function goToStep(n) {
  document.querySelectorAll('.step-pane').forEach(el => el.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');
  document.querySelectorAll('.progress-step').forEach(el => {
    const sn = parseInt(el.dataset.step);
    el.classList.remove('active', 'done');
    if (sn === n) el.classList.add('active');
    else if (sn < n) el.classList.add('done');
  });
  currentStep = n;
}

// ── Step 1: Welcome ──
document.getElementById('btn-start').addEventListener('click', () => {
  goToStep(2);
  loadThemes();
});

// ── Step 2: Choose theme ──
async function loadThemes() {
  const grid = document.getElementById('theme-grid');
  grid.innerHTML = '<p class="loading">Loading themes…</p>';
  try {
    allThemes = await invoke('list_themes');
    renderThemeGrid();
  } catch (e) {
    grid.innerHTML = `<p class="loading">Could not load themes: ${escHtml(String(e))}</p>`;
  }
}

function renderThemeGrid() {
  const grid = document.getElementById('theme-grid');
  if (!allThemes.length) {
    grid.innerHTML = '<p class="empty">No themes found.</p>';
    return;
  }
  grid.innerHTML = `<div class="theme-grid">${allThemes.map(t => `
    <div class="theme-card ${t.id === selectedThemeId ? 'selected' : ''}"
         onclick="selectTheme('${escAttr(t.id)}')">
      <div class="theme-preview">
        ${t.preview_url
          ? `<img src="${escAttr(t.preview_url)}" alt="${escAttr(t.name)}" onerror="this.parentElement.textContent='No Preview'">`
          : 'No Preview'}
      </div>
      <div class="theme-info">
        <h3>${escHtml(t.name)}</h3>
        ${t.description ? `<p>${escHtml(t.description)}</p>` : ''}
      </div>
    </div>
  `).join('')}</div>`;
}

function selectTheme(id) {
  selectedThemeId = id;
  document.getElementById('btn-next-2').disabled = false;
  renderThemeGrid();
}

document.getElementById('btn-skip-theme').addEventListener('click', () => {
  selectedThemeId = null;
  goToStep(3);
  loadModuleList();
});

document.getElementById('btn-next-2').addEventListener('click', () => {
  goToStep(3);
  loadModuleList();
});

// ── Step 3: Pick modules ──
function loadModuleList() {
  const list = document.getElementById('module-list');
  let modules = [];
  if (selectedThemeId) {
    const theme = allThemes.find(t => t.id === selectedThemeId);
    modules = theme ? theme.modules : [];
  } else {
    // Aggregate all modules from all themes (deduplicated by id)
    const seen = new Set();
    for (const t of allThemes) {
      for (const m of t.modules) {
        if (!seen.has(m.id)) { seen.add(m.id); modules.push(m); }
      }
    }
  }

  // Default: all on
  selectedModules = new Set(modules.map(m => m.id));
  updateStep3Button();

  if (!modules.length) {
    list.innerHTML = '<p class="empty">No modules found for this theme.</p>';
    return;
  }

  list.innerHTML = modules.map(m => `
    <div class="module-toggle-row">
      <span class="module-label">${escHtml(m.name || m.id)}</span>
      <label class="toggle">
        <input type="checkbox" checked onchange="toggleModuleCheck('${escAttr(m.id)}', this.checked)">
        <span class="toggle-track"></span>
      </label>
    </div>
  `).join('');
}

function toggleModuleCheck(id, checked) {
  if (checked) selectedModules.add(id);
  else selectedModules.delete(id);
  updateStep3Button();
}

function updateStep3Button() {
  document.getElementById('btn-next-3').disabled = selectedModules.size === 0;
}

document.getElementById('btn-all').addEventListener('click', () => {
  selectedModules.clear();
  document.querySelectorAll('#module-list .module-toggle-row input[type=checkbox]').forEach(cb => {
    cb.checked = true;
    const match = cb.getAttribute('onchange').match(/'([^']+)'/);
    if (match) selectedModules.add(match[1]);
  });
  updateStep3Button();
});

document.getElementById('btn-none').addEventListener('click', () => {
  document.querySelectorAll('#module-list input[type=checkbox]').forEach(cb => {
    cb.checked = false;
  });
  selectedModules.clear();
  updateStep3Button();
});

document.getElementById('btn-back-3').addEventListener('click', () => goToStep(2));

document.getElementById('btn-next-3').addEventListener('click', () => {
  goToStep(4);
  updateLaunchSummary();
});

// ── Step 4: Launch ──
function updateLaunchSummary() {
  const count = selectedModules.size;
  const theme = selectedThemeId ? allThemes.find(t => t.id === selectedThemeId) : null;
  const summary = theme
    ? `Starting ${count} module${count !== 1 ? 's' : ''} from ${escHtml(theme.name)}`
    : `Starting ${count} module${count !== 1 ? 's' : ''}`;
  document.getElementById('launch-summary').textContent = summary;
}

document.getElementById('btn-back-4').addEventListener('click', () => goToStep(3));

document.getElementById('btn-launch').addEventListener('click', async () => {
  document.getElementById('btn-launch').disabled = true;
  try {
    await invoke('wizard_launch', { activeModules: [...selectedModules] });
  } catch (e) {
    console.error('[Wizard] wizard_launch failed:', e);
    document.getElementById('btn-launch').disabled = false;
  }
});

// ── Helpers ──
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

- [ ] **Step 4: Verify the files exist**

```bash
ls -la flux/app/runtime/wizard/
```

Expected: `index.html`, `style.css`, `app.js` all present.

- [ ] **Step 5: Build and sanity check**

```bash
cd flux/app/src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd flux/app && git add runtime/wizard/
git commit -m "feat: add first-run wizard runtime files (HTML/CSS/JS)"
```

---

## Task 8: Add archive install commands to lib.rs

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

Adds three commands: `install_theme_archive(path)`, `pick_and_install_theme()`, `uninstall_theme(id)`.

- [ ] **Step 1: Write failing test**

In `flux/app/src-tauri/src/lib.rs` `mod tests`, add:

```rust
#[test]
fn install_theme_archive_validates_zip_in_isolation() {
    // Test the validation step directly without Tauri state
    use archive::{extract_to_temp, validate_extracted};
    use std::io::Write as _;

    let tmp = std::env::temp_dir().join(format!("flux_install_test_{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let zip_path = tmp.join("good.zip");
    let f = std::fs::File::create(&zip_path).unwrap();
    let mut z = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default();
    z.start_file("theme.json", opts).unwrap();
    z.write_all(br#"{"id":"test-theme","name":"Test","modules":[]}"#).unwrap();
    z.finish().unwrap();

    let extract_dir = extract_to_temp(&zip_path).unwrap();
    let (id, _) = validate_extracted(&extract_dir).unwrap();
    assert_eq!(id, "test-theme");
    std::fs::remove_dir_all(&extract_dir).ok();
    std::fs::remove_dir_all(&tmp).ok();
}
```

- [ ] **Step 2: Run test to verify it passes** (tests existing archive.rs code)

```bash
cd flux/app/src-tauri && cargo test install_theme_archive_validates 2>&1 | tail -5
```

Expected: `ok`

- [ ] **Step 3: Add install helper function**

In `lib.rs`, after `open_themes_folder` (around line 377), add a private helper and the three Tauri commands:

```rust
/// Shared install logic: validate and move extracted archive to user themes dir.
fn do_install_archive(path: &std::path::Path, resource_dir: &std::path::Path) -> Result<ThemeInfo, String> {
    let extract_dir = archive::extract_to_temp(path)?;
    let result = (|| -> Result<ThemeInfo, String> {
        let (theme_id, _) = archive::validate_extracted(&extract_dir)?;
        // Check for duplicate
        let user_theme_dest = flux_user_themes_dir().join(&theme_id);
        if user_theme_dest.exists() {
            return Err(format!("Theme '{}' is already installed", theme_id));
        }
        // Move extracted dir to user themes
        std::fs::rename(&extract_dir, &user_theme_dest)
            .map_err(|e| format!("Could not install theme: {}", e))?;
        // Read the manifest we just installed
        find_theme_manifest(&theme_id, resource_dir)
            .map(|m| ThemeInfo {
                id: m.id,
                name: m.name,
                description: m.description,
                version: m.version,
                preview_url: m.preview.map(|f| format!("flux-module://_theme/{}/{}", theme_id, f)),
                modules: vec![],
                source: "user".to_string(),
            })
    })();
    // Always clean up extract_dir if it still exists (rename failed or error before rename)
    if extract_dir.exists() {
        let _ = std::fs::remove_dir_all(&extract_dir);
    }
    result
}

#[tauri::command]
fn install_theme_archive(app: AppHandle, path: String) -> Result<ThemeInfo, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    do_install_archive(std::path::Path::new(&path), &resource_dir)
}

#[tauri::command]
fn pick_and_install_theme(app: AppHandle) -> Result<ThemeInfo, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog()
        .file()
        .add_filter("Theme Archive", &["zip", "7z", "gz", "tgz"])
        .blocking_pick_file();
    let file_path = picked
        .ok_or_else(|| "cancelled".to_string())?
        .into_path()
        .map_err(|e| e.to_string())?;
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    do_install_archive(&file_path, &resource_dir)
}

#[tauri::command]
fn uninstall_theme(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    // Deactivate theme first if any modules are active
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    if let Ok(manifest) = find_theme_manifest(&id, &resource_dir) {
        let active_ids: Vec<String> = manifest.modules.iter()
            .filter(|mid| state.active_modules.lock().unwrap().contains_key(*mid))
            .cloned()
            .collect();
        if !active_ids.is_empty() {
            for mid in &active_ids { close_module_window(mid, &app, &state); }
            let mut cfg = state.config.lock().unwrap();
            let active_set: std::collections::HashSet<&str> = active_ids.iter().map(|s| s.as_str()).collect();
            cfg.engine.active_modules.retain(|m| !active_set.contains(m.as_str()));
            write_config(&state.config_path, &cfg).map_err(|e| e.to_string())?;
        }
    }
    // Remove theme directory
    let theme_dir = flux_user_themes_dir().join(&id);
    if !theme_dir.exists() {
        return Err(format!("Theme '{}' is not installed", id));
    }
    std::fs::remove_dir_all(&theme_dir).map_err(|e| format!("Could not remove theme: {}", e))
}
```

- [ ] **Step 4: Register new commands in invoke_handler**

Add `install_theme_archive, pick_and_install_theme, uninstall_theme` to the `generate_handler!` list.

- [ ] **Step 5: Compile**

```bash
cd flux/app/src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd flux/app && git add src-tauri/src/lib.rs
git commit -m "feat: add install_theme_archive, pick_and_install_theme, uninstall_theme commands"
```

---

## Task 9: Update Command Center HTML and CSS

**Files:**
- Modify: `flux/app/runtime/command-center/index.html`
- Modify: `flux/app/runtime/command-center/style.css`

Adds: "Install Theme…" button in header, install status area below header, drop-zone overlay, settings side panel.

- [ ] **Step 1: Update index.html**

Replace `flux/app/runtime/command-center/index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flux</title>
  <link rel="stylesheet" href="flux-module://_flux/command-center/style.css">
</head>
<body>
  <header class="app-header">
    <h1 class="app-title">Flux</h1>
    <div class="header-actions">
      <button class="btn-secondary" id="install-btn">Install Theme…</button>
      <button class="btn-secondary" id="browse-btn">Browse Themes Folder</button>
    </div>
  </header>

  <div class="install-status" id="install-status" hidden></div>

  <div class="cc-body">
    <main id="themes-container">
      <p class="status-text">Loading themes…</p>
    </main>

    <aside class="settings-panel" id="settings-panel" hidden>
      <div class="settings-panel-header">
        <span class="settings-panel-title" id="settings-panel-title">Settings</span>
        <button class="settings-close-btn" id="settings-close-btn" title="Close">✕</button>
      </div>
      <div class="settings-panel-body" id="settings-panel-body"></div>
    </aside>
  </div>

  <!-- Drop zone overlay (shown while dragging a file over the window) -->
  <div class="drop-overlay" id="drop-overlay" hidden>
    <div class="drop-overlay-inner">Drop theme archive to install</div>
  </div>

  <script src="flux-module://_flux/command-center/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Update style.css**

Replace `flux/app/runtime/command-center/style.css` with:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0e0e0e;
  --surface: #1a1a1a;
  --surface-hover: #222;
  --border: #2a2a2a;
  --text: #e0e0e0;
  --text-dim: #888;
  --accent: #4a9eff;
  --accent-hover: #6ab3ff;
  --danger: #ff5555;
  --danger-hover: #ff3333;
  --success: #4caf50;
  --radius: 8px;
  --transition: 0.15s ease;
  --panel-width: 240px;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

/* ── Header ── */
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 28px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg);
  z-index: 10;
}

.app-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.header-actions { display: flex; gap: 8px; align-items: center; }

/* ── Install status ── */
.install-status {
  padding: 10px 28px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.install-status.installing { color: var(--text-dim); }
.install-status.success { color: var(--success); }
.install-status.error { color: var(--danger); }

/* ── Body split layout ── */
.cc-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* ── Themes grid ── */
#themes-container {
  flex: 1;
  padding: 24px 28px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
  align-content: start;
  overflow-y: auto;
}

.status-text {
  grid-column: 1 / -1;
  color: var(--text-dim);
  padding: 60px 0;
  text-align: center;
  font-size: 15px;
}

/* ── Settings side panel ── */
.settings-panel {
  width: var(--panel-width);
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-panel[hidden] { display: none; }

.settings-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.settings-panel-title { font-size: 13px; font-weight: 600; color: var(--text); }

.settings-close-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}
.settings-close-btn:hover { background: var(--surface-hover); color: var(--text); }

.settings-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Settings fields */
.setting-field { display: flex; flex-direction: column; gap: 6px; }
.setting-label { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
.setting-value-label { font-size: 11px; color: var(--text-dim); text-align: right; }

.setting-range-row { display: flex; align-items: center; gap: 8px; }
.setting-range-row input[type=range] { flex: 1; accent-color: var(--accent); }

.setting-select {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  padding: 6px 10px;
  width: 100%;
  cursor: pointer;
}
.setting-select:focus { outline: 1px solid var(--accent); }

.setting-toggle-row { display: flex; align-items: center; justify-content: space-between; }

.setting-text-input {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  padding: 6px 10px;
  width: 100%;
}
.setting-text-input:focus { outline: 1px solid var(--accent); border-color: var(--accent); }

/* ── Buttons ── */
button {
  cursor: pointer;
  border: none;
  border-radius: var(--radius);
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
  white-space: nowrap;
}

.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); }

.btn-secondary { background: transparent; color: var(--text-dim); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--surface-hover); color: var(--text); border-color: #444; }

.btn-danger { background: transparent; color: var(--danger); border: 1px solid currentColor; }
.btn-danger:hover { background: var(--danger-hover); color: #fff; border-color: var(--danger-hover); }

/* ── Theme Card ── */
.theme-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color var(--transition);
}

.theme-card:hover { border-color: #444; }

.theme-preview {
  width: 100%;
  aspect-ratio: 16/9;
  background: #111;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 12px;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
}

.theme-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }

.theme-body {
  padding: 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.theme-header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.theme-name { font-size: 15px; font-weight: 600; }
.theme-desc { color: var(--text-dim); font-size: 12px; line-height: 1.6; }
.theme-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* ── Module List ── */
.theme-modules {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.module-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
}

.module-name { flex: 1; font-size: 13px; color: var(--text); }

/* ── Settings gear icon ── */
.module-settings-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
  transition: color var(--transition), background var(--transition);
}
.module-settings-btn:hover { color: var(--text); background: var(--surface-hover); }
.module-settings-btn.active { color: var(--accent); }

/* ── Toggle Switch ── */
.toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle-track {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 20px;
  cursor: pointer;
  transition: background var(--transition);
}
.toggle input:checked + .toggle-track { background: var(--accent); }
.toggle input:disabled + .toggle-track { cursor: not-allowed; opacity: 0.5; }
.toggle-track::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  top: 3px;
  left: 3px;
  transition: transform var(--transition);
  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
.toggle input:checked + .toggle-track::after { transform: translateX(16px); }

/* ── Source Badge ── */
.source-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
  line-height: 1.4;
}

/* ── Drop overlay ── */
.drop-overlay {
  position: fixed;
  inset: 0;
  background: rgba(74, 158, 255, 0.08);
  border: 2px dashed var(--accent);
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  pointer-events: none;
}

.drop-overlay[hidden] { display: none; }

.drop-overlay-inner {
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 16px 32px;
  font-size: 15px;
  font-weight: 500;
  color: var(--accent);
}
```

- [ ] **Step 3: Verify build**

```bash
cd flux/app/src-tauri && cargo check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd flux/app && git add runtime/command-center/index.html runtime/command-center/style.css
git commit -m "feat: update Command Center HTML/CSS for install, drag-drop, settings panel"
```

---

## Task 10: Update Command Center app.js

**Files:**
- Modify: `flux/app/runtime/command-center/app.js`

Adds: archive install via button and drag-drop, settings panel open/close/render.

- [ ] **Step 1: Replace app.js**

Replace `flux/app/runtime/command-center/app.js` with:

```javascript
if (!window.__TAURI__) {
  document.getElementById('themes-container').innerHTML =
    '<p class="status-text">Tauri IPC not available.</p>';
  throw new Error('[CommandCenter] window.__TAURI__ not available');
}

const { invoke } = window.__TAURI__.core;

// ── State ──
let openSettingsModuleId = null;

// ── Theme loading ──
async function loadThemes() {
  try {
    const themes = await invoke('list_themes');
    renderThemes(themes);
  } catch (e) {
    document.getElementById('themes-container').innerHTML =
      `<p class="status-text">Failed to load themes: ${escHtml(String(e))}</p>`;
  }
}

function renderThemes(themes) {
  const container = document.getElementById('themes-container');
  if (!themes.length) {
    container.innerHTML =
      '<p class="status-text">No themes found. Use "Install Theme…" to add one.</p>';
    return;
  }
  container.innerHTML = themes.map(theme => `
    <div class="theme-card">
      <div class="theme-preview">
        ${theme.preview_url
          ? `<img src="${escAttr(theme.preview_url)}" alt="${escAttr(theme.name)} preview" onerror="this.parentElement.textContent='No Preview'">`
          : 'No Preview'}
      </div>
      <div class="theme-body">
        <div class="theme-header">
          <span class="theme-name">${escHtml(theme.name)}</span>
          <span class="source-badge">${escHtml(theme.source)}</span>
        </div>
        ${theme.description ? `<p class="theme-desc">${escHtml(theme.description)}</p>` : ''}
        <div class="theme-actions">
          <button class="btn-primary" onclick="activateTheme('${escAttr(theme.id)}')">Activate All</button>
          <button class="btn-danger" onclick="deactivateTheme('${escAttr(theme.id)}')">Deactivate All</button>
        </div>
        ${theme.modules.length ? `
        <div class="theme-modules">
          ${theme.modules.map(m => `
            <div class="module-row">
              <span class="module-name">${escHtml(m.name)}</span>
              <div style="display:flex;align-items:center;gap:6px">
                ${m.has_settings ? `<button class="module-settings-btn ${openSettingsModuleId === m.id ? 'active' : ''}"
                  onclick="openSettingsPanel('${escAttr(m.id)}','${escAttr(m.name)}')"
                  title="Settings for ${escAttr(m.name)}">⚙</button>` : ''}
                <label class="toggle" title="${m.active ? 'Deactivate' : 'Activate'} ${escAttr(m.name)}">
                  <input type="checkbox" ${m.active ? 'checked' : ''}
                    onchange="toggleModule('${escAttr(m.id)}')">
                  <span class="toggle-track"></span>
                </label>
              </div>
            </div>
          `).join('')}
        </div>` : ''}
      </div>
    </div>
  `).join('');
}

// ── Module actions ──
async function toggleModule(id) {
  try { await invoke('toggle_module', { id }); } catch (e) { console.error('[CC] toggleModule:', e); }
  await loadThemes();
}

async function activateTheme(id) {
  try { await invoke('activate_theme', { id }); } catch (e) { console.error('[CC] activateTheme:', e); }
  await loadThemes();
}

async function deactivateTheme(id) {
  try { await invoke('deactivate_theme', { id }); } catch (e) { console.error('[CC] deactivateTheme:', e); }
  await loadThemes();
}

// ── Settings panel ──
async function openSettingsPanel(moduleId, moduleName) {
  if (openSettingsModuleId === moduleId) {
    closeSettingsPanel();
    return;
  }
  openSettingsModuleId = moduleId;
  const panel = document.getElementById('settings-panel');
  const title = document.getElementById('settings-panel-title');
  const body = document.getElementById('settings-panel-body');
  title.textContent = moduleName;
  body.innerHTML = '<p style="color:var(--text-dim);font-size:12px">Loading…</p>';
  panel.hidden = false;

  try {
    const [schema, values] = await Promise.all([
      invoke('get_module_settings_schema', { moduleId }),
      invoke('get_module_settings', { moduleId }),
    ]);
    renderSettingsFields(body, moduleId, schema, values);
  } catch (e) {
    body.innerHTML = `<p style="color:var(--danger);font-size:12px">Could not load settings: ${escHtml(String(e))}</p>`;
  }
  await loadThemes(); // re-render to highlight active gear icon
}

function closeSettingsPanel() {
  openSettingsModuleId = null;
  document.getElementById('settings-panel').hidden = true;
  loadThemes();
}

function renderSettingsFields(container, moduleId, schema, values) {
  if (!schema.length) {
    container.innerHTML = '<p style="color:var(--text-dim);font-size:12px">No configurable settings.</p>';
    return;
  }
  container.innerHTML = schema.map(field => {
    const val = values[field.key] !== undefined ? values[field.key] : field.default;
    switch (field.type) {
      case 'range': {
        const min = field.min ?? 0;
        const max = field.max ?? 100;
        const step = field.step ?? 1;
        return `<div class="setting-field">
          <span class="setting-label">${escHtml(field.label)}</span>
          <div class="setting-range-row">
            <input type="range" min="${escAttr(String(min))}" max="${escAttr(String(max))}"
              step="${escAttr(String(step))}" value="${escAttr(String(val))}"
              oninput="this.nextElementSibling.textContent=this.value; saveSetting('${escAttr(moduleId)}','${escAttr(field.key)}',+this.value)"
              >
            <span class="setting-value-label">${escHtml(String(val))}</span>
          </div>
        </div>`;
      }
      case 'select': {
        const opts = (field.options || []).map(o =>
          `<option value="${escAttr(o)}" ${o === val ? 'selected' : ''}>${escHtml(o)}</option>`
        ).join('');
        return `<div class="setting-field">
          <span class="setting-label">${escHtml(field.label)}</span>
          <select class="setting-select"
            onchange="saveSetting('${escAttr(moduleId)}','${escAttr(field.key)}',this.value)">
            ${opts}
          </select>
        </div>`;
      }
      case 'toggle': {
        return `<div class="setting-field">
          <div class="setting-toggle-row">
            <span class="setting-label">${escHtml(field.label)}</span>
            <label class="toggle">
              <input type="checkbox" ${val ? 'checked' : ''}
                onchange="saveSetting('${escAttr(moduleId)}','${escAttr(field.key)}',this.checked)">
              <span class="toggle-track"></span>
            </label>
          </div>
        </div>`;
      }
      case 'text': {
        return `<div class="setting-field">
          <span class="setting-label">${escHtml(field.label)}</span>
          <input type="text" class="setting-text-input" value="${escAttr(String(val))}"
            onchange="saveSetting('${escAttr(moduleId)}','${escAttr(field.key)}',this.value)">
        </div>`;
      }
      default:
        return '';
    }
  }).join('');
}

async function saveSetting(moduleId, key, value) {
  try {
    await invoke('set_module_setting', { moduleId, key, value });
  } catch (e) {
    console.error('[CC] saveSetting failed:', e);
  }
}

document.getElementById('settings-close-btn').addEventListener('click', closeSettingsPanel);

// Close settings panel when clicking outside it
document.getElementById('themes-container').addEventListener('click', () => {
  if (openSettingsModuleId) closeSettingsPanel();
});

// ── Archive install ──
function showInstallStatus(msg, type) {
  const el = document.getElementById('install-status');
  el.textContent = msg;
  el.className = 'install-status ' + type;
  el.hidden = false;
  if (type !== 'installing') {
    setTimeout(() => { el.hidden = true; }, 5000);
  }
}

async function installThemeFromPath(path) {
  showInstallStatus('Installing…', 'installing');
  try {
    const info = await invoke('install_theme_archive', { path });
    showInstallStatus(`Theme '${escHtml(info.name)}' installed successfully`, 'success');
    await loadThemes();
  } catch (e) {
    const msg = String(e);
    if (msg !== 'cancelled') {
      showInstallStatus(msg, 'error');
    } else {
      document.getElementById('install-status').hidden = true;
    }
  }
}

document.getElementById('install-btn').addEventListener('click', async () => {
  showInstallStatus('Opening file picker…', 'installing');
  try {
    const info = await invoke('pick_and_install_theme');
    showInstallStatus(`Theme '${escHtml(info.name)}' installed successfully`, 'success');
    await loadThemes();
  } catch (e) {
    const msg = String(e);
    if (msg !== 'cancelled') {
      showInstallStatus(msg, 'error');
    } else {
      document.getElementById('install-status').hidden = true;
    }
  }
});

// ── Drag-and-drop ──
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  document.getElementById('drop-overlay').hidden = false;
});
document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    document.getElementById('drop-overlay').hidden = true;
  }
});
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  document.getElementById('drop-overlay').hidden = true;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  // Tauri webview File objects have a .path property with the OS path
  const filePath = file.path || (file.name ? null : null);
  if (!filePath) {
    showInstallStatus('Could not determine file path from dropped file', 'error');
    return;
  }
  await installThemeFromPath(filePath);
});

// ── Misc ──
async function openThemesFolder() {
  try { await invoke('open_themes_folder'); } catch (e) { console.error('[CC] openThemesFolder:', e); }
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.getElementById('browse-btn').addEventListener('click', openThemesFolder);

loadThemes();
```

- [ ] **Step 2: Commit**

```bash
cd flux/app && git add runtime/command-center/app.js
git commit -m "feat: update Command Center JS for archive install, drag-drop, settings panel"
```

---

## Task 11: Add module settings Tauri commands and update list_themes

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

Adds `get_module_settings`, `set_module_setting`, `get_module_settings_schema` commands. Also updates `ModuleInfo` and `list_themes` to include `has_settings` field.

- [ ] **Step 1: Write failing test**

In `lib.rs` `mod tests`, add:

```rust
#[test]
fn module_info_has_settings_field() {
    // Verifies that ModuleInfo includes has_settings
    let info = ModuleInfo {
        id: "test".to_string(),
        name: "Test".to_string(),
        active: false,
        has_settings: false,
    };
    let json = serde_json::to_string(&info).unwrap();
    assert!(json.contains("has_settings"), "ModuleInfo JSON should include has_settings");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd flux/app/src-tauri && cargo test module_info_has_settings 2>&1 | tail -5
```

Expected: compile error — `has_settings` not a field on `ModuleInfo`.

- [ ] **Step 3: Update ModuleInfo struct**

In `lib.rs`, find the `ModuleInfo` struct (around line 86) and add `has_settings`:

```rust
#[derive(Debug, Serialize)]
pub struct ModuleInfo {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub has_settings: bool,
}
```

- [ ] **Step 4: Update scan_theme_dir to populate has_settings**

In `scan_theme_dir` (around line 290), the `modules` mapping line currently is:
```rust
let modules = manifest.modules.iter().map(|mid| ModuleInfo {
    id: mid.clone(),
    name: get_module_name_from_dir(&modules_dir.join(mid)),
    active: active.contains_key(mid),
}).collect();
```

Replace with:

```rust
let modules = manifest.modules.iter().map(|mid| {
    let module_dir = modules_dir.join(mid);
    let has_settings = get_module_has_settings(&module_dir);
    ModuleInfo {
        id: mid.clone(),
        name: get_module_name_from_dir(&module_dir),
        active: active.contains_key(mid),
        has_settings,
    }
}).collect();
```

- [ ] **Step 5: Add get_module_has_settings helper**

After `get_module_name_from_dir` (around line 263), add:

```rust
fn get_module_has_settings(module_dir: &std::path::Path) -> bool {
    let manifest_path = module_dir.join("module.json");
    fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str::<ModuleManifest>(&s).ok())
        .map(|m| !m.settings.is_empty())
        .unwrap_or(false)
}
```

- [ ] **Step 6: Add three new Tauri commands**

After `get_config` (around line 393), add:

```rust
#[tauri::command]
fn get_module_settings_schema(app: AppHandle, module_id: String) -> Result<Vec<SettingDef>, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let manifest = find_module_manifest(&module_id, &resource_dir)?;
    Ok(manifest.settings)
}

#[tauri::command]
fn get_module_settings(app: AppHandle, module_id: String) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let manifest = find_module_manifest(&module_id, &resource_dir)?;
    let settings_file = paths::flux_module_settings_dir().join(format!("{}.toml", module_id));
    Ok(module_settings::read_settings(&settings_file, &manifest.settings))
}

#[tauri::command]
fn set_module_setting(module_id: String, key: String, value: serde_json::Value) -> Result<(), String> {
    let settings_file = paths::flux_module_settings_dir().join(format!("{}.toml", module_id));
    module_settings::write_setting(&settings_file, &key, &value)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 7: Add find_module_manifest helper**

After `find_theme_manifest` (around line 327), add:

```rust
fn find_module_manifest(id: &str, resource_dir: &std::path::Path) -> Result<ModuleManifest, String> {
    // Check user modules dir first
    let user_path = flux_modules_dir().join(id).join("module.json");
    if user_path.exists() {
        let content = fs::read_to_string(&user_path).map_err(|e| e.to_string())?;
        return serde_json::from_str(&content).map_err(|e| e.to_string());
    }
    // Search user themes
    let user_themes = flux_user_themes_dir();
    if let Ok(entries) = fs::read_dir(&user_themes) {
        for entry in entries.flatten() {
            let p = entry.path().join("modules").join(id).join("module.json");
            if p.exists() {
                let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
                return serde_json::from_str(&content).map_err(|e| e.to_string());
            }
        }
    }
    // Search bundled themes
    let bundled = resource_dir.join("themes");
    if let Ok(entries) = fs::read_dir(&bundled) {
        for entry in entries.flatten() {
            let p = entry.path().join("modules").join(id).join("module.json");
            if p.exists() {
                let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
                return serde_json::from_str(&content).map_err(|e| e.to_string());
            }
        }
    }
    Err(format!("module '{}' not found", id))
}
```

- [ ] **Step 8: Add paths import for flux_module_settings_dir**

At the top of `lib.rs`, update the paths import:

```rust
use paths::{ensure_flux_dirs, flux_config_path, flux_modules_dir, flux_user_dir, flux_user_themes_dir};
```

Add `flux_module_settings_dir` to paths module usage in `set_module_setting` and `get_module_settings` (they use `paths::flux_module_settings_dir()` which requires the module to be in scope). Since `paths` is already `mod paths`, you can call `paths::flux_module_settings_dir()` or add it to the `use` line.

Update the use statement to:

```rust
use paths::{ensure_flux_dirs, flux_config_path, flux_modules_dir, flux_user_dir, flux_user_themes_dir, flux_module_settings_dir};
```

And update `set_module_setting` and `get_module_settings` to use `flux_module_settings_dir()` directly instead of `paths::flux_module_settings_dir()`.

- [ ] **Step 9: Register new commands in invoke_handler**

Add `get_module_settings_schema, get_module_settings, set_module_setting` to the `generate_handler!` list.

- [ ] **Step 10: Compile and run tests**

```bash
cd flux/app/src-tauri && cargo test 2>&1 | tail -15
```

Expected: all tests pass including `module_info_has_settings_field`.

- [ ] **Step 11: Commit**

```bash
cd flux/app && git add src-tauri/src/lib.rs
git commit -m "feat: add module settings Tauri commands and has_settings to ModuleInfo"
```

---

## Task 12: Update widget-api.js with getSettings()

**Files:**
- Modify: `flux/app/runtime/widget-api.js`

- [ ] **Step 1: Add getSettings to the widget object**

In `flux/app/runtime/widget-api.js`, inside the `widget` object (after `close()`), add:

```javascript
    /**
     * Get the current settings for this module.
     * Returns a Promise that resolves to a plain object { key: value, ... }.
     * Falls back to an empty object if the module has no settings schema.
     */
    getSettings() {
      return invoke('get_module_settings', { moduleId: windowLabel });
    },

    /**
     * Save a single setting value for this module.
     * @param {string} key
     * @param {*} value
     */
    saveSetting(key, value) {
      return invoke('set_module_setting', { moduleId: windowLabel, key, value });
    },
```

The full `widget` object should now expose: `drag`, `resize`, `openSettings`, `close`, `getSettings`, `saveSetting`.

- [ ] **Step 2: Commit**

```bash
cd flux/app && git add runtime/widget-api.js
git commit -m "feat: add getSettings() and saveSetting() to WidgetAPI.widget"
```

---

## Task 13: Final compile, test run, and integration verification

**Files:**
- No new files — this is a verification task.

- [ ] **Step 1: Run all tests**

```bash
cd flux/app/src-tauri && cargo test 2>&1 | tail -20
```

Expected: all tests pass. Count should be ≥ 42 (34 existing + 8 archive + 3 module_settings + new lib tests).

- [ ] **Step 2: Full build**

```bash
cd flux/app && cargo tauri build --debug 2>&1 | tail -10
```

Expected: `Finished` with no errors.

- [ ] **Step 3: Delete config.toml to trigger wizard**

```bash
rm -f ~/.local/share/flux/config.toml
```

- [ ] **Step 4: Launch and verify wizard appears**

```bash
cd flux/app && cargo tauri dev
```

Expected: wizard window opens (not Command Center), shows 4-step flow. Steps 1→2→3→4 navigate correctly. Pressing Esc opens Command Center instead. Launching from Step 4 writes config.toml and opens selected module windows.

- [ ] **Step 5: Verify archive install**

Create a zip archive of a test theme and install via "Install Theme…" button:

```bash
mkdir -p /tmp/test-theme && echo '{"id":"test-theme","name":"Test Theme","description":"For testing","version":"1.0.0","modules":[]}' > /tmp/test-theme/theme.json && cd /tmp && zip -r test-theme.zip test-theme/
```

Drop `test-theme.zip` onto the Command Center window. Expected: "Theme 'Test Theme' installed successfully" message appears. Run again — expected: "Theme 'test-theme' is already installed" error message.

- [ ] **Step 6: Verify per-module settings (if any module has settings)**

To test settings, add a `settings` array to `flux/themes/bridges/modules/system-stats/module.json`:

```json
"settings": [
  { "key": "update_interval_ms", "label": "Update interval", "type": "range", "default": 2000, "min": 500, "max": 10000, "step": 100, "options": [] }
]
```

Reload the app. The system-stats module row should show a ⚙ icon. Clicking it should open the settings panel on the right with a range slider. Adjusting the slider should create/update `~/.local/share/flux/settings/system-stats.toml`.

- [ ] **Step 7: Final commit**

```bash
cd flux/app && git add -A && git status
```

Verify only expected files are staged (no accidental .env or large binaries). Then:

```bash
git commit -m "test: Phase 2 integration verification complete"
```

Only create this commit if there are any leftover staged changes. If git status is clean, skip.

---

## Notes for Implementers

- **theme.json vs manifest.toml**: The spec mentions `manifest.toml` but the existing system uses `theme.json`. Archive validation reads `theme.json` to be consistent with bundled themes.
- **`sevenz-rust` API**: `sevenz_rust::decompress_file(src, dest)` — the first argument is the archive path, second is the output directory.
- **`tauri-plugin-dialog` blocking API**: `app.dialog().file().add_filter(...).blocking_pick_file()` returns `Option<tauri_plugin_dialog::FilePath>`. Call `.into_path()` to get a `std::path::PathBuf`.
- **File drop path in Tauri webview**: `event.dataTransfer.files[0].path` — Tauri injects a `.path` property on File objects in the webview.
- **Lock order**: existing rule (active_modules → desktop_wayland_windows → persistent → config) — no new locks added.

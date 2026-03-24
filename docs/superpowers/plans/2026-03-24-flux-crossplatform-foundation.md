# Flux Cross-Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all hard-coded paths, wrap Linux-only system stat code, and add the `windowLevel` field so Flux builds and runs correctly on Linux, Windows, and Mac.

**Architecture:** Extract path resolution into a testable `paths.rs` module. Refactor `PersistentState` to accept an explicit path parameter. Wrap Linux-only GPU and disk I/O code with `#[cfg(target_os = "linux")]`. Replace the hard-coded `always_on_top` field in module manifests with a `windowLevel` enum. The `~/Flux/` directory is the user-facing home for widgets on all platforms.

**Tech Stack:** Rust, Tauri 2.0, `serde_json`, `dirs` crate (new dependency), `sysinfo`, `nvml-wrapper`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `flux/app/src-tauri/src/paths.rs` | All path resolution logic — testable pure functions |
| Modify | `flux/app/src-tauri/src/lib.rs` | Use paths module; cfg wrapping; windowLevel; disk I/O |
| Modify | `flux/app/src-tauri/Cargo.toml` | Add `dirs` dependency |
| Modify | `flux/app/src-tauri/tauri.conf.json` | productName, identifier, CSP, bundle.resources |
| Modify | `flux/app/src/main.ts` | Handle `null` disk I/O values gracefully |
| Modify | `flux/modules/system-stats/module.json` | Replace `alwaysOnTop` with `windowLevel` |
| Modify | `flux/modules/time-date/module.json` | Replace `alwaysOnTop` with `windowLevel` |
| Modify | `flux/modules/weather/module.json` | Replace `alwaysOnTop` with `windowLevel` |
| Create | `flux/platform-notes.md` | Living log of cross-platform constraints |
| Create | `flux/docs/authoring-guide.md` | Widget authoring guide skeleton |
| Create | `bridgegap/.gitignore` | Ignore build artifacts, node_modules, target/ |

---

## Task 1: Initialize Git

**Files:**
- Create: `bridgegap/.gitignore`

- [ ] **Step 1: Initialize the repository**

```bash
cd /home/jack/bridgegap
git init
```

Expected: `Initialized empty Git repository in /home/jack/bridgegap/.git/`

- [ ] **Step 2: Create .gitignore**

Create `/home/jack/bridgegap/.gitignore`:

```gitignore
# Rust build artifacts
flux/app/src-tauri/target/

# Node / frontend
flux/app/node_modules/
flux/app/dist/
flux/website/node_modules/

# Tauri build output
flux/app/src-tauri/gen/

# Personal / machine-specific
flux/window_state.json

# OS
.DS_Store
Thumbs.db

# Obsidian
.obsidian/workspace.json
.obsidian/workspace-mobile.json
```

- [ ] **Step 3: Stage and commit everything**

```bash
cd /home/jack/bridgegap
git add .gitignore AGENTS.md CLAUDE.md GEMINI.md docs/ flux/ bridges-ghostty-theme/
git commit -m "chore: initialize repository"
```

Expected: commit created with summary of files.

---

## Task 2: Add `dirs` Crate + Create `paths.rs`

**Files:**
- Modify: `flux/app/src-tauri/Cargo.toml`
- Create: `flux/app/src-tauri/src/paths.rs`

- [ ] **Step 1: Write the failing tests**

Create `flux/app/src-tauri/src/paths.rs` with tests only first:

```rust
use std::path::PathBuf;

pub fn flux_user_dir() -> PathBuf {
    todo!()
}

pub fn flux_modules_dir() -> PathBuf {
    todo!()
}

pub fn flux_skins_dir() -> PathBuf {
    todo!()
}

pub fn ensure_flux_dirs() -> std::io::Result<()> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flux_user_dir_is_under_home() {
        let result = flux_user_dir();
        let home = dirs::home_dir().expect("home dir must exist");
        assert!(result.starts_with(&home), "expected {:?} to start with {:?}", result, home);
        assert_eq!(result.file_name().unwrap(), "Flux");
    }

    #[test]
    fn flux_modules_dir_is_under_flux_user_dir() {
        let result = flux_modules_dir();
        assert!(result.starts_with(flux_user_dir()));
        assert_eq!(result.file_name().unwrap(), "modules");
    }

    #[test]
    fn flux_skins_dir_is_under_flux_user_dir() {
        let result = flux_skins_dir();
        assert!(result.starts_with(flux_user_dir()));
        assert_eq!(result.file_name().unwrap(), "skins");
    }
}
```

- [ ] **Step 2: Add `dirs` to Cargo.toml**

In `flux/app/src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
dirs = "5"
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd /home/jack/bridgegap/flux/app/src-tauri
cargo test paths
```

Expected: compile error or `todo!()` panics — tests must be failing before proceeding.

- [ ] **Step 4: Implement the functions**

Replace the `todo!()` stubs in `paths.rs`:

```rust
use std::path::PathBuf;

/// Returns ~/Flux — the user-facing directory for widgets and skins.
/// Same path on all platforms: users never need to know about AppData or Library.
pub fn flux_user_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Flux")
}

/// Returns ~/Flux/modules — where community widget folders live.
pub fn flux_modules_dir() -> PathBuf {
    flux_user_dir().join("modules")
}

/// Returns ~/Flux/skins — reserved for future global skin overrides.
pub fn flux_skins_dir() -> PathBuf {
    flux_user_dir().join("skins")
}

/// Creates ~/Flux/modules and ~/Flux/skins if they do not exist.
/// Called once at app startup.
pub fn ensure_flux_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(flux_modules_dir())?;
    std::fs::create_dir_all(flux_skins_dir())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flux_user_dir_is_under_home() {
        let result = flux_user_dir();
        let home = dirs::home_dir().expect("home dir must exist");
        assert!(result.starts_with(&home), "expected {:?} to start with {:?}", result, home);
        assert_eq!(result.file_name().unwrap(), "Flux");
    }

    #[test]
    fn flux_modules_dir_is_under_flux_user_dir() {
        let result = flux_modules_dir();
        assert!(result.starts_with(flux_user_dir()));
        assert_eq!(result.file_name().unwrap(), "modules");
    }

    #[test]
    fn flux_skins_dir_is_under_flux_user_dir() {
        let result = flux_skins_dir();
        assert!(result.starts_with(flux_user_dir()));
        assert_eq!(result.file_name().unwrap(), "skins");
    }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /home/jack/bridgegap/flux/app/src-tauri
cargo test paths
```

Expected: 3 tests pass.

- [ ] **Step 6: Declare `paths` module in lib.rs**

At the top of `flux/app/src-tauri/src/lib.rs`, add after the existing `use` statements:

```rust
mod paths;
use paths::{ensure_flux_dirs, flux_modules_dir};
```

- [ ] **Step 7: Commit**

```bash
cd /home/jack/bridgegap
git add flux/app/src-tauri/Cargo.toml flux/app/src-tauri/src/paths.rs flux/app/src-tauri/src/lib.rs
git commit -m "feat: add paths module with cross-platform ~/Flux directory resolution"
```

---

## Task 3: Fix PersistentState — Dynamic Paths + Version Field

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs` (lines 39–69, 322–391)

- [ ] **Step 1: Write failing tests**

Add this test module at the bottom of `lib.rs` (before the final `}`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn persistent_state_roundtrip() {
        let path = temp_dir().join("flux_test_state.json");
        let mut state = PersistentState::default();
        state.windows.insert(
            "test-window".to_string(),
            WindowBounds { x: 10.0, y: 20.0, width: 400.0, height: 600.0 },
        );
        state.save(&path);
        let loaded = PersistentState::load(&path);
        assert_eq!(loaded.windows["test-window"].x, 10.0);
        assert_eq!(loaded.windows["test-window"].height, 600.0);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn persistent_state_missing_file_returns_default() {
        let path = temp_dir().join("flux_nonexistent_state.json");
        let _ = std::fs::remove_file(&path);
        let loaded = PersistentState::load(&path);
        assert!(loaded.windows.is_empty());
    }

    #[test]
    fn persistent_state_version_mismatch_returns_default() {
        let path = temp_dir().join("flux_test_version.json");
        std::fs::write(&path, r#"{"version": 999, "windows": {}}"#).unwrap();
        let loaded = PersistentState::load(&path);
        assert!(loaded.windows.is_empty());
        std::fs::remove_file(path).ok();
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/jack/bridgegap/flux/app/src-tauri
cargo test persistent_state
```

Expected: compile errors — `load` and `save` don't accept a path parameter yet.

- [ ] **Step 3: Update PersistentState struct and impl**

Replace the entire `PersistentState` struct and impl block in `lib.rs` (lines 48–69):

```rust
const STATE_VERSION: u32 = 1;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PersistentState {
    #[serde(default)]
    pub version: u32,
    pub windows: HashMap<String, WindowBounds>,
}

impl Default for PersistentState {
    fn default() -> Self {
        Self { version: STATE_VERSION, windows: HashMap::new() }
    }
}

impl PersistentState {
    pub fn load(path: &std::path::Path) -> Self {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(state) = serde_json::from_str::<Self>(&content) {
                if state.version == STATE_VERSION {
                    return state;
                }
                // Version mismatch: discard and start fresh
            }
        }
        Self::default()
    }

    pub fn save(&self, path: &std::path::Path) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(content) = serde_json::to_string_pretty(self) {
            let _ = fs::write(path, content);
        }
    }
}
```

- [ ] **Step 4: Add `data_dir` to AppState**

In the `AppState` struct, add a `data_dir` field:

```rust
pub struct AppState {
    pub sys: Mutex<System>,
    pub nvml: Option<Nvml>,
    pub last_net_io: Mutex<(u64, u64, Instant)>,
    pub last_disk_io: Mutex<(u64, u64, Instant)>,
    pub active_modules: Mutex<HashMap<String, ModuleManifest>>,
    pub persistent: Mutex<PersistentState>,
    pub data_dir: PathBuf,   // OS app data dir — for window_state.json
}
```

- [ ] **Step 5: Update the `run()` function to resolve data_dir and pass it to load/save**

In the `run()` function, replace the `tauri::Builder::default()` chain's `.manage(AppState { ... })` and `.setup(...)` with:

```rust
pub fn run() {
    let nvml = Nvml::init().ok();

    tauri::Builder::default()
        .setup(|app| {
            // Resolve data directory
            let data_dir = app.path().app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            // Create ~/Flux/modules and ~/Flux/skins if needed
            if let Err(e) = ensure_flux_dirs() {
                eprintln!("Warning: could not create Flux directories: {}", e);
            }

            // Load persistent state
            let state_path = data_dir.join("window_state.json");
            let persistent = PersistentState::load(&state_path);

            // Restore main window position
            if let Some(main_win) = app.get_webview_window("main") {
                if let Some(b) = persistent.windows.get("main") {
                    let _ = main_win.set_position(tauri::PhysicalPosition::new(b.x as i32, b.y as i32));
                    let _ = main_win.set_size(tauri::PhysicalSize::new(b.width as u32, b.height as u32));
                }
                track_window(main_win);
            }

            app.manage(AppState {
                sys: Mutex::new(System::new_all()),
                nvml,
                last_net_io: Mutex::new((0, 0, Instant::now())),
                last_disk_io: Mutex::new((0, 0, Instant::now())),
                active_modules: Mutex::new(HashMap::new()),
                persistent: Mutex::new(persistent),
                data_dir,
            });

            // System tray
            let quit_i = MenuItem::with_id(app, "quit", "Quit Flux", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show Command Center", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => std::process::exit(0),
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Continue with the rest of the builder chain unchanged:
        // .register_uri_scheme_protocol(...)
        // .plugin(tauri_plugin_opener::init())
        // .invoke_handler(tauri::generate_handler![...])
        // .run(tauri::generate_context!())
        // .expect(...)
```

- [ ] **Step 6: Update `track_window` to save using data_dir from AppState**

Replace the `track_window` function:

```rust
fn track_window(window: WebviewWindow) {
    let app_handle = window.app_handle().clone();
    let label = window.label().to_string();
    let w = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(_) | WindowEvent::Resized(_) = event {
            let state = app_handle.state::<AppState>();
            if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
                let mut p = state.persistent.lock().unwrap();
                p.windows.insert(label.clone(), WindowBounds {
                    x: pos.x as f64,
                    y: pos.y as f64,
                    width: size.width as f64,
                    height: size.height as f64,
                });
                let state_path = state.data_dir.join("window_state.json");
                p.save(&state_path);
            }
        }
    });
}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
cd /home/jack/bridgegap/flux/app/src-tauri
cargo test persistent_state
```

Expected: 3 tests pass.

- [ ] **Step 8: Build the app to confirm no compile errors**

```bash
cd /home/jack/bridgegap/flux/app
npm run tauri build -- --debug 2>&1 | tail -20
```

Expected: builds successfully. Fix any compile errors before continuing.

- [ ] **Step 9: Commit**

```bash
cd /home/jack/bridgegap
git add flux/app/src-tauri/src/lib.rs
git commit -m "fix: dynamic path resolution for window state using app_data_dir"
```

---

## Task 4: Fix Module Loading Paths

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs` (`list_modules`, `toggle_module`, `flux-module://` handler)

The `flux-module://` protocol and `list_modules`/`toggle_module` commands all hardcode `/home/jack/bridgegap/flux/modules`. Replace with `flux_modules_dir()` from `paths.rs`.

- [ ] **Step 1: Write failing test for module manifest parsing**

Add to the `#[cfg(test)]` block in `lib.rs`:

```rust
    #[test]
    fn module_manifest_parses_correctly() {
        let json = r#"{
            "id": "test-widget",
            "name": "Test Widget",
            "author": "Tester",
            "version": "1.0.0",
            "entry": "index.html",
            "window": {
                "width": 400, "height": 600,
                "transparent": true, "decorations": false,
                "alwaysOnTop": false, "resizable": true
            },
            "permissions": ["system:stats"]
        }"#;
        let manifest: ModuleManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.id, "test-widget");
        assert_eq!(manifest.window.width, 400.0);
        assert_eq!(manifest.permissions, vec!["system:stats"]);
    }
```

- [ ] **Step 2: Run test to confirm it passes (no changes needed — just a baseline)**

```bash
cd /home/jack/bridgegap/flux/app/src-tauri
cargo test module_manifest
```

Expected: 1 test passes. This is a baseline before we change the manifest struct.

- [ ] **Step 3: Update `list_modules` to use both user and bundled module paths**

In `lib.rs`, replace the `list_modules` function (currently lines ~93–112).

`list_modules` now accepts `app: AppHandle` so it can resolve `resource_dir()` for bundled modules. User modules shadow bundled ones by id (user version wins).

```rust
#[tauri::command]
fn list_modules(app: AppHandle, state: State<'_, AppState>) -> Vec<ModuleManifest> {
    let active_map = state.active_modules.lock().unwrap();
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut modules = Vec::new();

    // User modules first — these shadow bundled modules of the same id
    let bundled_path = app.path().resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("modules");

    for modules_path in [flux_modules_dir(), bundled_path] {
        if let Ok(entries) = fs::read_dir(&modules_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Ok(content) = fs::read_to_string(path.join("module.json")) {
                        if let Ok(mut manifest) = serde_json::from_str::<ModuleManifest>(&content) {
                            // User modules (first loop iteration) win over bundled duplicates
                            if seen_ids.insert(manifest.id.clone()) {
                                manifest.active = active_map.contains_key(&manifest.id);
                                modules.push(manifest);
                            }
                        }
                    }
                }
            }
        }
    }
    modules
}
```

Also update the `invoke_handler` registration at the bottom of `run()` to pass `app` to `list_modules` — Tauri injects `AppHandle` automatically when the command signature includes it, no call-site change needed.

- [ ] **Step 4: Update `toggle_module` to use `flux_modules_dir()`**

In `toggle_module`, replace the two lines that reference the hardcoded path:

```rust
// Old:
let modules_path = PathBuf::from("/home/jack/bridgegap/flux/modules");

// New:
let modules_path = flux_modules_dir();
```

There are two occurrences — on the lines that build `manifest_path`. Replace both.

- [ ] **Step 5: Update the `flux-module://` protocol handler**

In the `register_uri_scheme_protocol` closure, replace the hardcoded path:

```rust
.register_uri_scheme_protocol("flux-module", |app, request| {
    let uri = request.uri().to_string();
    let path_part = uri.strip_prefix("flux-module://").unwrap_or("");

    // Check user modules dir first, then bundled resources
    let user_path = flux_modules_dir().join(path_part);
    let file_path = if user_path.exists() {
        user_path
    } else {
        // Bundled fallback — will be populated when resource_dir is configured
        app.path().resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("modules")
            .join(path_part)
    };

    if let Ok(content) = fs::read(&file_path) {
        let ext = file_path.extension().map_or("", |e| e.to_str().unwrap_or(""));
        let mime = match ext {
            "html" => "text/html",
            "js" => "application/javascript",
            "css" => "text/css",
            "svg" => "image/svg+xml",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "json" => "application/json",
            _ => "application/octet-stream",
        };
        tauri::http::Response::builder()
            .header("Content-Type", mime)
            .body(content)
            .unwrap()
    } else {
        tauri::http::Response::builder().status(404).body(Vec::new()).unwrap()
    }
})
```

- [ ] **Step 6: Build to confirm no compile errors**

```bash
cd /home/jack/bridgegap/flux/app
npm run tauri build -- --debug 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 7: Manually verify modules load from ~/Flux/modules/**

Copy the modules directory to the new location and run the app:

```bash
mkdir -p ~/Flux/modules
cp -r /home/jack/bridgegap/flux/modules/* ~/Flux/modules/
cd /home/jack/bridgegap/flux/app
npm run tauri dev
```

Expected: app launches, modules appear in the list, widgets toggle on/off correctly.

- [ ] **Step 8: Commit**

```bash
cd /home/jack/bridgegap
git add flux/app/src-tauri/src/lib.rs
git commit -m "fix: replace hardcoded module paths with ~/Flux/modules/"
```

---

## Task 5: Replace `alwaysOnTop` with `windowLevel`

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`
- Modify: `flux/modules/system-stats/module.json`
- Modify: `flux/modules/time-date/module.json`
- Modify: `flux/modules/weather/module.json`

`always_on_top` is a binary flag. `windowLevel` is `"desktop" | "top" | "normal"`. Default is `"desktop"` (above wallpaper, below all windows — actual desktop-layer behaviour comes in Phase 2; for now `desktop` maps to `always_on_top: false`).

- [ ] **Step 1: Write failing test**

Add to the `#[cfg(test)]` block:

```rust
    #[test]
    fn module_manifest_parses_window_level_desktop() {
        let json = r#"{
            "id": "t", "name": "T", "author": "a", "version": "1.0.0",
            "entry": "index.html",
            "window": {
                "width": 400, "height": 600, "transparent": true,
                "decorations": false, "windowLevel": "desktop", "resizable": true
            },
            "permissions": []
        }"#;
        let manifest: ModuleManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.window.window_level, WindowLevel::Desktop);
    }

    #[test]
    fn module_manifest_window_level_defaults_to_desktop() {
        let json = r#"{
            "id": "t", "name": "T", "author": "a", "version": "1.0.0",
            "entry": "index.html",
            "window": {
                "width": 400, "height": 600, "transparent": true,
                "decorations": false, "resizable": true
            },
            "permissions": []
        }"#;
        let manifest: ModuleManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.window.window_level, WindowLevel::Desktop);
    }
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cargo test window_level
```

Expected: compile error — `WindowLevel` does not exist yet.

- [ ] **Step 3: Add `WindowLevel` enum and update `ModuleWindowConfig`**

Replace the `ModuleWindowConfig` struct in `lib.rs`:

```rust
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum WindowLevel {
    #[default]
    Desktop,
    Top,
    Normal,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleWindowConfig {
    pub width: f64,
    pub height: f64,
    pub transparent: bool,
    pub decorations: bool,
    #[serde(default)]
    pub window_level: WindowLevel,
    pub resizable: bool,
}
```

Note: `always_on_top` is removed. Old `module.json` files that still have `"alwaysOnTop"` will have the field ignored by serde (unknown fields are ignored by default), and `window_level` will default to `Desktop`.

- [ ] **Step 4: Update `toggle_module` to use `window_level`**

In `toggle_module`, replace the `.always_on_top(win_config.always_on_top)` builder call:

```rust
let always_on_top = win_config.window_level == WindowLevel::Top;

let mut builder = WebviewWindowBuilder::new(&app, &id, url)
    .title(&manifest.name)
    .transparent(win_config.transparent)
    .decorations(win_config.decorations)
    .always_on_top(always_on_top)
    .resizable(win_config.resizable)
    .skip_taskbar(true)
    .shadow(false);
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cargo test window_level
```

Expected: 2 new tests pass. Also run all tests:

```bash
cargo test
```

Expected: all tests pass.

- [ ] **Step 6: Update all three module.json files**

`flux/modules/system-stats/module.json` — replace `"alwaysOnTop": true` with `"windowLevel": "desktop"`:

```json
{
  "id": "system-stats",
  "name": "System Stats",
  "author": "Jack",
  "version": "1.0.0",
  "entry": "index.html",
  "window": {
    "width": 400,
    "height": 600,
    "transparent": true,
    "decorations": false,
    "windowLevel": "desktop",
    "resizable": true,
    "minWidth": 280,
    "minHeight": 450
  },
  "permissions": ["system:stats", "window:drag", "window:resize"]
}
```

`flux/modules/time-date/module.json`:

```json
{
  "id": "time-date",
  "name": "Time & Chronometry",
  "author": "Flux Core",
  "version": "1.0.0",
  "entry": "index.html",
  "window": {
    "width": 350,
    "height": 200,
    "transparent": true,
    "decorations": false,
    "windowLevel": "desktop",
    "resizable": true
  },
  "permissions": []
}
```

`flux/modules/weather/module.json`:

```json
{
  "id": "weather",
  "name": "Weather Report",
  "author": "Jack",
  "version": "1.0.0",
  "entry": "index.html",
  "window": {
    "width": 800,
    "height": 450,
    "transparent": true,
    "decorations": false,
    "windowLevel": "desktop",
    "resizable": true,
    "minWidth": 600,
    "minHeight": 350
  },
  "permissions": ["window:drag", "window:resize"]
}
```

- [ ] **Step 7: Build and smoke test**

```bash
cd /home/jack/bridgegap/flux/app
npm run tauri dev
```

Expected: app launches, modules toggle correctly. Widgets are no longer always-on-top by default.

- [ ] **Step 8: Commit**

```bash
cd /home/jack/bridgegap
git add flux/app/src-tauri/src/lib.rs flux/modules/
git commit -m "feat: replace alwaysOnTop with windowLevel enum (desktop/top/normal)"
```

---

## Task 6: Wrap Linux-Only GPU Code

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Wrap `get_linux_gpu_usage` in `#[cfg(target_os = "linux")]`**

Find `get_linux_gpu_usage()` (~line 237) and wrap the entire function:

```rust
#[cfg(target_os = "linux")]
fn get_linux_gpu_usage() -> u32 {
    for i in 0..3 {
        let path = format!("/sys/class/drm/card{}/device/gpu_busy_percent", i);
        if let Ok(content) = fs::read_to_string(path) {
            return content.trim().parse::<u32>().unwrap_or(0);
        }
    }
    0
}
```

- [ ] **Step 2: Wrap `get_linux_vram_best` in `#[cfg(target_os = "linux")]`**

Find `get_linux_vram_best()` (~line 245) and wrap the entire function:

```rust
#[cfg(target_os = "linux")]
fn get_linux_vram_best() -> Option<(u64, u64)> {
    let mut best = (0u64, 0u64);
    for i in 0..5 {
        let p = format!("/sys/class/drm/card{}/device", i);
        let t_p = format!("{}/mem_info_vram_total", p);
        let u_p = format!("{}/mem_info_vram_used", p);
        if let (Ok(t_s), Ok(u_s)) = (fs::read_to_string(&t_p), fs::read_to_string(&u_p)) {
            let t = t_s.trim().parse::<u64>().unwrap_or(0);
            let u = u_s.trim().parse::<u64>().unwrap_or(0);
            if t > best.1 { best = (u, t); }
        }
    }
    if best.1 > 0 { Some(best) } else { None }
}
```

- [ ] **Step 3: Wrap the Linux GPU fallback block in `get_system_stats`**

In `get_system_stats`, find the block that calls `get_linux_vram_best()` and `get_linux_gpu_usage()` (~lines 309–315) and wrap it:

```rust
#[cfg(target_os = "linux")]
if gpu.is_none() || gpu.as_ref().map_or(0, |g| g.usage) == 0 {
    if let Some((u, t)) = get_linux_vram_best() {
        let gpu_temp = components.iter()
            .filter(|c| c.label().to_lowercase().contains("gpu") || c.label().to_lowercase().contains("amdgpu"))
            .filter_map(|c| c.temperature())
            .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or(0.0);
        let mut usage = get_linux_gpu_usage();
        if usage == 0 { usage = gpu.as_ref().map_or(0, |g| g.usage); }
        gpu = Some(GpuStats {
            usage,
            vram_used: u,
            vram_total: t,
            vram_percentage: (u as f32 / t as f32) * 100.0,
            temp: gpu_temp,
        });
    }
}
```

- [ ] **Step 4: Build on Linux to confirm no errors**

```bash
cd /home/jack/bridgegap/flux/app
npm run tauri build -- --debug 2>&1 | tail -20
```

Expected: clean build. GPU stats still work on Linux.

- [ ] **Step 5: Commit**

```bash
cd /home/jack/bridgegap
git add flux/app/src-tauri/src/lib.rs
git commit -m "fix: wrap Linux-only GPU detection in cfg(target_os = linux)"
```

---

## Task 7: Scope Disk I/O to Linux-Only

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`
- Modify: `flux/app/src/main.ts`

- [ ] **Step 1: Write failing test**

Add to `#[cfg(test)]` block:

```rust
    #[test]
    fn system_stats_disk_fields_are_optional() {
        // Verify the struct compiles with Option<u64> disk fields.
        // The actual values depend on platform — we just check the type is correct.
        let stats = SystemStats {
            cpu_usage: 0.0, cpu_temp: 0.0, cpu_freq: 0,
            ram_used: 0, ram_total: 1, ram_percentage: 0.0,
            uptime: String::new(),
            net_in: 0, net_out: 0,
            disk_read: None,
            disk_write: None,
            gpu: None,
        };
        assert!(stats.disk_read.is_none());
        assert!(stats.disk_write.is_none());
    }
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cargo test disk_fields
```

Expected: compile error — `disk_read` and `disk_write` are currently `u64`, not `Option<u64>`.

- [ ] **Step 3: Update `SystemStats` struct**

Replace `disk_read: u64, disk_write: u64` in the `SystemStats` struct:

```rust
#[derive(Serialize)]
pub struct SystemStats {
    cpu_usage: f32, cpu_temp: f32, cpu_freq: u64,
    ram_used: u64, ram_total: u64, ram_percentage: f32,
    uptime: String,
    net_in: u64, net_out: u64,
    disk_read: Option<u64>,
    disk_write: Option<u64>,
    gpu: Option<GpuStats>,
}
```

- [ ] **Step 4: Wrap the `/proc/diskstats` block in `#[cfg(target_os = "linux")]`**

In `get_system_stats`, find the disk I/O section that reads `/proc/diskstats` and computes delta values. Replace the entire disk I/O section with:

```rust
#[cfg(target_os = "linux")]
let (disk_read, disk_write) = {
    let (td_r, td_w) = {
        if let Ok(content) = fs::read_to_string("/proc/diskstats") {
            let (mut tr, mut tw) = (0u64, 0u64);
            for line in content.lines() {
                let p: Vec<&str> = line.split_whitespace().collect();
                if p.len() > 13 {
                    let dev = p[2];
                    if dev.starts_with("sd") || dev.starts_with("nvme") {
                        tr += p[5].parse::<u64>().unwrap_or(0) * 512;
                        tw += p[9].parse::<u64>().unwrap_or(0) * 512;
                    }
                }
            }
            (tr, tw)
        } else {
            (0, 0)
        }
    };
    let mut last = state.last_disk_io.lock().unwrap();
    let el = now.duration_since(last.2).as_secs_f32();
    let res = if el > 0.0 {
        (
            Some((td_r.saturating_sub(last.0) as f32 / el) as u64),
            Some((td_w.saturating_sub(last.1) as f32 / el) as u64),
        )
    } else {
        (Some(0), Some(0))
    };
    *last = (td_r, td_w, now);
    res
};

#[cfg(not(target_os = "linux"))]
let (disk_read, disk_write) = (None, None);
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cargo test disk_fields
```

Expected: 1 test passes.

- [ ] **Step 6: Build to confirm no errors**

```bash
cd /home/jack/bridgegap/flux/app
npm run tauri build -- --debug 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 7: Update frontend to handle null disk values**

In `flux/app/src/main.ts`, find the disk I/O update section in `SystemStatsModule.update()` (~lines 138–143) and replace:

```typescript
// IO
if (stats.net_in !== undefined) {
  document.getElementById("net-in")!.textContent = `IN: ${fmtBS(stats.net_in)}`;
  document.getElementById("net-out")!.textContent = `OUT: ${fmtBS(stats.net_out)}`;
  this.netGraph.update(stats.net_in + stats.net_out, 1024 * 1024 * 2, theme.primary);
}

const diskSection = document.getElementById("disk-section");
if (stats.disk_read !== null && stats.disk_read !== undefined) {
  document.getElementById("disk-read")!.textContent = `READ: ${fmtBS(stats.disk_read)}`;
  document.getElementById("disk-write")!.textContent = `WRITE: ${fmtBS(stats.disk_write ?? 0)}`;
  this.diskGraph.update((stats.disk_read ?? 0) + (stats.disk_write ?? 0), 1024 * 1024 * 10, theme.primary);
  if (diskSection) diskSection.style.display = "";
} else {
  if (diskSection) diskSection.style.display = "none";
}
```

Also update the `SystemStats` interface in `main.ts` to reflect optional disk values:

```typescript
interface SystemStats {
  cpu_usage: number; cpu_temp: number; cpu_freq: number;
  ram_used: number; ram_total: number; ram_percentage: number;
  uptime: string; net_in: number; net_out: number;
  disk_read: number | null;
  disk_write: number | null;
  gpu?: GpuStats;
}
```

- [ ] **Step 8: Run all tests**

```bash
cd /home/jack/bridgegap/flux/app/src-tauri
cargo test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
cd /home/jack/bridgegap
git add flux/app/src-tauri/src/lib.rs flux/app/src/main.ts
git commit -m "fix: scope disk I/O stats to Linux-only, hide section on unsupported platforms"
```

---

## Task 8: Update tauri.conf.json

**Files:**
- Modify: `flux/app/src-tauri/tauri.conf.json`

- [ ] **Step 1: Update productName, identifier, and window defaults**

Replace `flux/app/src-tauri/tauri.conf.json` with:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Flux",
  "version": "0.1.0",
  "identifier": "dev.flux.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "label": "main",
        "title": "Flux",
        "width": 400,
        "height": 600,
        "minWidth": 280,
        "minHeight": 450,
        "resizable": true,
        "fullscreen": false,
        "transparent": true,
        "decorations": false,
        "alwaysOnTop": false,
        "shadow": false,
        "skipTaskbar": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src ipc: http://ipc.localhost flux-module:"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "resources": {
      "../../modules": "modules"
    },
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 2: Build to confirm no errors**

```bash
cd /home/jack/bridgegap/flux/app
npm run tauri build -- --debug 2>&1 | tail -20
```

Expected: clean build with product name "Flux".

- [ ] **Step 3: Commit**

```bash
cd /home/jack/bridgegap
git add flux/app/src-tauri/tauri.conf.json
git commit -m "chore: rename product to Flux, fix CSP for flux-module:// protocol, bundle modules as resources"
```

---

## Task 9: Write Platform Notes + Authoring Guide Skeleton

**Files:**
- Create: `flux/platform-notes.md`
- Create: `flux/docs/authoring-guide.md`

- [ ] **Step 1: Create platform-notes.md**

Create `flux/platform-notes.md`:

```markdown
# Flux Platform Notes

A living log of cross-platform constraints discovered during development.
Updated whenever a new limitation or workaround is found.
Feeds directly into the Widget Authoring Guide.

---

## 2026-03-24

### Disk I/O Throughput — Linux Only
**Affected platforms:** Windows, Mac (unavailable)
**Symptom:** `disk_read` and `disk_write` in `SystemStats` are `null` on non-Linux platforms.
**Reason:** Linux exposes disk I/O counters via `/proc/diskstats`. No equivalent cross-platform API exists in the `sysinfo` crate. `sysinfo::Disks` only provides storage capacity, not throughput.
**Workaround:** Widgets must check for `null` and hide the disk I/O section gracefully. See Authoring Guide — Handling Unavailable Stats.

### GPU Stats — Platform Coverage
**Affected platforms:** Partial
**Coverage:**
- Linux AMD: available via `/sys/class/drm/` (DRM subsystem)
- Linux NVIDIA: available via `nvml_wrapper`
- Windows NVIDIA: available via `nvml_wrapper` (requires NVIDIA driver)
- Windows AMD/Intel: unavailable
- Mac (all): unavailable
**Workaround:** `gpu` field in `SystemStats` is `null` when unavailable. Widgets must handle `gpu === null`. See Authoring Guide — Handling Unavailable Stats.

### Window Desktop Layer — Not Yet Implemented
**Affected platforms:** All
**Status:** Phase 2
**Notes:** The default `windowLevel: "desktop"` currently maps to a normal non-topmost window. True desktop-layer behaviour (above wallpaper, below all app windows) requires platform-specific implementation:
- Linux X11: `_NET_WM_WINDOW_TYPE_DESKTOP`
- Linux Wayland: compositor-dependent
- Windows: `WorkerW`/`Progman` parenting (Win32 API)
- Mac: `NSWindowLevel.desktopIconLevel`
Will be implemented and documented per platform in Phase 2.
```

- [ ] **Step 2: Create authoring-guide.md skeleton**

Create `flux/docs/authoring-guide.md`:

```markdown
# Flux Widget Authoring Guide

> **Cross-platform compatibility is Flux's contract.**
> If your widget runs on Flux, it runs on Linux, Windows, and Mac.
> This guide is how we keep that promise.

This is a living document. As new cross-platform constraints are discovered during
Flux development, they are added here. Check `platform-notes.md` for the raw log.

---

## Quick Start

A Flux widget is a folder containing:

```
my-widget/
  module.json     # manifest — required
  index.html      # entry point — required
  logic.js        # optional
  styles.css      # optional
  settings.html   # optional settings panel
  assets/         # optional
```

Drop it in `~/Flux/modules/` and it appears in Flux immediately.

---

## module.json Reference

```json
{
  "id": "my-widget",
  "name": "My Widget",
  "author": "Your Name",
  "version": "1.0.0",
  "entry": "index.html",
  "window": {
    "width": 400,
    "height": 300,
    "transparent": true,
    "decorations": false,
    "windowLevel": "desktop",
    "resizable": true
  },
  "permissions": []
}
```

### windowLevel
| Value | Behaviour |
|-------|-----------|
| `"desktop"` | Above wallpaper, below all windows (default) |
| `"top"` | Always on top of all windows |
| `"normal"` | Standard window z-ordering |

---

## The Flux API

Your widget's HTML/JS has access to these Tauri commands via `__TAURI__.core.invoke`:

### `get_system_stats`
Returns live system metrics. **Some fields are platform-dependent — always check for null.**

```typescript
interface SystemStats {
  cpu_usage: number;      // 0–100 percent
  cpu_temp: number;       // Celsius
  cpu_freq: number;       // MHz
  ram_used: number;       // bytes
  ram_total: number;      // bytes
  ram_percentage: number; // 0–100
  uptime: string;         // "HH:MM:SS"
  net_in: number;         // bytes/sec
  net_out: number;        // bytes/sec
  disk_read: number | null;   // bytes/sec — Linux only, null elsewhere
  disk_write: number | null;  // bytes/sec — Linux only, null elsewhere
  gpu: GpuStats | null;       // null if unavailable on this platform
}

interface GpuStats {
  usage: number;           // 0–100 percent
  vram_used: number;       // bytes
  vram_total: number;      // bytes
  vram_percentage: number; // 0–100
  temp: number;            // Celsius
}
```

### `drag_window`
Initiates a native window drag. Call on `mousedown` of your drag handle.

```javascript
__TAURI__.core.invoke("drag_window");
```

### `list_modules`
Returns all available module manifests (both active and inactive).

### `toggle_module`
Shows or hides a module window by id.

```javascript
__TAURI__.core.invoke("toggle_module", { id: "my-widget" });
```

---

## Cross-Platform Rules

Follow these rules and your widget will work everywhere.

### 1. Always handle null stats
```javascript
// Bad — crashes on Windows/Mac
document.getElementById("disk-read").textContent = fmtBytes(stats.disk_read);

// Good — safe everywhere
if (stats.disk_read !== null) {
  document.getElementById("disk-section").style.display = "";
  document.getElementById("disk-read").textContent = fmtBytes(stats.disk_read);
} else {
  document.getElementById("disk-section").style.display = "none";
}
```

### 2. No absolute file paths
Your widget runs from inside the `flux-module://` protocol. Use relative paths only.

```html
<!-- Bad -->
<img src="/home/user/my-widget/logo.png">

<!-- Good -->
<img src="assets/logo.png">
```

### 3. No Node.js APIs
Widgets run in a webview, not Node. `require()`, `fs`, `path` are not available.
All system data comes through `invoke()`.

### 4. No direct OS calls
Do not attempt to call OS APIs from the frontend. Everything goes through Flux's
Rust backend via `invoke`.

---

## Widget Compatibility Checklist

Include this as `COMPATIBILITY.md` in your widget repo before publishing:

```markdown
## Flux Compatibility

- [ ] Tested on Linux
- [ ] Handles `gpu: null` without UI breakage
- [ ] Handles `disk_read: null` / `disk_write: null` without UI breakage
- [ ] No hard-coded file paths
- [ ] No direct OS calls from frontend
- [ ] `module.json` is valid and complete
- [ ] Tested with `windowLevel: "desktop"`, `"top"`, and `"normal"`
```

---

## AI Prompting Guide

Flux widgets are designed to be AI-friendly. To generate a Flux-compliant widget:

1. Share this authoring guide with your AI assistant
2. Include the `SystemStats` interface above in your prompt
3. Ask the AI to handle null stats gracefully
4. Ask for a `module.json` with appropriate dimensions

Example prompt:
> "Using the Flux widget API below, create a widget that shows CPU usage as an
> animated bar. Handle the case where gpu is null. Follow all cross-platform rules."
> [paste the API section above]

---

*This guide is updated as new constraints are discovered. See `platform-notes.md` for the full log.*
```

- [ ] **Step 3: Commit**

```bash
cd /home/jack/bridgegap
git add flux/platform-notes.md flux/docs/authoring-guide.md
git commit -m "docs: add platform notes log and widget authoring guide skeleton"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /home/jack/bridgegap/flux/app/src-tauri
cargo test
```

Expected: all tests pass with no warnings about unused imports.

- [ ] **Step 2: Build release binary**

```bash
cd /home/jack/bridgegap/flux/app
npm run tauri build 2>&1 | tail -30
```

Expected: release build completes. Note the output binary path.

- [ ] **Step 3: Smoke test the release binary**

Run the release binary directly and verify:
- App launches and shows in system tray
- Modules load from `~/Flux/modules/`
- Widgets toggle on/off
- Window positions are saved and restored on restart
- No hard-coded paths in any error output

- [ ] **Step 4: Tag the release**

```bash
cd /home/jack/bridgegap
git tag v0.1.0-foundation
git log --oneline -10
```

Expected: clean commit history showing all tasks completed.

---

## What's Next

After this plan is complete, the following plans follow:

1. **Bridges Palette System** — palette swap settings menu, 3-4 colour variants (requires brainstorm session first)
2. **Window Layering (Phase 2)** — desktop-layer implementation per platform (Linux X11, Wayland, Windows WorkerW, Mac NSWindowLevel)
3. **Public Flux Repo Extraction** — separate the engine into its own public GitHub repo, GitHub README, Ko-fi integration

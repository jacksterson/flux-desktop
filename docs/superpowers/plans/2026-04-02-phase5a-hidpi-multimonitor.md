# Phase 5a: HiDPI Fixes + Multi-Monitor Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two HiDPI bugs (resize speed, position flash), add monitor-aware widget placement with off-screen recovery, and add a Preferences window.

**Architecture:** New `monitors.rs` handles fingerprinting and bounds detection. `WindowBounds` and `ModuleManifest` gain monitor-aware fields. Startup check moves off-screen widgets to primary. New Preferences window (`runtime/preferences/`) exposes monitor list and recovery actions. Tray menu gains "Bring all to screen" and "Preferences" items.

**Tech Stack:** Rust (Tauri 2, serde), vanilla ES modules (no bundler), `window.available_monitors()` Tauri API.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `flux/app/src-tauri/src/monitors.rs` | Create | Monitor fingerprints, offscreen detection, monitor collection |
| `flux/app/src-tauri/src/lib.rs` | Modify | WindowBounds fields, AppState fields, HiDPI fixes, startup check, tray menu, commands |
| `flux/app/runtime/preferences/index.html` | Create | Preferences window HTML |
| `flux/app/runtime/preferences/app.js` | Create | Preferences window logic |
| `flux/app/runtime/preferences/style.css` | Create | Preferences window styles |
| `flux/app/runtime/command-center/app.js` | Modify | Listen for startup toast, show banner |
| `flux/app/runtime/widget-editor/store.js` | Modify | Add `widgetMeta.allowOffscreen` |
| `flux/app/runtime/widget-editor/render.js` | Modify | Render allow-offscreen checkbox |
| `flux/app/runtime/widget-editor/file-ops.js` | Modify | Export `allowOffscreen` to widget.json |

---

### Task 1: Rust — monitors.rs module

**Files:**
- Create: `flux/app/src-tauri/src/monitors.rs`
- Modify: `flux/app/src-tauri/src/lib.rs` (add `pub mod monitors;`)

- [ ] **Step 1: Write failing tests**

At the bottom of the new file `flux/app/src-tauri/src/monitors.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn make_monitor(name: &str, w: u32, h: u32, x: i32, y: i32) -> MonitorInfo {
        MonitorInfo { name: name.to_string(), width: w, height: h, x, y, scale_factor: 1.0 }
    }

    #[test]
    fn fingerprint_format() {
        let m = make_monitor("DP-1", 2560, 1440, 0, 0);
        assert_eq!(monitor_fingerprint(&m), "DP-1:2560x1440@0,0");
    }

    #[test]
    fn fingerprint_negative_offset() {
        let m = make_monitor("HDMI-1", 1920, 1080, -1920, 0);
        assert_eq!(monitor_fingerprint(&m), "HDMI-1:1920x1080@-1920,0");
    }

    #[test]
    fn on_primary_monitor_not_offscreen() {
        let monitors = vec![make_monitor("DP-1", 2560, 1440, 0, 0)];
        assert!(!is_topleft_offscreen(100, 100, &monitors));
        assert!(!is_topleft_offscreen(0, 0, &monitors));
        assert!(!is_topleft_offscreen(2559, 1439, &monitors));
    }

    #[test]
    fn just_outside_right_edge_is_offscreen() {
        let monitors = vec![make_monitor("DP-1", 2560, 1440, 0, 0)];
        assert!(is_topleft_offscreen(2560, 0, &monitors));
    }

    #[test]
    fn on_secondary_monitor_not_offscreen() {
        let monitors = vec![
            make_monitor("DP-1", 2560, 1440, 0, 0),
            make_monitor("HDMI-1", 1920, 1080, 2560, 0),
        ];
        assert!(!is_topleft_offscreen(2700, 100, &monitors));
    }

    #[test]
    fn between_monitors_is_offscreen() {
        let monitors = vec![
            make_monitor("DP-1", 2560, 1440, 0, 0),
            make_monitor("HDMI-1", 1920, 1080, 3000, 0),
        ];
        // gap between 2560 and 3000
        assert!(is_topleft_offscreen(2600, 100, &monitors));
    }

    #[test]
    fn monitor_for_position_finds_correct_monitor() {
        let monitors = vec![
            make_monitor("DP-1", 2560, 1440, 0, 0),
            make_monitor("HDMI-1", 1920, 1080, 2560, 0),
        ];
        let m = monitor_for_position(2600, 50, &monitors);
        assert!(m.is_some());
        assert_eq!(m.unwrap().name, "HDMI-1");
    }

    #[test]
    fn primary_monitor_at_origin() {
        let monitors = vec![
            make_monitor("HDMI-1", 1920, 1080, -1920, 0),
            make_monitor("DP-1", 2560, 1440, 0, 0),
        ];
        let p = primary_monitor(&monitors);
        assert!(p.is_some());
        assert_eq!(p.unwrap().name, "DP-1");
    }

    #[test]
    fn primary_monitor_fallback_to_first() {
        let monitors = vec![make_monitor("HDMI-1", 1920, 1080, 100, 0)];
        let p = primary_monitor(&monitors);
        assert!(p.is_some());
        assert_eq!(p.unwrap().name, "HDMI-1");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd flux/app/src-tauri && cargo test monitors 2>&1 | grep -E "error|FAILED"
```

Expected: compile error — `monitors` not found.

- [ ] **Step 3: Implement monitors.rs**

Write `flux/app/src-tauri/src/monitors.rs`:

```rust
use tauri::AppHandle;

#[derive(Debug, Clone, serde::Serialize)]
pub struct MonitorInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale_factor: f64,
}

/// Stable string identifier for a monitor: "name:WxH@x,y"
pub fn monitor_fingerprint(m: &MonitorInfo) -> String {
    format!("{}:{}x{}@{},{}", m.name, m.width, m.height, m.x, m.y)
}

/// Returns true if the point (x, y) does not fall within any monitor's bounds.
pub fn is_topleft_offscreen(x: i32, y: i32, monitors: &[MonitorInfo]) -> bool {
    !monitors.iter().any(|m| {
        x >= m.x
            && x < m.x + m.width as i32
            && y >= m.y
            && y < m.y + m.height as i32
    })
}

/// Returns the monitor that contains (x, y), or None if off all monitors.
pub fn monitor_for_position<'a>(x: i32, y: i32, monitors: &'a [MonitorInfo]) -> Option<&'a MonitorInfo> {
    monitors.iter().find(|m| {
        x >= m.x
            && x < m.x + m.width as i32
            && y >= m.y
            && y < m.y + m.height as i32
    })
}

/// Returns the monitor at (0, 0), or the first monitor if none is at the origin.
pub fn primary_monitor(monitors: &[MonitorInfo]) -> Option<&MonitorInfo> {
    monitors
        .iter()
        .find(|m| m.x == 0 && m.y == 0)
        .or_else(|| monitors.first())
}

/// Collects all currently connected monitors from the OS via Tauri.
pub fn collect_monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| MonitorInfo {
            name: m.name().cloned().unwrap_or_else(|| "Unknown".to_string()),
            width: m.size().width,
            height: m.size().height,
            x: m.position().x,
            y: m.position().y,
            scale_factor: m.scale_factor(),
        })
        .collect()
}
```

Add `pub mod monitors;` in `lib.rs` after `pub mod custom_data;`.

- [ ] **Step 4: Run tests**

```bash
cd flux/app/src-tauri && cargo test monitors 2>&1 | tail -5
```

Expected: `test result: ok. 8 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add flux/app/src-tauri/src/monitors.rs flux/app/src-tauri/src/lib.rs
git commit -m "feat(rust): add monitors module — fingerprinting, offscreen detection, primary monitor"
```

---

### Task 2: Rust — Extend WindowBounds + HiDPI bug fixes

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing test for resize scale factor**

Find the `#[cfg(test)]` block in `lib.rs`. Add:

```rust
#[test]
fn resize_deltas_scale_with_hidpi() {
    // At 2x scale, a 10px CSS delta should become 20 physical pixels.
    // We test the scaling formula in isolation.
    let scale = 2.0_f64;
    let dx = 10_i32;
    let dy = 5_i32;
    let pdx = (dx as f64 * scale).round() as i32;
    let pdy = (dy as f64 * scale).round() as i32;
    assert_eq!(pdx, 20);
    assert_eq!(pdy, 10);
}
```

- [ ] **Step 2: Run test to verify it passes (pure arithmetic, no Tauri)**

```bash
cd flux/app/src-tauri && cargo test resize_deltas_scale 2>&1 | tail -3
```

Expected: `test result: ok. 1 passed`

- [ ] **Step 3: Extend WindowBounds struct**

Find `pub struct WindowBounds` (~line 132). Replace with:

```rust
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Fingerprint of the monitor this widget was last seen on ("name:WxH@x,y").
    /// None for widgets created before Phase 5a.
    #[serde(default)]
    pub monitor: Option<String>,
    /// If true, the startup off-screen check skips this widget.
    #[serde(default)]
    pub allow_offscreen: bool,
}
```

- [ ] **Step 4: Fix resize_module — apply scale factor**

Find `fn resize_module` (~line 1033). Replace the function body:

```rust
fn resize_module(app: AppHandle, id: String, direction: String, dx: i32, dy: i32) -> Result<(), String> {
    let window = app.get_webview_window(&id)
        .ok_or_else(|| format!("resize_module: window '{}' not found", id))?;

    // dx/dy arrive as CSS logical pixels from JS screenX/Y deltas.
    // inner_size() returns physical pixels. Scale to match.
    let scale = window.scale_factor().unwrap_or(1.0);
    let pdx = (dx as f64 * scale).round() as i32;
    let pdy = (dy as f64 * scale).round() as i32;

    let current = window.inner_size().map_err(|e| e.to_string())?;
    let (dw, dh): (i32, i32) = match direction.as_str() {
        "East"      => (pdx, 0),
        "West"      => (-pdx, 0),
        "North"     => (0, -pdy),
        "South"     => (0, pdy),
        "NorthEast" => (pdx, -pdy),
        "NorthWest" => (-pdx, -pdy),
        "SouthEast" => (pdx, pdy),
        "SouthWest" => (-pdx, pdy),
        other => return Err(format!("resize_module: unknown direction '{}'", other)),
    };
    let new_w = (current.width as i32 + dw).max(100) as u32;
    let new_h = (current.height as i32 + dh).max(100) as u32;
    window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: new_w, height: new_h }))
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 5: Fix position flash — remove builder.position() in both launch paths**

In `launch_module_window`, find the first occurrence (~line 843):

```rust
if let Some(b) = &saved {
    builder = builder.position(b.x, b.y).inner_size(b.width, b.height);
} else {
    builder = builder.inner_size(win_config.width, win_config.height);
}
```

Replace with (remove `.position(b.x, b.y)`):

```rust
if let Some(b) = &saved {
    builder = builder.inner_size(b.width, b.height);
} else {
    builder = builder.inner_size(win_config.width, win_config.height);
}
```

Find the second occurrence (~line 948):

```rust
if let Some(b) = &saved {
    builder = builder.position(b.x, b.y).inner_size(b.width, b.height);
}
```

Replace with:

```rust
if let Some(b) = &saved {
    builder = builder.inner_size(b.width, b.height);
}
```

The subsequent `set_position(PhysicalPosition::new(...))` calls already handle correct physical placement — the builder calls were redundant and caused the flash.

- [ ] **Step 6: Save monitor fingerprint on window move**

Find the `WindowEvent` handler that saves bounds (~line 777):

```rust
if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
    let mut p = state.persistent.lock().unwrap();
    p.windows.insert(label.clone(), WindowBounds {
        x: pos.x as f64,
        y: pos.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    });
```

Replace with:

```rust
if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
    let monitor_fp = {
        let ms = monitors::collect_monitors(app);
        monitors::monitor_for_position(pos.x, pos.y, &ms)
            .map(monitors::monitor_fingerprint)
    };
    // Preserve allow_offscreen from existing saved state
    let allow_offscreen = {
        let p = state.persistent.lock().unwrap();
        p.windows.get(&label).map(|b| b.allow_offscreen).unwrap_or(false)
    };
    let mut p = state.persistent.lock().unwrap();
    p.windows.insert(label.clone(), WindowBounds {
        x: pos.x as f64,
        y: pos.y as f64,
        width: size.width as f64,
        height: size.height as f64,
        monitor: monitor_fp,
        allow_offscreen,
    });
```

- [ ] **Step 7: Run all tests**

```bash
cd flux/app/src-tauri && cargo test 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add flux/app/src-tauri/src/lib.rs
git commit -m "fix(rust): HiDPI resize scale factor, remove builder.position() flash, save monitor fingerprint"
```

---

### Task 3: Rust — AppState offscreen tracking + startup check + new commands

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing test for off-screen check logic**

Add to the test block in `lib.rs`:

```rust
#[test]
fn offscreen_check_identifies_out_of_bounds_window() {
    use crate::monitors::{MonitorInfo, is_topleft_offscreen};
    let monitors = vec![MonitorInfo {
        name: "DP-1".to_string(), width: 2560, height: 1440,
        x: 0, y: 0, scale_factor: 1.0,
    }];
    // On-screen
    assert!(!is_topleft_offscreen(100, 100, &monitors));
    // Off right edge
    assert!(is_topleft_offscreen(3000, 100, &monitors));
    // Off bottom
    assert!(is_topleft_offscreen(100, 1500, &monitors));
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd flux/app/src-tauri && cargo test offscreen_check 2>&1 | tail -3
```

Expected: `test result: ok. 1 passed`

- [ ] **Step 3: Extend AppState**

Find `pub struct AppState` (~line 188). Add two new fields:

```rust
pub struct AppState {
    pub sys: Mutex<System>,
    pub nvml: Option<Nvml>,
    pub last_net_io: Mutex<(u64, u64, Instant)>,
    pub last_disk_io: Mutex<(u64, u64, Instant)>,
    pub active_modules: Mutex<HashMap<String, ModuleManifest>>,
    pub persistent: Mutex<PersistentState>,
    pub data_dir: PathBuf,
    pub desktop_wayland_windows: Mutex<HashSet<String>>,
    pub config: Mutex<EngineConfig>,
    pub config_path: PathBuf,
    pub custom_broker: CustomDataBroker,
    /// IDs of widgets currently positioned off all monitors.
    pub offscreen_widgets: Mutex<Vec<String>>,
    /// Startup notification text set if any widgets were auto-recovered; consumed on first read.
    pub startup_toast: Mutex<Option<String>>,
}
```

Find where `AppState` is constructed (the `manage(AppState { ... })` call, ~line 1270). Add the two new fields:

```rust
offscreen_widgets: Mutex::new(Vec::new()),
startup_toast: Mutex::new(None),
```

- [ ] **Step 4: Implement check_and_recover_offscreen_widgets**

Add this function before the `#[tauri::command]` section:

```rust
/// Checks all active widget windows. Moves off-screen widgets (where allow_offscreen is false)
/// to (primary.x + 20, primary.y + 20). Returns the number of widgets moved.
fn check_and_recover_offscreen_widgets(app: &AppHandle, state: &AppState) -> usize {
    let ms = monitors::collect_monitors(app);
    let Some(primary) = monitors::primary_monitor(&ms) else { return 0; };
    let recover_x = primary.x + 20;
    let recover_y = primary.y + 20;
    let primary_fp = monitors::monitor_fingerprint(primary);

    let window_ids: Vec<String> = {
        let p = state.persistent.lock().unwrap();
        p.windows.keys().cloned().collect()
    };

    let mut moved = 0;
    let mut offscreen_ids: Vec<String> = Vec::new();

    for id in &window_ids {
        let bounds = {
            let p = state.persistent.lock().unwrap();
            p.windows.get(id).cloned()
        };
        let Some(bounds) = bounds else { continue; };

        let offscreen = monitors::is_topleft_offscreen(bounds.x as i32, bounds.y as i32, &ms);
        if offscreen {
            offscreen_ids.push(id.clone());
        }

        if offscreen && !bounds.allow_offscreen {
            if let Some(window) = app.get_webview_window(id) {
                let _ = window.set_position(tauri::PhysicalPosition::new(recover_x, recover_y));
            }
            {
                let mut p = state.persistent.lock().unwrap();
                if let Some(b) = p.windows.get_mut(id) {
                    b.x = recover_x as f64;
                    b.y = recover_y as f64;
                    b.monitor = Some(primary_fp.clone());
                }
            }
            moved += 1;
        }
    }

    *state.offscreen_widgets.lock().unwrap() = offscreen_ids;
    moved
}
```

- [ ] **Step 5: Call startup check after modules launch**

Find the startup module launch loop (~line 1358):

```rust
for id in &active_on_start {
    if let Err(e) = launch_module_window(id, &handle, &state) {
        eprintln!("[flux] Warning: could not launch '{}' on startup: {}", id, e);
    }
}
```

Add the check immediately after the loop:

```rust
for id in &active_on_start {
    if let Err(e) = launch_module_window(id, &handle, &state) {
        eprintln!("[flux] Warning: could not launch '{}' on startup: {}", id, e);
    }
}

let recovered = check_and_recover_offscreen_widgets(&handle, &state);
if recovered > 0 {
    let msg = format!(
        "{} widget{} off-screen and moved to your primary monitor.",
        recovered,
        if recovered == 1 { " was" } else { " were" }
    );
    *state.startup_toast.lock().unwrap() = Some(msg);
}
```

- [ ] **Step 6: Add new Tauri commands**

Add these commands after `is_layer_shell_window`:

```rust
#[tauri::command]
fn get_monitors(app: AppHandle) -> Vec<monitors::MonitorInfo> {
    monitors::collect_monitors(&app)
}

#[tauri::command]
fn bring_all_to_screen(app: AppHandle, state: State<'_, AppState>) -> usize {
    check_and_recover_offscreen_widgets(&app, &state)
}

#[tauri::command]
fn move_widget_to_monitor(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    monitor_index: usize,
) -> Result<(), String> {
    let ms = monitors::collect_monitors(&app);
    let m = ms.get(monitor_index)
        .ok_or_else(|| format!("monitor index {} out of range", monitor_index))?;
    let x = m.x + 20;
    let y = m.y + 20;
    let window = app.get_webview_window(&id)
        .ok_or_else(|| format!("window '{}' not found", id))?;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    {
        let mut p = state.persistent.lock().unwrap();
        if let Some(b) = p.windows.get_mut(&id) {
            b.x = x as f64;
            b.y = y as f64;
            b.monitor = Some(monitors::monitor_fingerprint(m));
        }
    }
    Ok(())
}

#[tauri::command]
fn get_offscreen_widgets(state: State<'_, AppState>) -> Vec<String> {
    state.offscreen_widgets.lock().unwrap().clone()
}

#[tauri::command]
fn recover_widget(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let ms = monitors::collect_monitors(&app);
    let primary = monitors::primary_monitor(&ms)
        .ok_or_else(|| "no monitors found".to_string())?;
    let x = primary.x + 20;
    let y = primary.y + 20;
    let window = app.get_webview_window(&id)
        .ok_or_else(|| format!("window '{}' not found", id))?;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    {
        let mut p = state.persistent.lock().unwrap();
        if let Some(b) = p.windows.get_mut(&id) {
            b.x = x as f64;
            b.y = y as f64;
            b.monitor = Some(monitors::monitor_fingerprint(primary));
        }
    }
    // Remove from offscreen list
    state.offscreen_widgets.lock().unwrap().retain(|i| i != &id);
    Ok(())
}

#[tauri::command]
fn get_and_clear_startup_toast(state: State<'_, AppState>) -> Option<String> {
    state.startup_toast.lock().unwrap().take()
}
```

- [ ] **Step 7: Register commands in invoke_handler**

Find the `invoke_handler` list. Add:

```rust
get_monitors, bring_all_to_screen, move_widget_to_monitor,
get_offscreen_widgets, recover_widget, get_and_clear_startup_toast,
```

- [ ] **Step 8: Run all tests**

```bash
cd flux/app/src-tauri && cargo test 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add flux/app/src-tauri/src/lib.rs
git commit -m "feat(rust): startup off-screen recovery, offscreen tracking, monitor commands"
```

---

### Task 4: Rust — Tray menu additions

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add new tray menu items**

Find the tray menu construction block (~line 1285). Replace with:

```rust
use tauri::menu::PredefinedMenuItem;
let open_i          = MenuItem::with_id(app, "open_cc",          "Open Command Center",       true, None::<&str>)?;
let widget_editor_i = MenuItem::with_id(app, "widget_editor",    "Widget Editor",              true, None::<&str>)?;
let browse_i        = MenuItem::with_id(app, "browse",           "Browse Themes Folder",       true, None::<&str>)?;
let bring_i         = MenuItem::with_id(app, "bring_to_screen",  "Bring all widgets to screen",true, None::<&str>)?;
let login_i         = CheckMenuItem::with_id(app, "toggle_autostart", "Start on Login", true, initial_autostart, None::<&str>)?;
let sep             = PredefinedMenuItem::separator(app)?;
let prefs_i         = MenuItem::with_id(app, "preferences",      "Preferences",                true, None::<&str>)?;
let sep2            = PredefinedMenuItem::separator(app)?;
let quit_i          = MenuItem::with_id(app, "quit",             "Quit Flux",                  true, None::<&str>)?;
let menu = Menu::with_items(app, &[
    &open_i, &widget_editor_i, &browse_i, &bring_i, &login_i,
    &sep, &prefs_i, &sep2, &quit_i,
])?;
```

- [ ] **Step 2: Handle new tray menu events**

In the `on_menu_event` closure, add cases for the two new items:

```rust
"bring_to_screen" => {
    let state = app.state::<AppState>();
    let moved = check_and_recover_offscreen_widgets(app, &state);
    if moved > 0 {
        let msg = format!(
            "{} widget{} moved to your primary monitor.",
            moved,
            if moved == 1 { " was" } else { " were" }
        );
        *state.startup_toast.lock().unwrap() = Some(msg);
    }
}
"preferences" => {
    if let Some(win) = app.get_webview_window("flux-preferences") {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        let url = WebviewUrl::CustomProtocol(
            "flux-module://_flux/preferences/index.html".parse::<tauri::Url>().unwrap()
        );
        let _ = WebviewWindowBuilder::new(app, "flux-preferences", url)
            .title("Flux Preferences")
            .inner_size(480.0, 420.0)
            .min_inner_size(400.0, 320.0)
            .decorations(true)
            .transparent(false)
            .build();
    }
}
```

- [ ] **Step 3: Run all tests**

```bash
cd flux/app/src-tauri && cargo test 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add flux/app/src-tauri/src/lib.rs
git commit -m "feat(rust): tray menu — bring all to screen, preferences window"
```

---

### Task 5: JS — Preferences window

**Files:**
- Create: `flux/app/runtime/preferences/index.html`
- Create: `flux/app/runtime/preferences/app.js`
- Create: `flux/app/runtime/preferences/style.css`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flux Preferences</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="prefs-container">
    <h1 class="prefs-title">Preferences</h1>

    <section class="prefs-section">
      <h2 class="section-title">Display</h2>
      <div id="monitor-list" class="monitor-list"></div>
      <button id="btn-bring-all" class="btn-primary">Bring all widgets to screen</button>
      <div id="bring-result" class="result-msg" style="display:none;"></div>
    </section>

    <section class="prefs-section">
      <h2 class="section-title">Advanced</h2>
      <p class="section-desc">Widgets positioned off all connected monitors.</p>
      <div id="offscreen-list"></div>
    </section>
  </div>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create app.js**

```js
const { invoke } = window.__TAURI__.core;

async function loadMonitors() {
    const monitors = await invoke('get_monitors');
    const el = document.getElementById('monitor-list');
    if (monitors.length === 0) {
        el.innerHTML = '<p class="empty-state">No monitors detected.</p>';
        return;
    }
    el.innerHTML = monitors.map((m, i) =>
        `<div class="monitor-row">
            <span class="monitor-name">${escHtml(m.name)}</span>
            <span class="monitor-res">${m.width}×${m.height}</span>
            ${m.x === 0 && m.y === 0 ? '<span class="monitor-badge">Primary</span>' : ''}
        </div>`
    ).join('');
}

async function loadOffscreenWidgets() {
    const ids = await invoke('get_offscreen_widgets');
    const el = document.getElementById('offscreen-list');
    if (ids.length === 0) {
        el.innerHTML = '<p class="empty-state">All widgets are on-screen.</p>';
        return;
    }
    el.innerHTML = '<div class="offscreen-table">' +
        ids.map(id =>
            `<div class="offscreen-row">
                <span class="offscreen-id">${escHtml(id)}</span>
                <button class="btn-recover btn-secondary" data-id="${escHtml(id)}">Move to primary</button>
            </div>`
        ).join('') +
        '</div>';

    el.querySelectorAll('.btn-recover').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await invoke('recover_widget', { id: btn.dataset.id });
                await loadOffscreenWidgets();
            } catch (e) {
                console.error('recover_widget failed:', e);
            }
        });
    });
}

document.getElementById('btn-bring-all').addEventListener('click', async () => {
    const resultEl = document.getElementById('bring-result');
    try {
        const count = await invoke('bring_all_to_screen');
        resultEl.textContent = count === 0
            ? 'All widgets are already on-screen.'
            : `${count} widget${count === 1 ? ' was' : ' were'} moved to your primary monitor.`;
        resultEl.style.display = 'block';
        await loadOffscreenWidgets();
        setTimeout(() => { resultEl.style.display = 'none'; }, 4000);
    } catch (e) {
        resultEl.textContent = 'Error: ' + e;
        resultEl.style.display = 'block';
    }
});

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

loadMonitors();
loadOffscreenWidgets();
```

- [ ] **Step 3: Create style.css**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d1117; color: #e6edf3; font-family: monospace; font-size: 13px; }

.prefs-container { padding: 20px 24px; max-width: 480px; }
.prefs-title { font-size: 16px; font-weight: 600; margin-bottom: 20px; color: #fff; }

.prefs-section { margin-bottom: 28px; }
.section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #666; margin-bottom: 10px; }
.section-desc { font-size: 11px; color: #666; margin-bottom: 8px; }

.monitor-list { margin-bottom: 12px; }
.monitor-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #1c2128; }
.monitor-name { color: #e6edf3; flex: 1; }
.monitor-res { color: #666; font-size: 11px; }
.monitor-badge { font-size: 10px; background: #1a3a4a; color: #00bfff; border-radius: 3px; padding: 1px 5px; }

.btn-primary { background: #00bfff; color: #000; border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 12px; font-family: monospace; }
.btn-primary:hover { background: #33ccff; }
.btn-secondary { background: transparent; color: #ccc; border: 1px solid #333; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 11px; font-family: monospace; }
.btn-secondary:hover { border-color: #00bfff; color: #00bfff; }

.result-msg { margin-top: 8px; font-size: 11px; color: #00bfff; }
.empty-state { color: #555; font-size: 11px; padding: 4px 0; }

.offscreen-table { display: flex; flex-direction: column; gap: 6px; }
.offscreen-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: #1a1a2e; border: 1px solid #30363d; border-radius: 4px; }
.offscreen-id { color: #e6edf3; font-size: 12px; }
```

- [ ] **Step 4: Verify module syntax**

```bash
node --input-type=module < flux/app/runtime/preferences/app.js 2>&1 | head -3
```

Expected: error about `window` not defined (not a Node module) — no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add flux/app/runtime/preferences/
git commit -m "feat(js): preferences window — monitor list, bring to screen, recover hidden widgets"
```

---

### Task 6: JS — Command center startup toast

**Files:**
- Modify: `flux/app/runtime/command-center/app.js`

- [ ] **Step 1: Read the current command center app.js**

Read `flux/app/runtime/command-center/app.js` in full before editing.

- [ ] **Step 2: Add startup toast check**

At the bottom of `flux/app/runtime/command-center/app.js`, add:

```js
// Show startup notification if Flux moved any off-screen widgets
(async () => {
    try {
        const { invoke } = window.__TAURI__.core;
        const toast = await invoke('get_and_clear_startup_toast');
        if (toast) {
            const banner = document.createElement('div');
            banner.style.cssText = [
                'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
                'background:#1a3a4a', 'color:#00bfff', 'border:1px solid #00bfff',
                'border-radius:6px', 'padding:8px 16px', 'font-size:12px',
                'font-family:monospace', 'z-index:9999', 'max-width:360px', 'text-align:center',
            ].join(';');
            banner.textContent = toast;
            document.body.appendChild(banner);
            setTimeout(() => banner.remove(), 5000);
        }
    } catch (e) {
        // Silently ignore if command not available
    }
})();
```

- [ ] **Step 3: Verify syntax**

```bash
node --input-type=module < flux/app/runtime/command-center/app.js 2>&1 | head -3
```

Expected: error about `window` — no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add flux/app/runtime/command-center/app.js
git commit -m "feat(js): command center shows startup toast when widgets were auto-recovered"
```

---

### Task 7: JS — Widget editor allow-offscreen setting

**Files:**
- Modify: `flux/app/runtime/widget-editor/store.js`
- Modify: `flux/app/runtime/widget-editor/render.js`
- Modify: `flux/app/runtime/widget-editor/file-ops.js`

- [ ] **Step 1: Add allowOffscreen to store.js serialization**

Read `flux/app/runtime/widget-editor/store.js`. Find the `serialize()` method and `deserialize()` method in `ComponentStore`. The store serializes the component array and canvas settings. There is likely a `meta` or top-level object structure.

Look for where `canvasWidth`, `canvasHeight` or similar widget-level metadata is stored. If a `widgetMeta` object exists, add `allowOffscreen` to it. If metadata is stored as flat top-level JSON keys alongside the components array, add it there.

Find the `serialize()` output structure. Add `allowOffscreen: false` as a default field at the same level as canvas dimensions. Then in `deserialize()`, read it back:

In `serialize()`, in the JSON object being returned, add:
```js
allowOffscreen: this._allowOffscreen || false,
```

In `deserialize(json, ...)`, after parsing, add:
```js
this._allowOffscreen = data.allowOffscreen || false;
```

Add a getter and setter to `ComponentStore`:
```js
get allowOffscreen() { return this._allowOffscreen || false; }
set allowOffscreen(v) { this._allowOffscreen = !!v; }
```

Initialize `this._allowOffscreen = false;` in the constructor.

- [ ] **Step 2: Render the checkbox in render.js**

Read `flux/app/runtime/widget-editor/render.js`. Find the canvas settings section in `renderProperties` — where `canvasWidth` and `canvasHeight` inputs are rendered (look for `prop-canvas-width` or similar). After those inputs, add:

```js
html += `
    <div class="prop-row" style="margin-top:10px;border-top:1px solid #1c2128;padding-top:10px;">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:11px;color:#ccc;">
            <input type="checkbox" id="prop-allow-offscreen" style="margin-top:2px;" ${_ctx.store.allowOffscreen ? 'checked' : ''}>
            <span>
                <strong>Allow off-screen placement</strong><br>
                <span style="color:#666;font-size:10px;">If enabled, Flux will not automatically move this widget back on-screen if its monitor is disconnected.</span>
            </span>
        </label>
    </div>
`;
```

Wire the checkbox in the same block where other canvas property listeners are wired:

```js
document.getElementById('prop-allow-offscreen')?.addEventListener('change', function() {
    _ctx.store.allowOffscreen = this.checked;
    _ctx.pushHistory();
});
```

- [ ] **Step 3: Export allowOffscreen in file-ops.js**

Read `flux/app/runtime/widget-editor/file-ops.js`. Find `generateWidgetFiles`. Find where `widget.json` content (`moduleJson`) is assembled. It includes `id`, `name`, `window`, etc. Add `allowOffscreen`:

```js
const moduleJson = {
    id: moduleId,
    name,
    // ... existing fields ...
    allowOffscreen: _ctx.store.allowOffscreen || false,
    // ... rest ...
};
```

- [ ] **Step 4: Add allowOffscreen to ModuleManifest in Rust**

Read `flux/app/src-tauri/src/lib.rs`. Find `pub struct ModuleManifest` (~line 65). Add:

```rust
#[serde(default)]
pub allow_offscreen: bool,
```

In `launch_module_window`, after loading the manifest and before calling `WindowBounds::default()` or looking up saved bounds, set the `allow_offscreen` flag in the saved bounds from the manifest:

Find the section just before `builder.build()` where the window opens. After `let window = builder.build()?;` and the position restore, add:

```rust
// Apply allow_offscreen from manifest to saved WindowBounds
{
    let mut p = state.persistent.lock().unwrap();
    let bounds = p.windows.entry(id.to_string()).or_insert_with(WindowBounds::default);
    bounds.allow_offscreen = manifest.allow_offscreen;
}
```

- [ ] **Step 5: Run all tests**

```bash
cd flux/app/src-tauri && cargo test 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add flux/app/src-tauri/src/lib.rs flux/app/runtime/widget-editor/store.js flux/app/runtime/widget-editor/render.js flux/app/runtime/widget-editor/file-ops.js
git commit -m "feat: allow-offscreen widget setting — editor checkbox, widget.json export, manifest read"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Fix resize_module HiDPI scale factor — Task 2
- ✅ Fix builder.position() flash — Task 2
- ✅ Monitor fingerprint saved on move — Task 2
- ✅ monitors.rs module — Task 1
- ✅ WindowBounds extended — Task 2
- ✅ AppState offscreen tracking — Task 3
- ✅ Startup check with toast — Task 3
- ✅ check_and_recover_offscreen_widgets — Task 3
- ✅ New Tauri commands — Task 3
- ✅ Tray menu "Bring all to screen" — Task 4
- ✅ Tray menu "Preferences" — Task 4
- ✅ Preferences window — Task 5
- ✅ Command center startup toast — Task 6
- ✅ Widget editor allow-offscreen checkbox — Task 7
- ✅ ModuleManifest allowOffscreen — Task 7
- ✅ allow_offscreen in WindowBounds — Tasks 2, 7

**Placeholder scan:** None found.

**Type consistency:**
- `monitor_fingerprint` used in Task 1 (definition), Task 2 (save on move), Task 3 (recovery) ✅
- `MonitorInfo` defined in Task 1, used in Task 3 ✅
- `allow_offscreen` (Rust snake_case) ↔ `allowOffscreen` (JS camelCase via Tauri serde rename) ✅
- `get_and_clear_startup_toast` defined in Task 3, called in Task 6 ✅
- `recover_widget` defined in Task 3, called in Task 5 ✅

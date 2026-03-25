# Desktop Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement true `windowLevel: "desktop"` behaviour so Flux widgets sit above the wallpaper and below all app windows on Linux Wayland (KDE Plasma) and X11.

**Architecture:** A new `desktop_layer.rs` module owns all platform-specific code behind `#[cfg(target_os = "linux")]`. It is called from `toggle_module` after the window is built. Wayland windows use `gtk-layer-shell` with margin-based positioning; X11 windows use `x11rb` to set EWMH properties. A `desktop_wayland_windows` set in `AppState` tracks which windows have layer shell applied so `track_window` and `drag_window` can guard against the `(0,0)` position problem and broken `xdg_toplevel.move()` respectively.

**Tech Stack:** Rust / Tauri 2, `gtk-layer-shell = "0.6"` (Linux-only), `x11rb = "0.13"` (Linux-only), existing `serde_json` persistence.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `app/src-tauri/src/desktop_layer.rs` | All platform-specific desktop-layer logic |
| Modify | `app/src-tauri/Cargo.toml` | Add Linux-only Cargo deps |
| Modify | `app/src-tauri/src/lib.rs` | `AppState`, `PersistentState`, `track_window`, `toggle_module`, `drag_window`, new `move_module` command |
| Modify | `flux/docs/authoring-guide.md` | Document `move_module` API + desktop layer drag note |

---

## Task 1: Add Linux-only Cargo dependencies

**Files:**
- Modify: `app/src-tauri/Cargo.toml`

- [ ] **Step 1: Add Linux-only deps to Cargo.toml**

Open `app/src-tauri/Cargo.toml`. After the existing `[dependencies]` block, add:

```toml
[target.'cfg(target_os = "linux")'.dependencies]
gtk-layer-shell = "0.6"   # 0.6+ required for KeyboardMode enum API
x11rb = "0.13"            # pure-Rust RustConnection; no system dep beyond X11 socket
```

- [ ] **Step 2: Verify the project still builds**

```bash
cd app && cargo build 2>&1 | tail -20
```

Expected: compiles successfully (may download new crates). No errors.

- [ ] **Step 3: Commit**

```bash
git add app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock
git commit -m "chore: add gtk-layer-shell and x11rb as Linux-only deps"
```

---

## Task 2: Scaffold `desktop_layer.rs` and wire into `lib.rs`

**Files:**
- Create: `app/src-tauri/src/desktop_layer.rs`
- Modify: `app/src-tauri/src/lib.rs` (4 locations)

- [ ] **Step 1: Create `desktop_layer.rs` with stubs**

Create `app/src-tauri/src/desktop_layer.rs`:

```rust
use tauri::WebviewWindow;
use crate::WindowLevel;

/// Apply desktop-layer window behaviour for the given window.
/// Returns `true` if Wayland layer shell was successfully applied
/// (caller should track this to guard drag/position events).
pub fn apply(window: &WebviewWindow, level: &WindowLevel, initial_margins: Option<(i32, i32)>) -> bool {
    if *level != WindowLevel::Desktop {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        return apply_linux(window, initial_margins);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, initial_margins);
        false
    }
}

/// Update margins on an existing Wayland layer-shell window.
/// No-op on non-Linux or non-Wayland.
pub fn set_margins(window: &WebviewWindow, left: i32, top: i32) {
    #[cfg(target_os = "linux")]
    set_margins_linux(window, left, top);
    #[cfg(not(target_os = "linux"))]
    let _ = (window, left, top);
}

#[cfg(target_os = "linux")]
fn apply_linux(window: &WebviewWindow, initial_margins: Option<(i32, i32)>) -> bool {
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        apply_wayland(window, initial_margins)
    } else {
        apply_x11(window);
        false  // X11 does not use margin-based drag
    }
}

// Wayland implementation — filled in Task 5
#[cfg(target_os = "linux")]
fn apply_wayland(_window: &WebviewWindow, _initial_margins: Option<(i32, i32)>) -> bool {
    false  // stub — replaced in Task 5
}

// X11 implementation — filled in Task 6
#[cfg(target_os = "linux")]
fn apply_x11(_window: &WebviewWindow) {
    // stub — replaced in Task 6
}

#[cfg(target_os = "linux")]
fn set_margins_linux(_window: &WebviewWindow, _left: i32, _top: i32) {
    // stub — replaced in Task 5
}
```

- [ ] **Step 2: Add `mod desktop_layer;` and `HashSet` import to `lib.rs`**

At the top of `app/src-tauri/src/lib.rs`, add the module declaration and import:

```rust
mod desktop_layer;
mod paths;
```

And add `HashSet` to the `std::collections` import line (line 14):

```rust
use std::collections::{HashMap, HashSet};
```

- [ ] **Step 3: Add `desktop_wayland_windows` field to `AppState`**

In `lib.rs`, find the `AppState` struct (around line 101). Add one field:

```rust
pub struct AppState {
    pub sys: Mutex<System>,
    pub nvml: Option<Nvml>,
    pub last_net_io: Mutex<(u64, u64, Instant)>,
    pub last_disk_io: Mutex<(u64, u64, Instant)>,
    pub active_modules: Mutex<HashMap<String, ModuleManifest>>,
    pub persistent: Mutex<PersistentState>,
    pub data_dir: PathBuf,
    /// IDs of windows that have Wayland layer shell applied.
    /// Used to guard track_window and drag_window.
    pub desktop_wayland_windows: Mutex<HashSet<String>>,
}
```

- [ ] **Step 4: Initialise the new field in `run()`**

In the `.setup(|app| { ... })` block, find where `app.manage(AppState { ... })` is called (around line 480). Add the new field:

```rust
app.manage(AppState {
    sys: Mutex::new(System::new_all()),
    nvml,
    last_net_io: Mutex::new((0, 0, Instant::now())),
    last_disk_io: Mutex::new((0, 0, Instant::now())),
    active_modules: Mutex::new(HashMap::new()),
    persistent: Mutex::new(persistent),
    data_dir,
    desktop_wayland_windows: Mutex::new(HashSet::new()),
});
```

- [ ] **Step 5: Wire `apply` into `toggle_module` (open branch)**

In `toggle_module`, find the block that builds and opens the window (around lines 196–234). Replace:

```rust
                track_window(window);
                active_map.insert(id.clone(), manifest.clone());
```

With:

```rust
                let saved_margins = {
                    let p = state.persistent.lock().unwrap();
                    p.margins.get(&id).map(|m| (m.left, m.top))
                };

                // apply() borrows &window, so it must come before track_window()
                // which takes ownership. No clone needed this way.
                let is_wayland_desktop = desktop_layer::apply(&window, &win_config.window_level, saved_margins);
                if is_wayland_desktop {
                    state.desktop_wayland_windows.lock().unwrap().insert(id.clone());
                }
                track_window(window);
                active_map.insert(id.clone(), manifest.clone());
```

- [ ] **Step 6: Clean up `desktop_wayland_windows` in `toggle_module` (close branch)**

In `toggle_module`, find the block that closes the window (around lines 181–183):

```rust
    if let Some(_existing) = active_map.remove(&id) {
        if let Some(win) = app.get_webview_window(&id) { let _ = win.close(); }
        if let Some(win) = app.get_webview_window(&format!("{}-settings", id)) { let _ = win.close(); }
```

Add one line after the two `win.close()` calls:

```rust
        state.desktop_wayland_windows.lock().unwrap().remove(&id);
```

- [ ] **Step 7: Verify build**

```bash
cd app && cargo build 2>&1 | tail -20
```

Expected: compiles with no errors.

- [ ] **Step 8: Run existing tests**

```bash
cd app && cargo test 2>&1
```

Expected: all existing tests pass.

- [ ] **Step 9: Commit**

```bash
git add app/src-tauri/src/desktop_layer.rs app/src-tauri/src/lib.rs
git commit -m "feat: scaffold desktop_layer module, wire into toggle_module"
```

---

## Task 3: Add `margins` to `PersistentState`

**Files:**
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

In `lib.rs`, in the `#[cfg(test)] mod tests` block, add:

```rust
    #[test]
    fn persistent_state_margins_roundtrip() {
        let path = temp_dir().join("flux_test_margins.json");
        let mut state = PersistentState::default();
        state.margins.insert(
            "my-widget".to_string(),
            MarginPosition { left: 120, top: 80 },
        );
        state.save(&path);
        let loaded = PersistentState::load(&path);
        assert_eq!(loaded.margins["my-widget"].left, 120);
        assert_eq!(loaded.margins["my-widget"].top, 80);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn persistent_state_margins_default_empty() {
        let state = PersistentState::default();
        assert!(state.margins.is_empty());
    }

    #[test]
    fn compute_new_margins_adds_delta() {
        assert_eq!(compute_new_margins((100, 50), 10, -5), (110, 45));
    }

    #[test]
    fn compute_new_margins_allows_negative() {
        assert_eq!(compute_new_margins((5, 5), -10, -10), (-5, -5));
    }
```

- [ ] **Step 2: Run tests — expect compile failure**

```bash
cd app && cargo test 2>&1 | grep -E "error|FAILED"
```

Expected: compile errors for `MarginPosition`, `margins`, `compute_new_margins` not found.

- [ ] **Step 3: Add `MarginPosition` struct**

In `lib.rs`, after the `WindowBounds` struct (around line 59), add:

```rust
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct MarginPosition {
    pub left: i32,
    pub top: i32,
}
```

- [ ] **Step 4: Add `margins` field to `PersistentState`**

> **Version note:** `STATE_VERSION` is intentionally left at `1`. Old `window_state.json` files will deserialise successfully because `margins` has `#[serde(default)]` — the field just populates as an empty map. No migration needed.

Find the `PersistentState` struct (around line 63). Add the `margins` field:

```rust
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PersistentState {
    #[serde(default)]
    pub version: u32,
    pub windows: HashMap<String, WindowBounds>,
    #[serde(default)]
    pub margins: HashMap<String, MarginPosition>,
}
```

- [ ] **Step 5: Add `compute_new_margins` pure function**

After the `drag_window` command (around line 291), add:

```rust
fn compute_new_margins(current: (i32, i32), dx: i32, dy: i32) -> (i32, i32) {
    (current.0 + dx, current.1 + dy)
}
```

- [ ] **Step 6: Run tests — expect all pass**

```bash
cd app && cargo test 2>&1
```

Expected: all tests pass including the 4 new ones.

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/lib.rs
git commit -m "feat: add margins persistence to PersistentState for Wayland desktop-layer windows"
```

---

## Task 4: Add `move_module` command + guards for `track_window` and `drag_window`

**Files:**
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add `track_window` Wayland guard**

In `track_window` (around line 156), replace the `on_window_event` closure body:

```rust
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
```

With:

```rust
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(_) | WindowEvent::Resized(_) = event {
            let state = app_handle.state::<AppState>();

            // Wayland layer-shell surfaces always report outer_position() as (0,0).
            // Skip Moved events for these windows — their position is managed via margins.
            if matches!(event, WindowEvent::Moved(_)) {
                let dw = state.desktop_wayland_windows.lock().unwrap();
                if dw.contains(&label) {
                    return;
                }
            }

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
```

- [ ] **Step 2: Add `drag_window` Wayland guard**

Replace the existing `drag_window` command (around line 291):

```rust
#[tauri::command]
fn drag_window(window: Window) { let _ = window.start_dragging(); }
```

With:

```rust
#[tauri::command]
fn drag_window(window: Window, state: State<'_, AppState>) {
    // On Wayland, layer-shell windows cannot use xdg_toplevel.move().
    // Widget JS handles drag via move_module instead.
    let dw = state.desktop_wayland_windows.lock().unwrap();
    if dw.contains(window.label()) {
        return;
    }
    let _ = window.start_dragging();
}
```

- [ ] **Step 3: Add `move_module` command**

After `drag_window`, add:

```rust
#[tauri::command]
async fn move_module(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    dx: i32,
    dy: i32,
) -> Result<(), String> {
    // Only applies to Wayland desktop-layer windows
    {
        let dw = state.desktop_wayland_windows.lock().unwrap();
        if !dw.contains(&id) {
            return Ok(());
        }
    }

    let Some(window) = app.get_webview_window(&id) else {
        return Ok(());
    };

    let (new_left, new_top) = {
        let p = state.persistent.lock().unwrap();
        let current = p.margins.get(&id).map(|m| (m.left, m.top)).unwrap_or((0, 0));
        compute_new_margins(current, dx, dy)
    };

    desktop_layer::set_margins(&window, new_left, new_top);

    {
        let mut p = state.persistent.lock().unwrap();
        p.margins.insert(id.clone(), MarginPosition { left: new_left, top: new_top });
        let state_path = state.data_dir.join("window_state.json");
        p.save(&state_path);
    }

    Ok(())
}
```

- [ ] **Step 4: Register `move_module` in the invoke handler**

Find the `.invoke_handler(tauri::generate_handler![...])` line (around line 522). Add `move_module`:

```rust
.invoke_handler(tauri::generate_handler![
    get_system_stats, drag_window, list_modules, toggle_module,
    open_module_settings, close_window, move_module
])
```

- [ ] **Step 5: Verify build**

```bash
cd app && cargo build 2>&1 | tail -20
```

Expected: compiles. Note: `drag_window` now takes a `State` param — Tauri's `generate_handler!` macro will handle this automatically.

- [ ] **Step 6: Run tests**

```bash
cd app && cargo test 2>&1
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/lib.rs
git commit -m "feat: add move_module command, guard track_window and drag_window for Wayland layer shell"
```

---

## Task 5: Implement Wayland desktop layer in `desktop_layer.rs`

**Files:**
- Modify: `app/src-tauri/src/desktop_layer.rs`

**Prerequisite:** `libgtk-layer-shell` must be installed on the dev machine.
- Arch/Manjaro: `sudo pacman -S gtk-layer-shell`
- Ubuntu/Debian: `sudo apt install libgtk-layer-shell-dev`

- [ ] **Step 1: Replace the `apply_wayland` stub**

In `desktop_layer.rs`, replace:

```rust
#[cfg(target_os = "linux")]
fn apply_wayland(_window: &WebviewWindow, _initial_margins: Option<(i32, i32)>) -> bool {
    false  // stub — replaced in Task 5
}
```

With:

```rust
#[cfg(target_os = "linux")]
fn apply_wayland(window: &WebviewWindow, initial_margins: Option<(i32, i32)>) -> bool {
    use gtk_layer_shell::{Layer, Edge};

    let Ok(gtk_win) = window.gtk_window() else { return false; };
    if !gtk_layer_shell::is_supported(&gtk_win) {
        return false;
    }

    gtk_layer_shell::init_for_window(&gtk_win);
    gtk_layer_shell::set_layer(&gtk_win, Layer::Bottom);
    gtk_layer_shell::set_keyboard_mode(&gtk_win, gtk_layer_shell::KeyboardMode::None);
    gtk_layer_shell::set_exclusive_zone(&gtk_win, -1);

    // Anchor top-left; margins define the widget's (x, y) position on screen
    gtk_layer_shell::set_anchor(&gtk_win, Edge::Left, true);
    gtk_layer_shell::set_anchor(&gtk_win, Edge::Top, true);

    let (left, top) = initial_margins.unwrap_or((0, 0));
    gtk_layer_shell::set_margin(&gtk_win, Edge::Left, left);
    gtk_layer_shell::set_margin(&gtk_win, Edge::Top, top);

    true
}
```

- [ ] **Step 2: Replace the `set_margins_linux` stub**

Replace:

```rust
#[cfg(target_os = "linux")]
fn set_margins_linux(_window: &WebviewWindow, _left: i32, _top: i32) {
    // stub — replaced in Task 5
}
```

With:

```rust
#[cfg(target_os = "linux")]
fn set_margins_linux(window: &WebviewWindow, left: i32, top: i32) {
    if std::env::var("WAYLAND_DISPLAY").is_err() {
        return;
    }
    use gtk_layer_shell::Edge;
    let Ok(gtk_win) = window.gtk_window() else { return; };
    if !gtk_layer_shell::is_supported(&gtk_win) {
        return;
    }
    gtk_layer_shell::set_margin(&gtk_win, Edge::Left, left);
    gtk_layer_shell::set_margin(&gtk_win, Edge::Top, top);
}
```

- [ ] **Step 3: Build**

```bash
cd app && cargo build 2>&1 | tail -20
```

Expected: compiles.

- [ ] **Step 4: Manual test — open a desktop-level widget on KDE Plasma Wayland**

1. Run `cargo tauri dev` or the built binary
2. Toggle on the `system-stats` bundled module (its `module.json` already has `"windowLevel": "desktop"`)
3. Verify the widget appears at the Bottom layer — it should sit above the wallpaper but below any open app windows
4. Alt-Tab through apps — the widget should not appear in the alt-tab list
5. Open a maximised window over it — the widget should disappear behind the app

- [ ] **Step 5: Manual test — drag the widget**

From the widget's JS, the existing `drag_window` call is now a no-op. To test drag, you need to use the `move_module` command. Open the browser devtools for the widget window and run:

```javascript
__TAURI__.core.invoke("move_module", { id: "system-stats", dx: 50, dy: 50 })
```

Verify the widget moves 50px right and 50px down.

- [ ] **Step 6: Manual test — position persists on restart**

1. Move the widget to a non-default position via `move_module`
2. Close the widget (toggle it off)
3. Toggle it back on
4. Verify it reopens at the same position

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/desktop_layer.rs
git commit -m "feat: implement Wayland desktop layer via gtk-layer-shell (Layer::Bottom, margin drag)"
```

---

## Task 6: Implement X11 desktop layer in `desktop_layer.rs`

**Files:**
- Modify: `app/src-tauri/src/desktop_layer.rs`

- [ ] **Step 1: Replace the `apply_x11` stub**

Replace:

```rust
#[cfg(target_os = "linux")]
fn apply_x11(_window: &WebviewWindow) {
    // stub — replaced in Task 6
}
```

With:

```rust
#[cfg(target_os = "linux")]
fn apply_x11(window: &WebviewWindow) {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ChangePropertyAux, ConnectionExt, PropMode};
    use x11rb::rust_connection::RustConnection;

    let xlib_win = match window.xlib_window() {
        Some(w) => w as u32,
        None => return,
    };

    let Ok((conn, _screen)) = RustConnection::connect(None) else { return; };

    // Intern the atoms we need
    let wm_type_cookie = match conn.intern_atom(false, b"_NET_WM_WINDOW_TYPE") {
        Ok(c) => c,
        Err(_) => return,
    };
    let type_desktop_cookie = match conn.intern_atom(false, b"_NET_WM_WINDOW_TYPE_DESKTOP") {
        Ok(c) => c,
        Err(_) => return,
    };
    let wm_state_cookie = match conn.intern_atom(false, b"_NET_WM_STATE") {
        Ok(c) => c,
        Err(_) => return,
    };
    let state_below_cookie = match conn.intern_atom(false, b"_NET_WM_STATE_BELOW") {
        Ok(c) => c,
        Err(_) => return,
    };

    let Ok(wm_type) = wm_type_cookie.reply() else { return; };
    let Ok(type_desktop) = type_desktop_cookie.reply() else { return; };
    let Ok(wm_state) = wm_state_cookie.reply() else { return; };
    let Ok(state_below) = state_below_cookie.reply() else { return; };

    // _NET_WM_WINDOW_TYPE = _NET_WM_WINDOW_TYPE_DESKTOP
    let _ = conn.change_property32(
        PropMode::REPLACE,
        xlib_win,
        wm_type.atom,
        AtomEnum::ATOM,
        &[type_desktop.atom],
    );

    // _NET_WM_STATE = _NET_WM_STATE_BELOW
    let _ = conn.change_property32(
        PropMode::REPLACE,
        xlib_win,
        wm_state.atom,
        AtomEnum::ATOM,
        &[state_below.atom],
    );

    let _ = conn.flush();
}
```

- [ ] **Step 2: Build**

```bash
cd app && cargo build 2>&1 | tail -20
```

Expected: compiles.

- [ ] **Step 3: Manual test on X11 session**

> **Mapping-order note:** EWMH requires `_NET_WM_WINDOW_TYPE` to be set before the window is mapped. Tauri maps the window during `builder.build()`, which runs before `desktop_layer::apply`. If testing shows the WM ignores the properties (widget still appears in the normal layer), the fix is to set the properties via a pre-map hook rather than post-build — record this finding in `platform-notes.md` and open a follow-up task.

Switch to or launch an X11 session (e.g. KDE Plasma X11 or any EWMH-compliant WM). Toggle a desktop-level widget and verify:

1. The widget appears below all normal windows
2. The widget is not in the alt-tab list (most WMs honour `_NET_WM_WINDOW_TYPE_DESKTOP`)
3. `drag_window` still works (X11 path does not set `desktop_wayland_windows`, so the guard in `drag_window` is skipped)

**If the WM treats `_NET_WM_WINDOW_TYPE_DESKTOP` as fixed-position (widget cannot be dragged):**
Drop the type property and keep only `_NET_WM_STATE_BELOW`. Replace the `change_property32` for `wm_type` with a no-op. Record this finding in `platform-notes.md`.

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/desktop_layer.rs
git commit -m "feat: implement X11 desktop layer via _NET_WM_WINDOW_TYPE_DESKTOP + _NET_WM_STATE_BELOW"
```

---

## Task 7: Update authoring guide

**Files:**
- Modify: `flux/docs/authoring-guide.md`

- [ ] **Step 1: Add `move_module` to the API section**

In `authoring-guide.md`, after the `### toggle_module` section (search for `### \`toggle_module\``), add:

```markdown
### `move_module`
Moves a desktop-layer widget by a pixel delta. **Wayland only** — on X11 and other platforms this is a no-op; use `drag_window` instead.

```javascript
// Call repeatedly during pointermove while dragging
__TAURI__.core.invoke("move_module", { id: "my-widget", dx: deltaX, dy: deltaY });
```

`dx` and `dy` are integers (pixels). The position is persisted automatically — the widget reopens at the last dragged position.
```

- [ ] **Step 2: Add desktop layer note to the `drag_window` section**

Find the `### \`drag_window\`` section (search for the heading, don't rely on line numbers). After the code example, add:

```markdown
> **Desktop layer note (Wayland):** `drag_window` does not work on `windowLevel: "desktop"` windows on Wayland — the compositor does not expose `xdg_toplevel.move()` for layer-shell surfaces. Use `mousedown`/`pointermove` event tracking + `move_module(id, dx, dy)` for drag handles in desktop-layer widgets.
```

- [ ] **Step 3: Run existing tests**

```bash
cd app && cargo test 2>&1
```

Expected: all tests pass (docs change only).

- [ ] **Step 4: Commit**

```bash
git add flux/docs/authoring-guide.md
git commit -m "docs: add move_module API, desktop layer drag note for Wayland"
```

---

## Done

At this point:

- `windowLevel: "desktop"` works on KDE Plasma Wayland (and any wlroots compositor)
- `windowLevel: "desktop"` works on X11 EWMH-compliant WMs
- `move_module` handles drag for Wayland layer-shell widgets
- Position persists across restarts for both Wayland (margins) and X11 (pixel coords)
- Non-Linux platforms compile and open a normal window silently
- Mac is deferred to hardware testing — no changes needed here

**Next:** When on the MacBook, start a new brainstorm for the Mac `NSWindowLevel` implementation.

# Desktop Layer — Phase 2 Design Spec

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Implement true `windowLevel: "desktop"` behaviour — windows sit above the wallpaper and below all app windows.

---

## Platform Priority

1. Linux Wayland (KDE Plasma, primary dev target)
2. Linux X11
3. Mac (deferred — will be implemented on hardware)
4. Windows (out of scope for this phase)

---

## Architecture

A new file `app/src-tauri/src/desktop_layer.rs` owns all platform-specific code.

**Public interface:**

```rust
pub fn apply(window: &WebviewWindow, level: &WindowLevel)
```

Called from `lib.rs` immediately after `track_window(window)`. No-op if `level` is not `WindowLevel::Desktop`. All errors are swallowed silently — if desktop layer cannot be applied, the window opens as a normal window with no user-visible indication.

**Linux dispatch (inside `apply`):**

1. Check `WAYLAND_DISPLAY` env var — if set, try Wayland path
2. Wayland path: attempt `gtk-layer-shell`; if `is_supported()` returns false, return silently
3. If not Wayland, try X11 path; swallow any errors

Non-Linux targets compile to an empty stub.

---

## Wayland Implementation

**Library:** `gtk-layer-shell` Rust crate, added as a Linux-only Cargo dependency.
**Protocol:** `zwlr_layer_shell_v1` (supported on KDE Plasma, wlroots compositors; not supported on GNOME).

**Window setup:**

```rust
fn apply_wayland(window: &WebviewWindow) {
    use tauri::WindowExtLinux;
    use gtk_layer_shell::{Layer, Edge};

    let gtk_win = window.gtk_window();
    if !gtk_layer_shell::is_supported(&gtk_win) { return; }

    gtk_layer_shell::init_for_window(&gtk_win);
    gtk_layer_shell::set_layer(&gtk_win, Layer::Background);
    gtk_layer_shell::set_keyboard_mode(&gtk_win, gtk_layer_shell::KeyboardMode::None);

    // Anchor top+left; margins are the widget's (x, y) position
    gtk_layer_shell::set_anchor(&gtk_win, Edge::Left, true);
    gtk_layer_shell::set_anchor(&gtk_win, Edge::Top, true);
    gtk_layer_shell::set_margin(&gtk_win, Edge::Left, x);
    gtk_layer_shell::set_margin(&gtk_win, Edge::Top, y);

    gtk_layer_shell::set_exclusive_zone(&gtk_win, -1);
}
```

**Layer:** `Background` — above wallpaper, below desktop icons layer, below all app windows.
**Exclusive zone:** `-1` — does not push panels or taskbars.

### Drag on Wayland

Tauri's `drag_window` command calls `xdg_toplevel.move()`, which does not exist on layer shell surfaces. A new command `move_module(id: String, dx: i32, dy: i32)` is added to handle drag on desktop-layer Wayland windows:

- Widget JS tracks `mousedown` → `mousemove` delta while button is held
- Streams `move_module` invocations to Rust
- Rust accumulates delta, updates `Edge::Left` and `Edge::Top` margins via `gtk_layer_shell::set_margin`
- On `mouseup`, final position is written to persistent state (existing save mechanism)

`drag_window` continues to work on non-desktop-layer windows and on X11 — no existing widgets break.

### Resize on Wayland

Standard Tauri `window.set_size()` works on layer shell surfaces. No changes needed.

---

## X11 Implementation

**Library:** `x11rb` (pure Rust, no system library required), added as a Linux-only Cargo dependency.

**Window properties set after build:**

- `_NET_WM_WINDOW_TYPE_DESKTOP` — signals the WM to treat this as a desktop-type window
- `_NET_WM_STATE_BELOW` — enforces z-order below normal windows

**Drag on X11:** Tauri's existing `drag_window` command works normally via `_NET_WM_MOVERESIZE`. No changes needed.

**Resize on X11:** Standard Tauri `set_size()`. No changes needed.

**Caveat:** Some WMs treat `_NET_WM_WINDOW_TYPE_DESKTOP` as fully fixed (no drag). If discovered in testing, fallback is to drop the type hint and use only `_NET_WM_STATE_BELOW`.

---

## Mac (Deferred)

Will use `NSWindowLevel` set to `kCGDesktopIconWindowLevel` via `objc2` bindings. To be designed and implemented when tested on hardware.

---

## Cargo.toml Changes

```toml
[target.'cfg(target_os = "linux")'.dependencies]
gtk-layer-shell = "0.5"
x11rb = { version = "0.13", features = ["allow-unsafe-code"] }
```

---

## lib.rs Changes

- After `track_window(window)`: call `desktop_layer::apply(&window, &win_config.window_level)`
- Add new command `move_module(id, dx, dy)` registered in `tauri::Builder`
- `drag_window` command gains a guard: if the target window is desktop-layer on Wayland, return early (widget JS handles drag itself)

---

## Authoring Guide Changes

Add a note to the `drag_window` API entry:

> **Desktop layer note:** On Wayland, `drag_window` does not work on `windowLevel: "desktop"` windows. Use pointer event tracking + `move_module(id, dx, dy)` for drag handles in desktop-layer widgets.

---

## Fallback Summary

| Condition | Behaviour |
|---|---|
| Wayland + compositor supports layer shell | Desktop layer applied |
| Wayland + compositor does not support layer shell (e.g. GNOME) | Silent fallback to normal window |
| `libgtk-layer-shell` not installed | `is_supported()` returns false → silent fallback |
| X11 + EWMH-compliant WM | Desktop layer applied |
| X11 + WM treats type as fixed-position | Testing may require dropping type hint |
| Non-Linux platform | Empty stub, normal window |

---

## Out of Scope

- Windows desktop layer (`WorkerW`/`Progman`)
- GNOME Wayland workarounds
- Mac implementation (deferred to hardware testing)

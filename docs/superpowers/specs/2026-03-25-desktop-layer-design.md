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
    use gtk_layer_shell::{Layer, Edge};

    // gtk_window() returns Result in Tauri 2 — bail silently on error
    let Ok(gtk_win) = window.gtk_window() else { return; };
    if !gtk_layer_shell::is_supported(&gtk_win) { return; }

    gtk_layer_shell::init_for_window(&gtk_win);
    gtk_layer_shell::set_layer(&gtk_win, Layer::Bottom);
    // 0.6 API: set_keyboard_mode with KeyboardMode enum
    gtk_layer_shell::set_keyboard_mode(&gtk_win, gtk_layer_shell::KeyboardMode::None);

    // Anchor top+left; margins are the widget's (x, y) position
    gtk_layer_shell::set_anchor(&gtk_win, Edge::Left, true);
    gtk_layer_shell::set_anchor(&gtk_win, Edge::Top, true);
    gtk_layer_shell::set_margin(&gtk_win, Edge::Left, x);
    gtk_layer_shell::set_margin(&gtk_win, Edge::Top, y);

    gtk_layer_shell::set_exclusive_zone(&gtk_win, -1);
}
```

**Layer:** `Bottom` — above wallpaper, visible alongside desktop icons, below all app windows. (`Background` sits behind desktop icons on KDE Plasma; `Bottom` is the correct layer for widgets.)
**Exclusive zone:** `-1` — does not push panels or taskbars.

### Drag on Wayland

Tauri's `drag_window` command calls `xdg_toplevel.move()`, which does not exist on layer shell surfaces. A new command `move_module(id: String, dx: i32, dy: i32)` is added to handle drag on desktop-layer Wayland windows:

- Widget JS tracks `mousedown` → `mousemove` delta while button is held
- Streams `move_module` invocations to Rust
- Rust accumulates delta, updates `Edge::Left` and `Edge::Top` margins via `gtk_layer_shell::set_margin`
- On `mouseup`, final margin values `(left, top)` are written to persistent state under a separate key from the normal position store (Wayland surfaces always report `outer_position()` as `(0, 0)`, so the existing `track_window` position-save mechanism must be bypassed for desktop-layer Wayland windows to avoid overwriting the correct margins with zeros on every move event)

`drag_window` continues to work on non-desktop-layer windows and on X11 — no existing widgets break.

`track_window` gains a guard: if the window is a desktop-layer window on Wayland, `WindowEvent::Moved` is ignored (position is managed via margins, not pixel coordinates).

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
gtk-layer-shell = "0.6"   # 0.6+ required for KeyboardMode enum API
x11rb = "0.13"            # pure-Rust RustConnection; no allow-unsafe-code needed
```

---

## lib.rs Changes

- After `track_window(window)`: call `desktop_layer::apply(&window, &win_config.window_level)`
- Add new command `move_module(id, dx, dy)` registered in `tauri::Builder`
- `drag_window` command gains a guard: if the target window is desktop-layer on Wayland, return early (widget JS handles drag itself)
- `track_window` gains a guard: skip `WindowEvent::Moved` for desktop-layer Wayland windows (they always report `outer_position()` as `(0, 0)`; saving that value would corrupt the margin-based position on restart)
- Persistent state gains a separate `margins` map for desktop-layer Wayland window positions (`{id: {left, top}}`) alongside the existing `windows` position/size map

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
| `libgtk-layer-shell` not installed | Dynamic linker error at process start — `libgtk-layer-shell` is a required system dependency on Wayland; users must install it (`libgtk-layer-shell` / `gtk-layer-shell` package) |
| X11 + EWMH-compliant WM | Desktop layer applied |
| X11 + WM treats type as fixed-position | Testing may require dropping type hint |
| Non-Linux platform | Empty stub, normal window |

---

## Out of Scope

- Windows desktop layer (`WorkerW`/`Progman`)
- GNOME Wayland workarounds
- Mac implementation (deferred to hardware testing)

# Phase 5a Design: HiDPI Fixes + Multi-Monitor Support

**Date:** 2026-04-02
**Phase:** 5a (pre-launch polish)
**Author:** Claude (Sonnet 4.6) via brainstorming session

---

## Overview

Phase 5a fixes two confirmed HiDPI bugs and adds the multi-monitor support that competing tools (Rainmeter, Conky) are consistently criticized for lacking. A hard constraint: no new processes, no new tray icons.

---

## Architecture

### New module: `monitors.rs`

A focused Rust module responsible for:
- Building a **monitor fingerprint** string from a monitor's OS name, resolution, and position: `"DP-1:2560x1440@0,0"`
- Determining which monitor a widget's top-left corner is on
- Detecting whether a position is off all connected monitors

### Extended `WindowBounds`

`WindowBounds` (in `lib.rs`) gains two new optional fields:

```json
{
  "x": 400, "y": 300, "width": 200, "height": 150,
  "monitor": "DP-1:2560x1440@0,0",
  "allow_offscreen": false
}
```

Both fields use `#[serde(default)]` for backwards compatibility — existing `window_state.json` files without these fields deserialize cleanly.

### Extended `ModuleManifest`

`ModuleManifest` gains `allow_offscreen: bool` (`#[serde(default)]`). The widget editor sets this at design time; the runtime reads it when launching the widget window and stores it in `WindowBounds`.

### Extended `AppState`

`AppState` gains:
- `offscreen_widgets: Mutex<Vec<String>>` — live list of widget IDs currently off all monitors (updated at startup)
- `startup_toast: Mutex<Option<String>>` — deferred notification text set at startup if any widgets were moved; consumed and cleared when the command center next opens

### New Preferences Window

A new Tauri window (`flux-preferences`) at `runtime/preferences/`. Opened from the tray menu. Contains two sections:

**Display**
- Read-only monitor list (name + resolution)
- "Bring all widgets to screen" button

**Advanced**
- "Recover hidden widgets" table: lists off-screen widgets (including `allow_offscreen` ones) with per-row "Move to primary" button
- Empty state: "All widgets are on-screen"

---

## HiDPI Bug Fixes

### Fix 1: Remove redundant `builder.position()` call

`launch_module_window` calls both `builder.position(b.x, b.y)` (which Tauri treats as logical coordinates) and then `window.set_position(PhysicalPosition::new(b.x, b.y))` after build. The builder call passes physical coordinates as if they are logical — on HiDPI this causes a brief position flash before the `set_position` corrects it.

**Fix:** Remove `builder.position(b.x, b.y)` from both `launch_module_window` code paths. Rely entirely on the post-build `set_position(PhysicalPosition)` call.

### Fix 2: Scale `resize_module` deltas by `scale_factor`

`resize_module` receives `dx`/`dy` from JS `screenX/Y` deltas, which are logical CSS pixels. It applies them directly to `window.inner_size()`, which is in physical pixels. On 2x HiDPI, the resize moves half as fast as the mouse.

**Fix:** Multiply `dx`/`dy` by `window.scale_factor().unwrap_or(1.0)` before applying to `inner_size`.

---

## Multi-Monitor Behavior

### Monitor fingerprint on save

When `WindowBounds` is saved (on `WindowEvent::Moved` / `WindowEvent::Resized`), Flux calls `monitors::collect_monitors(app)`, finds which monitor the widget's top-left is on, and stores its fingerprint in `WindowBounds.monitor`.

### Startup off-screen check

After all module windows open at startup, Flux runs `check_and_recover_offscreen_widgets`:

1. Enumerate connected monitors
2. For each active widget:
   - If `allow_offscreen` is true → skip
   - If saved monitor fingerprint matches a connected monitor → widget is on its correct monitor, skip
   - If saved monitor fingerprint matches no connected monitor → **orphaned widget**: move to primary monitor at `(primary.x + 20, primary.y + 20)`, update saved position and monitor fingerprint
   - If no saved monitor fingerprint (old state) → run top-left bounds check; if off-screen, move to primary
3. If any widgets were moved, set `startup_toast` to: `"N widget(s) were off-screen and moved to your primary monitor."`

"Primary monitor" = the monitor at global position (0, 0); if none, the first monitor returned by `available_monitors()`.

**On monitor reconnect:** Handled at next Flux startup. When the monitor is connected and Flux restarts, the saved fingerprint matches the reconnected monitor → widget restores to its original position automatically. No mid-session hotplug detection.

### Off-screen widget list

`AppState.offscreen_widgets` is populated at startup with the IDs of any widget whose top-left is outside all monitor bounds (regardless of `allow_offscreen` flag). Updated whenever "Bring all to screen" or a "Recover" action runs.

### Startup toast

When the command center opens, it calls `get_and_clear_startup_toast()`. If the result is non-empty, it shows a banner with the message. The toast is cleared after first read — shown once only.

---

## Tray Menu

Updated structure:

```
Open Command Center
Widget Editor
Browse Themes Folder
Bring all widgets to screen        ← new
Start on Login ✓
─────────────────────────────────
Preferences                        ← new
─────────────────────────────────
Quit Flux
```

**"Bring all widgets to screen":** Runs off-screen check. Skips widgets with `allow_offscreen = true`. Shows toast via command center if any were moved. Updates `offscreen_widgets` list.

**"Preferences":** Opens the `flux-preferences` window (or focuses it if already open).

### Per-widget monitor assignment

Each widget entry in the tray menu gains a submenu via a right-click / secondary context. Shown only when ≥ 2 monitors connected:

```
[Widget name] ▶
    Move to Monitor
        DP-1 (2560×1440) ✓ current
        HDMI-1 (1920×1080)
```

Selecting a monitor teleports the widget to `(monitor.x + 20, monitor.y + 20)` and updates its saved fingerprint.

---

## Widget Editor: Allow Off-Screen Placement

In the widget editor properties panel, below canvas size settings, add:

```
☐ Allow off-screen placement
  If enabled, Flux will not automatically move this widget back on-screen
  if its monitor is disconnected.
```

Stored in `.fluxwidget` metadata as `allowOffscreen: false`. Exported to `widget.json` and `module.json` on install.

---

## New Tauri Commands

| Command | Purpose |
|---|---|
| `get_monitors` | Returns list of connected monitors with name, resolution, position |
| `bring_all_to_screen` | Runs off-screen check, moves violating widgets, returns count moved |
| `move_widget_to_monitor(id, monitor_index)` | Teleports widget to monitor's top-left + 20px offset |
| `get_offscreen_widgets` | Returns current `offscreen_widgets` list |
| `recover_widget(id)` | Moves a specific widget to primary regardless of `allow_offscreen` |
| `get_and_clear_startup_toast` | Returns pending startup notification text and clears it |

---

## Out of Scope for Phase 5a

- Mid-session monitor hotplug detection (future: platform-specific udev/Win32/NSNotification)
- Wayland layer-shell drag scale factor fix (needs HiDPI Wayland test environment to confirm the bug)
- Per-monitor widget grouping ("only show these widgets on monitor X")
- Widget editor multi-monitor canvas preview

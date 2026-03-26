# Flux Phase 0 — Foundation Design

**Date:** 2026-03-26
**Scope:** System metrics API, position/size persistence, drag/drop, system tray, Bridges theme pack reorganization
**Status:** Approved

---

## Overview

Phase 0 replaces the ad-hoc early implementation with a clean, guide-aligned foundation before any new features are added. No new user-facing functionality beyond what already exists — this is a rework for correctness and long-term stability.

---

## 1. System Metrics API

### Rust Commands (Pull)

Replace the single `get_system_stats()` command with individual typed commands:

| Command | Returns |
|---|---|
| `system_cpu` | per-core usage %, average usage %, frequency (MHz), name, core count, thread count |
| `system_memory` | total, used, available bytes; swap total and used |
| `system_disk` | array of { name, mountPoint, total, used, available, kind (SSD/HDD/Unknown) } |
| `system_network` | array of { name, received, transmitted bytes since last call, totals } |
| `system_gpu` | usage %, VRAM used/total bytes, VRAM %, temperature (null if no GPU detected) |
| `system_battery` | percentage, charging bool, timeToEmpty/timeToFull seconds (null if no battery) |
| `system_uptime` | seconds since boot |
| `system_os` | name, version, kernel, arch |

GPU detection priority: NVML (NVIDIA) → AMD sysfs (`/sys/class/drm/`) → null. Existing logic repackaged.

### Push Broadcaster

A background thread starts at launch and emits typed Tauri events on a configurable interval (default: 2000ms):

- `system:cpu` — every tick
- `system:memory` — every tick
- `system:network` — every tick
- `system:gpu` — every tick (skipped/null payload if no GPU)
- `system:disk` — every 30s (mounts change rarely)
- `system:battery` — every 30s (charge level changes slowly)
- `system:os` — once at startup only

Broadcast interval is hardcoded at 2000ms for Phase 0. Configurability is Phase 1.

### `widget-api.js` Runtime

A shared JS file served via a reserved internal path: `flux-module://_flux/widget-api.js`. The URI scheme handler gains a special case: paths starting with `_flux/` are served from `resource_dir/runtime/` rather than a module directory. This avoids duplicating the file inside every module.

Each module `index.html` includes it manually:
```html
<script src="flux-module://_flux/widget-api.js"></script>
```
(Automatic injection at the URI handler level is deferred to Phase 1.)

Exposes `window.WidgetAPI` with:

**Pull (on-demand):**
```
WidgetAPI.system.cpu()       → Promise
WidgetAPI.system.memory()    → Promise
WidgetAPI.system.disk()      → Promise
WidgetAPI.system.network()   → Promise
WidgetAPI.system.gpu()       → Promise
WidgetAPI.system.battery()   → Promise
WidgetAPI.system.uptime()    → Promise
WidgetAPI.system.os()        → Promise
```

**Subscribe (push):**
```
WidgetAPI.system.subscribe(metric, callback) → unlisten function
// e.g. WidgetAPI.system.subscribe('cpu', data => { ... })
```

**Widget self-management:**
```
WidgetAPI.widget.drag(mousedownEvent)  — start dragging this module
WidgetAPI.widget.resize(direction)     — start resize in given direction
WidgetAPI.widget.openSettings()        — open this module's settings window
WidgetAPI.widget.close()               — close this module
```

### Drag Platform Awareness

The Rust side injects `window.__fluxLayerShell = true` into the webview via `eval_script` immediately after creating a Wayland layer-shell window. `widget-api.js` reads this flag once on load.

`WidgetAPI.widget.drag(event)` then picks the right path:
- **Non-layer-shell** (X11, Windows, macOS): calls `appWindow.startDragging()` — native OS drag takes over
- **Wayland layer-shell**: tracks `mousemove` deltas from the mousedown event and calls `invoke('move_module', { id, dx, dy })` on each move, stopping on `mouseup`

This is the first place the Wayland drag path is actually implemented in the module JS. Previously, modules called `appWindow.startDragging()` directly and the Wayland case was silently broken.

---

## 2. Position & Size Persistence

No format change — `window_state.json` (JSON) remains the runtime state file. It stores:
- `windows`: map of module ID → { x, y, width, height }
- `margins`: map of module ID → { left, top } (Wayland layer-shell only)

**Behavioural fixes aligned with the guide:**
- On Wayland, position is stored as margins (already implemented). Pixel coords are not saved for layer-shell windows.
- On X11/Windows/macOS, pixel position is saved on every `Moved` and `Resized` event.
- Main window position restored on X11/Windows/macOS; skipped on Wayland (compositor manages it).
- State file write is synchronous and immediate on each move/resize event (already implemented).

No changes to the persistence format or file location in Phase 0.

---

## 3. Drag & Drop

Two paths — Rust side already correct, JS side incomplete for Wayland. Phase 0 fixes the JS:

| Platform | Mechanism |
|---|---|
| X11, Windows, macOS | `appWindow.startDragging()` — native OS drag |
| Wayland (layer-shell) | `mousemove` delta tracking → `invoke('move_module', { id, dx, dy })` |

Modules stop calling `appWindow.startDragging()` directly and use `WidgetAPI.widget.drag(event)` instead, which handles both paths. The `drag_window` and `move_module` Rust commands are unchanged.

Resize (`appWindow.startResizeDragging(direction)`) is wrapped as `WidgetAPI.widget.resize(direction)`. Resize does not need a Wayland-specific path — layer-shell windows use Tauri's built-in resize which works correctly.

---

## 4. System Tray

No new features in Phase 0. Existing implementation retained:
- Left-click or "Show Command Center" menu item → shows and focuses the main window
- "Quit Flux" menu item → exits the process

The tray menu will gain a module toggle list in Phase 3 (Settings UI phase).

---

## 5. Bridges Theme Pack

### File Structure

```
flux/
  themes/
    bridges/
      theme.json
      modules/
        system-stats/
          module.json
          index.html
          logic.js
          settings.html
          assets/
        time-date/
          module.json
          index.html
          logic.js
          settings.html
          assets/
        weather/
          module.json
          index.html
          logic.js
          settings.html
          assets/
```

### `theme.json`
```json
{
  "id": "bridges",
  "name": "Bridges",
  "description": "The default module pack. Clean, functional, desktop-ready.",
  "version": "1.0.0",
  "modules": ["system-stats", "time-date", "weather"]
}
```

### Module Discovery Update

The Rust discovery logic (`list_modules`) gains a second bundled scan path:
1. `~/.local/share/flux/modules/` (user-installed, already exists)
2. `resource_dir/themes/*/modules/` (bundled theme packs — new)
3. `resource_dir/modules/` (legacy flat path — kept for backwards compat during transition, removed in Phase 1)

Deduplication by module ID is preserved (user modules shadow bundled ones of the same ID).

### Module Updates

All three Bridges modules are updated to use `WidgetAPI` instead of direct Tauri invocations:
- `system-stats`: replace `invoke('get_system_stats')` polling with `WidgetAPI.system.subscribe('cpu', ...)` etc.
- `time-date`: no system data dependency — update drag/resize calls only
- `weather`: update drag/resize calls; weather fetch remains a direct `fetch()` call (no WidgetAPI wrapper needed in Phase 0)

Module names (in `module.json`) remain: "System Stats", "Time & Date", "Weather".

---

## Out of Scope (Phase 1+)

- TOML engine config for persisting which modules are active across restarts
- Configurable broadcast interval
- Automatic `widget-api.js` injection (modules include it manually in Phase 0)
- Additional tray menu items (module toggles, reload all)
- New modules or Bridges visual redesign
- Mac/Windows testing and platform-specific fixes (tracked separately)

---

## Checklist

- [ ] `get_system_stats` removed; 8 individual commands added
- [ ] Push broadcaster running at 2s (fast metrics) / 30s (slow metrics)
- [ ] `widget-api.js` written and served via `flux-module://` protocol
- [ ] `system-stats` module updated to use `WidgetAPI`
- [ ] `time-date` module updated to use `WidgetAPI`
- [ ] `weather` module updated to use `WidgetAPI`
- [ ] Bridges modules moved to `themes/bridges/modules/`
- [ ] `theme.json` written for Bridges
- [ ] Module discovery updated to scan `themes/*/modules/`
- [ ] Drag JS updated to use `WidgetAPI.widget.drag(event)` with Wayland layer-shell path implemented
- [ ] Resize JS updated to use `WidgetAPI.widget.resize(direction)`
- [ ] `__fluxLayerShell` flag injected by Rust on layer-shell window creation
- [ ] Existing tests updated/passing
- [ ] New unit tests for individual metric commands

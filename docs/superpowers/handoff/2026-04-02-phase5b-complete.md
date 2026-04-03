# Handoff: Phase 5b Complete — Ready for Phase 5c

**Date:** 2026-04-02
**Branch:** master (all merged)
**Last commit:** a2ac7fa — fix: guard sysinfo refreshes by subscriber, align battery interval min to 500ms, clarify lock order

---

## What just shipped

### Phase 5a — HiDPI + Multi-Monitor (merged earlier this session)
- HiDPI position flash bug fixed (removed redundant `builder.position()` call)
- HiDPI resize delta bug fixed (scale factor applied to dx/dy)
- Monitor fingerprinting — widgets remember which monitor they were on
- Startup recovery — orphaned widgets (monitor unplugged) auto-moved to primary
- "Bring all widgets to screen" tray item
- Per-widget "Move to Monitor" submenu (shown when ≥2 monitors)
- Preferences window (`runtime/preferences/`) — Display + Advanced sections
- `allow_offscreen` flag in `.fluxwidget` manifest

### Phase 5b — Performance & Power Management (merged this session)
- **Subscription-aware polling** — broadcaster skips collection for zero-subscriber categories (cpu, memory, network, gpu, disk-io, disk, battery), including sysinfo refreshes
- **Visibility throttling** — hidden widgets get events every ~10s (HIDDEN_THROTTLE_TICKS = 5 × 2s); visible widgets get full rate
- **Battery-aware interval** — auto-slows to 5s when on battery; default on, user-configurable
- **widget-api.js** — `subscribe()` calls `register_metric_interest` on first listener; returned `unlisten()` calls `unregister_metric_interest` when count hits zero
- **Preferences → Performance section** — battery saver checkbox + interval input, live-saved
- 89 Rust tests passing (was 74 before 5b — 15 new tests added)

---

## Current codebase state

### Key files changed in 5a+5b
```
flux/app/src-tauri/src/
  config.rs          — battery_saver, battery_interval_ms fields
  lib.rs             — AppState: metric_subscriptions, hidden_widget_ticks, offscreen_widgets,
                       startup_toast; commands: register/unregister_metric_interest,
                       set_battery_saver, set_battery_interval, get_performance_config,
                       get_monitors, bring_all_to_screen, move_widget_to_monitor,
                       get_offscreen_widgets, recover_widget, get_and_clear_startup_toast
  broadcaster.rs     — subscription guards, emit_to_windows, compute_effective_ms,
                       battery state tracking on slow tick
  monitors.rs        — NEW: monitor fingerprinting, offscreen detection
  metrics.rs         — BatteryInfo { percentage, charging, time_to_empty, time_to_full }

flux/app/runtime/
  widget-api.js      — _counts Map, register/unregister in subscribe()
  preferences/       — NEW: index.html, app.js, style.css (Display + Advanced + Performance)
  command-center/    — startup toast banner, flux:toast event listener
  widget-editor/     — allowOffscreen checkbox in properties panel
```

### widget-api.js public surface (unchanged, still backwards-compatible)
```js
WidgetAPI.system.subscribe(metric, callback) → unlisten fn
WidgetAPI.system.cpu/memory/disk/network/gpu/battery/uptime/os() → Promise
WidgetAPI.widget.drag/resize/openSettings/close/getSettings/saveSetting()
```

---

## What's next

### Phase 5c — Alerts + History (not yet brainstormed)
Ideas scoped during Phase 5 planning:
- Threshold alerts: user sets "notify me when CPU > 80% for 10s"
- Metric history ring buffer in AppState for sparkline widgets
- Alert delivery via system notification or in-widget callback

### Phase 5d — Widget Gallery / Sharing (not yet brainstormed)
- Browse + install widgets from a remote registry
- One-click install from URL

### Phase 5e — Intel + AMD GPU (cross-platform) (deferred from 5b)
- Intel GPU: `/sys/class/drm/renderD*/` on Linux, DXGI on Windows, IOKit on macOS
- AMD GPU: already works on Linux via sysfs (in 5b); Windows/macOS needs ADL/Metal
- Spec: `docs/superpowers/specs/2026-04-02-phase5b-performance-design.md` § Out of Scope

---

## How to resume

1. Start Claude Code in `/home/jack/bridgegap`
2. Say "read the handoff file" — Claude will read this doc
3. Pick a phase: "let's brainstorm phase 5c" or "let's do phase 5e GPU"
4. The brainstorming skill will explore the codebase and pick up from here

---

## Specs and plans on disk
```
docs/superpowers/specs/
  2026-04-02-phase5a-hidpi-multimonitor-design.md
  2026-04-02-phase5b-performance-design.md

docs/superpowers/plans/
  2026-03-27-phase1-multi-widget-config.md
  2026-03-28-phase4b-widget-editor.md
  2026-04-02-phase5a-hidpi-multimonitor.md  (5a plan)
  2026-04-02-phase5b-performance.md         (5b plan — just executed)
```

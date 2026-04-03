# Phase 5b Design: Performance & Power Management

**Date:** 2026-04-02
**Phase:** 5b (pre-launch polish)
**Author:** Claude (Sonnet 4.6) via brainstorming session

---

## Overview

Phase 5b addresses three independent performance problems in Flux's broadcaster pipeline:

1. **Battery drain** — Flux polls at full rate even on battery
2. **Wasted collection** — GPU/disk metrics collected even when no widget needs them
3. **Hidden widget waste** — Hidden widgets receive events at full rate and process them unnecessarily

All three changes are internal to the Rust broadcaster and the JS widget API. No new windows. No new processes. Hard constraint: backwards-compatible — existing `.fluxwidget` files and `window_state.json` continue to work unchanged.

---

## Architecture

### Modified: `broadcaster.rs`

The broadcaster gains three new behaviors:

1. **Battery-aware interval** — reads power state on the slow tick, swaps its sleep interval when on battery
2. **Per-category collection guard** — checks subscriber count before collecting each metric; skips collection and emission entirely for zero-subscriber categories
3. **Per-window emission** — replaces `app.emit()` (broadcast) with per-window `window.emit()`, applying a hidden-widget slow rate

### Modified: `config.rs`

`EngineConfig` gains two new fields:

```rust
/// Whether to automatically reduce polling rate when on battery power.
#[serde(default = "default_true")]
pub battery_saver: bool,

/// Polling interval (ms) used when battery_saver is active and device is on battery.
#[serde(default = "default_battery_interval")]
pub battery_interval_ms: u64,
```

Defaults: `battery_saver = true`, `battery_interval_ms = 5000`.

### Modified: `lib.rs`

`AppState` gains two new fields:

```rust
/// Maps metric category name → set of window IDs currently subscribed.
/// Categories: "cpu", "memory", "network", "gpu", "disk-io", "disk", "battery"
pub metric_subscriptions: Mutex<HashMap<String, HashSet<String>>>,

/// Per-window tick counter for hidden-widget throttling.
/// Reset to 0 when window becomes visible; incremented each tick when hidden.
pub hidden_widget_ticks: Mutex<HashMap<String, u32>>,
```

Both initialized to empty on startup.

### Modified: `widget-api.js`

`WidgetAPI.system.subscribe(eventSuffix, callback)` gains registration side-effects:
- On first subscription to a category → calls `invoke('register_metric_interest', { windowId, categories: [eventSuffix] })`
- When the last listener for a category is removed → calls `invoke('unregister_metric_interest', { windowId, categories: [eventSuffix] })`

`windowId` is read from `window.__TAURI_INTERNALS__.metadata.currentWindow.label`.

### Modified: `preferences/`

Preferences window gains a **Performance** section with battery saver controls.

---

## Battery Awareness

### Detection

The broadcaster's slow tick (every 30s) already reads battery state for `system:battery` emission. This same read is used to determine power state. A device is considered "on battery" when:
- A battery exists AND
- Its status is not `Charging` and not `Full`

On desktops with no battery, `battery_saver` has no effect (no battery detected → always use normal rate).

### Interval swapping

Each tick, the broadcaster resolves its effective interval:

```
effective_interval = if battery_saver && on_battery {
    battery_interval_ms
} else {
    broadcast_interval_ms
}
```

The power state is re-evaluated every slow tick (~30s), not every tick. This avoids per-tick locking.

### Config persistence

`set_battery_saver(enabled: bool)` and `set_battery_interval(ms: u64)` write to `EngineConfig` and save to disk. The broadcaster reads the config under lock at the start of each slow tick, so changes take effect within 30s without restart.

`get_performance_config()` returns `{ battery_saver, battery_interval_ms, broadcast_interval_ms }` for the Preferences UI.

### Preferences UI — Performance section

Added to `runtime/preferences/index.html` after the existing Display and Advanced sections:

```
Performance
───────────────────────────────────────────
☑ Battery saver (auto)
  Reduces polling rate when running on battery.

  Battery polling interval: [5000] ms
  (Normal interval: 2000 ms)
```

The interval input is disabled when the checkbox is unchecked. Changes call `set_battery_saver` / `set_battery_interval` and `save_config`.

---

## Subscription-Aware Polling

### Metric categories

Seven categories map to broadcaster collection blocks:

| Category | Event emitted | Collection cost |
|---|---|---|
| `cpu` | `system:cpu` | sysinfo CPU refresh |
| `memory` | `system:memory` | sysinfo memory refresh |
| `network` | `system:network` | sysinfo network refresh + delta |
| `gpu` | `system:gpu` | NVML call or sysfs read |
| `disk-io` | `system:disk-io` | `/proc/diskstats` parse (Linux) |
| `disk` | `system:disk` | sysinfo disk refresh (slow tick) |
| `battery` | `system:battery` | battery read (slow tick) |

### Registration commands

```rust
#[tauri::command]
fn register_metric_interest(
    state: State<'_, AppState>,
    window_id: String,
    categories: Vec<String>,
) // adds window_id to each category's subscriber set

#[tauri::command]
fn unregister_metric_interest(
    state: State<'_, AppState>,
    window_id: String,
    categories: Vec<String>,
) // removes window_id from each category's subscriber set
```

A third variant handles full cleanup on window close:

```rust
fn unregister_all_metric_interest(state: &AppState, window_id: &str)
// removes window_id from ALL categories — called from WindowEvent::CloseRequested
```

This is a plain function (not a command) called from the window event handler.

### Broadcaster guard

Before each collection block:

```rust
let has_subscribers = {
    let subs = state.metric_subscriptions.lock().unwrap();
    subs.get("gpu").map(|s| !s.is_empty()).unwrap_or(false)
};
if !has_subscribers { /* skip collection and emit */ }
```

Lock is acquired and released immediately — not held during collection.

### JS side — widget-api.js

`WidgetAPI.system` maintains a per-category listener count (`Map<string, number>`):

```js
subscribe(eventSuffix, callback) {
    const count = this._counts.get(eventSuffix) || 0;
    if (count === 0) {
        // First subscriber for this category — register with Rust
        invoke('register_metric_interest', {
            windowId: this._windowId,
            categories: [eventSuffix],
        }).catch(() => {}); // fire-and-forget
    }
    this._counts.set(eventSuffix, count + 1);
    // ... existing listen() setup ...
    return () => {
        // unlisten ...
        const newCount = (this._counts.get(eventSuffix) || 1) - 1;
        this._counts.set(eventSuffix, newCount);
        if (newCount === 0) {
            invoke('unregister_metric_interest', {
                windowId: this._windowId,
                categories: [eventSuffix],
            }).catch(() => {});
        }
    };
}
```

### Startup behaviour

On startup, `metric_subscriptions` is empty. The broadcaster skips all collection until at least one widget registers interest. This means at startup there is a brief window (~one tick) before widgets have registered and data starts flowing — acceptable since widgets initialize asynchronously anyway.

---

## Visibility Throttling

### Emission change

The broadcaster replaces:
```rust
let _ = app.emit("system:cpu", &cpu_payload);
```

With a per-window loop over `state.active_modules`:

```rust
let window_ids: Vec<String> = state.active_modules.lock().unwrap().keys().cloned().collect();
for id in &window_ids {
    if let Some(win) = app.get_webview_window(id) {
        let visible = win.is_visible().unwrap_or(true);
        if visible {
            // Reset slow counter, emit immediately
            state.hidden_widget_ticks.lock().unwrap().insert(id.clone(), 0);
            let _ = win.emit("system:cpu", &cpu_payload);
        } else {
            // Increment slow counter; emit every HIDDEN_THROTTLE_TICKS
            let mut ticks = state.hidden_widget_ticks.lock().unwrap();
            let count = ticks.entry(id.clone()).or_insert(0);
            *count += 1;
            if *count >= HIDDEN_THROTTLE_TICKS {
                *count = 0;
                let _ = win.emit("system:cpu", &cpu_payload);
            }
        }
    }
}
```

`HIDDEN_THROTTLE_TICKS: u32 = 5` — constant in `broadcaster.rs`. At the default 2s interval, hidden widgets receive updates every ~10s.

### Payload sharing

The metric payload is computed once per tick (not per window). The per-window loop only varies the emit decision, not the data collection. No extra serialization cost.

### Non-widget windows

Command center, widget editor, preferences, and other internal windows are not in `active_modules` and are unaffected. They do not subscribe to `system:*` events.

---

## New Tauri Commands

| Command | Purpose |
|---|---|
| `register_metric_interest(window_id, categories)` | Add window to subscriber sets |
| `unregister_metric_interest(window_id, categories)` | Remove window from subscriber sets |
| `set_battery_saver(enabled)` | Update config + save |
| `set_battery_interval(ms)` | Update config + save |
| `get_performance_config()` | Read current performance settings for Preferences UI |

---

## Out of Scope for Phase 5b

- Intel GPU support (Phase 5e)
- AMD GPU on macOS/Windows (Phase 5e)
- Mid-session broadcaster restart when config changes (next tick picks up new values)
- Per-widget polling rate overrides (future)
- Adaptive polling based on system load (future)

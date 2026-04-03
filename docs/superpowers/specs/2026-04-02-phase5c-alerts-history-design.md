# Phase 5c: Alerts + History — Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Builds on:** Phase 5b (subscription-aware broadcaster, battery-aware polling)

---

## Overview

Two tightly coupled features:

1. **History ring buffer** — per-metric circular buffer in `AppState` filled by the broadcaster loop. Enables sparkline widgets to pull recent samples on demand.
2. **Alert engine** — threshold monitoring in the broadcaster loop with OS toast and/or in-widget callback delivery. Alerts can be registered by widgets (runtime) or users (Preferences UI, persisted to config).

---

## Architecture

### Approach

Rust-owned engine. Both history and alert evaluation live in the broadcaster loop (`broadcaster.rs`). This ensures alerts fire even when widgets are hidden or not loaded — a JS-driven approach would miss alerts for hidden widgets.

### New AppState fields

```rust
/// Per-metric ring buffer. Filled regardless of subscription state.
/// Key = metric name ("cpu", "memory", etc.)
pub metric_history: Mutex<HashMap<String, VecDeque<serde_json::Value>>>,

/// Active alert definitions (widget-registered + user-defined).
pub alert_defs: Mutex<Vec<AlertDef>>,

/// Tracks when each alert condition first became true.
/// None = condition currently false.
pub alert_states: Mutex<HashMap<String, Option<Instant>>>,
```

---

## History Ring Buffer

### Scope

Fills for fast-tick metrics only: `cpu`, `memory`, `network`, `gpu`, `disk-io`.
Skipped: `disk` and `battery` (30s slow-tick — not useful for sparklines).

### Depth

`history_depth: usize` added to `EngineConfig` (default 60, valid range 30–300).
Configurable in Preferences → Performance section.

### Broadcaster integration

After emitting each metric payload to windows, the broadcaster pushes a clone into the deque:

```rust
let mut hist = state.metric_history.lock().unwrap();
let deque = hist.entry(metric_name).or_insert_with(VecDeque::new);
deque.push_back(payload.clone());
let depth = state.config.lock().unwrap().engine.history_depth;
while deque.len() > depth { deque.pop_front(); }
```

### New Tauri command

```rust
#[tauri::command]
pub fn get_metric_history(
    state: State<'_, AppState>,
    metric: String,
    n: usize,
) -> Vec<serde_json::Value>
```

Returns last `n` samples (or fewer if buffer hasn't filled yet). Clamps `n` to `history_depth`.

---

## Alert Engine

### Data types

```rust
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AlertOp { Gt, Lt, Gte, Lte, Eq }

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AlertDelivery { Notification, Callback, Both }

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum AlertSource { Widget { window_id: String }, User }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AlertDef {
    pub id: String,           // UUID assigned on register
    pub metric: String,       // "cpu", "memory", "network", "gpu", "disk-io"
    pub field: String,        // payload field to test, e.g. "avg_usage"
    pub op: AlertOp,
    pub value: f64,           // threshold
    pub duration_secs: u64,   // condition must hold this long before firing
    pub delivery: AlertDelivery,
    pub label: String,        // human-readable, used in OS notification title
    pub source: AlertSource,
}
```

### Alert evaluation (broadcaster loop)

After emitting a metric payload, evaluate all alert defs for that metric:

```
for each alert_def where alert_def.metric == current_metric:
    actual = extract_f64(payload, alert_def.field)  // None → skip
    condition_met = compare(actual, alert_def.op, alert_def.value)

    if condition_met:
        if alert_states[id] == None:
            alert_states[id] = Some(Instant::now())
        elif Instant::now() - alert_states[id] >= duration_secs:
            fire_alert(alert_def, actual)
            alert_states[id] = None   // reset — won't re-fire until condition clears
    else:
        alert_states[id] = None       // condition cleared, reset
```

### Alert delivery

**System notification** (`AlertDelivery::Notification` or `Both`):
- Uses `tauri-plugin-notification`
- Title: `alert_def.label`
- Body: `"{field} is {actual} (threshold: {op} {value})"`

**Widget callback** (`AlertDelivery::Callback` or `Both`):
- Emits `flux:alert` event to all active widget windows
- Payload: `{ id, label, metric, field, value, actual }`

### Hysteresis

Once an alert fires, `alert_states[id]` is reset to `None`. The alert cannot re-fire until the condition clears (sets state to `None`) and re-triggers. This prevents spam on a metric hovering at the threshold.

### Persistence

- **User-defined alerts** (`AlertSource::User`): stored in `EngineConfig` as `alerts: Vec<AlertDef>`, saved to TOML on add/remove.
- **Widget-registered alerts** (`AlertSource::Widget`): runtime only. Cleaned up in `WindowEvent::Destroyed` handler by filtering `alert_defs` to remove all entries with `source == Widget { window_id }`.

### New Tauri commands

```rust
register_alert(def: AlertDefInput) -> String   // returns assigned id
unregister_alert(id: String)
get_alerts() -> Vec<AlertDef>
set_history_depth(depth: usize)
```

`AlertDefInput` is `AlertDef` without `id` and `source` fields — those are assigned server-side.

---

## widget-api.js additions

### History

```js
// Pull last N samples for a metric. One-shot invoke.
WidgetAPI.system.history(metric, n)  // → Promise<Array>
```

Typical usage: call on load to seed a sparkline, then append new values via `subscribe()`.

### Alerts

```js
// Register a threshold alert. Returns Promise<string> (alert id).
WidgetAPI.alerts.register({ metric, field, op, value, duration, delivery, label })

// Remove a previously registered alert.
WidgetAPI.alerts.unregister(id)  // → Promise<void>

// Listen for alert callbacks. Same pattern as system.subscribe().
// Returns synchronous unlisten fn.
WidgetAPI.alerts.onAlert(callback)
// callback({ id, label, metric, field, value, actual })
```

Widget-registered alerts are cleaned up automatically on window close (Rust side). `onAlert` uses `listen('flux:alert', ...)` — no ref-counting needed since `flux:alert` is broadcast to all windows.

---

## Preferences UI additions

### Performance section (existing)

Add below battery saver controls:

- **Label:** "History samples"
- **Input:** number, range 30–300, step 10, default 60
- **Helper:** "Samples kept per metric for sparklines. At 2s interval, 60 = 1 minute."
- Live-saved via `set_history_depth` command on change (same pattern as battery interval input)

### Alerts section (new)

New `<section>` below Performance in `preferences/index.html`:

- Header: "Alerts"
- Alert list: each row shows label, condition summary (`cpu avg_usage > 80% for 10s`), delivery icons (🔔 notification / 📡 callback), delete button
- "Add alert" button expands an inline form:
  - Metric: `<select>` — CPU, Memory, Network, GPU, Disk I/O
  - Field: `<select>` — populated per metric
    - CPU: avg_usage, cpu_temp
    - Memory: used, available, swap_used
    - Network: received, transmitted
    - GPU: usage, vram_percentage, temp
    - Disk I/O: read, write
  - Operator: `<select>` — `>`, `<`, `>=`, `<=`
  - Value: `<input type="number">`
  - Duration (seconds): `<input type="number">` default 10
  - Delivery: two checkboxes — "System notification", "Widget callback"
  - Label: `<input type="text">`
  - "Add" button → calls `register_alert`, closes form, refreshes list

No edit-in-place. Delete and re-add to modify an alert.

---

## Config additions

`EngineConfig` (`config.rs`):

```rust
#[serde(default = "default_history_depth")]
pub history_depth: usize,   // default 60

#[serde(default)]
pub alerts: Vec<AlertDef>,
```

```rust
fn default_history_depth() -> usize { 60 }
```

---

## New dependency

```toml
tauri-plugin-notification = "2"
```

Add to `Cargo.toml` and register in `lib.rs` plugin setup.

---

## Out of scope

- Alert editing in-place (delete + re-add)
- Alert history log (which alerts have fired, when)
- Per-widget alert mute/snooze
- Alert conditions across multiple metrics (e.g. "CPU > 80% AND temp > 90°C")
- History for `disk` and `battery` (slow-tick metrics)

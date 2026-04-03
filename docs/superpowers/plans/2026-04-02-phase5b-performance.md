# Phase 5b: Performance & Power Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Flux's CPU, GPU, and battery overhead by making the broadcaster subscription-aware, visibility-aware, and battery-aware.

**Architecture:** Three independent changes to `broadcaster.rs` (subscription guards, visibility throttling, battery-aware interval), one to `lib.rs` (AppState fields + Tauri commands), one to `config.rs` (new fields), one to `widget-api.js` (register/unregister on subscribe/unlisten), and one to `preferences/` (new Performance section UI).

**Tech Stack:** Rust/Tauri 2, `serde`/`serde_json`, vanilla JS

**Spec:** `docs/superpowers/specs/2026-04-02-phase5b-performance-design.md`

---

## File Map

| File | Change |
|---|---|
| `flux/app/src-tauri/src/config.rs` | Add `battery_saver: bool` + `battery_interval_ms: u64` to `EngineSection` |
| `flux/app/src-tauri/src/lib.rs` | Add `metric_subscriptions` + `hidden_widget_ticks` to `AppState`; add 5 commands + 1 plain fn; wire `CloseRequested` |
| `flux/app/src-tauri/src/broadcaster.rs` | Add helper fns, subscription guards, visibility throttling loop, battery-aware sleep interval |
| `flux/app/runtime/widget-api.js` | Add `_counts` Map + `_windowId`; call `register/unregister_metric_interest` in `subscribe()` |
| `flux/app/runtime/preferences/index.html` | Add Performance section after Advanced |
| `flux/app/runtime/preferences/app.js` | Add `loadPerformanceConfig()` + battery saver handlers |

---

## Task 1: `config.rs` — Add Battery Saver Fields

**Files:**
- Modify: `flux/app/src-tauri/src/config.rs`

- [ ] **Step 1: Write the failing tests**

Add to `#[cfg(test)] mod tests` in `config.rs`:

```rust
#[test]
fn battery_saver_defaults_to_true() {
    let c = EngineConfig::default();
    assert!(c.engine.battery_saver);
    assert_eq!(c.engine.battery_interval_ms, 5000);
}

#[test]
fn battery_saver_roundtrip() {
    let mut c = EngineConfig::default();
    c.engine.battery_saver = false;
    c.engine.battery_interval_ms = 3000;
    let tmp = temp_dir().join(format!("flux_config_test_battery_{}.toml", std::process::id()));
    write_config(&tmp, &c).expect("write failed");
    let loaded = read_config(&tmp);
    assert!(!loaded.engine.battery_saver);
    assert_eq!(loaded.engine.battery_interval_ms, 3000);
    let _ = std::fs::remove_file(&tmp);
}

#[test]
fn old_config_without_battery_fields_uses_defaults() {
    let tmp = temp_dir().join(format!("flux_config_test_old_{}.toml", std::process::id()));
    // Write a config file with no battery fields (simulating pre-5b config)
    std::fs::write(&tmp, "[engine]\nbroadcast_interval_ms = 2000\n").unwrap();
    let loaded = read_config(&tmp);
    assert!(loaded.engine.battery_saver);
    assert_eq!(loaded.engine.battery_interval_ms, 5000);
    let _ = std::fs::remove_file(&tmp);
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd flux/app/src-tauri && cargo test -- config::tests::battery 2>&1 | tail -20
```

Expected: compile error (fields don't exist yet) or test failure.

- [ ] **Step 3: Add fields to `EngineSection`**

Replace the `EngineSection` struct and its `Default` impl (lines 11–27 of `config.rs`):

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EngineSection {
    #[serde(default = "default_interval")]
    pub broadcast_interval_ms: u64,
    #[serde(default)]
    pub active_modules: Vec<String>,
    #[serde(default)]
    pub start_on_login: bool,
    #[serde(default = "default_true")]
    pub battery_saver: bool,
    #[serde(default = "default_battery_interval")]
    pub battery_interval_ms: u64,
}

fn default_interval() -> u64 { 2000 }
fn default_true() -> bool { true }
fn default_battery_interval() -> u64 { 5000 }

impl Default for EngineSection {
    fn default() -> Self {
        Self {
            broadcast_interval_ms: default_interval(),
            active_modules: Vec::new(),
            start_on_login: false,
            battery_saver: true,
            battery_interval_ms: default_battery_interval(),
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd flux/app/src-tauri && cargo test -- config::tests 2>&1 | tail -20
```

Expected: all config tests pass (5 tests: 4 existing + 3 new; the 3 new share a prefix so filter passes all).

- [ ] **Step 5: Commit**

```bash
cd flux/app/src-tauri && git add src/config.rs
git commit -m "feat(config): add battery_saver and battery_interval_ms fields"
```

---

## Task 2: `lib.rs` — AppState Fields, Commands, Cleanup

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Add to `#[cfg(test)] mod tests` in `lib.rs`:

```rust
fn make_test_state() -> AppState {
    AppState {
        sys: Mutex::new(System::new_all()),
        nvml: None,
        last_net_io: Mutex::new((0, 0, Instant::now())),
        last_disk_io: Mutex::new((0, 0, Instant::now())),
        active_modules: Mutex::new(HashMap::new()),
        persistent: Mutex::new(PersistentState::default()),
        data_dir: std::path::PathBuf::from("/tmp"),
        desktop_wayland_windows: Mutex::new(HashSet::new()),
        config: Mutex::new(EngineConfig::default()),
        config_path: std::path::PathBuf::from("/tmp/flux_test_perf.toml"),
        custom_broker: custom_data::CustomDataBroker::new(),
        offscreen_widgets: Mutex::new(Vec::new()),
        startup_toast: Mutex::new(None),
        metric_subscriptions: Mutex::new(HashMap::new()),
        hidden_widget_ticks: Mutex::new(HashMap::new()),
    }
}

#[test]
fn unregister_all_clears_subscriptions_and_ticks() {
    let state = make_test_state();
    {
        let mut subs = state.metric_subscriptions.lock().unwrap();
        subs.entry("cpu".to_string()).or_default().insert("widget-1".to_string());
        subs.entry("gpu".to_string()).or_default().insert("widget-1".to_string());
        subs.entry("cpu".to_string()).or_default().insert("widget-2".to_string());
    }
    {
        let mut ticks = state.hidden_widget_ticks.lock().unwrap();
        ticks.insert("widget-1".to_string(), 3u32);
    }
    unregister_all_metric_interest(&state, "widget-1");
    let subs = state.metric_subscriptions.lock().unwrap();
    assert!(!subs["cpu"].contains("widget-1"), "widget-1 removed from cpu");
    assert!(subs["cpu"].contains("widget-2"),  "widget-2 still in cpu");
    assert!(!subs["gpu"].contains("widget-1"), "widget-1 removed from gpu");
    assert!(!state.hidden_widget_ticks.lock().unwrap().contains_key("widget-1"), "tick counter removed");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd flux/app/src-tauri && cargo test -- lib::tests::unregister_all 2>&1 | tail -20
```

Expected: compile error (fields/function don't exist yet).

- [ ] **Step 3: Add fields to `AppState`**

In `lib.rs`, find the `AppState` struct (around line 198). Add two fields after `startup_toast`:

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
    pub offscreen_widgets: Mutex<Vec<String>>,
    pub startup_toast: Mutex<Option<String>>,
    /// Maps metric category → set of window IDs subscribed (e.g. "cpu" → {"widget-1"}).
    pub metric_subscriptions: Mutex<HashMap<String, HashSet<String>>>,
    /// Per-window tick counter for hidden-widget throttling.
    pub hidden_widget_ticks: Mutex<HashMap<String, u32>>,
}
```

- [ ] **Step 4: Initialize the new fields in the AppState constructor**

Find the `app.manage(AppState { ... })` block (around line 1445). Add after `startup_toast`:

```rust
metric_subscriptions: Mutex::new(HashMap::new()),
hidden_widget_ticks: Mutex::new(HashMap::new()),
```

- [ ] **Step 5: Add the commands and plain function**

Add these functions in `lib.rs` near the other commands (before the `invoke_handler`):

```rust
#[tauri::command]
fn register_metric_interest(
    state: State<'_, AppState>,
    window_id: String,
    categories: Vec<String>,
) {
    let mut subs = state.metric_subscriptions.lock().unwrap();
    for cat in categories {
        subs.entry(cat).or_insert_with(HashSet::new).insert(window_id.clone());
    }
}

#[tauri::command]
fn unregister_metric_interest(
    state: State<'_, AppState>,
    window_id: String,
    categories: Vec<String>,
) {
    let mut subs = state.metric_subscriptions.lock().unwrap();
    for cat in &categories {
        if let Some(set) = subs.get_mut(cat) {
            set.remove(&window_id);
        }
    }
}

/// Called from WindowEvent::CloseRequested — removes window from all subscription sets
/// and cleans up its tick counter. NOT a Tauri command.
fn unregister_all_metric_interest(state: &AppState, window_id: &str) {
    let mut subs = state.metric_subscriptions.lock().unwrap();
    for set in subs.values_mut() {
        set.remove(window_id);
    }
    drop(subs);
    state.hidden_widget_ticks.lock().unwrap().remove(window_id);
}

#[tauri::command]
fn set_battery_saver(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.engine.battery_saver = enabled;
    write_config(&state.config_path, &cfg).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_battery_interval(state: State<'_, AppState>, ms: u64) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.engine.battery_interval_ms = ms.max(100);
    write_config(&state.config_path, &cfg).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_performance_config(state: State<'_, AppState>) -> serde_json::Value {
    let cfg = state.config.lock().unwrap();
    serde_json::json!({
        "battery_saver": cfg.engine.battery_saver,
        "battery_interval_ms": cfg.engine.battery_interval_ms,
        "broadcast_interval_ms": cfg.engine.broadcast_interval_ms,
    })
}
```

- [ ] **Step 6: Wire `unregister_all_metric_interest` into `track_window`**

Find `track_window` (around line 833). The closure inside `window.on_window_event` currently only handles `WindowEvent::Moved` and `WindowEvent::Resized`. Add `CloseRequested` handling:

```rust
fn track_window(window: WebviewWindow) {
    let app_handle = window.app_handle().clone();
    let label = window.label().to_string();
    let w = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(_) | WindowEvent::Resized(_) = event {
            // ... existing position-save code unchanged ...
        }
        if let WindowEvent::CloseRequested { .. } = event {
            let state = app_handle.state::<AppState>();
            unregister_all_metric_interest(&state, &label);
        }
    });
}
```

- [ ] **Step 7: Register the new commands in `invoke_handler`**

Find the `.invoke_handler(tauri::generate_handler![` block (around line 1593). Add the 5 new commands:

```rust
.invoke_handler(tauri::generate_handler![
    drag_window, list_modules, toggle_module,
    open_module_settings, close_window, move_module, resize_module,
    is_layer_shell_window,
    list_themes,
    activate_theme, deactivate_theme,
    open_themes_folder, open_command_center, get_config,
    get_module_settings_schema, get_module_settings, set_module_setting,
    install_theme_archive, pick_and_install_theme, uninstall_theme,
    open_wizard, wizard_launch, wizard_escape,
    open_widget_editor, save_fluxwidget, load_fluxwidget, export_widget_package,
    register_custom_sources, test_custom_source,
    list_assets, import_asset, delete_asset, get_asset_data_url,
    get_monitors, bring_all_to_screen, move_widget_to_monitor,
    get_offscreen_widgets, recover_widget, get_and_clear_startup_toast,
    register_metric_interest, unregister_metric_interest,
    set_battery_saver, set_battery_interval, get_performance_config,
    metrics::system_cpu,
    metrics::system_memory,
    metrics::system_disk,
    metrics::system_network,
    metrics::system_gpu,
    metrics::system_battery,
    metrics::system_uptime,
    metrics::system_os,
    metrics::system_disk_io,
])
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd flux/app/src-tauri && cargo test -- lib::tests::unregister_all 2>&1 | tail -20
```

Expected: `test lib::tests::unregister_all_clears_subscriptions_and_ticks ... ok`

Also verify the build compiles cleanly:

```bash
cd flux/app/src-tauri && cargo build 2>&1 | grep -E "^error" | head -20
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
cd flux/app/src-tauri && git add src/lib.rs
git commit -m "feat(lib): add metric_subscriptions, hidden_widget_ticks, and performance commands"
```

---

## Task 3: `broadcaster.rs` — Helper Functions + Subscription Guards

**Files:**
- Modify: `flux/app/src-tauri/src/broadcaster.rs`

- [ ] **Step 1: Write the failing tests**

These go in a new `#[cfg(test)] mod tests` block at the bottom of `broadcaster.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::sync::Mutex;
    use crate::metrics::BatteryInfo;

    #[test]
    fn has_subscribers_empty_map_returns_false() {
        let subs: Mutex<HashMap<String, HashSet<String>>> = Mutex::new(HashMap::new());
        assert!(!has_subscribers(&subs, "cpu"));
    }

    #[test]
    fn has_subscribers_with_one_subscriber_returns_true() {
        let mut map = HashMap::new();
        let mut set = HashSet::new();
        set.insert("widget-1".to_string());
        map.insert("cpu".to_string(), set);
        let subs = Mutex::new(map);
        assert!(has_subscribers(&subs, "cpu"));
    }

    #[test]
    fn has_subscribers_empty_set_returns_false() {
        let mut map = HashMap::new();
        map.insert("cpu".to_string(), HashSet::<String>::new());
        let subs = Mutex::new(map);
        assert!(!has_subscribers(&subs, "cpu"));
    }

    #[test]
    fn has_subscribers_wrong_category_returns_false() {
        let mut map = HashMap::new();
        let mut set = HashSet::new();
        set.insert("widget-1".to_string());
        map.insert("cpu".to_string(), set);
        let subs = Mutex::new(map);
        assert!(!has_subscribers(&subs, "gpu"));
    }

    #[test]
    fn detect_on_battery_no_battery_returns_false() {
        assert!(!detect_on_battery(None));
    }

    #[test]
    fn detect_on_battery_discharging_returns_true() {
        let b = BatteryInfo { percentage: 80.0, charging: false, time_to_empty: None, time_to_full: None };
        assert!(detect_on_battery(Some(&b)));
    }

    #[test]
    fn detect_on_battery_charging_returns_false() {
        let b = BatteryInfo { percentage: 80.0, charging: true, time_to_empty: None, time_to_full: None };
        assert!(!detect_on_battery(Some(&b)));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd flux/app/src-tauri && cargo test -- broadcaster::tests 2>&1 | tail -20
```

Expected: compile error — `has_subscribers` and `detect_on_battery` don't exist yet.

- [ ] **Step 3: Add helper functions**

Add these two functions to `broadcaster.rs` (before the `start` function):

```rust
use std::collections::{HashMap, HashSet};

/// Returns true if at least one window is subscribed to `category`.
/// Acquires and immediately releases the lock.
fn has_subscribers(
    subs: &std::sync::Mutex<HashMap<String, HashSet<String>>>,
    category: &str,
) -> bool {
    subs.lock()
        .unwrap()
        .get(category)
        .map(|s| !s.is_empty())
        .unwrap_or(false)
}

/// Returns true when the device has a battery and it is not charging.
fn detect_on_battery(battery: Option<&crate::metrics::BatteryInfo>) -> bool {
    battery.map(|b| !b.charging).unwrap_or(false)
}
```

- [ ] **Step 4: Move state acquisition to top of loop; wrap each metric block in a guard**

The current code acquires `state` only before the GPU block (line 88). Move it to the very start of the loop, then wrap every metric collection block. Replace the entire loop body with:

```rust
loop {
    let tick_start = Instant::now();

    // Acquire state once per tick — cheap Arc clone
    let state = app.state::<AppState>();

    // Refresh persistent state objects in-place
    networks.refresh(false);
    components.refresh(false);

    // --- CPU ---
    if has_subscribers(&state.metric_subscriptions, "cpu") {
        sys.refresh_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_cpu_usage()),
        );
        let cpu_temp = read_cpu_temp(&components);
        let cpu_payload = serde_json::json!({
            "usage":     sys.cpus().iter().map(|c| c.cpu_usage()).collect::<Vec<_>>(),
            "avg_usage": sys.global_cpu_usage(),
            "frequency": sys.cpus().first().map(|c| c.frequency()).unwrap_or(0),
            "name":      sys.cpus().first().map(|c| c.brand()).unwrap_or(""),
            "cores":     System::physical_core_count().unwrap_or(0),
            "threads":   sys.cpus().len(),
            "cpu_temp":  cpu_temp,
        });
        let _ = app.emit("system:cpu", &cpu_payload);
    }

    // --- Memory ---
    if has_subscribers(&state.metric_subscriptions, "memory") {
        sys.refresh_memory();
        let mem_payload = serde_json::json!({
            "total":      sys.total_memory(),
            "used":       sys.used_memory(),
            "available":  sys.available_memory(),
            "swap_total": sys.total_swap(),
            "swap_used":  sys.used_swap(),
        });
        let _ = app.emit("system:memory", &mem_payload);
    }

    // --- Network ---
    if has_subscribers(&state.metric_subscriptions, "network") {
        let net_payload: Vec<serde_json::Value> = networks.iter().map(|(name, data)| {
            let total_rx = data.total_received();
            let total_tx = data.total_transmitted();
            let (prev_rx, prev_tx) = prev_net.get(name.as_str()).copied().unwrap_or((total_rx, total_tx));
            let rx_delta = total_rx.saturating_sub(prev_rx);
            let tx_delta = total_tx.saturating_sub(prev_tx);
            serde_json::json!({
                "name":               name,
                "received":           rx_delta,
                "transmitted":        tx_delta,
                "total_received":     total_rx,
                "total_transmitted":  total_tx,
            })
        }).collect();
        for (name, data) in networks.iter() {
            prev_net.insert(name.to_string(), (data.total_received(), data.total_transmitted()));
        }
        let _ = app.emit("system:network", &net_payload);
    }

    // --- GPU ---
    if has_subscribers(&state.metric_subscriptions, "gpu") {
        let gpu = collect_gpu(&state.nvml, &mut components);
        let _ = app.emit("system:gpu", &gpu);
    }

    // --- Disk I/O (Linux only) ---
    if has_subscribers(&state.metric_subscriptions, "disk-io") {
        #[cfg(target_os = "linux")]
        {
            let (td_r, td_w) = read_disk_io_linux();
            let now = Instant::now();
            let el = now.duration_since(prev_disk.2).as_secs_f32();
            let disk_io = if el > 0.0 {
                DiskIoInfo {
                    read:  Some((td_r.saturating_sub(prev_disk.0) as f32 / el) as u64),
                    write: Some((td_w.saturating_sub(prev_disk.1) as f32 / el) as u64),
                }
            } else {
                DiskIoInfo { read: Some(0), write: Some(0) }
            };
            prev_disk = (td_r, td_w, now);
            let _ = app.emit("system:disk-io", &disk_io);
        }
        #[cfg(not(target_os = "linux"))]
        {
            let disk_io = DiskIoInfo { read: None, write: None };
            let _ = app.emit("system:disk-io", &disk_io);
        }
    }

    // --- Slow metrics (every 30 s) ---
    slow_tick += 1;
    if slow_tick >= slow_ticks {
        slow_tick = 0;

        if has_subscribers(&state.metric_subscriptions, "disk") {
            let disks = Disks::new_with_refreshed_list();
            let disk_payload: Vec<serde_json::Value> = disks.iter().map(|d| {
                let avail = d.available_space();
                let total = d.total_space();
                serde_json::json!({
                    "name":        d.name().to_string_lossy(),
                    "mount_point": d.mount_point().to_string_lossy(),
                    "total":       total,
                    "used":        total.saturating_sub(avail),
                    "available":   avail,
                    "kind": match d.kind() {
                        sysinfo::DiskKind::SSD => "SSD",
                        sysinfo::DiskKind::HDD => "HDD",
                        _ => "Unknown",
                    },
                })
            }).collect();
            let _ = app.emit("system:disk", &disk_payload);
        }

        if has_subscribers(&state.metric_subscriptions, "battery") {
            let _ = app.emit("system:battery", &read_battery());
        }
    }

    // Sleep for remainder of tick
    let elapsed = tick_start.elapsed();
    if elapsed < Duration::from_millis(fast_ms) {
        std::thread::sleep(Duration::from_millis(fast_ms) - elapsed);
    }
}
```

**Note:** `networks` is still refreshed unconditionally before the blocks. Only collection and emit are guarded. `prev_net` delta tracking happens inside the network guard — this is intentional: if no widget is subscribed, we skip updating deltas too, which means the first emission after resubscription may show an inflated delta. This is acceptable for Phase 5b. (Fix: always update `prev_net` even when skipped — see the note at the end of this step.)

Actually, update `prev_net` unconditionally to keep deltas accurate even when no one is listening. Revise the network block:

```rust
// Always track prev_net for accurate deltas on next subscribe
for (name, data) in networks.iter() {
    prev_net.insert(name.to_string(), (data.total_received(), data.total_transmitted()));
}

// --- Network ---
if has_subscribers(&state.metric_subscriptions, "network") {
    let net_payload: Vec<serde_json::Value> = networks.iter().map(|(name, data)| {
        let total_rx = data.total_received();
        let total_tx = data.total_transmitted();
        let (prev_rx, prev_tx) = prev_net.get(name.as_str()).copied().unwrap_or((total_rx, total_tx));
        serde_json::json!({
            "name":               name,
            "received":           total_rx.saturating_sub(prev_rx),
            "transmitted":        total_tx.saturating_sub(prev_tx),
            "total_received":     total_rx,
            "total_transmitted":  total_tx,
        })
    }).collect();
    let _ = app.emit("system:network", &net_payload);
}
```

Similarly for disk-io on Linux, update `prev_disk` unconditionally:

```rust
// Always read disk-io counters for accurate deltas
#[cfg(target_os = "linux")]
let (td_r_cur, td_w_cur, now_disk) = {
    let (td_r, td_w) = read_disk_io_linux();
    let now = Instant::now();
    (td_r, td_w, now)
};

// --- Disk I/O ---
if has_subscribers(&state.metric_subscriptions, "disk-io") {
    #[cfg(target_os = "linux")]
    {
        let el = now_disk.duration_since(prev_disk.2).as_secs_f32();
        let disk_io = if el > 0.0 {
            DiskIoInfo {
                read:  Some((td_r_cur.saturating_sub(prev_disk.0) as f32 / el) as u64),
                write: Some((td_w_cur.saturating_sub(prev_disk.1) as f32 / el) as u64),
            }
        } else {
            DiskIoInfo { read: Some(0), write: Some(0) }
        };
        let _ = app.emit("system:disk-io", &disk_io);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let disk_io = DiskIoInfo { read: None, write: None };
        let _ = app.emit("system:disk-io", &disk_io);
    }
}

#[cfg(target_os = "linux")]
{ prev_disk = (td_r_cur, td_w_cur, now_disk); }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd flux/app/src-tauri && cargo test -- broadcaster::tests 2>&1 | tail -20
```

Expected: all 7 broadcaster tests pass.

Also confirm the build compiles:
```bash
cd flux/app/src-tauri && cargo build 2>&1 | grep "^error" | head -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd flux/app/src-tauri && git add src/broadcaster.rs
git commit -m "feat(broadcaster): add subscription guards — skip collection for unsubscribed categories"
```

---

## Task 4: `broadcaster.rs` — Visibility Throttling

**Files:**
- Modify: `flux/app/src-tauri/src/broadcaster.rs`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `broadcaster.rs`:

```rust
#[test]
fn hidden_throttle_ticks_constant_is_five() {
    assert_eq!(HIDDEN_THROTTLE_TICKS, 5);
}

#[test]
fn compute_effective_ms_battery_saver_off() {
    assert_eq!(compute_effective_ms(false, true,  5000, 2000), 2000);
    assert_eq!(compute_effective_ms(false, false, 5000, 2000), 2000);
}

#[test]
fn compute_effective_ms_battery_saver_on_discharging() {
    assert_eq!(compute_effective_ms(true, true, 5000, 2000), 5000);
}

#[test]
fn compute_effective_ms_battery_saver_on_charging() {
    assert_eq!(compute_effective_ms(true, false, 5000, 2000), 2000);
}
```

(Note: `compute_effective_ms` is added in Task 5 Step 3. Include it here anyway — the test module accumulates; the tests for Task 5 will be added in Task 5.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd flux/app/src-tauri && cargo test -- broadcaster::tests::hidden_throttle 2>&1 | tail -10
```

Expected: compile error — `HIDDEN_THROTTLE_TICKS` doesn't exist yet.

- [ ] **Step 3: Add the constant and `emit_to_windows` helper**

Add before the `start` function in `broadcaster.rs`:

```rust
/// Hidden widgets receive events every N ticks. At the default 2s interval, this gives ~10s updates.
const HIDDEN_THROTTLE_TICKS: u32 = 5;

/// Emit `event` + `payload` to each active widget window, throttling hidden windows.
/// Visible windows get every event and have their tick counter reset to 0.
/// Hidden windows get an event only every HIDDEN_THROTTLE_TICKS ticks.
fn emit_to_windows(app: &AppHandle, state: &AppState, event: &str, payload: &serde_json::Value) {
    let window_ids: Vec<String> = state.active_modules.lock().unwrap().keys().cloned().collect();
    for id in &window_ids {
        if let Some(win) = app.get_webview_window(id) {
            let visible = win.is_visible().unwrap_or(true);
            if visible {
                state.hidden_widget_ticks.lock().unwrap().insert(id.clone(), 0);
                let _ = win.emit(event, payload);
            } else {
                let mut ticks = state.hidden_widget_ticks.lock().unwrap();
                let count = ticks.entry(id.clone()).or_insert(0);
                *count += 1;
                if *count >= HIDDEN_THROTTLE_TICKS {
                    *count = 0;
                    let _ = win.emit(event, payload);
                }
            }
        }
    }
}
```

- [ ] **Step 4: Replace `app.emit()` calls with `emit_to_windows()`**

For each metric that uses `app.emit()` inside the `has_subscribers` guard, replace with `emit_to_windows`. The non-`serde_json::Value` payloads need to be converted first.

**CPU** (already `serde_json::Value`):
```rust
emit_to_windows(&app, &state, "system:cpu", &cpu_payload);
```

**Memory** (already `serde_json::Value`):
```rust
emit_to_windows(&app, &state, "system:memory", &mem_payload);
```

**Network** (already `Vec<serde_json::Value>`, need to convert):
```rust
let net_val = serde_json::to_value(&net_payload).unwrap_or(serde_json::Value::Null);
emit_to_windows(&app, &state, "system:network", &net_val);
```

**GPU** (`Option<serde_json::Value>`, need to convert):
```rust
let gpu = collect_gpu(&state.nvml, &mut components);
let gpu_val = serde_json::to_value(&gpu).unwrap_or(serde_json::Value::Null);
emit_to_windows(&app, &state, "system:gpu", &gpu_val);
```

**Disk I/O** (`DiskIoInfo`, need to convert):
```rust
let disk_io_val = serde_json::to_value(&disk_io).unwrap_or(serde_json::Value::Null);
emit_to_windows(&app, &state, "system:disk-io", &disk_io_val);
// (for the non-Linux stub too)
let disk_io_val = serde_json::to_value(&disk_io).unwrap_or(serde_json::Value::Null);
emit_to_windows(&app, &state, "system:disk-io", &disk_io_val);
```

**Disk capacity** (slow tick, `Vec<serde_json::Value>`):
```rust
let disk_val = serde_json::to_value(&disk_payload).unwrap_or(serde_json::Value::Null);
emit_to_windows(&app, &state, "system:disk", &disk_val);
```

**Battery** (slow tick, `Option<BatteryInfo>`):
```rust
let batt = read_battery();
let batt_val = serde_json::to_value(&batt).unwrap_or(serde_json::Value::Null);
emit_to_windows(&app, &state, "system:battery", &batt_val);
```

- [ ] **Step 5: Run tests**

```bash
cd flux/app/src-tauri && cargo test -- broadcaster::tests 2>&1 | tail -20
```

Expected: `hidden_throttle_ticks_constant_is_five ... ok` plus all prior tests pass.

Also:
```bash
cd flux/app/src-tauri && cargo build 2>&1 | grep "^error" | head -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd flux/app/src-tauri && git add src/broadcaster.rs
git commit -m "feat(broadcaster): per-window visibility throttling — hidden widgets update every ~10s"
```

---

## Task 5: `broadcaster.rs` — Battery-Aware Interval

**Files:**
- Modify: `flux/app/src-tauri/src/broadcaster.rs`

- [ ] **Step 1: Write the failing tests**

These were listed in Task 4 Step 1. If already added, skip adding them again and just verify they fail:

```bash
cd flux/app/src-tauri && cargo test -- broadcaster::tests::compute_effective 2>&1 | tail -10
```

Expected: compile error — `compute_effective_ms` doesn't exist yet.

- [ ] **Step 2: Add `compute_effective_ms` helper**

Add before the `start` function:

```rust
/// Resolve the tick sleep interval: uses `battery_interval_ms` when battery saver is
/// active and the device is discharging; otherwise uses `broadcast_interval_ms`.
fn compute_effective_ms(
    battery_saver: bool,
    on_battery: bool,
    battery_interval_ms: u64,
    broadcast_interval_ms: u64,
) -> u64 {
    if battery_saver && on_battery {
        battery_interval_ms
    } else {
        broadcast_interval_ms
    }
}
```

- [ ] **Step 3: Add battery state tracking and effective_ms to the broadcaster loop**

In `pub fn start(app: AppHandle, interval_ms: u64)`, after the existing variable declarations and before `loop {`, add:

```rust
let mut on_battery = false;       // updated each slow tick
let mut effective_ms = fast_ms;   // updated each slow tick; starts at normal rate
```

Inside the slow tick block (where `slow_tick = 0`), BEFORE the disk and battery guards, add:

```rust
// Update battery state and recompute effective interval
let batt_info = read_battery();
on_battery = detect_on_battery(batt_info.as_ref());
{
    let cfg = state.config.lock().unwrap();
    effective_ms = compute_effective_ms(
        cfg.engine.battery_saver,
        on_battery,
        cfg.engine.battery_interval_ms,
        cfg.engine.broadcast_interval_ms,
    );
}
```

**Important:** This reads the battery info for interval computation. The `battery` guard below will call `read_battery()` again if subscribed — that's two reads per slow tick when a battery widget is active. This is acceptable (the read is a cheap `/sys/class/power_supply/` file read on Linux). Alternatively, reuse `batt_info` in the guard:

```rust
// Battery (slow tick)
if has_subscribers(&state.metric_subscriptions, "battery") {
    let batt_val = serde_json::to_value(&batt_info).unwrap_or(serde_json::Value::Null);
    emit_to_windows(&app, &state, "system:battery", &batt_val);
}
```

This reuses the `batt_info` already read for on_battery detection, eliminating the second read.

- [ ] **Step 4: Replace the sleep call to use `effective_ms`**

Find the sleep at the bottom of the loop:

```rust
let elapsed = tick_start.elapsed();
if elapsed < Duration::from_millis(fast_ms) {
    std::thread::sleep(Duration::from_millis(fast_ms) - elapsed);
}
```

Replace `fast_ms` with `effective_ms`:

```rust
let elapsed = tick_start.elapsed();
if elapsed < Duration::from_millis(effective_ms) {
    std::thread::sleep(Duration::from_millis(effective_ms) - elapsed);
}
```

- [ ] **Step 5: Run all broadcaster tests**

```bash
cd flux/app/src-tauri && cargo test -- broadcaster::tests 2>&1 | tail -20
```

Expected: all tests pass including the 4 `compute_effective_ms` tests.

Also:
```bash
cd flux/app/src-tauri && cargo build 2>&1 | grep "^error" | head -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd flux/app/src-tauri && git add src/broadcaster.rs
git commit -m "feat(broadcaster): battery-aware polling interval — slows to 5s on battery"
```

---

## Task 6: `widget-api.js` — Register/Unregister Subscriptions

**Files:**
- Modify: `flux/app/runtime/widget-api.js`

There are no automated tests for this JS file — correctness is verified by building the Tauri app and testing with a widget. The changes are straightforward.

- [ ] **Step 1: Add `_counts` and `_windowId` to the `system` object**

Replace the `const system = { ... }` declaration. The new version adds a `_counts` Map (tracks active listener count per category) and `_windowId` (the window's Tauri label), then modifies `subscribe` to call `register_metric_interest` on first subscribe and `unregister_metric_interest` when count drops to zero.

The full new `system` object:

```js
const system = {
    _counts: new Map(),   // category → active listener count
    _windowId: windowLabel,

    /**
     * Pull (on-demand) system metrics. Each returns a Promise.
     */
    cpu()     { return invoke('system_cpu'); },
    memory()  { return invoke('system_memory'); },
    disk()    { return invoke('system_disk'); },
    network() { return invoke('system_network'); },
    gpu()     { return invoke('system_gpu'); },
    battery() { return invoke('system_battery'); },
    uptime()  { return invoke('system_uptime'); },
    os()      { return invoke('system_os'); },

    /**
     * Subscribe to a pushed metric broadcast event.
     *
     * @param {string} metric - One of: 'cpu', 'memory', 'disk', 'network',
     *                          'gpu', 'disk-io', 'battery'
     * @param {function} callback - Called with the event payload on each update.
     * @returns {function} unlisten - Call to stop listening.
     */
    subscribe(metric, callback) {
      const eventName = `system:${metric}`;

      // First listener for this category — register with Rust broadcaster
      const count = this._counts.get(metric) || 0;
      if (count === 0) {
        invoke('register_metric_interest', {
          windowId: this._windowId,
          categories: [metric],
        }).catch(() => {}); // fire-and-forget
      }
      this._counts.set(metric, count + 1);

      let unlistenFn = null;
      const unlistenPromise = listen(eventName, (event) => {
        callback(event.payload);
      });

      let cancelled = false;
      unlistenPromise.then((fn) => {
        unlistenFn = fn;
        if (cancelled) fn();
      });

      return function unlisten() {
        // Decrement listener count; unregister if last listener
        const newCount = (system._counts.get(metric) || 1) - 1;
        system._counts.set(metric, newCount);
        if (newCount === 0) {
          invoke('unregister_metric_interest', {
            windowId: system._windowId,
            categories: [metric],
          }).catch(() => {}); // fire-and-forget
        }

        if (unlistenFn) {
          unlistenFn();
        } else {
          cancelled = true;
        }
      };
    },
};
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd flux/app && npm run tauri build -- --debug 2>&1 | grep -E "^error|ERROR" | head -20
```

Expected: no errors. (Or run `cargo check` from src-tauri if a full build is slow.)

```bash
cd flux/app/src-tauri && cargo check 2>&1 | grep "^error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add flux/app/runtime/widget-api.js
git commit -m "feat(widget-api): register/unregister metric subscriptions with Rust broadcaster"
```

---

## Task 7: `preferences/` — Performance Section

**Files:**
- Modify: `flux/app/runtime/preferences/index.html`
- Modify: `flux/app/runtime/preferences/app.js`

- [ ] **Step 1: Add the Performance section to `index.html`**

In `flux/app/runtime/preferences/index.html`, add a new section after the existing Advanced section (before `</div>` that closes `prefs-container`):

```html
    <section class="prefs-section">
      <h2 class="section-title">Performance</h2>
      <div class="pref-row">
        <label class="pref-checkbox-label">
          <input type="checkbox" id="battery-saver-check">
          Battery saver (auto)
        </label>
        <p class="section-desc">Reduces polling rate when running on battery.</p>
      </div>
      <div class="pref-row" id="battery-interval-row">
        <label class="pref-label" for="battery-interval-input">Battery polling interval (ms)</label>
        <input type="number" id="battery-interval-input" class="pref-number" min="500" max="60000" step="500">
        <span id="normal-interval-label" class="pref-hint"></span>
      </div>
      <div id="perf-result" class="result-msg" style="display:none;"></div>
    </section>
```

- [ ] **Step 2: Add `loadPerformanceConfig()` and event handlers to `app.js`**

Append to `flux/app/runtime/preferences/app.js`:

```js
async function loadPerformanceConfig() {
    try {
        const cfg = await invoke('get_performance_config');

        const check = document.getElementById('battery-saver-check');
        const intervalInput = document.getElementById('battery-interval-input');
        const intervalRow = document.getElementById('battery-interval-row');
        const normalLabel = document.getElementById('normal-interval-label');

        check.checked = cfg.battery_saver;
        intervalInput.value = cfg.battery_interval_ms;
        normalLabel.textContent = `Normal interval: ${cfg.broadcast_interval_ms} ms`;
        intervalRow.style.opacity = cfg.battery_saver ? '1' : '0.5';
        intervalInput.disabled = !cfg.battery_saver;
    } catch (e) {
        console.error('get_performance_config failed:', e);
    }
}

document.getElementById('battery-saver-check').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const intervalInput = document.getElementById('battery-interval-input');
    const intervalRow = document.getElementById('battery-interval-row');
    const resultEl = document.getElementById('perf-result');
    intervalRow.style.opacity = enabled ? '1' : '0.5';
    intervalInput.disabled = !enabled;
    try {
        await invoke('set_battery_saver', { enabled });
    } catch (err) {
        resultEl.textContent = 'Error: ' + err;
        resultEl.style.display = 'block';
        setTimeout(() => { resultEl.style.display = 'none'; }, 3000);
    }
});

document.getElementById('battery-interval-input').addEventListener('change', async (e) => {
    const ms = parseInt(e.target.value, 10);
    if (isNaN(ms) || ms < 500) { e.target.value = 500; return; }
    const resultEl = document.getElementById('perf-result');
    try {
        await invoke('set_battery_interval', { ms });
    } catch (err) {
        resultEl.textContent = 'Error: ' + err;
        resultEl.style.display = 'block';
        setTimeout(() => { resultEl.style.display = 'none'; }, 3000);
    }
});

loadPerformanceConfig();
```

- [ ] **Step 3: Verify the build compiles**

```bash
cd flux/app/src-tauri && cargo check 2>&1 | grep "^error" | head -10
```

Expected: no errors.

- [ ] **Step 4: Manual smoke-test (optional but recommended)**

Run the app in dev mode, open Preferences from the tray, and verify:
- Performance section is visible
- Battery saver checkbox reflects config value
- Battery interval input is disabled when unchecked
- Toggling the checkbox calls Rust and persists (reopen Preferences to confirm)

- [ ] **Step 5: Commit**

```bash
git add flux/app/runtime/preferences/index.html flux/app/runtime/preferences/app.js
git commit -m "feat(preferences): add Performance section with battery saver controls"
```

---

## Spec Coverage Self-Check

| Spec requirement | Task |
|---|---|
| `battery_saver: bool` + `battery_interval_ms: u64` in `EngineConfig` | Task 1 |
| Default `battery_saver = true`, `battery_interval_ms = 5000` | Task 1 |
| `metric_subscriptions: Mutex<HashMap<String, HashSet<String>>>` in `AppState` | Task 2 |
| `hidden_widget_ticks: Mutex<HashMap<String, u32>>` in `AppState` | Task 2 |
| `register_metric_interest` + `unregister_metric_interest` commands | Task 2 |
| `unregister_all_metric_interest` called on `WindowEvent::CloseRequested` | Task 2 |
| `set_battery_saver`, `set_battery_interval`, `get_performance_config` commands | Task 2 |
| Per-category subscription guard before collection | Task 3 |
| `HIDDEN_THROTTLE_TICKS = 5` constant | Task 4 |
| Per-window emission loop with visibility check | Task 4 |
| Battery state re-evaluated each slow tick | Task 5 |
| `effective_ms` controls sleep interval | Task 5 |
| `widget-api.js` calls `register_metric_interest` on first subscribe | Task 6 |
| `widget-api.js` calls `unregister_metric_interest` when count reaches 0 | Task 6 |
| Preferences Performance section UI | Task 7 |
| `windowId` from `window.__TAURI_INTERNALS__.metadata.currentWindow.label` | ✅ uses `windowLabel` = `appWindow.label` (same source) |
| Desktop with no battery: `battery_saver` has no effect | ✅ `read_battery()` returns `None` on non-Linux → `detect_on_battery(None) = false` |
| No new windows, no new processes | ✅ |
| Backwards-compatible (existing `.fluxwidget` and `window_state.json` unchanged) | ✅ all new fields use `#[serde(default)]` |

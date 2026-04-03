use std::collections::HashMap;
use std::time::{Duration, Instant};
use sysinfo::{System, Networks, Disks, CpuRefreshKind, RefreshKind, Components};
use tauri::{AppHandle, Emitter, Manager};
use nvml_wrapper::Nvml;
use crate::metrics::{read_cpu_temp, read_battery, DiskIoInfo};
use crate::AppState;
#[cfg(target_os = "linux")]
use crate::metrics::read_disk_io_linux;

/// Hidden widgets receive events every N ticks. At the default 2s interval, this gives ~10s updates.
const HIDDEN_THROTTLE_TICKS: u32 = 5;

/// Returns true if at least one window is subscribed to `category`.
/// Acquires and immediately releases the lock.
fn has_subscribers(
    subs: &std::sync::Mutex<HashMap<String, std::collections::HashSet<String>>>,
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

pub fn start(app: AppHandle, interval_ms: u64) {
    std::thread::spawn(move || {
        let fast_ms = interval_ms.max(100); // floor at 100ms to prevent spin loops
        let slow_ticks = (30_000u64 / fast_ms).max(1) as u32;
        let mut sys = System::new_all();
        let mut prev_net: HashMap<String, (u64, u64)> = HashMap::new();
        #[cfg(target_os = "linux")]
        let mut prev_disk: (u64, u64, Instant) = (0, 0, Instant::now());
        let mut slow_tick: u32 = 0;
        let mut networks = Networks::new_with_refreshed_list();
        let mut components = Components::new_with_refreshed_list();
        let mut on_battery = false;     // updated each slow tick
        let mut effective_ms = fast_ms; // updated each slow tick; starts at normal rate

        // Emit OS info once at startup
        let os_payload = serde_json::json!({
            "name":    System::name().unwrap_or_default(),
            "version": System::os_version().unwrap_or_default(),
            "kernel":  System::kernel_version().unwrap_or_default(),
            "arch":    System::cpu_arch(),
        });
        let _ = app.emit("system:os", &os_payload);

        loop {
            let tick_start = Instant::now();

            // Acquire state once per tick
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
                emit_to_windows(&app, &state, "system:cpu", &cpu_payload);
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
                emit_to_windows(&app, &state, "system:memory", &mem_payload);
            }

            // Always update prev_net for accurate deltas on next subscribe
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
                let net_val = serde_json::to_value(&net_payload).unwrap_or(serde_json::Value::Null);
                emit_to_windows(&app, &state, "system:network", &net_val);
            }

            // --- GPU ---
            if has_subscribers(&state.metric_subscriptions, "gpu") {
                let gpu = collect_gpu(&state.nvml, &mut components);
                let gpu_val = serde_json::to_value(&gpu).unwrap_or(serde_json::Value::Null);
                emit_to_windows(&app, &state, "system:gpu", &gpu_val);
            }

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
                    let disk_io_val = serde_json::to_value(&disk_io).unwrap_or(serde_json::Value::Null);
                    emit_to_windows(&app, &state, "system:disk-io", &disk_io_val);
                }
                #[cfg(not(target_os = "linux"))]
                {
                    let disk_io = DiskIoInfo { read: None, write: None };
                    let disk_io_val = serde_json::to_value(&disk_io).unwrap_or(serde_json::Value::Null);
                    emit_to_windows(&app, &state, "system:disk-io", &disk_io_val);
                }
            }

            #[cfg(target_os = "linux")]
            { prev_disk = (td_r_cur, td_w_cur, now_disk); }

            // --- Slow metrics (every 30 s) ---
            slow_tick += 1;
            if slow_tick >= slow_ticks {
                slow_tick = 0;

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
                    let disk_val = serde_json::to_value(&disk_payload).unwrap_or(serde_json::Value::Null);
                    emit_to_windows(&app, &state, "system:disk", &disk_val);
                }

                // Reuse batt_info already read for on_battery detection
                if has_subscribers(&state.metric_subscriptions, "battery") {
                    let batt_val = serde_json::to_value(&batt_info).unwrap_or(serde_json::Value::Null);
                    emit_to_windows(&app, &state, "system:battery", &batt_val);
                }
            }

            // Sleep for remainder of tick — uses battery-aware effective interval
            let elapsed = tick_start.elapsed();
            if elapsed < Duration::from_millis(effective_ms) {
                std::thread::sleep(Duration::from_millis(effective_ms) - elapsed);
            }
        }
    });
}

fn collect_gpu(nvml: &Option<Nvml>, components: &mut Components) -> Option<serde_json::Value> {
    use std::fs;

    // NVIDIA
    if let Some(nvml) = nvml {
        if let Ok(device) = nvml.device_by_index(0) {
            let mem  = device.memory_info().ok();
            let temp = device.temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu).ok();
            let util = device.utilization_rates().ok().map(|u| u.gpu).unwrap_or(0);
            return Some(serde_json::json!({
                "usage": util,
                "vram_used": mem.as_ref().map(|m| m.used).unwrap_or(0),
                "vram_total": mem.as_ref().map(|m| m.total).unwrap_or(0),
                "vram_percentage": mem.as_ref().map(|m| (m.used as f32 / m.total as f32) * 100.0).unwrap_or(0.0f32),
                "temp": temp.map(|t| t as f32).unwrap_or(0.0f32),
            }));
        }
    }

    // AMD sysfs (Linux only)
    #[cfg(target_os = "linux")]
    {
        let gpu_temp = components.iter()
            .filter(|c| { let l = c.label().to_lowercase(); l.contains("gpu") || l.contains("amdgpu") })
            .filter_map(|c| c.temperature())
            .reduce(f32::max)
            .unwrap_or(0.0);

        let mut best_card: Option<usize> = None;
        let mut best_vram = (0u64, 0u64);
        for i in 0..5 {
            let base = format!("/sys/class/drm/card{}/device", i);
            if let (Ok(t), Ok(u)) = (
                fs::read_to_string(format!("{}/mem_info_vram_total", base)),
                fs::read_to_string(format!("{}/mem_info_vram_used",  base)),
            ) {
                let total: u64 = t.trim().parse().unwrap_or(0);
                let used:  u64 = u.trim().parse().unwrap_or(0);
                if total > best_vram.1 {
                    best_vram = (used, total);
                    best_card = Some(i);
                }
            }
        }
        if let Some(card_idx) = best_card {
            if best_vram.1 > 0 {
                let usage = {
                    let p = format!("/sys/class/drm/card{}/device/gpu_busy_percent", card_idx);
                    fs::read_to_string(&p).ok()
                        .and_then(|s| s.trim().parse::<u32>().ok())
                        .unwrap_or(0)
                };
                return Some(serde_json::json!({
                    "usage": usage,
                    "vram_used": best_vram.0,
                    "vram_total": best_vram.1,
                    "vram_percentage": (best_vram.0 as f32 / best_vram.1 as f32) * 100.0,
                    "temp": gpu_temp,
                }));
            }
        }
    }

    None
}

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
}

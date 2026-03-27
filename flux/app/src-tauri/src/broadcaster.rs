use std::collections::HashMap;
use std::time::{Duration, Instant};
use sysinfo::{System, Networks, Disks, CpuRefreshKind, RefreshKind, Components};
use tauri::{AppHandle, Emitter, Manager};
use nvml_wrapper::Nvml;
use crate::metrics::{read_cpu_temp, read_battery, DiskIoInfo};
use crate::AppState;
#[cfg(target_os = "linux")]
use crate::metrics::read_disk_io_linux;

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

            // Refresh persistent state objects in-place
            networks.refresh(false);
            components.refresh(false);

            // --- CPU ---
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

            // --- Memory ---
            sys.refresh_memory();
            let mem_payload = serde_json::json!({
                "total":      sys.total_memory(),
                "used":       sys.used_memory(),
                "available":  sys.available_memory(),
                "swap_total": sys.total_swap(),
                "swap_used":  sys.used_swap(),
            });
            let _ = app.emit("system:memory", &mem_payload);

            // --- Network ---
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

            // --- GPU ---
            let state = app.state::<AppState>();
            let gpu = collect_gpu(&state.nvml, &mut components);
            let _ = app.emit("system:gpu", &gpu);

            // --- Disk I/O (Linux only) ---
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

            // --- Slow metrics (every 30 s) ---
            slow_tick += 1;
            if slow_tick >= slow_ticks {
                slow_tick = 0;

                // Disk capacity
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

                // Battery
                let _ = app.emit("system:battery", &read_battery());
            }

            // Sleep for remainder of 2 s tick
            let elapsed = tick_start.elapsed();
            if elapsed < Duration::from_millis(fast_ms) {
                std::thread::sleep(Duration::from_millis(fast_ms) - elapsed);
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

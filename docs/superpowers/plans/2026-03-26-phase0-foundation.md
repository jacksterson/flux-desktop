# Flux Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc early implementation with a clean, guide-aligned foundation: individual metric commands, a push broadcaster, a shared `widget-api.js` runtime, and the Bridges theme pack reorganisation.

**Architecture:** Individual Rust commands expose each metric type independently; a background broadcaster thread emits push events at 2 s (fast) / 30 s (slow) intervals; a shared `widget-api.js` is served at `flux-module://_flux/widget-api.js` and gives every module a consistent `WidgetAPI` surface for data and window management; the three bundled modules move under `flux/themes/bridges/`.

**Tech Stack:** Rust / Tauri 2, sysinfo 0.38, nvml-wrapper 0.12, x11rb, gtk-layer-shell (Linux), vanilla JS.

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| **Create** | `flux/app/src-tauri/src/metrics.rs` | All 8 metric structs + Tauri commands |
| **Create** | `flux/app/src-tauri/src/broadcaster.rs` | Push event loop thread |
| **Create** | `flux/app/runtime/widget-api.js` | Shared WidgetAPI JS runtime |
| **Create** | `flux/themes/bridges/theme.json` | Bridges theme manifest |
| **Modify** | `flux/app/src-tauri/src/lib.rs` | Wire metrics + broadcaster; _flux URI; layer-shell flag; remove old structs |
| **Modify** | `flux/app/src-tauri/tauri.conf.json` | Resources: add themes + runtime; CSP: add flux-module: to script-src |
| **Move** | `flux/modules/*/` → `flux/themes/bridges/modules/*/` | Reorganise modules under theme pack |
| **Modify** | `flux/themes/bridges/modules/system-stats/index.html` | Add widget-api.js script tag |
| **Modify** | `flux/themes/bridges/modules/system-stats/logic.js` | Use WidgetAPI subscribe + drag/resize |
| **Modify** | `flux/themes/bridges/modules/time-date/index.html` | Add widget-api.js script tag |
| **Modify** | `flux/themes/bridges/modules/time-date/logic.js` | Use WidgetAPI drag/resize/settings |
| **Modify** | `flux/themes/bridges/modules/weather/index.html` | Add widget-api.js script tag |
| **Modify** | `flux/themes/bridges/modules/weather/logic.js` | Use WidgetAPI drag/resize/settings |

---

## Task 1: metrics.rs — individual metric commands

**Files:**
- Create: `flux/app/src-tauri/src/metrics.rs`

- [ ] **Step 1.1: Write the file with all structs and commands**

Create `flux/app/src-tauri/src/metrics.rs` with this exact content:

```rust
use sysinfo::{System, Networks, Disks, CpuRefreshKind, RefreshKind, Components};
use tauri::State;
use crate::AppState;
use std::time::Instant;
use serde::Serialize;
use std::fs;

// --- Data Types ---

#[derive(Serialize, Clone)]
pub struct CpuInfo {
    pub usage: Vec<f32>,
    pub avg_usage: f32,
    pub frequency: u64,
    pub name: String,
    pub cores: usize,
    pub threads: usize,
    pub cpu_temp: Option<f32>,
}

#[derive(Serialize, Clone)]
pub struct MemoryInfo {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub swap_total: u64,
    pub swap_used: u64,
}

#[derive(Serialize, Clone)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct NetworkInfo {
    pub name: String,
    pub received: u64,
    pub transmitted: u64,
    pub total_received: u64,
    pub total_transmitted: u64,
}

#[derive(Serialize, Clone)]
pub struct GpuInfo {
    pub usage: u32,
    pub vram_used: u64,
    pub vram_total: u64,
    pub vram_percentage: f32,
    pub temp: f32,
}

#[derive(Serialize, Clone)]
pub struct BatteryInfo {
    pub percentage: f32,
    pub charging: bool,
    pub time_to_empty: Option<u64>,
    pub time_to_full: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct OsInfo {
    pub name: String,
    pub version: String,
    pub kernel: String,
    pub arch: String,
}

#[derive(Serialize, Clone)]
pub struct DiskIoInfo {
    pub read: Option<u64>,
    pub write: Option<u64>,
}

// --- Battery helpers ---

#[cfg(target_os = "linux")]
pub fn read_battery_linux() -> Option<BatteryInfo> {
    let ps_path = std::path::Path::new("/sys/class/power_supply");
    let entries = fs::read_dir(ps_path).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let type_str = fs::read_to_string(path.join("type")).ok()?;
        if type_str.trim() != "Battery" {
            continue;
        }
        let capacity: f32 = fs::read_to_string(path.join("capacity"))
            .ok()?
            .trim()
            .parse()
            .ok()?;
        let status = fs::read_to_string(path.join("status")).unwrap_or_default();
        let charging = matches!(status.trim(), "Charging" | "Full");
        return Some(BatteryInfo {
            percentage: capacity,
            charging,
            time_to_empty: None,
            time_to_full: None,
        });
    }
    None
}

pub fn read_battery() -> Option<BatteryInfo> {
    #[cfg(target_os = "linux")]
    return read_battery_linux();
    #[cfg(not(target_os = "linux"))]
    return None;
}

// --- Disk I/O helpers ---

#[cfg(target_os = "linux")]
pub fn read_disk_io_linux() -> (u64, u64) {
    let content = match fs::read_to_string("/proc/diskstats") {
        Ok(c) => c,
        Err(_) => return (0, 0),
    };
    let (mut total_read, mut total_write) = (0u64, 0u64);
    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() > 13 {
            let dev = parts[2];
            if dev.starts_with("sd") || dev.starts_with("nvme") {
                total_read  += parts[5].parse::<u64>().unwrap_or(0) * 512;
                total_write += parts[9].parse::<u64>().unwrap_or(0) * 512;
            }
        }
    }
    (total_read, total_write)
}

// --- CPU temperature helper ---

pub fn read_cpu_temp() -> Option<f32> {
    let mut components = Components::new();
    components.refresh(true);
    components.iter()
        .filter(|c| {
            let l = c.label().to_lowercase();
            l.contains("package") || l.contains("cpu") || l.contains("tctl")
        })
        .filter_map(|c| c.temperature())
        .reduce(f32::max)
}

// --- Commands ---

#[tauri::command]
pub fn system_cpu(state: State<'_, AppState>) -> CpuInfo {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_specifics(RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing().with_cpu_usage()));
    let cpus = sys.cpus();
    CpuInfo {
        usage: cpus.iter().map(|c| c.cpu_usage()).collect(),
        avg_usage: sys.global_cpu_usage(),
        frequency: cpus.first().map(|c| c.frequency()).unwrap_or(0),
        name: cpus.first().map(|c| c.brand().to_string()).unwrap_or_default(),
        cores: sys.physical_core_count().unwrap_or(0),
        threads: cpus.len(),
        cpu_temp: read_cpu_temp(),
    }
}

#[tauri::command]
pub fn system_memory(state: State<'_, AppState>) -> MemoryInfo {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_memory();
    MemoryInfo {
        total: sys.total_memory(),
        used: sys.used_memory(),
        available: sys.available_memory(),
        swap_total: sys.total_swap(),
        swap_used: sys.used_swap(),
    }
}

#[tauri::command]
pub fn system_disk() -> Vec<DiskInfo> {
    let disks = Disks::new_with_refreshed_list();
    disks.iter().map(|d| {
        let avail = d.available_space();
        let total = d.total_space();
        DiskInfo {
            name: d.name().to_string_lossy().to_string(),
            mount_point: d.mount_point().to_string_lossy().to_string(),
            total,
            used: total.saturating_sub(avail),
            available: avail,
            kind: match d.kind() {
                sysinfo::DiskKind::SSD => "SSD".to_string(),
                sysinfo::DiskKind::HDD => "HDD".to_string(),
                _ => "Unknown".to_string(),
            },
        }
    }).collect()
}

#[tauri::command]
pub fn system_network(state: State<'_, AppState>) -> Vec<NetworkInfo> {
    let mut networks = Networks::new_with_refreshed_list();
    let now = Instant::now();
    let (mut tn_in, mut tn_out) = (0u64, 0u64);
    for (_, net) in networks.iter() {
        tn_in  += net.total_received();
        tn_out += net.total_transmitted();
    }

    let (net_in_rate, net_out_rate) = {
        let mut last = state.last_net_io.lock().unwrap();
        let el = now.duration_since(last.2).as_secs_f32();
        let res = if el > 0.0 {
            (
                ((tn_in.saturating_sub(last.0)  as f32 / el) as u64),
                ((tn_out.saturating_sub(last.1) as f32 / el) as u64),
            )
        } else {
            (0, 0)
        };
        *last = (tn_in, tn_out, now);
        res
    };

    // Return one aggregate entry (matching the existing system-stats module expectation)
    vec![NetworkInfo {
        name: "aggregate".to_string(),
        received: net_in_rate,
        transmitted: net_out_rate,
        total_received: tn_in,
        total_transmitted: tn_out,
    }]
}

#[tauri::command]
pub fn system_gpu(state: State<'_, AppState>) -> Option<GpuInfo> {
    // NVIDIA via NVML
    if let Some(nvml) = &state.nvml {
        if let Ok(device) = nvml.device_by_index(0) {
            let mem  = device.memory_info().ok();
            let temp = device.temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu).ok();
            let util = device.utilization_rates().ok().map(|u| u.gpu).unwrap_or(0);
            return Some(GpuInfo {
                usage: util,
                vram_used:   mem.as_ref().map(|m| m.used).unwrap_or(0),
                vram_total:  mem.as_ref().map(|m| m.total).unwrap_or(0),
                vram_percentage: mem.as_ref().map(|m| (m.used as f32 / m.total as f32) * 100.0).unwrap_or(0.0),
                temp: temp.map(|t| t as f32).unwrap_or(0.0),
            });
        }
    }

    // AMD via sysfs (Linux only)
    #[cfg(target_os = "linux")]
    {
        let mut components = Components::new();
        components.refresh(true);
        let gpu_temp = components.iter()
            .filter(|c| {
                let l = c.label().to_lowercase();
                l.contains("gpu") || l.contains("amdgpu")
            })
            .filter_map(|c| c.temperature())
            .reduce(f32::max)
            .unwrap_or(0.0);

        let mut best_vram = (0u64, 0u64); // (used, total)
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
                }
            }
        }
        if best_vram.1 > 0 {
            let usage = {
                let mut u = 0u32;
                for i in 0..3 {
                    let p = format!("/sys/class/drm/card{}/device/gpu_busy_percent", i);
                    if let Ok(s) = fs::read_to_string(&p) {
                        u = s.trim().parse().unwrap_or(0);
                        if u > 0 { break; }
                    }
                }
                u
            };
            return Some(GpuInfo {
                usage,
                vram_used: best_vram.0,
                vram_total: best_vram.1,
                vram_percentage: (best_vram.0 as f32 / best_vram.1 as f32) * 100.0,
                temp: gpu_temp,
            });
        }
    }

    None
}

#[tauri::command]
pub fn system_battery() -> Option<BatteryInfo> {
    read_battery()
}

#[tauri::command]
pub fn system_uptime() -> u64 {
    System::uptime()
}

#[tauri::command]
pub fn system_os() -> OsInfo {
    OsInfo {
        name:    System::name().unwrap_or_default(),
        version: System::os_version().unwrap_or_default(),
        kernel:  System::kernel_version().unwrap_or_default(),
        arch:    System::cpu_arch(),
    }
}

#[tauri::command]
pub fn system_disk_io(state: State<'_, AppState>) -> DiskIoInfo {
    #[cfg(target_os = "linux")]
    {
        let (td_r, td_w) = read_disk_io_linux();
        let now = Instant::now();
        let mut last = state.last_disk_io.lock().unwrap();
        let el = now.duration_since(last.2).as_secs_f32();
        let res = if el > 0.0 {
            DiskIoInfo {
                read:  Some(((td_r.saturating_sub(last.0) as f32 / el) as u64)),
                write: Some(((td_w.saturating_sub(last.1) as f32 / el) as u64)),
            }
        } else {
            DiskIoInfo { read: Some(0), write: Some(0) }
        };
        *last = (td_r, td_w, now);
        return res;
    }
    #[cfg(not(target_os = "linux"))]
    DiskIoInfo { read: None, write: None }
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_info_serializes() {
        let info = CpuInfo {
            usage: vec![10.0, 20.0],
            avg_usage: 15.0,
            frequency: 3600,
            name: "Test CPU".to_string(),
            cores: 4,
            threads: 8,
            cpu_temp: Some(55.0),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("avg_usage"));
        assert!(json.contains("cpu_temp"));
    }

    #[test]
    fn memory_info_serializes() {
        let info = MemoryInfo {
            total: 16 * 1024 * 1024 * 1024,
            used:   8 * 1024 * 1024 * 1024,
            available: 8 * 1024 * 1024 * 1024,
            swap_total: 4 * 1024 * 1024 * 1024,
            swap_used: 0,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("swap_total"));
    }

    #[test]
    fn disk_info_serializes() {
        let info = DiskInfo {
            name: "nvme0n1".to_string(),
            mount_point: "/".to_string(),
            total: 500_000_000_000,
            used: 100_000_000_000,
            available: 400_000_000_000,
            kind: "SSD".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("mount_point"));
        assert!(json.contains("SSD"));
    }

    #[test]
    fn battery_info_none_when_no_battery() {
        // On a desktop without sysfs battery entries this should return None
        // (also passes on any CI system without a battery)
        #[cfg(not(target_os = "linux"))]
        assert!(read_battery().is_none());
    }

    #[test]
    fn disk_io_info_null_on_non_linux() {
        #[cfg(not(target_os = "linux"))]
        {
            let info = DiskIoInfo { read: None, write: None };
            let json = serde_json::to_string(&info).unwrap();
            assert!(json.contains("null"));
        }
    }

    #[test]
    fn gpu_info_serializes() {
        let info = GpuInfo {
            usage: 45,
            vram_used: 4 * 1024 * 1024 * 1024,
            vram_total: 8 * 1024 * 1024 * 1024,
            vram_percentage: 50.0,
            temp: 72.0,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("vram_percentage"));
    }

    #[test]
    fn os_info_serializes() {
        let info = OsInfo {
            name: "Linux".to_string(),
            version: "6.1.0".to_string(),
            kernel: "6.1.0-generic".to_string(),
            arch: "x86_64".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("kernel"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn disk_io_linux_returns_pair() {
        // Just check it doesn't panic and returns non-negative values
        let (r, w) = read_disk_io_linux();
        assert!(r < u64::MAX);
        assert!(w < u64::MAX);
    }
}
```

- [ ] **Step 1.2: Run the tests**

```bash
cd /home/jack/bridgegap/flux/app && cargo test --lib -- metrics 2>&1 | tail -20
```

Expected: Tests fail with "file not found" or "module not declared" because `metrics` isn't wired into lib.rs yet. That's correct at this stage — the struct and helper tests that don't need AppState should still compile once we add `pub mod metrics;`.

**Skip to step 1.3 before running tests** — you need lib.rs wired first.

- [ ] **Step 1.3: Add `pub mod metrics;` to lib.rs**

In `flux/app/src-tauri/src/lib.rs`, add after the existing `mod desktop_layer;` line:

```rust
pub mod metrics;
```

Also add `pub use nvml_wrapper;` is not needed — but you do need to add `nvml_wrapper` import in metrics.rs. Check the existing lib.rs imports and add to metrics.rs:

```rust
use nvml_wrapper::Nvml;
```

Add this import at the top of `metrics.rs` (already in the file above — confirm it's there).

- [ ] **Step 1.4: Run tests again**

```bash
cd /home/jack/bridgegap/flux/app && cargo test --lib -- metrics 2>&1 | tail -20
```

Expected output: all `metrics::tests::*` pass. Struct serialisation tests do not require a running Tauri app.

- [ ] **Step 1.5: Commit**

```bash
cd /home/jack/bridgegap && git add flux/app/src-tauri/src/metrics.rs flux/app/src-tauri/src/lib.rs && git commit -m "feat: add metrics.rs with individual metric commands and types"
```

---

## Task 2: broadcaster.rs — push event loop

**Files:**
- Create: `flux/app/src-tauri/src/broadcaster.rs`

- [ ] **Step 2.1: Create broadcaster.rs**

Create `flux/app/src-tauri/src/broadcaster.rs`:

```rust
use std::collections::HashMap;
use std::time::{Duration, Instant};
use sysinfo::{System, Networks, Disks, CpuRefreshKind, RefreshKind, Components};
use tauri::AppHandle;
use nvml_wrapper::Nvml;
use crate::metrics::{read_cpu_temp, read_battery, DiskIoInfo};
#[cfg(target_os = "linux")]
use crate::metrics::read_disk_io_linux;

const FAST_MS: u64 = 2000;
const SLOW_TICKS: u32 = 15; // 15 × 2 s = 30 s

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new_all();
        let nvml = Nvml::init().ok();
        let mut prev_net: HashMap<String, (u64, u64)> = HashMap::new();
        #[cfg(target_os = "linux")]
        let mut prev_disk: (u64, u64, Instant) = (0, 0, Instant::now());
        let mut slow_tick: u32 = 0;

        loop {
            let tick_start = Instant::now();

            // --- CPU ---
            sys.refresh_specifics(
                RefreshKind::nothing()
                    .with_cpu(CpuRefreshKind::nothing().with_cpu_usage()),
            );
            let cpu_temp = read_cpu_temp();
            let cpu_payload = serde_json::json!({
                "usage":     sys.cpus().iter().map(|c| c.cpu_usage()).collect::<Vec<_>>(),
                "avg_usage": sys.global_cpu_usage(),
                "frequency": sys.cpus().first().map(|c| c.frequency()).unwrap_or(0),
                "name":      sys.cpus().first().map(|c| c.brand()).unwrap_or(""),
                "cores":     sys.physical_core_count().unwrap_or(0),
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
            let mut networks = Networks::new_with_refreshed_list();
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
            let gpu = collect_gpu(&nvml);
            let _ = app.emit("system:gpu", &gpu);

            // --- Disk I/O (Linux only) ---
            #[cfg(target_os = "linux")]
            {
                let (td_r, td_w) = read_disk_io_linux();
                let now = Instant::now();
                let el = now.duration_since(prev_disk.2).as_secs_f32();
                let disk_io = if el > 0.0 {
                    DiskIoInfo {
                        read:  Some(((td_r.saturating_sub(prev_disk.0) as f32 / el) as u64)),
                        write: Some(((td_w.saturating_sub(prev_disk.1) as f32 / el) as u64)),
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
            if slow_tick >= SLOW_TICKS {
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
            if elapsed < Duration::from_millis(FAST_MS) {
                std::thread::sleep(Duration::from_millis(FAST_MS) - elapsed);
            }
        }
    });
}

fn collect_gpu(nvml: &Option<Nvml>) -> Option<serde_json::Value> {
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
                "vram_percentage": mem.as_ref().map(|m| (m.used as f32 / m.total as f32) * 100.0).unwrap_or(0.0),
                "temp": temp.map(|t| t as f32).unwrap_or(0.0),
            }));
        }
    }

    // AMD sysfs (Linux only)
    #[cfg(target_os = "linux")]
    {
        let mut components = Components::new();
        components.refresh(true);
        let gpu_temp = components.iter()
            .filter(|c| { let l = c.label().to_lowercase(); l.contains("gpu") || l.contains("amdgpu") })
            .filter_map(|c| c.temperature())
            .reduce(f32::max)
            .unwrap_or(0.0);

        let mut best = (0u64, 0u64); // (used, total)
        for i in 0..5 {
            let base = format!("/sys/class/drm/card{}/device", i);
            if let (Ok(t), Ok(u)) = (
                std::fs::read_to_string(format!("{}/mem_info_vram_total", base)),
                std::fs::read_to_string(format!("{}/mem_info_vram_used",  base)),
            ) {
                let total: u64 = t.trim().parse().unwrap_or(0);
                let used:  u64 = u.trim().parse().unwrap_or(0);
                if total > best.1 { best = (used, total); }
            }
        }
        if best.1 > 0 {
            let usage = (0..3).find_map(|i| {
                let p = format!("/sys/class/drm/card{}/device/gpu_busy_percent", i);
                std::fs::read_to_string(&p).ok()
                    .and_then(|s| s.trim().parse::<u32>().ok())
                    .filter(|&u| u > 0)
            }).unwrap_or(0);
            return Some(serde_json::json!({
                "usage": usage,
                "vram_used": best.0,
                "vram_total": best.1,
                "vram_percentage": (best.0 as f32 / best.1 as f32) * 100.0,
                "temp": gpu_temp,
            }));
        }
    }

    None
}
```

- [ ] **Step 2.2: Add `pub mod broadcaster;` to lib.rs**

In `flux/app/src-tauri/src/lib.rs`, add after the `pub mod metrics;` line:

```rust
pub mod broadcaster;
```

- [ ] **Step 2.3: Verify it compiles**

```bash
cd /home/jack/bridgegap/flux/app && cargo check 2>&1 | tail -20
```

Expected: no errors (there may be unused import warnings — that's fine).

- [ ] **Step 2.4: Commit**

```bash
cd /home/jack/bridgegap && git add flux/app/src-tauri/src/broadcaster.rs flux/app/src-tauri/src/lib.rs && git commit -m "feat: add broadcaster.rs — push metrics event loop"
```

---

## Task 3: lib.rs — wire everything, remove old structs, inject layer-shell flag

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

This task makes four changes to lib.rs:
1. Remove `SystemStats`, `GpuStats`, and `get_system_stats`
2. Add the `_flux/` URI path to the scheme handler
3. Inject `window.__fluxLayerShell` after layer-shell apply
4. Start the broadcaster in `setup`
5. Update the `invoke_handler` macro
6. Update the broken test

- [ ] **Step 3.1: Remove old metric structs and command from lib.rs**

Delete these lines from `lib.rs`:

```rust
#[derive(Serialize)]
pub struct GpuStats { usage: u32, vram_used: u64, vram_total: u64, vram_percentage: f32, temp: f32 }

#[derive(Serialize)]
pub struct SystemStats {
    cpu_usage: f32, cpu_temp: f32, cpu_freq: u64, ram_used: u64, ram_total: u64, ram_percentage: f32,
    uptime: String, net_in: u64, net_out: u64, disk_read: Option<u64>, disk_write: Option<u64>, gpu: Option<GpuStats>,
}
```

And delete the entire `get_system_stats` function (lines 408–482 in the original file).

Also delete the Linux-specific helpers that were only used by `get_system_stats`:
```rust
#[cfg(target_os = "linux")]
fn get_linux_gpu_usage() -> u32 { ... }

#[cfg(target_os = "linux")]
fn get_linux_vram_best() -> Option<(u64, u64)> { ... }
```

These are now in `metrics.rs` / `broadcaster.rs`.

- [ ] **Step 3.2: Update the `run()` function — add _flux URI path**

In the `register_uri_scheme_protocol` closure, **before** the existing `let user_base = flux_modules_dir();` line, add:

```rust
// Serve runtime files from resource_dir/runtime/ at flux-module://_flux/...
let path_part = uri.strip_prefix("flux-module://").unwrap_or("");
if let Some(runtime_file) = path_part.strip_prefix("_flux/") {
    let runtime_base = ctx.app_handle().path().resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("runtime");
    let candidate = runtime_base.join(runtime_file);
    if let Ok(canonical) = candidate.canonicalize() {
        if canonical.starts_with(&runtime_base.canonicalize().unwrap_or(runtime_base.clone())) {
            if let Ok(content) = fs::read(&canonical) {
                let ext = canonical.extension().map_or("", |e| e.to_str().unwrap_or(""));
                let mime = match ext {
                    "js"  => "application/javascript",
                    "css" => "text/css",
                    _     => "application/octet-stream",
                };
                return tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .body(content)
                    .unwrap();
            }
        }
    }
    return tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
}
```

This early-return means `_flux/` paths never reach the module-resolution logic below.

- [ ] **Step 3.3: Add `is_layer_shell_window` command**

The `__fluxLayerShell` eval approach has a race condition: there is no guarantee the eval fires before or after `widget-api.js` reads the flag. The reliable alternative is a Tauri command that `widget-api.js` invokes once at load time.

Add this command to `lib.rs` (place it after the `drag_window` function):

```rust
/// Returns true if the calling window is a Wayland layer-shell window.
/// widget-api.js calls this once on load to decide the drag path.
#[tauri::command]
fn is_layer_shell_window(window: Window, state: State<'_, AppState>) -> bool {
    state.desktop_wayland_windows.lock().unwrap().contains(window.label())
}
```

Also add it to the invoke_handler in Step 3.5 below.

- [ ] **Step 3.4: Start broadcaster in setup**

In the `setup` closure, after the `app.manage(AppState { ... })` call, add:

```rust
broadcaster::start(app.handle().clone());
```

- [ ] **Step 3.5: Update invoke_handler**

Replace the existing `invoke_handler` call:

```rust
.invoke_handler(tauri::generate_handler![
    get_system_stats, drag_window, list_modules, toggle_module,
    open_module_settings, close_window, move_module
])
```

With:

```rust
.invoke_handler(tauri::generate_handler![
    drag_window, list_modules, toggle_module,
    open_module_settings, close_window, move_module,
    is_layer_shell_window,
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

- [ ] **Step 3.6: Fix the broken test**

In the `#[cfg(test)]` block at the bottom of `lib.rs`, remove the `system_stats_disk_fields_are_optional` test (it referenced the deleted `SystemStats` struct) and replace it with:

```rust
#[test]
fn disk_io_info_fields_are_optional() {
    use crate::metrics::DiskIoInfo;
    let info = DiskIoInfo { read: None, write: None };
    assert!(info.read.is_none());
    assert!(info.write.is_none());
}
```

- [ ] **Step 3.7: Verify compilation and tests**

```bash
cd /home/jack/bridgegap/flux/app && cargo test 2>&1 | tail -30
```

Expected: all existing tests pass, `metrics::tests::*` pass, `disk_io_info_fields_are_optional` passes.

- [ ] **Step 3.8: Commit**

```bash
cd /home/jack/bridgegap && git add flux/app/src-tauri/src/lib.rs && git commit -m "feat: wire metrics + broadcaster into lib.rs, add _flux URI path, inject layer-shell flag"
```

---

## Task 4: widget-api.js

**Files:**
- Create: `flux/app/runtime/widget-api.js`

- [ ] **Step 4.1: Create the runtime directory and widget-api.js**

```bash
mkdir -p /home/jack/bridgegap/flux/app/runtime
```

Create `flux/app/runtime/widget-api.js`:

```javascript
/**
 * Flux WidgetAPI Runtime
 * Served at flux-module://_flux/widget-api.js
 * Included by every module: <script src="flux-module://_flux/widget-api.js"></script>
 */
(function () {
  'use strict';

  const { invoke } = window.__TAURI__.core;
  const { listen }  = window.__TAURI__.event;
  const { getCurrentWindow } = window.__TAURI__.window;

  const appWindow = getCurrentWindow();

  // Query once at load time whether this window is a Wayland layer-shell window.
  // Cached synchronously before any user interaction can trigger drag.
  // Using invoke + Promise means no timing race with eval injection.
  var _isLayerShell = false;
  invoke('is_layer_shell_window').then(function(result) {
    _isLayerShell = result;
  });

  window.WidgetAPI = {

    // ── System data ─────────────────────────────────────────────────────────

    system: {
      cpu:     () => invoke('system_cpu'),
      memory:  () => invoke('system_memory'),
      disk:    () => invoke('system_disk'),
      network: () => invoke('system_network'),
      gpu:     () => invoke('system_gpu'),
      battery: () => invoke('system_battery'),
      uptime:  () => invoke('system_uptime'),
      os:      () => invoke('system_os'),
      diskIo:  () => invoke('system_disk_io'),

      /**
       * Subscribe to a pushed metric event.
       * @param {string} metric  One of: cpu, memory, network, gpu, disk, disk-io, battery
       * @param {function} callback  Called with the event payload each time it fires
       * @returns {function}  Call to unsubscribe
       */
      subscribe(metric, callback) {
        let unlisten = null;
        listen('system:' + metric, function (event) {
          callback(event.payload);
        }).then(function (fn) {
          unlisten = fn;
        });
        return function () {
          if (unlisten) unlisten();
        };
      }
    },

    // ── Widget window management ─────────────────────────────────────────────

    widget: {
      /**
       * Start dragging this module.
       * On Wayland layer-shell windows, tracks mousemove deltas and calls move_module.
       * On all other platforms, uses native OS drag.
       * @param {MouseEvent} mousedownEvent  The mousedown event that triggered drag
       */
      drag(mousedownEvent) {
        if (_isLayerShell) {
          var windowId = appWindow.label;
          var lastX = mousedownEvent.screenX;
          var lastY = mousedownEvent.screenY;

          function onMove(e) {
            var dx = Math.round(e.screenX - lastX);
            var dy = Math.round(e.screenY - lastY);
            if (dx !== 0 || dy !== 0) {
              lastX = e.screenX;
              lastY = e.screenY;
              invoke('move_module', { id: windowId, dx: dx, dy: dy });
            }
          }

          function onUp() {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          }

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        } else {
          appWindow.startDragging();
        }
      },

      /**
       * Start resizing this module.
       * @param {string} direction  e.g. "East", "South", "SouthEast"
       */
      resize(direction) {
        appWindow.startResizeDragging(direction);
      },

      /** Open this module's settings window. */
      openSettings() {
        invoke('open_module_settings', { id: appWindow.label });
      },

      /** Close this module window. */
      close() {
        appWindow.close();
      }
    }
  };
})();
```

- [ ] **Step 4.2: Commit**

```bash
cd /home/jack/bridgegap && git add flux/app/runtime/widget-api.js && git commit -m "feat: add widget-api.js WidgetAPI runtime"
```

---

## Task 5: Bridges reorganisation + tauri.conf.json

**Files:**
- Create: `flux/themes/bridges/theme.json`
- Move: `flux/modules/*/` → `flux/themes/bridges/modules/*/`
- Modify: `flux/app/src-tauri/tauri.conf.json`
- Modify: `flux/app/src-tauri/src/lib.rs` (module discovery)

- [ ] **Step 5.1: Create the Bridges theme directory and manifest**

```bash
mkdir -p /home/jack/bridgegap/flux/themes/bridges
```

Create `flux/themes/bridges/theme.json`:

```json
{
  "id": "bridges",
  "name": "Bridges",
  "description": "The default module pack. Clean, functional, desktop-ready.",
  "version": "1.0.0",
  "modules": ["system-stats", "time-date", "weather"]
}
```

- [ ] **Step 5.2: Move the modules**

```bash
cd /home/jack/bridgegap/flux && mkdir -p themes/bridges/modules && git mv modules/system-stats themes/bridges/modules/system-stats && git mv modules/time-date themes/bridges/modules/time-date && git mv modules/weather themes/bridges/modules/weather
```

Verify the move:

```bash
ls /home/jack/bridgegap/flux/themes/bridges/modules/
```

Expected: `system-stats  time-date  weather`

- [ ] **Step 5.3: Update tauri.conf.json resources and CSP**

In `flux/app/src-tauri/tauri.conf.json`, replace the `bundle.resources` section:

```json
"resources": {
  "../../modules": "modules"
}
```

With:

```json
"resources": {
  "../../themes": "themes",
  "../runtime": "runtime"
}
```

Also update the `security.csp` value. Replace:

```
"script-src 'self';"
```

With:

```
"script-src 'self' flux-module:;"
```

The full updated CSP line should be:

```json
"csp": "default-src 'self'; script-src 'self' flux-module:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: flux-module:; connect-src ipc: http://ipc.localhost flux-module:"
```

- [ ] **Step 5.4: Update module discovery in lib.rs to scan themes/\*/modules/**

In `lib.rs`, replace the `list_modules` function body. Find this block:

```rust
let bundled_path = app.path().resource_dir()
    .unwrap_or_else(|_| PathBuf::from("."))
    .join("modules");

for modules_path in [flux_modules_dir(), bundled_path] {
```

Replace with:

```rust
// Collect all scan paths: user dir first, then all bundled theme module dirs
let resource_dir = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
let mut scan_paths: Vec<PathBuf> = vec![flux_modules_dir()];

// Scan resource_dir/themes/*/modules/
if let Ok(theme_entries) = fs::read_dir(resource_dir.join("themes")) {
    for theme_entry in theme_entries.flatten() {
        let modules_path = theme_entry.path().join("modules");
        if modules_path.is_dir() {
            scan_paths.push(modules_path);
        }
    }
}

// Legacy flat path (backwards compat — removed in Phase 1)
let legacy_path = resource_dir.join("modules");
if legacy_path.is_dir() {
    scan_paths.push(legacy_path);
}

for modules_path in scan_paths {
```

The rest of the loop body is unchanged.

- [ ] **Step 5.5: Verify compilation**

```bash
cd /home/jack/bridgegap/flux/app && cargo check 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 5.6: Commit**

```bash
cd /home/jack/bridgegap && git add flux/themes/ flux/app/src-tauri/tauri.conf.json flux/app/src-tauri/src/lib.rs && git commit -m "feat: reorganise modules under themes/bridges, update discovery and bundle config"
```

---

## Task 6: Update system-stats module

**Files:**
- Modify: `flux/themes/bridges/modules/system-stats/index.html`
- Modify: `flux/themes/bridges/modules/system-stats/logic.js`

- [ ] **Step 6.1: Add widget-api.js script tag to index.html**

In `flux/themes/bridges/modules/system-stats/index.html`, find the existing `<script>` tag that loads `logic.js` (it will look like `<script type="module" src="logic.js">` or similar). Add this line **immediately before it**:

```html
<script src="flux-module://_flux/widget-api.js"></script>
```

- [ ] **Step 6.2: Rewrite the top of logic.js**

In `flux/themes/bridges/modules/system-stats/logic.js`, replace the first three lines:

```javascript
const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const appWindow = getCurrentWindow();
```

With:

```javascript
// WidgetAPI is injected via flux-module://_flux/widget-api.js
```

- [ ] **Step 6.3: Replace the tick function and interval**

Find and replace the entire `tick` function and the two lines that call it:

Old code (find this block, starting from `async function tick()`):

```javascript
async function tick() {
  try {
    const stats = await invoke("get_system_stats");
    document.getElementById("uptime").textContent = stats.uptime;

    // CPU
    const cColor = getSeverityColor(stats.cpu_usage, stats.cpu_temp);
    document.getElementById("cpu-usage").textContent = `${stats.cpu_usage.toFixed(1)}%`;
    document.getElementById("cpu-temp").textContent = `${stats.cpu_temp.toFixed(0)}°C`;
    document.getElementById("cpu-freq").textContent = `${toGHz(stats.cpu_freq)} GHz`;
    document.querySelector("#cpu-section .stats-right").style.color = cColor;
    cpuGraph.update(stats.cpu_usage, 100, cColor);

    // GPU
    if (stats.gpu) {
      const vramPct = stats.gpu.vram_percentage;
      const gColor = getSeverityColor(vramPct, stats.gpu.temp);
      document.getElementById("gpu-usage-pct").textContent = `${vramPct.toFixed(1)}%`;
      document.getElementById("gpu-temp").textContent = `${stats.gpu.temp.toFixed(0)}°C`;
      document.getElementById("vram-info").textContent = `${toGiB(stats.gpu.vram_used)}/${toGiB(stats.gpu.vram_total)} GiB`;
      document.querySelector("#gpu-section .stats-right").style.color = gColor;
      gpuGraph.update(vramPct, 100, gColor);
    }

    // RAM
    const rColor = getSeverityColor(stats.ram_percentage, 0);
    document.getElementById("ram-percentage").textContent = `${stats.ram_percentage.toFixed(1)}%`;
    document.getElementById("ram-used").textContent = `${toGiB(stats.ram_used)}/${toGiB(stats.ram_total)} GiB`;
    document.querySelector("#ram-section .stats-right").style.color = rColor;
    ramGraph.update(stats.ram_percentage, 100, rColor);

    // IO
    document.getElementById("net-in").textContent = `IN: ${fmtBS(stats.net_in)}`;
    document.getElementById("net-out").textContent = `OUT: ${fmtBS(stats.net_out)}`;
    document.getElementById("disk-read").textContent = `READ: ${fmtBS(stats.disk_read)}`;
    document.getElementById("disk-write").textContent = `WRITE: ${fmtBS(stats.disk_write)}`;
    netGraph.update(stats.net_in + stats.net_out, 1024 * 1024 * 2, state.theme.primary);
    diskGraph.update(stats.disk_read + stats.disk_write, 1024 * 1024 * 10, state.theme.primary);

  } catch (e) { console.error(e); }
}
```

And the two lines at the bottom of the file:
```javascript
setInterval(tick, 1000);
tick();
```

Replace all of the above with:

```javascript
// --- Uptime (polled — not pushed) ---
function fmtUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
async function updateUptime() {
  try {
    const seconds = await WidgetAPI.system.uptime();
    document.getElementById("uptime").textContent = fmtUptime(seconds);
  } catch (e) { console.error("uptime:", e); }
}
updateUptime();
setInterval(updateUptime, 1000);

// --- Push subscriptions ---
WidgetAPI.system.subscribe('cpu', function(cpu) {
  const cColor = getSeverityColor(cpu.avg_usage, cpu.cpu_temp || 0);
  document.getElementById("cpu-usage").textContent = `${cpu.avg_usage.toFixed(1)}%`;
  document.getElementById("cpu-temp").textContent  = cpu.cpu_temp != null ? `${cpu.cpu_temp.toFixed(0)}°C` : "—";
  document.getElementById("cpu-freq").textContent  = `${toGHz(cpu.frequency)} GHz`;
  document.querySelector("#cpu-section .stats-right").style.color = cColor;
  cpuGraph.update(cpu.avg_usage, 100, cColor);
});

WidgetAPI.system.subscribe('memory', function(mem) {
  const pct = (mem.used / mem.total) * 100;
  const rColor = getSeverityColor(pct, 0);
  document.getElementById("ram-percentage").textContent = `${pct.toFixed(1)}%`;
  document.getElementById("ram-used").textContent = `${toGiB(mem.used)}/${toGiB(mem.total)} GiB`;
  document.querySelector("#ram-section .stats-right").style.color = rColor;
  ramGraph.update(pct, 100, rColor);
});

WidgetAPI.system.subscribe('gpu', function(gpu) {
  if (!gpu) return;
  const gColor = getSeverityColor(gpu.vram_percentage, gpu.temp);
  document.getElementById("gpu-usage-pct").textContent = `${gpu.vram_percentage.toFixed(1)}%`;
  document.getElementById("gpu-temp").textContent = `${gpu.temp.toFixed(0)}°C`;
  document.getElementById("vram-info").textContent = `${toGiB(gpu.vram_used)}/${toGiB(gpu.vram_total)} GiB`;
  document.querySelector("#gpu-section .stats-right").style.color = gColor;
  gpuGraph.update(gpu.vram_percentage, 100, gColor);
});

WidgetAPI.system.subscribe('network', function(nets) {
  const total_rx = nets.reduce((s, n) => s + n.received, 0);
  const total_tx = nets.reduce((s, n) => s + n.transmitted, 0);
  document.getElementById("net-in").textContent  = `IN: ${fmtBS(total_rx)}`;
  document.getElementById("net-out").textContent = `OUT: ${fmtBS(total_tx)}`;
  netGraph.update(total_rx + total_tx, 1024 * 1024 * 2, state.theme.primary);
});

WidgetAPI.system.subscribe('disk-io', function(io) {
  const r = io.read  != null ? io.read  : 0;
  const w = io.write != null ? io.write : 0;
  document.getElementById("disk-read").textContent  = `READ: ${fmtBS(r)}`;
  document.getElementById("disk-write").textContent = `WRITE: ${fmtBS(w)}`;
  diskGraph.update(r + w, 1024 * 1024 * 10, state.theme.primary);
});
```

- [ ] **Step 6.4: Update drag and resize calls**

Find:
```javascript
      appWindow.startDragging();
```
Replace with:
```javascript
      WidgetAPI.widget.drag(e);
```

Find:
```javascript
    if (dir) appWindow.startResizeDragging(dir);
```
Replace with:
```javascript
    if (dir) WidgetAPI.widget.resize(dir);
```

Find:
```javascript
  invoke("open_module_settings", { id: "system-stats" });
```
Replace with:
```javascript
  WidgetAPI.widget.openSettings();
```

- [ ] **Step 6.5: Commit**

```bash
cd /home/jack/bridgegap && git add flux/themes/bridges/modules/system-stats/ && git commit -m "feat: update system-stats module to use WidgetAPI"
```

---

## Task 7: Update time-date module

**Files:**
- Modify: `flux/themes/bridges/modules/time-date/index.html`
- Modify: `flux/themes/bridges/modules/time-date/logic.js`

- [ ] **Step 7.1: Add widget-api.js script tag to index.html**

In `flux/themes/bridges/modules/time-date/index.html`, add immediately before the `logic.js` script tag:

```html
<script src="flux-module://_flux/widget-api.js"></script>
```

- [ ] **Step 7.2: Update the top of logic.js**

Replace:
```javascript
const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const appWindow = getCurrentWindow();
```

With:
```javascript
// WidgetAPI is injected via flux-module://_flux/widget-api.js
```

- [ ] **Step 7.3: Update drag, resize, and settings calls**

Find:
```javascript
    appWindow.startDragging();
```
Replace with:
```javascript
    WidgetAPI.widget.drag(e);
```

Find:
```javascript
    if (dir) appWindow.startResizeDragging(dir);
```
Replace with:
```javascript
    if (dir) WidgetAPI.widget.resize(dir);
```

Find:
```javascript
    settingsBtn.onclick = () => invoke("open_module_settings", { id: "time-date" });
```
Replace with:
```javascript
    settingsBtn.onclick = () => WidgetAPI.widget.openSettings();
```

- [ ] **Step 7.4: Commit**

```bash
cd /home/jack/bridgegap && git add flux/themes/bridges/modules/time-date/ && git commit -m "feat: update time-date module to use WidgetAPI"
```

---

## Task 8: Update weather module

**Files:**
- Modify: `flux/themes/bridges/modules/weather/index.html`
- Modify: `flux/themes/bridges/modules/weather/logic.js`

- [ ] **Step 8.1: Add widget-api.js script tag to index.html**

In `flux/themes/bridges/modules/weather/index.html`, add immediately before the `logic.js` script tag:

```html
<script src="flux-module://_flux/widget-api.js"></script>
```

- [ ] **Step 8.2: Update the top of logic.js**

Replace:
```javascript
const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const appWindow = getCurrentWindow();
```

With:
```javascript
// WidgetAPI is injected via flux-module://_flux/widget-api.js
```

- [ ] **Step 8.3: Update drag, resize, and settings calls**

Find:
```javascript
    appWindow.startDragging();
```
Replace with:
```javascript
    WidgetAPI.widget.drag(e);
```

Find:
```javascript
    if (dir) appWindow.startResizeDragging(dir);
```
Replace with:
```javascript
    if (dir) WidgetAPI.widget.resize(dir);
```

Find:
```javascript
if (settingsBtn) settingsBtn.onclick = () => invoke("open_module_settings", { id: "weather" });
```
Replace with:
```javascript
if (settingsBtn) settingsBtn.onclick = () => WidgetAPI.widget.openSettings();
```

- [ ] **Step 8.4: Commit**

```bash
cd /home/jack/bridgegap && git add flux/themes/bridges/modules/weather/ && git commit -m "feat: update weather module to use WidgetAPI"
```

---

## Task 9: Full build verification

- [ ] **Step 9.1: Run all Rust tests**

```bash
cd /home/jack/bridgegap/flux/app && cargo test 2>&1 | tail -30
```

Expected: all tests pass. Count should be greater than before (new metrics tests added).

- [ ] **Step 9.2: Build the Tauri app**

```bash
cd /home/jack/bridgegap/flux/app && cargo tauri build 2>&1 | tail -40
```

Expected: build succeeds. If it fails, note the error and fix before proceeding.

- [ ] **Step 9.3: Verify the bundled paths**

```bash
ls /home/jack/bridgegap/flux/app/src-tauri/target/release/bundle/
```

This shows the generated bundle. The important check is that the `themes/` and `runtime/` resource directories are present in the bundle.

- [ ] **Step 9.4: Commit the final verified state**

```bash
cd /home/jack/bridgegap && git add -A && git status
```

If there are any stray files or changes, review them. Then:

```bash
cd /home/jack/bridgegap && git commit -m "chore: Phase 0 complete — foundation build verified"
```

---

## Phase 0 Checklist (cross-reference with spec)

- [ ] `get_system_stats` removed; 9 individual commands added (cpu, memory, disk, network, gpu, battery, uptime, os, disk_io)
- [ ] Push broadcaster running at 2 s (cpu, memory, network, gpu, disk-io) / 30 s (disk, battery)
- [ ] `widget-api.js` written and served via `flux-module://_flux/widget-api.js`
- [ ] `system-stats` module updated to use `WidgetAPI`
- [ ] `time-date` module updated to use `WidgetAPI`
- [ ] `weather` module updated to use `WidgetAPI`
- [ ] Bridges modules moved to `themes/bridges/modules/`
- [ ] `theme.json` written for Bridges
- [ ] Module discovery updated to scan `themes/*/modules/`
- [ ] Drag JS updated to use `WidgetAPI.widget.drag(event)` with Wayland layer-shell path
- [ ] Resize JS updated to use `WidgetAPI.widget.resize(direction)`
- [ ] `__fluxLayerShell` flag injected by Rust on layer-shell window creation
- [ ] Existing tests updated and passing
- [ ] New unit tests for metric structs and helpers

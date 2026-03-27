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
        // Skip entries that don't have a "type" file or aren't batteries
        let type_str = match fs::read_to_string(path.join("type")) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if type_str.trim() != "Battery" {
            continue;
        }
        let capacity: f32 = match fs::read_to_string(path.join("capacity"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
        {
            Some(v) => v,
            None => continue,
        };
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

pub fn read_cpu_temp(components: &Components) -> Option<f32> {
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
    let mut components = Components::new();
    components.refresh(true);
    CpuInfo {
        usage: cpus.iter().map(|c| c.cpu_usage()).collect(),
        avg_usage: sys.global_cpu_usage(),
        frequency: cpus.first().map(|c| c.frequency()).unwrap_or(0),
        name: cpus.first().map(|c| c.brand().to_string()).unwrap_or_default(),
        cores: System::physical_core_count().unwrap_or(0),
        threads: cpus.len(),
        cpu_temp: read_cpu_temp(&components),
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
    let networks = Networks::new_with_refreshed_list();
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
        // On-demand pull command — Components allocation per-call is acceptable here (not a hot path).
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

        let mut best_card: Option<usize> = None;
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
                return Some(GpuInfo {
                    usage,
                    vram_used: best_vram.0,
                    vram_total: best_vram.1,
                    vram_percentage: (best_vram.0 as f32 / best_vram.1 as f32) * 100.0,
                    temp: gpu_temp,
                });
            }
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
                read:  Some((td_r.saturating_sub(last.0) as f32 / el) as u64),
                write: Some((td_w.saturating_sub(last.1) as f32 / el) as u64),
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

    #[test]
    fn network_info_serializes() {
        let info = NetworkInfo {
            name: "eth0".to_string(),
            received: 1024,
            transmitted: 2048,
            total_received: 1_000_000,
            total_transmitted: 2_000_000,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("received"));
        assert!(json.contains("total_received"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn disk_io_linux_returns_pair() {
        let (r, w) = read_disk_io_linux();
        assert!(r < u64::MAX);
        assert!(w < u64::MAX);
    }
}

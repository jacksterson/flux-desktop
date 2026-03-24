mod paths;
use paths::{ensure_flux_dirs, flux_modules_dir};

use sysinfo::{System, Components, Networks, CpuRefreshKind, RefreshKind};
use std::sync::Mutex;
use tauri::{State, Window, Manager, WebviewWindowBuilder, WebviewUrl, AppHandle, WindowEvent, WebviewWindow};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton};
use nvml_wrapper::Nvml;
use std::time::Instant;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// --- Discovery Types ---
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum WindowLevel {
    #[default]
    Desktop,
    Top,
    Normal,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleWindowConfig {
    pub width: f64,
    pub height: f64,
    pub transparent: bool,
    pub decorations: bool,
    #[serde(default)]
    pub window_level: WindowLevel,
    pub resizable: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub entry: String,
    pub window: ModuleWindowConfig,
    pub permissions: Vec<String>,
    #[serde(default)]
    pub active: bool,
}

// --- Window State Persistence ---
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

const STATE_VERSION: u32 = 1;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PersistentState {
    #[serde(default)]
    pub version: u32,
    pub windows: HashMap<String, WindowBounds>,
}

impl Default for PersistentState {
    fn default() -> Self {
        Self { version: STATE_VERSION, windows: HashMap::new() }
    }
}

impl PersistentState {
    pub fn load(path: &std::path::Path) -> Self {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(state) = serde_json::from_str::<Self>(&content) {
                if state.version == STATE_VERSION {
                    return state;
                }
                eprintln!("Info: window_state.json version {} does not match expected {}, starting fresh", state.version, STATE_VERSION);
                // Version mismatch: discard and start fresh
            }
        }
        Self::default()
    }

    pub fn save(&self, path: &std::path::Path) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(content) = serde_json::to_string_pretty(self) {
            let _ = fs::write(path, content);
        }
    }
}

// --- Engine State ---
pub struct AppState {
    pub sys: Mutex<System>,
    pub nvml: Option<Nvml>,
    pub last_net_io: Mutex<(u64, u64, Instant)>,
    pub last_disk_io: Mutex<(u64, u64, Instant)>,
    pub active_modules: Mutex<HashMap<String, ModuleManifest>>,
    pub persistent: Mutex<PersistentState>,
    pub data_dir: PathBuf,   // OS app data dir — for window_state.json
}

#[derive(Serialize)]
pub struct GpuStats { usage: u32, vram_used: u64, vram_total: u64, vram_percentage: f32, temp: f32 }

#[derive(Serialize)]
pub struct SystemStats {
    cpu_usage: f32, cpu_temp: f32, cpu_freq: u64, ram_used: u64, ram_total: u64, ram_percentage: f32,
    uptime: String, net_in: u64, net_out: u64, disk_read: u64, disk_write: u64, gpu: Option<GpuStats>,
}

// --- Commands ---

#[tauri::command]
fn list_modules(app: AppHandle, state: State<'_, AppState>) -> Vec<ModuleManifest> {
    // Snapshot active IDs under lock, then release before doing filesystem I/O
    let active_ids: std::collections::HashSet<String> = {
        let active_map = state.active_modules.lock().unwrap();
        active_map.keys().cloned().collect()
    };
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut modules = Vec::new();

    let bundled_path = app.path().resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("modules");

    for modules_path in [flux_modules_dir(), bundled_path] {
        if let Ok(entries) = fs::read_dir(&modules_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Ok(content) = fs::read_to_string(path.join("module.json")) {
                        if let Ok(mut manifest) = serde_json::from_str::<ModuleManifest>(&content) {
                            if seen_ids.insert(manifest.id.clone()) {
                                manifest.active = active_ids.contains(&manifest.id);
                                modules.push(manifest);
                            }
                        }
                    }
                }
            }
        }
    }
    modules
}

fn track_window(window: WebviewWindow) {
    let app_handle = window.app_handle().clone();
    let label = window.label().to_string();
    let w = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(_) | WindowEvent::Resized(_) = event {
            let state = app_handle.state::<AppState>();
            if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
                let mut p = state.persistent.lock().unwrap();
                p.windows.insert(label.clone(), WindowBounds {
                    x: pos.x as f64,
                    y: pos.y as f64,
                    width: size.width as f64,
                    height: size.height as f64,
                });
                let state_path = state.data_dir.join("window_state.json");
                p.save(&state_path);
            }
        }
    });
}

#[tauri::command]
async fn toggle_module(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut active_map = state.active_modules.lock().unwrap();
    if let Some(_existing) = active_map.remove(&id) {
        if let Some(win) = app.get_webview_window(&id) { let _ = win.close(); }
        if let Some(win) = app.get_webview_window(&format!("{}-settings", id)) { let _ = win.close(); }
    } else {
        let user_manifest = flux_modules_dir().join(&id).join("module.json");
        let bundled_manifest = app.path().resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("modules").join(&id).join("module.json");

        let manifest_path = if user_manifest.exists() {
            user_manifest
        } else {
            bundled_manifest
        };

        if let Ok(content) = fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<ModuleManifest>(&content) {
                let win_config = &manifest.window;
                let url = WebviewUrl::CustomProtocol(format!("flux-module://{}/{}", id, manifest.entry).parse().unwrap());
                
                let saved = {
                    let p = state.persistent.lock().unwrap();
                    p.windows.get(&id).cloned()
                };

                let always_on_top = win_config.window_level == WindowLevel::Top;

                let mut builder = WebviewWindowBuilder::new(&app, &id, url)
                    .title(&manifest.name)
                    .transparent(win_config.transparent)
                    .decorations(win_config.decorations)
                    .always_on_top(always_on_top)
                    .resizable(win_config.resizable)
                    .skip_taskbar(true)
                    .shadow(false);

                if let Some(b) = &saved {
                    builder = builder
                        .position(b.x, b.y)
                        .inner_size(b.width, b.height);
                } else {
                    builder = builder.inner_size(win_config.width, win_config.height);
                }

                let window = builder.build().map_err(|e| e.to_string())?;

                // Force physical restore if saved
                if let Some(b) = &saved {
                    let _ = window.set_position(tauri::PhysicalPosition::new(b.x as i32, b.y as i32));
                    let _ = window.set_size(tauri::PhysicalSize::new(b.width as u32, b.height as u32));
                }
                
                track_window(window);
                active_map.insert(id.clone(), manifest.clone());
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn open_module_settings(app: AppHandle, id: String) -> Result<(), String> {
    let settings_id = format!("{}-settings", id);
    if let Some(win) = app.get_webview_window(&settings_id) {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        let url = WebviewUrl::CustomProtocol(format!("flux-module://{}/settings.html", id).parse().unwrap());
        let app_state = app.state::<AppState>();
        let saved = {
            let p = app_state.persistent.lock().unwrap();
            p.windows.get(&settings_id).cloned()
        };

        let mut builder = WebviewWindowBuilder::new(&app, &settings_id, url)
            .title(format!("Configure // {}", id))
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .resizable(true)
            .skip_taskbar(true)
            .shadow(false);

        if let Some(b) = &saved {
            builder = builder
                .position(b.x, b.y)
                .inner_size(b.width, b.height);
        } else {
            builder = builder.inner_size(350.0, 500.0);
        }

        let window = builder.build().map_err(|e| e.to_string())?;

        // Force physical restore if saved
        if let Some(b) = &saved {
            let _ = window.set_position(tauri::PhysicalPosition::new(b.x as i32, b.y as i32));
            let _ = window.set_size(tauri::PhysicalSize::new(b.width as u32, b.height as u32));
        }

        track_window(window);
    }
    Ok(())
}

#[tauri::command]
fn close_window(window: Window) {
    let _ = window.close();
}

#[tauri::command]
fn drag_window(window: Window) { let _ = window.start_dragging(); }

// --- Metrics Logic ---

fn get_linux_gpu_usage() -> u32 {
    for i in 0..3 {
        let path = format!("/sys/class/drm/card{}/device/gpu_busy_percent", i);
        if let Ok(content) = fs::read_to_string(path) { return content.trim().parse::<u32>().unwrap_or(0); }
    }
    0
}

fn get_linux_vram_best() -> Option<(u64, u64)> {
    let mut best = (0, 0);
    for i in 0..5 {
        let p = format!("/sys/class/drm/card{}/device", i);
        let t_p = format!("{}/mem_info_vram_total", p);
        let u_p = format!("{}/mem_info_vram_used", p);
        if let (Ok(t_s), Ok(u_s)) = (fs::read_to_string(&t_p), fs::read_to_string(&u_p)) {
            let t = t_s.trim().parse::<u64>().unwrap_or(0);
            let u = u_s.trim().parse::<u64>().unwrap_or(0);
            if t > best.1 { best = (u, t); }
        }
    }
    if best.1 > 0 { Some(best) } else { None }
}

#[tauri::command]
fn get_system_stats(state: State<'_, AppState>) -> SystemStats {
    let mut sys = state.sys.lock().unwrap();
    let now = Instant::now();
    sys.refresh_specifics(RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing().with_cpu_usage()));
    let mut components = Components::new();
    components.refresh(true);
    let cpu_temp = components.iter().filter(|c| { let l = c.label().to_lowercase(); l.contains("package") || l.contains("cpu") || l.contains("tctl") }).filter_map(|c| c.temperature()).max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(0.0);
    let mut networks = Networks::new();
    networks.refresh(true);
    let (mut tn_in, mut tn_out) = (0, 0);
    for (_n, net) in networks.iter() { tn_in += net.total_received(); tn_out += net.total_transmitted(); }
    let (net_in, net_out) = {
        let mut last = state.last_net_io.lock().unwrap();
        let el = now.duration_since(last.2).as_secs_f32();
        let res = if el > 0.0 { ((tn_in.saturating_sub(last.0) as f32 / el) as u64, (tn_out.saturating_sub(last.1) as f32 / el) as u64) } else { (0,0) };
        *last = (tn_in, tn_out, now); res
    };
    let (td_r, td_w) = {
        if let Ok(content) = fs::read_to_string("/proc/diskstats") {
            let (mut tr, mut tw) = (0, 0);
            for line in content.lines() {
                let p: Vec<&str> = line.split_whitespace().collect();
                if p.len() > 13 {
                    let dev = p[2];
                    if dev.starts_with("sd") || dev.starts_with("nvme") {
                        tr += p[5].parse::<u64>().unwrap_or(0) * 512;
                        tw += p[9].parse::<u64>().unwrap_or(0) * 512;
                    }
                }
            }
            (tr, tw)
        } else { (0, 0) }
    };
    let (disk_read, disk_write) = {
        let mut last = state.last_disk_io.lock().unwrap();
        let el = now.duration_since(last.2).as_secs_f32();
        let res = if el > 0.0 { ((td_r.saturating_sub(last.0) as f32 / el) as u64, (td_w.saturating_sub(last.1) as f32 / el) as u64) } else { (0,0) };
        *last = (td_r, td_w, now); res
    };
    let mut gpu = None;
    if let Some(nvml) = &state.nvml {
        if let Ok(d) = nvml.device_by_index(0) {
            let m = d.memory_info().ok();
            let t = d.temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu).ok();
            let ut = d.utilization_rates().ok().map(|u| u.gpu).unwrap_or(0);
            gpu = Some(GpuStats { usage: ut, vram_used: m.as_ref().map(|m| m.used).unwrap_or(0), vram_total: m.as_ref().map(|m| m.total).unwrap_or(0), vram_percentage: m.as_ref().map(|m| (m.used as f32 / m.total as f32) * 100.0).unwrap_or(0.0), temp: t.map(|t| t as f32).unwrap_or(0.0) });
        }
    }
    if gpu.is_none() || gpu.as_ref().map_or(0, |g| g.usage) == 0 {
        if let Some((u, t)) = get_linux_vram_best() {
            let gpu_temp = components.iter().filter(|c| c.label().to_lowercase().contains("gpu") || c.label().to_lowercase().contains("amdgpu")).filter_map(|c| c.temperature()).max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(0.0);
            let mut usage = get_linux_gpu_usage();
            if usage == 0 { usage = gpu.as_ref().map_or(0, |g| g.usage); }
            gpu = Some(GpuStats { usage, vram_used: u, vram_total: t, vram_percentage: (u as f32 / t as f32) * 100.0, temp: gpu_temp });
        }
    }
    let uptime = { let ts = System::uptime(); format!("{:02}:{:02}:{:02}", ts / 3600, (ts % 3600) / 60, ts % 60) };
    SystemStats { cpu_usage: sys.global_cpu_usage(), cpu_temp, cpu_freq: sys.cpus().first().map(|c| c.frequency()).unwrap_or(0), ram_used: sys.used_memory(), ram_total: sys.total_memory(), ram_percentage: (sys.used_memory() as f32 / sys.total_memory() as f32) * 100.0, uptime, net_in, net_out, disk_read, disk_write, gpu }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("flux-module", |ctx, request| {
            let uri = request.uri().to_string();
            let path_part = uri.strip_prefix("flux-module://").unwrap_or("");

            // Resolve candidate paths
            let user_base = flux_modules_dir();
            let user_candidate = user_base.join(path_part);

            // Canonicalize to resolve .. segments and symlinks
            let file_path = if let Ok(canonical) = user_candidate.canonicalize() {
                if canonical.starts_with(&user_base.canonicalize().unwrap_or(user_base.clone())) {
                    canonical
                } else {
                    // Path traversal attempt — deny
                    return tauri::http::Response::builder().status(403).body(Vec::new()).unwrap();
                }
            } else {
                // Not in user dir — try bundled resources
                let bundled_base = ctx.app_handle().path().resource_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join("modules");
                let bundled_candidate = bundled_base.join(path_part);
                if let Ok(canonical) = bundled_candidate.canonicalize() {
                    if canonical.starts_with(&bundled_base.canonicalize().unwrap_or(bundled_base.clone())) {
                        canonical
                    } else {
                        return tauri::http::Response::builder().status(403).body(Vec::new()).unwrap();
                    }
                } else {
                    return tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
                }
            };

            if let Ok(content) = fs::read(&file_path) {
                let ext = file_path.extension().map_or("", |e: &std::ffi::OsStr| e.to_str().unwrap_or(""));
                let mime = match ext {
                    "html" => "text/html",
                    "js" => "application/javascript",
                    "css" => "text/css",
                    "svg" => "image/svg+xml",
                    "png" => "image/png",
                    "jpg" | "jpeg" => "image/jpeg",
                    "json" => "application/json",
                    _ => "application/octet-stream",
                };
                tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .body(content)
                    .unwrap()
            } else {
                tauri::http::Response::builder().status(404).body(Vec::new()).unwrap()
            }
        })
        .setup(|app| {
            let nvml = Nvml::init().ok();

            // Resolve data directory
            let data_dir = app.path().app_data_dir()
                .unwrap_or_else(|e| {
                    eprintln!("Warning: could not resolve app data dir ({}), using current directory", e);
                    PathBuf::from(".")
                });

            // Create ~/Flux/modules and ~/Flux/skins if needed
            if let Err(e) = ensure_flux_dirs() {
                eprintln!("Warning: could not create Flux directories: {}", e);
            }

            // Load persistent state
            let state_path = data_dir.join("window_state.json");
            let persistent = PersistentState::load(&state_path);

            // Restore main window position
            if let Some(main_win) = app.get_webview_window("main") {
                if let Some(b) = persistent.windows.get("main") {
                    let _ = main_win.set_position(tauri::PhysicalPosition::new(b.x as i32, b.y as i32));
                    let _ = main_win.set_size(tauri::PhysicalSize::new(b.width as u32, b.height as u32));
                }
                track_window(main_win);
            }

            app.manage(AppState {
                sys: Mutex::new(System::new_all()),
                nvml,
                last_net_io: Mutex::new((0, 0, Instant::now())),
                last_disk_io: Mutex::new((0, 0, Instant::now())),
                active_modules: Mutex::new(HashMap::new()),
                persistent: Mutex::new(persistent),
                data_dir,
            });

            // System tray
            let quit_i = MenuItem::with_id(app, "quit", "Quit Flux", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show Command Center", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => std::process::exit(0),
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_system_stats, drag_window, list_modules, toggle_module, open_module_settings, close_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn persistent_state_roundtrip() {
        let path = temp_dir().join("flux_test_state.json");
        let mut state = PersistentState::default();
        state.windows.insert(
            "test-window".to_string(),
            WindowBounds { x: 10.0, y: 20.0, width: 400.0, height: 600.0 },
        );
        state.save(&path);
        let loaded = PersistentState::load(&path);
        assert_eq!(loaded.windows["test-window"].x, 10.0);
        assert_eq!(loaded.windows["test-window"].height, 600.0);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn persistent_state_missing_file_returns_default() {
        let path = temp_dir().join("flux_nonexistent_state.json");
        let _ = std::fs::remove_file(&path);
        let loaded = PersistentState::load(&path);
        assert!(loaded.windows.is_empty());
    }

    #[test]
    fn persistent_state_version_mismatch_returns_default() {
        let path = temp_dir().join("flux_test_version.json");
        std::fs::write(&path, r#"{"version": 999, "windows": {}}"#).unwrap();
        let loaded = PersistentState::load(&path);
        assert!(loaded.windows.is_empty());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn module_manifest_parses_correctly() {
        let json = r#"{
            "id": "test-widget",
            "name": "Test Widget",
            "author": "Tester",
            "version": "1.0.0",
            "entry": "index.html",
            "window": {
                "width": 400, "height": 600,
                "transparent": true, "decorations": false,
                "windowLevel": "desktop", "resizable": true
            },
            "permissions": ["system:stats"]
        }"#;
        let manifest: ModuleManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.id, "test-widget");
        assert_eq!(manifest.window.width, 400.0);
        assert_eq!(manifest.permissions, vec!["system:stats"]);
    }

    #[test]
    fn module_manifest_parses_window_level_desktop() {
        let json = r#"{
            "id": "t", "name": "T", "author": "a", "version": "1.0.0",
            "entry": "index.html",
            "window": {
                "width": 400, "height": 600, "transparent": true,
                "decorations": false, "windowLevel": "desktop", "resizable": true
            },
            "permissions": []
        }"#;
        let manifest: ModuleManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.window.window_level, WindowLevel::Desktop);
    }

    #[test]
    fn module_manifest_parses_window_level_top() {
        let json = r#"{
            "id": "t", "name": "T", "author": "a", "version": "1.0.0",
            "entry": "index.html",
            "window": {
                "width": 400, "height": 600, "transparent": true,
                "decorations": false, "windowLevel": "top", "resizable": true
            },
            "permissions": []
        }"#;
        let manifest: ModuleManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.window.window_level, WindowLevel::Top);
    }

    #[test]
    fn module_manifest_window_level_defaults_to_desktop() {
        let json = r#"{
            "id": "t", "name": "T", "author": "a", "version": "1.0.0",
            "entry": "index.html",
            "window": {
                "width": 400, "height": 600, "transparent": true,
                "decorations": false, "resizable": true
            },
            "permissions": []
        }"#;
        let manifest: ModuleManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.window.window_level, WindowLevel::Desktop);
    }
}
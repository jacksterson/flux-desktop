mod desktop_layer;
pub mod claude_usage;
pub mod assets;
pub mod config;
use config::{EngineConfig, read_config};
pub mod metrics;
pub mod broadcaster;
mod paths;
mod archive;
mod module_settings;
mod autostart;
pub mod custom_data;
pub mod alerts;
pub mod monitors;
use custom_data::CustomDataBroker;
use paths::flux_module_settings_dir;

use sysinfo::System;
use std::sync::Mutex;
use tauri::{State, Manager, WebviewWindowBuilder, WebviewUrl, AppHandle, WindowEvent, WebviewWindow};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use nvml_wrapper::Nvml;
use std::time::Instant;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "html" => "text/html", "js" => "application/javascript", "css" => "text/css",
        "svg" => "image/svg+xml", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
        "json" => "application/json", _ => "application/octet-stream",
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum WindowLevel { #[default] Desktop, Top, Normal }

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleWindowConfig { pub width: f64, pub height: f64, pub transparent: bool, pub decorations: bool, #[serde(default)] pub window_level: WindowLevel, pub resizable: bool }

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest { pub id: String, pub name: String, pub author: String, pub version: String, pub entry: String, pub window: ModuleWindowConfig, pub permissions: Vec<String>, #[serde(default)] pub active: bool, #[serde(default)] pub settings: Vec<SettingDef>, #[serde(default)] pub allow_offscreen: bool }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeManifest { pub id: String, pub name: String, #[serde(default)] pub description: String, #[serde(default = "default_version_str")] pub version: String, pub modules: Vec<String>, #[serde(skip_serializing_if = "Option::is_none")] pub preview: Option<String> }
fn default_version_str() -> String { "1.0.0".to_string() }

#[derive(Debug, Serialize)]
pub struct ModuleInfo { pub id: String, pub name: String, pub active: bool, pub has_settings: bool }
#[derive(Debug, Serialize)]
pub struct ThemeInfo { pub id: String, pub name: String, pub description: String, pub version: String, pub preview_url: Option<String>, pub modules: Vec<ModuleInfo>, pub source: String }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SettingDef { pub key: String, pub label: String, #[serde(rename = "type")] pub field_type: String, pub default: serde_json::Value, #[serde(default, skip_serializing_if = "Option::is_none")] pub min: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] pub max: Option<f64>, #[serde(default, skip_serializing_if = "Option::is_none")] pub step: Option<f64>, #[serde(default)] pub options: Vec<String> }

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct WindowBounds { pub x: f64, pub y: f64, width: f64, height: f64, #[serde(default)] pub monitor: Option<String>, #[serde(default)] pub allow_offscreen: bool }
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct MarginPosition { pub left: i32, pub top: i32 }

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PersistentState { #[serde(default)] pub version: u32, pub windows: HashMap<String, WindowBounds>, #[serde(default)] pub margins: HashMap<String, MarginPosition> }
impl Default for PersistentState { fn default() -> Self { Self { version: 1, windows: HashMap::new(), margins: HashMap::new() } } }
impl PersistentState {
    pub fn load(path: &std::path::Path) -> Self {
        if let Ok(c) = fs::read_to_string(path) { if let Ok(s) = serde_json::from_str::<Self>(&c) { if s.version == 1 { return s; } } }
        Self::default()
    }
    pub fn save(&self, path: &std::path::Path) {
        if let Some(p) = path.parent() { let _ = fs::create_dir_all(p); }
        if let Ok(c) = serde_json::to_string_pretty(self) { let _ = fs::write(path, c); }
    }
}

pub struct AppState {
    pub sys: Mutex<System>, pub nvml: Option<Nvml>,
    pub last_net_io: Mutex<(u64, u64, Instant)>, pub last_disk_io: Mutex<(u64, u64, Instant)>,
    pub active_modules: Mutex<HashMap<String, ModuleManifest>>, pub persistent: Mutex<PersistentState>,
    pub data_dir: PathBuf, pub desktop_wayland_windows: Mutex<HashSet<String>>,
    pub config: Mutex<EngineConfig>, pub config_path: PathBuf, pub custom_broker: CustomDataBroker,
    pub offscreen_widgets: Mutex<Vec<String>>, pub startup_toast: Mutex<Option<String>>,
    pub metric_subscriptions: Mutex<HashMap<String, HashSet<String>>>, pub hidden_widget_ticks: Mutex<HashMap<String, u32>>,
    pub metric_history: Mutex<HashMap<String, std::collections::VecDeque<serde_json::Value>>>,
    pub alert_defs: Mutex<Vec<alerts::AlertDef>>, pub alert_states: Mutex<HashMap<String, Option<std::time::Instant>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetricInterestArgs {
    window_id: String,
    categories: Vec<String>,
}

#[tauri::command]
fn register_metric_interest(state: State<'_, AppState>, args: MetricInterestArgs) {
    let mut subs = state.metric_subscriptions.lock().unwrap();
    for cat in args.categories { 
        subs.entry(cat).or_insert_with(HashSet::new).insert(args.window_id.clone()); 
    }
}

#[tauri::command]
fn unregister_metric_interest(state: State<'_, AppState>, args: MetricInterestArgs) {
    let mut subs = state.metric_subscriptions.lock().unwrap();
    for cat in &args.categories { 
        if let Some(set) = subs.get_mut(cat) { 
            set.remove(&args.window_id); 
        } 
    }
}
fn unregister_all_metric_interest(state: &AppState, window_id: &str) {
    let mut subs = state.metric_subscriptions.lock().unwrap();
    for set in subs.values_mut() { set.remove(window_id); }
}

#[tauri::command]
fn list_modules(app: AppHandle, state: State<'_, AppState>) -> Vec<ModuleManifest> {
    let active_ids: HashSet<String> = state.active_modules.lock().unwrap().keys().cloned().collect();
    let mut seen_ids = HashSet::new();
    let mut modules = Vec::new();
    let res_dir = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
    scan_modules_dir(&paths::flux_modules_dir(), &active_ids, &mut seen_ids, &mut modules);
    let themes_dir = res_dir.join("themes");
    if themes_dir.exists() {
        if let Ok(entries) = fs::read_dir(&themes_dir) {
            for entry in entries.flatten() {
                let m_path = entry.path().join("modules");
                if m_path.is_dir() { scan_modules_dir(&m_path, &active_ids, &mut seen_ids, &mut modules); }
            }
        }
    }
    modules
}

fn scan_modules_dir(path: &std::path::Path, active: &HashSet<String>, seen: &mut HashSet<String>, out: &mut Vec<ModuleManifest>) {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let m_path = p.join("module.json");
                if let Ok(c) = fs::read_to_string(&m_path) {
                    if let Ok(mut m) = serde_json::from_str::<ModuleManifest>(&c) {
                        if seen.insert(m.id.clone()) { m.active = active.contains(&m.id); out.push(m); }
                    }
                }
            }
        }
    }
}

fn track_window(window: WebviewWindow) {
    let app_handle = window.app_handle().clone();
    let label = window.label().to_string();
    let w = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { .. } = event {
            let state = app_handle.state::<AppState>();
            unregister_all_metric_interest(&state, &label);
        }
        if let WindowEvent::Moved(_) | WindowEvent::Resized(_) = event {
            let state = app_handle.state::<AppState>();
            
            // Wayland layer-shell surfaces always report outer_position() as (0,0).
            // Skip Moved events for these windows — their position is managed via margins.
            if matches!(event, WindowEvent::Moved(_)) {
                let dw = state.desktop_wayland_windows.lock().unwrap();
                if dw.contains(&label) { return; }
            }

            if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
                let mut p = state.persistent.lock().unwrap();
                p.windows.insert(label.clone(), WindowBounds { x: pos.x as f64, y: pos.y as f64, width: size.width as f64, height: size.height as f64, ..Default::default() });
                p.save(&state.data_dir.join("window_state.json"));
            }
        }
    });
}

fn launch_module_window(id: &str, app: &AppHandle, state: &AppState) -> Result<(), String> {
    let res_dir = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
    let manifest = find_module_manifest(id, &res_dir)?;
    let url = WebviewUrl::CustomProtocol(format!("flux-module://{}/{}", id, manifest.entry).parse().unwrap());
    let builder = WebviewWindowBuilder::new(app, id, url)
        .title(&manifest.name)
        .transparent(manifest.window.transparent)
        .decorations(manifest.window.decorations)
        .resizable(manifest.window.resizable)
        .visible(false)
        .skip_taskbar(true);
    let window = builder.build().map_err(|e| e.to_string())?;
    let saved = state.persistent.lock().unwrap().windows.get(id).cloned();
    if let Some(b) = saved {
        let _ = window.set_position(tauri::PhysicalPosition::new(b.x as i32, b.y as i32));
        let _ = window.set_size(tauri::PhysicalSize::new(b.width as u32, b.height as u32));
    }
    
    let saved_margins = {
        let p = state.persistent.lock().unwrap();
        p.margins.get(id).map(|m| (m.left, m.top))
    };
    let is_wayland_desktop = desktop_layer::apply(&window, &manifest.window.window_level, saved_margins);
    if is_wayland_desktop {
        state.desktop_wayland_windows.lock().unwrap().insert(id.to_string());
    }

    let _ = window.show();
    track_window(window);
    state.active_modules.lock().unwrap().insert(id.to_string(), manifest);
    Ok(())
}

fn find_module_manifest(id: &str, res_dir: &std::path::Path) -> Result<ModuleManifest, String> {
    let user_p = paths::flux_modules_dir().join(id).join("module.json");
    if let Ok(c) = fs::read_to_string(user_p) { if let Ok(m) = serde_json::from_str(&c) { return Ok(m); } }
    let themes_p = res_dir.join("themes");
    if let Ok(entries) = fs::read_dir(themes_p) {
        for entry in entries.flatten() {
            let p = entry.path().join("modules").join(id).join("module.json");
            if let Ok(c) = fs::read_to_string(p) { if let Ok(m) = serde_json::from_str(&c) { return Ok(m); } }
        }
    }
    Err(format!("module {} not found", id))
}

#[tauri::command] fn open_module_settings(app: AppHandle, id: String) -> Result<(), String> {
    let url = WebviewUrl::CustomProtocol(format!("flux-module://{}/settings.html", id).parse().unwrap());
    let _ = WebviewWindowBuilder::new(&app, format!("{}-settings", id), url).title("Settings").build();
    Ok(())
}

#[tauri::command] fn toggle_module(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let active = state.active_modules.lock().unwrap().contains_key(&id);
    if active {
        state.active_modules.lock().unwrap().remove(&id);
        if let Some(w) = app.get_webview_window(&id) { let _ = w.close(); }
        state.desktop_wayland_windows.lock().unwrap().remove(&id);
    } else { launch_module_window(&id, &app, &state)?; }
    Ok(())
}

#[tauri::command] fn list_themes(app: AppHandle) -> Vec<ThemeInfo> {
    let mut themes = Vec::new();
    let res_dir = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
    let themes_dir = res_dir.join("themes");
    if let Ok(entries) = fs::read_dir(themes_dir) {
        for entry in entries.flatten() {
            let p = entry.path().join("theme.json");
            if let Ok(c) = fs::read_to_string(p) { if let Ok(m) = serde_json::from_str::<ThemeManifest>(&c) { themes.push(ThemeInfo { id: m.id, name: m.name, description: m.description, version: m.version, preview_url: None, modules: vec![], source: "bundled".to_string() }); } }
        }
    }
    themes
}

#[tauri::command] fn drag_window(window: WebviewWindow, state: State<'_, AppState>) {
    let dw = state.desktop_wayland_windows.lock().unwrap();
    if dw.contains(window.label()) { return; }
    let _ = window.start_dragging();
}

#[tauri::command]
fn is_layer_shell_window(window: WebviewWindow, state: State<'_, AppState>) -> bool {
    state.desktop_wayland_windows.lock().unwrap().contains(window.label())
}

#[tauri::command] async fn move_module(app: AppHandle, state: State<'_, AppState>, id: String, dx: i32, dy: i32) -> Result<(), String> {
    // Only applies to Wayland desktop-layer windows
    {
        let dw = state.desktop_wayland_windows.lock().unwrap();
        if !dw.contains(&id) { return Ok(()); }
    }
    if let Some(win) = app.get_webview_window(&id) {
        let (nl, nt) = {
            let p = state.persistent.lock().unwrap();
            let cur = p.margins.get(&id).map(|m| (m.left, m.top)).unwrap_or((0, 0));
            (cur.0.saturating_add(dx), cur.1.saturating_add(dy))
        };
        app.run_on_main_thread(move || { desktop_layer::set_margins(&win, nl, nt); }).unwrap();
        let mut p = state.persistent.lock().unwrap();
        p.margins.insert(id, MarginPosition { left: nl, top: nt });
        p.save(&state.data_dir.join("window_state.json"));
    }
    Ok(())
}

#[tauri::command]
async fn resize_module(
    app: AppHandle,
    id: String,
    direction: String,
    dx: i32,
    dy: i32,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&id) {
        let size = win.inner_size().map_err(|e| e.to_string())?;
        let mut new_width = size.width as i32;
        let mut new_height = size.height as i32;

        match direction.as_str() {
            "East" => new_width += dx,
            "South" => new_height += dy,
            "SouthEast" => {
                new_width += dx;
                new_height += dy;
            }
            _ => return Err(format!("unsupported resize direction: {}", direction)),
        }

        win.set_size(tauri::PhysicalSize::new(new_width.max(100) as u32, new_height.max(100) as u32)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command] fn get_module_settings(module_id: String) -> Result<HashMap<String, serde_json::Value>, String> {
    let p = flux_module_settings_dir().join(format!("{}.toml", module_id));
    Ok(module_settings::read_settings(&p, &[]))
}

#[tauri::command] fn set_module_setting(module_id: String, key: String, value: serde_json::Value) -> Result<(), String> {
    let p = flux_module_settings_dir().join(format!("{}.toml", module_id));
    module_settings::write_setting(&p, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_command_center(app: AppHandle) -> Result<(), String> {
    let url = WebviewUrl::CustomProtocol("flux-module://_flux/command-center/index.html".parse().unwrap());
    if let Some(win) = app.get_webview_window("command-center") {
        let _ = win.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(&app, "command-center", url)
            .title("Flux Command Center")
            .inner_size(900.0, 600.0)
            .resizable(true)
            .decorations(true)
            .build()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn run_wizard(app: AppHandle) -> Result<(), String> {
    let url = WebviewUrl::CustomProtocol("flux-module://_flux/wizard/index.html".parse().unwrap());
    let _ = WebviewWindowBuilder::new(&app, "wizard", url)
        .title("Welcome to Flux")
        .inner_size(600.0, 500.0)
        .resizable(false)
        .decorations(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_wizard(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("wizard") {
        let _ = win.close();
    }
    Ok(())
}

#[tauri::command]
fn close_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("flux-module", |ctx, request| {
            let uri = request.uri().to_string();
            let path_part = uri.strip_prefix("flux-module://").unwrap_or("");
            let res_dir = ctx.app_handle().path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
            
            // DEV OVERRIDE: Look in project root first if we are in dev
            let project_root = PathBuf::from(".."); // Assuming we run from app/src-tauri
            let dev_runtime = project_root.join("runtime");
            let dev_themes = project_root.join("..").join("themes");

            if let Some(idx) = path_part.find("_flux/") {
                let rel = &path_part[idx + 6..];
                if let Ok(c) = fs::read(dev_runtime.join(rel)) { return finalize_response(ctx.app_handle().clone(), rel, c); }
                let base = res_dir.join("runtime");
                if let Ok(c) = fs::read(base.join(rel)) { return finalize_response(ctx.app_handle().clone(), rel, c); }
            }

            let user_m_base = paths::flux_modules_dir();
            if let Ok(c) = fs::read(user_m_base.join(path_part)) { return finalize_response(ctx.app_handle().clone(), path_part, c); }

            // Search theme packs (module AND theme root)
            let search_dirs = vec![dev_themes, res_dir.join("themes")];
            for t_base in search_dirs {
                if let Ok(entries) = fs::read_dir(&t_base) {
                    for entry in entries.flatten() {
                        let t_dir = entry.path();
                        let m_path = t_dir.join("modules").join(path_part);
                        if let Ok(c) = fs::read(&m_path) { 
                            return finalize_response(ctx.app_handle().clone(), path_part, c); 
                        }
                        // Try filename only in theme root (e.g. for /shared-hud.css)
                        if let Some(fname) = PathBuf::from(path_part).file_name() {
                            let r_path = t_dir.join(fname);
                            if let Ok(c) = fs::read(&r_path) { 
                                return finalize_response(ctx.app_handle().clone(), path_part, c); 
                            }
                        }
                    }
                }
            }
            tauri::http::Response::builder().status(404).body(Vec::new()).unwrap()
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir().unwrap_or_default();
            let config_path = paths::flux_config_path();
            let engine_config = read_config(&config_path);

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).unwrap();
            
            // Build Modules sub-menu
            let modules_menu = tauri::menu::Submenu::with_id(app, "modules", "Modules", true).unwrap();
            let res_dir = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
            let mut seen_ids = HashSet::new();
            let mut modules = Vec::new();
            scan_modules_dir(&paths::flux_modules_dir(), &HashSet::new(), &mut seen_ids, &mut modules);
            if let Ok(entries) = fs::read_dir(res_dir.join("themes")) {
                for entry in entries.flatten() {
                    let m_path = entry.path().join("modules");
                    if m_path.is_dir() { scan_modules_dir(&m_path, &HashSet::new(), &mut seen_ids, &mut modules); }
                }
            }

            for m in modules {
                let item = MenuItem::with_id(app, format!("toggle:{}", m.id), &m.name, true, None::<&str>).unwrap();
                let _ = modules_menu.append(&item);
            }

            let menu = Menu::with_items(app, &[
                &MenuItem::with_id(app, "open_cc", "Command Center", true, None::<&str>).unwrap(),
                &MenuItem::with_id(app, "run_wizard", "Setup Wizard", true, None::<&str>).unwrap(),
                &tauri::menu::PredefinedMenuItem::separator(app).unwrap(),
                &modules_menu,
                &tauri::menu::PredefinedMenuItem::separator(app).unwrap(),
                &quit_i
            ]).unwrap();

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    } else if event.id.as_ref() == "open_cc" {
                        let _ = open_command_center(app.clone());
                    } else if event.id.as_ref() == "run_wizard" {
                        let _ = run_wizard(app.clone());
                    } else if event.id.as_ref().starts_with("toggle:") {
                        let id = &event.id.as_ref()[7..];
                        let state = app.state::<AppState>();
                        let _ = toggle_module(app.clone(), state, id.to_string());
                    }
                })
                .on_tray_icon_event(|_tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        // Potential future toggle: show/hide all widgets
                    }
                })
                .build(app)
                .unwrap();

            app.manage(AppState {
                sys: Mutex::new(System::new_all()), nvml: Nvml::init().ok(),
                last_net_io: Mutex::new((0, 0, Instant::now())), last_disk_io: Mutex::new((0, 0, Instant::now())),
                active_modules: Mutex::new(HashMap::new()), persistent: Mutex::new(PersistentState::load(&data_dir.join("window_state.json"))),
                data_dir, desktop_wayland_windows: Mutex::new(HashSet::new()), config: Mutex::new(engine_config.clone()), config_path,
                custom_broker: CustomDataBroker::new(), offscreen_widgets: Mutex::new(Vec::new()), startup_toast: Mutex::new(None),
                metric_subscriptions: Mutex::new(HashMap::new()), hidden_widget_ticks: Mutex::new(HashMap::new()),
                metric_history: Mutex::new(HashMap::new()), alert_defs: Mutex::new(engine_config.engine.alerts.clone()), alert_states: Mutex::new(HashMap::new()),
            });
            broadcaster::start(app.handle().clone(), engine_config.engine.broadcast_interval_ms);
            for id in &engine_config.engine.active_modules { let _ = launch_module_window(id, &app.handle(), &app.state::<AppState>()); }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            register_metric_interest, unregister_metric_interest, drag_window, move_module, resize_module, is_layer_shell_window,
            metrics::system_cpu, metrics::system_memory, metrics::system_network, metrics::system_gpu, metrics::system_uptime,
            open_module_settings, toggle_module, list_modules, list_themes, get_module_settings, set_module_setting,
            open_command_center, run_wizard, close_wizard, close_window,
            claude_usage::list_claude_session_files, claude_usage::read_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn finalize_response(app: AppHandle, path: &str, mut content: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    let ext = path.split('.').last().unwrap_or("");
    let mime = match ext {
        "html" => "text/html", "js" => "application/javascript", "css" => "text/css",
        "svg" => "image/svg+xml", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
        "json" => "application/json", _ => "application/octet-stream",
    };
    if path.ends_with(".js") {
        let head = String::from_utf8_lossy(&content[..100.min(content.len())]);
        println!("[Engine] Finalizing {} ({} bytes) as {}. Start: {}", path, content.len(), mime, head);
    } else {
        println!("[Engine] Finalizing {} ({} bytes) as {}", path, content.len(), mime);
    }
    if path.ends_with("index.html") {
        let mut html = String::from_utf8_lossy(&content).to_string();
        let res_dir = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
        let api_path = res_dir.join("runtime").join("widget-api.js");
        if let Ok(api_code) = fs::read_to_string(api_path) {
            let tag = format!("<script>{}</script>", api_code);
            if let Some(i) = html.find("</head>") { html.insert_str(i, &tag); } else { html.insert_str(0, &tag); }
            content = html.into_bytes();
        }
    }
    tauri::http::Response::builder().header("Content-Type", mime).body(content).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persistent_state_margins_roundtrip() {
        let temp_dir = std::env::temp_dir();
        let path = temp_dir.join("flux_test_margins.json");
        let mut state = PersistentState::default();
        state.margins.insert(
            "my-widget".to_string(),
            MarginPosition { left: 120, top: 80 },
        );
        state.save(&path);
        let loaded = PersistentState::load(&path);
        assert_eq!(loaded.margins["my-widget"].left, 120);
        assert_eq!(loaded.margins["my-widget"].top, 80);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn persistent_state_margins_default_empty() {
        let state = PersistentState::default();
        assert!(state.margins.is_empty());
    }

    #[test]
    fn compute_new_margins_adds_delta() {
        let current = (100, 50);
        let dx = 10;
        let dy = -5;
        let new_margins = (current.0 + dx, current.1 + dy);
        assert_eq!(new_margins, (110, 45));
    }

    #[test]
    fn compute_new_margins_allows_negative() {
        let current = (5, 5);
        let dx = -10;
        let dy = -10;
        let new_margins = (current.0 + dx, current.1 + dy);
        assert_eq!(new_margins, (-5, -5));
    }
}

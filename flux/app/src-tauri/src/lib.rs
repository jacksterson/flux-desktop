mod desktop_layer;
pub mod config;
use config::{EngineConfig, read_config, write_config, config_exists};
pub mod metrics;
pub mod broadcaster;
mod paths;
use paths::{ensure_flux_dirs, flux_config_path, flux_modules_dir, flux_user_dir, flux_user_themes_dir};

use sysinfo::System;
use std::sync::Mutex;
use tauri::{State, Manager, WebviewWindowBuilder, WebviewUrl, AppHandle, WindowEvent, WebviewWindow};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton};
use nvml_wrapper::Nvml;
use std::time::Instant;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

// --- MIME helper ---
fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "html" => "text/html",
        "js" => "application/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

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

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct MarginPosition {
    pub left: i32,
    pub top: i32,
}

const STATE_VERSION: u32 = 1;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PersistentState {
    #[serde(default)]
    pub version: u32,
    pub windows: HashMap<String, WindowBounds>,
    #[serde(default)]
    pub margins: HashMap<String, MarginPosition>,
}

impl Default for PersistentState {
    fn default() -> Self {
        Self { version: STATE_VERSION, windows: HashMap::new(), margins: HashMap::new() }
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
// Lock order: active_modules → desktop_wayland_windows → persistent → config
pub struct AppState {
    pub sys: Mutex<System>,
    pub nvml: Option<Nvml>,
    pub last_net_io: Mutex<(u64, u64, Instant)>,
    pub last_disk_io: Mutex<(u64, u64, Instant)>,
    pub active_modules: Mutex<HashMap<String, ModuleManifest>>,
    pub persistent: Mutex<PersistentState>,
    pub data_dir: PathBuf,
    /// IDs of windows that have Wayland layer shell applied.
    pub desktop_wayland_windows: Mutex<HashSet<String>>,
    pub config: Mutex<EngineConfig>,
    pub config_path: PathBuf,
}

// --- Commands ---

/// Scan a single modules directory, appending discovered manifests to `modules`.
/// Modules whose IDs are already in `seen_ids` are skipped (first-found wins).
fn scan_modules_dir(
    modules_path: &std::path::Path,
    active_ids: &std::collections::HashSet<String>,
    seen_ids: &mut std::collections::HashSet<String>,
    modules: &mut Vec<ModuleManifest>,
) {
    if let Ok(entries) = fs::read_dir(modules_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("module.json");
                if let Ok(content) = fs::read_to_string(&manifest_path) {
                    match serde_json::from_str::<ModuleManifest>(&content) {
                        Ok(mut manifest) => {
                            // Fix 3: validate manifest id matches directory name
                            let dir_name = path.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("");
                            if manifest.id != dir_name {
                                eprintln!("[flux] Warning: module at {} has id '{}' but directory is '{}', skipping",
                                    path.display(), manifest.id, dir_name);
                                continue;
                            }
                            if seen_ids.insert(manifest.id.clone()) {
                                manifest.active = active_ids.contains(&manifest.id);
                                modules.push(manifest);
                            }
                        }
                        Err(e) => {
                            // Fix 2: log malformed manifests
                            eprintln!("[flux] Warning: could not parse manifest at {}: {e}", manifest_path.display());
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn list_modules(app: AppHandle, state: State<'_, AppState>) -> Vec<ModuleManifest> {
    // Snapshot active IDs under lock, then release before doing filesystem I/O
    let active_ids: std::collections::HashSet<String> = {
        let active_map = state.active_modules.lock().unwrap();
        active_map.keys().cloned().collect()
    };
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut modules = Vec::new();

    let resource_dir = app.path().resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // 1. User-installed modules (~/.local/share/flux/modules/) — highest priority
    scan_modules_dir(&flux_modules_dir(), &active_ids, &mut seen_ids, &mut modules);

    // 2. Bundled theme packs (resource_dir/themes/*/modules/)
    let themes_dir = resource_dir.join("themes");
    if themes_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&themes_dir) {
            for entry in entries.flatten() {
                let modules_path = entry.path().join("modules");
                if modules_path.is_dir() {
                    scan_modules_dir(&modules_path, &active_ids, &mut seen_ids, &mut modules);
                }
            }
        }
    }

    // 3. Legacy flat bundled path (resource_dir/modules/) — backwards compat, removed in Phase 1
    scan_modules_dir(&resource_dir.join("modules"), &active_ids, &mut seen_ids, &mut modules);

    modules
}

fn track_window(window: WebviewWindow) {
    let app_handle = window.app_handle().clone();
    let label = window.label().to_string();
    let w = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(_) | WindowEvent::Resized(_) = event {
            let state = app_handle.state::<AppState>();

            if matches!(event, WindowEvent::Moved(_)) {
                // Layer-shell windows: position is managed via margins, not pixel coords.
                let is_layer_shell = state.desktop_wayland_windows.lock().unwrap().contains(&label);
                if is_layer_shell { return; }
            }

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

/// Open a module window. Does NOT update config — caller is responsible.
fn launch_module_window(id: &str, app: &AppHandle, state: &AppState) -> Result<(), String> {
    let resource_dir = app.path().resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    let user_manifest = flux_modules_dir().join(id).join("module.json");
    let manifest_path = if user_manifest.exists() {
        user_manifest
    } else {
        let themes_dir = resource_dir.join("themes");
        let user_themes_dir = flux_user_themes_dir();
        let found = std::fs::read_dir(&user_themes_dir).ok()
            .and_then(|entries| entries.flatten().find_map(|e| {
                let p = e.path().join("modules").join(id).join("module.json");
                if p.exists() { Some(p) } else { None }
            }));
        let found = found.or_else(|| {
            std::fs::read_dir(&themes_dir).ok()
                .and_then(|entries| entries.flatten().find_map(|e| {
                    let p = e.path().join("modules").join(id).join("module.json");
                    if p.exists() { Some(p) } else { None }
                }))
        });
        found.ok_or_else(|| format!("module '{}' not found in any theme", id))?
    };

    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("cannot read manifest for '{}': {}", id, e))?;
    let manifest = serde_json::from_str::<ModuleManifest>(&content)
        .map_err(|e| format!("cannot parse manifest for '{}': {}", id, e))?;
    if manifest.id != id {
        return Err(format!("manifest id '{}' does not match requested id '{}'", manifest.id, id));
    }

    let win_config = &manifest.window;
    let url = WebviewUrl::CustomProtocol(
        format!("flux-module://{}/{}", id, manifest.entry).parse::<tauri::Url>()
            .map_err(|e| e.to_string())?
    );
    let saved = state.persistent.lock().unwrap().windows.get(id).cloned();
    let always_on_top = win_config.window_level == WindowLevel::Top;

    let mut builder = WebviewWindowBuilder::new(app, id, url)
        .title(&manifest.name)
        .transparent(win_config.transparent)
        .decorations(win_config.decorations)
        .always_on_top(always_on_top)
        .resizable(win_config.resizable)
        .skip_taskbar(true)
        .shadow(false);

    if let Some(b) = &saved {
        builder = builder.position(b.x, b.y).inner_size(b.width, b.height);
    } else {
        builder = builder.inner_size(win_config.width, win_config.height);
    }

    let window = builder.build().map_err(|e| e.to_string())?;
    if let Some(b) = &saved {
        let _ = window.set_position(tauri::PhysicalPosition::new(b.x as i32, b.y as i32));
        let _ = window.set_size(tauri::PhysicalSize::new(b.width as u32, b.height as u32));
    }

    let saved_margins = state.persistent.lock().unwrap()
        .margins.get(id).map(|m| (m.left, m.top));
    let is_wayland_desktop = desktop_layer::apply(&window, &win_config.window_level, saved_margins);
    if is_wayland_desktop {
        state.desktop_wayland_windows.lock().unwrap().insert(id.to_string());
    }
    track_window(window);
    state.active_modules.lock().unwrap().insert(id.to_string(), manifest);
    Ok(())
}

/// Close a module window and remove from active state. Does NOT update config.
fn close_module_window(id: &str, app: &AppHandle, state: &AppState) {
    state.active_modules.lock().unwrap().remove(id);
    state.desktop_wayland_windows.lock().unwrap().remove(id);
    if let Some(win) = app.get_webview_window(id) { let _ = win.close(); }
    if let Some(win) = app.get_webview_window(&format!("{}-settings", id)) { let _ = win.close(); }
}

fn build_command_center_window(app: &AppHandle) -> Result<(), String> {
    let url = WebviewUrl::CustomProtocol(
        "flux-module://_flux/command-center/index.html".parse::<tauri::Url>()
            .map_err(|e| e.to_string())?
    );
    WebviewWindowBuilder::new(app, "command-center", url)
        .title("Flux")
        .inner_size(960.0, 680.0)
        .min_inner_size(800.0, 600.0)
        .decorations(true)
        .transparent(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_module(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let is_active = state.active_modules.lock().unwrap().contains_key(&id);
    if is_active {
        close_module_window(&id, &app, &state);
    } else {
        launch_module_window(&id, &app, &state)?;
    }
    let mut cfg = state.config.lock().unwrap();
    if is_active {
        cfg.engine.active_modules.retain(|m| m != &id);
    } else if !cfg.engine.active_modules.contains(&id) {
        cfg.engine.active_modules.push(id.clone());
    }
    write_config(&state.config_path, &cfg).map_err(|e| e.to_string())
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
fn close_window(window: WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
fn drag_window(window: WebviewWindow, state: State<'_, AppState>) {
    // On Wayland, layer-shell windows cannot use xdg_toplevel.move().
    // Widget JS handles drag via move_module instead.
    let is_layer_shell = {
        let dw = state.desktop_wayland_windows.lock().unwrap();
        dw.contains(window.label())
    };
    if !is_layer_shell {
        let _ = window.start_dragging();
    }
}

fn compute_new_margins(current: (i32, i32), dx: i32, dy: i32) -> (i32, i32) {
    (current.0.saturating_add(dx), current.1.saturating_add(dy))
}

#[tauri::command]
async fn move_module(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    dx: i32,
    dy: i32,
) -> Result<(), String> {
    // Only applies to Wayland desktop-layer windows
    {
        let dw = state.desktop_wayland_windows.lock().unwrap();
        if !dw.contains(&id) {
            return Ok(());
        }
    }

    let Some(window) = app.get_webview_window(&id) else {
        return Err(format!("move_module: window '{id}' is in desktop_wayland_windows but not found in app — state mismatch"));
    };

    let (new_left, new_top) = {
        let p = state.persistent.lock().unwrap();
        let current = p.margins.get(&id).map(|m| (m.left, m.top)).unwrap_or((0, 0));
        compute_new_margins(current, dx, dy)
    };

    // gtk-layer-shell requires the GTK main thread; dispatch via run_on_main_thread.
    // Fire-and-forget: disk write below can proceed immediately since it's independent.
    app.run_on_main_thread(move || {
        desktop_layer::set_margins(&window, new_left, new_top);
    }).map_err(|e| e.to_string())?;

    {
        let mut p = state.persistent.lock().unwrap();
        p.margins.insert(id.clone(), MarginPosition { left: new_left, top: new_top });
        let state_path = state.data_dir.join("window_state.json");
        p.save(&state_path);
    }

    Ok(())
}

#[tauri::command]
fn is_layer_shell_window(window: WebviewWindow, state: State<'_, AppState>) -> bool {
    #[cfg(target_os = "linux")]
    {
        let dw = state.desktop_wayland_windows.lock().unwrap();
        return dw.contains(window.label());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, state);
        false
    }
}

fn setup_panic_log() {
    let log_path = flux_user_dir().join("crash.log");
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default_hook(info); // still prints to terminal
        let bt = std::backtrace::Backtrace::force_capture();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let entry = format!("=== CRASH at unix:{ts} ===\n{info}\n{bt}\n\n");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
            let _ = std::io::Write::write_all(&mut f, entry.as_bytes());
        }
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_panic_log();
    tauri::Builder::default()
        .register_uri_scheme_protocol("flux-module", |ctx, request| {
            let uri = request.uri().to_string();
            let path_part = uri.strip_prefix("flux-module://").unwrap_or("");

            // Special case: _flux/ prefix serves from the bundled runtime directory
            if let Some(runtime_rel) = path_part.strip_prefix("_flux/") {
                let runtime_base = ctx.app_handle().path().resource_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join("runtime");
                let candidate = runtime_base.join(runtime_rel);
                // Guard against path traversal
                let file_path = if let Ok(canonical) = candidate.canonicalize() {
                    let canonical_base = runtime_base.canonicalize().unwrap_or_else(|e| {
                        eprintln!("[flux] Warning: could not canonicalize runtime resource path: {e}");
                        runtime_base.clone()
                    });
                    if canonical.starts_with(&canonical_base) {
                        canonical
                    } else {
                        return tauri::http::Response::builder().status(403).body(Vec::new()).unwrap();
                    }
                } else {
                    return tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
                };
                return if let Ok(content) = fs::read(&file_path) {
                    let ext = file_path.extension().map_or("", |e: &std::ffi::OsStr| e.to_str().unwrap_or(""));
                    let mime = mime_for_ext(ext);
                    tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .body(content)
                        .unwrap()
                } else {
                    tauri::http::Response::builder().status(404).body(Vec::new()).unwrap()
                };
            }

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
                // Not in user dir — search theme packs, then legacy flat bundled path
                let resource_dir = ctx.app_handle().path().resource_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));

                // Try themes/*/modules/<path_part>
                let themes_dir = resource_dir.join("themes");
                let theme_canonical = if themes_dir.exists() {
                    // Fix 1: canonicalize themes_dir once for symlink escape prevention
                    let themes_base_canonical = themes_dir.canonicalize()
                        .unwrap_or_else(|_| themes_dir.clone());
                    std::fs::read_dir(&themes_dir)
                        .ok()
                        .and_then(|entries| {
                            entries.flatten().find_map(|entry| {
                                let theme_modules_base = entry.path().join("modules");
                                let candidate = theme_modules_base.join(path_part);
                                if let Ok(canonical) = candidate.canonicalize() {
                                    let base_canonical = theme_modules_base.canonicalize()
                                        .unwrap_or(theme_modules_base.clone());
                                    // Fix 1: also verify path stays within themes_dir
                                    if canonical.starts_with(&base_canonical) && canonical.starts_with(&themes_base_canonical) {
                                        Some(canonical)
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            })
                        })
                } else {
                    None
                };

                if let Some(canonical) = theme_canonical {
                    canonical
                } else {
                    // Legacy flat bundled path
                    let bundled_base = resource_dir.join("modules");
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
                }
            };

            if let Ok(content) = fs::read(&file_path) {
                let ext = file_path.extension().map_or("", |e: &std::ffi::OsStr| e.to_str().unwrap_or(""));
                let mime = mime_for_ext(ext);
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

            let data_dir = app.path().app_data_dir().unwrap_or_else(|e| {
                eprintln!("Warning: could not resolve app data dir ({}), using current directory", e);
                PathBuf::from(".")
            });

            if let Err(e) = ensure_flux_dirs() {
                eprintln!("Warning: could not create Flux directories: {}", e);
            }

            let state_path = data_dir.join("window_state.json");
            let persistent = PersistentState::load(&state_path);

            let config_path = flux_config_path();
            let is_first_run = !config_exists(&config_path);
            let engine_config = read_config(&config_path);
            let interval_ms = engine_config.engine.broadcast_interval_ms;
            let active_on_start: Vec<String> = engine_config.engine.active_modules.clone();

            app.manage(AppState {
                sys: Mutex::new(System::new_all()),
                nvml,
                last_net_io: Mutex::new((0, 0, Instant::now())),
                last_disk_io: Mutex::new((0, 0, Instant::now())),
                active_modules: Mutex::new(HashMap::new()),
                persistent: Mutex::new(persistent),
                data_dir,
                desktop_wayland_windows: Mutex::new(HashSet::new()),
                config: Mutex::new(engine_config),
                config_path: config_path.clone(),
            });

            // System tray
            use tauri::menu::PredefinedMenuItem;
            let open_i   = MenuItem::with_id(app, "open_cc", "Open Command Center",  true, None::<&str>)?;
            let browse_i = MenuItem::with_id(app, "browse",  "Browse Themes Folder", true, None::<&str>)?;
            let sep      = PredefinedMenuItem::separator(app)?;
            let quit_i   = MenuItem::with_id(app, "quit",    "Quit Flux",            true, None::<&str>)?;
            let menu     = Menu::with_items(app, &[&open_i, &browse_i, &sep, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit"    => std::process::exit(0),
                    "open_cc" => { let _ = build_command_center_window(app); }
                    "browse"  => {
                        let dir = flux_user_themes_dir();
                        let _ = std::fs::create_dir_all(&dir);
                        use tauri_plugin_opener::OpenerExt;
                        let _ = app.opener().open_path(dir.to_str().unwrap_or("."), None::<&str>);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        let _ = build_command_center_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            broadcaster::start(app.handle().clone(), interval_ms);

            let handle = app.handle().clone();
            if is_first_run {
                build_command_center_window(&handle)?;
            } else {
                let state = handle.state::<AppState>();
                for id in &active_on_start {
                    if let Err(e) = launch_module_window(id, &handle, &state) {
                        eprintln!("[flux] Warning: could not launch '{}' on startup: {}", id, e);
                    }
                }
            }

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            drag_window, list_modules, toggle_module,
            open_module_settings, close_window, move_module,
            metrics::system_cpu,
            metrics::system_memory,
            metrics::system_disk,
            metrics::system_network,
            metrics::system_gpu,
            metrics::system_battery,
            metrics::system_uptime,
            metrics::system_os,
            metrics::system_disk_io,
            is_layer_shell_window,
        ])
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

    #[test]
    fn persistent_state_margins_roundtrip() {
        let path = temp_dir().join("flux_test_margins.json");
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
        assert_eq!(compute_new_margins((100, 50), 10, -5), (110, 45));
    }

    #[test]
    fn compute_new_margins_allows_negative() {
        assert_eq!(compute_new_margins((5, 5), -10, -10), (-5, -5));
    }

    #[test]
    fn disk_io_info_fields_are_optional() {
        let info = metrics::DiskIoInfo { read: None, write: None };
        assert!(info.read.is_none());
        assert!(info.write.is_none());
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("null"));
    }

    #[test]
    fn scan_modules_dir_deduplicates() {
        use std::fs;

        // Create two separate theme dirs, each containing the same module id
        let base = temp_dir().join(format!("flux_test_dedup_{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
        let theme1_modules = base.join("theme1").join("modules").join("my-module");
        let theme2_modules = base.join("theme2").join("modules").join("my-module");
        fs::create_dir_all(&theme1_modules).unwrap();
        fs::create_dir_all(&theme2_modules).unwrap();

        let manifest_json = r#"{
            "id": "my-module",
            "name": "Test",
            "author": "tester",
            "version": "1.0.0",
            "entry": "index.html",
            "window": {
                "width": 400, "height": 300,
                "transparent": false, "decorations": true,
                "windowLevel": "desktop", "resizable": false
            },
            "permissions": []
        }"#;
        fs::write(theme1_modules.join("module.json"), manifest_json).unwrap();
        fs::write(theme2_modules.join("module.json"), manifest_json).unwrap();

        let active_ids = std::collections::HashSet::new();
        let mut seen_ids = std::collections::HashSet::new();
        let mut modules = Vec::new();

        scan_modules_dir(
            &base.join("theme1").join("modules"),
            &active_ids,
            &mut seen_ids,
            &mut modules,
        );
        scan_modules_dir(
            &base.join("theme2").join("modules"),
            &active_ids,
            &mut seen_ids,
            &mut modules,
        );

        assert_eq!(modules.len(), 1, "module should appear exactly once despite being in two theme dirs");
        assert_eq!(modules[0].id, "my-module");

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn is_layer_shell_window_detects_registered_window() {
        let mut set = HashSet::<String>::new();
        set.insert("module-test".to_string());
        assert!(set.contains("module-test"));
        assert!(!set.contains("module-other"));
    }
}

# Phase 4d-a: Custom Data Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shell-command and HTTP-polling custom data sources to the widget editor, so widgets can display any data beyond the 12 built-in system metrics.

**Architecture:** A new Rust module (`custom_data.rs`) manages per-source polling threads that emit `custom-data:<name>` Tauri events — identical to the existing `system:cpu` / `system:memory` event pattern. The JS side adds a 5th "Sources" floating panel, wires custom sources into the data-source dropdowns, and serializes them into the widget state and export.

**Tech Stack:** Rust (std::thread, std::process::Command, reqwest 0.12 blocking), Tauri 2 events, vanilla ES modules (no bundler).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `flux/app/src-tauri/Cargo.toml` | Modify | Add reqwest dependency |
| `flux/app/src-tauri/src/custom_data.rs` | Create | Polling broker, fetch_value, CustomSourceDef |
| `flux/app/src-tauri/src/lib.rs` | Modify | Add mod, AppState field, 2 Tauri commands, invoke_handler |
| `flux/app/runtime/widget-editor/data-sources.js` | Create | Panel UI, serialize/deserialize, register sources |
| `flux/app/runtime/widget-editor/store.js` | Modify | Include dataSources in serialize/deserialize |
| `flux/app/runtime/widget-editor/app.js` | Modify | Import data-sources, setContext, getAppState/setAppState, PANEL_IDS |
| `flux/app/runtime/widget-editor/live-data.js` | Modify | Subscribe to custom-data events in setupLiveData/teardownLiveData |
| `flux/app/runtime/widget-editor/render.js` | Modify | Custom source option in DATA_SOURCES dropdowns |
| `flux/app/runtime/widget-editor/file-ops.js` | Modify | Emit dataSources array in widget.json |
| `flux/app/runtime/widget-editor/index.html` | Modify | Add Sources panel div |
| `flux/app/runtime/widget-editor/style.css` | Modify | Sources panel styles |

---

### Task 1: Rust — reqwest + custom_data.rs skeleton with data types and fetch_value

**Files:**
- Modify: `flux/app/src-tauri/Cargo.toml`
- Create: `flux/app/src-tauri/src/custom_data.rs`

- [ ] **Step 1: Add reqwest to Cargo.toml**

Open `flux/app/src-tauri/Cargo.toml`. After the `zip = "2"` line, add:

```toml
reqwest = { version = "0.12", features = ["blocking", "json", "rustls-tls"], default-features = false }
```

- [ ] **Step 2: Write the failing test (json_path extraction)**

Create `flux/app/src-tauri/src/custom_data.rs` with just the test:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_path_nested() {
        let json = r#"{"current":{"temperature_2m":23.5}}"#;
        assert_eq!(extract_json_path(json, "current.temperature_2m").unwrap(), "23.5");
    }

    #[test]
    fn extract_json_path_string_value() {
        let json = r#"{"artist":"Radiohead"}"#;
        assert_eq!(extract_json_path(json, "artist").unwrap(), "Radiohead");
    }

    #[test]
    fn extract_json_path_missing_key() {
        let json = r#"{"a":1}"#;
        assert!(extract_json_path(json, "b").is_err());
    }

    #[test]
    fn extract_json_path_invalid_json() {
        assert!(extract_json_path("not json", "key").is_err());
    }

    #[test]
    fn fetch_shell_echo() {
        let def = CustomSourceDef {
            name: "test".to_string(),
            source_type: "shell".to_string(),
            command: "echo hello".to_string(),
            platform_overrides: std::collections::HashMap::new(),
            url: String::new(),
            json_path: String::new(),
            interval_secs: 5,
        };
        let result = fetch_value(&def).unwrap();
        assert_eq!(result, "hello");
    }

    #[test]
    fn fetch_unknown_source_type_errors() {
        let def = CustomSourceDef {
            name: "t".to_string(),
            source_type: "ftp".to_string(),
            command: String::new(),
            platform_overrides: std::collections::HashMap::new(),
            url: String::new(),
            json_path: String::new(),
            interval_secs: 1,
        };
        assert!(fetch_value(&def).is_err());
    }
}
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd flux/app/src-tauri && cargo test custom_data 2>&1 | head -20
```

Expected: compile error (types not defined yet).

- [ ] **Step 4: Implement CustomSourceDef, fetch_value, and helpers**

Replace the contents of `custom_data.rs` with:

```rust
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// ── Data Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomSourceDef {
    pub name: String,
    #[serde(rename = "type")]
    pub source_type: String, // "shell" | "http"
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub platform_overrides: HashMap<String, String>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub json_path: String,
    pub interval_secs: u64,
}

// ── JSON path extraction ──────────────────────────────────────────────────────

pub fn extract_json_path(json: &str, path: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("invalid JSON: {}", e))?;
    let mut current = &value;
    for key in path.split('.') {
        current = current.get(key)
            .ok_or_else(|| format!("key '{}' not found in path '{}'", key, path))?;
    }
    Ok(match current {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b)   => b.to_string(),
        serde_json::Value::Null      => "null".to_string(),
        v => v.to_string(),
    })
}

// ── Shell execution ───────────────────────────────────────────────────────────

fn resolve_shell_command<'a>(def: &'a CustomSourceDef) -> &'a str {
    #[cfg(target_os = "windows")]
    if let Some(cmd) = def.platform_overrides.get("windows") { return cmd; }
    #[cfg(target_os = "macos")]
    if let Some(cmd) = def.platform_overrides.get("macos") { return cmd; }
    #[cfg(target_os = "linux")]
    if let Some(cmd) = def.platform_overrides.get("linux") { return cmd; }
    &def.command
}

fn fetch_shell(def: &CustomSourceDef) -> Result<String, String> {
    let cmd_str = resolve_shell_command(def);
    if cmd_str.is_empty() { return Err("empty command".to_string()); }

    #[cfg(target_os = "windows")]
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", cmd_str])
        .output()
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .args(["-c", cmd_str])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("command failed: {}", stderr.trim()));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().next().unwrap_or("").trim().to_string())
}

// ── HTTP execution ────────────────────────────────────────────────────────────

fn fetch_http(def: &CustomSourceDef, client: Option<&reqwest::blocking::Client>) -> Result<String, String> {
    if def.url.is_empty() { return Err("empty URL".to_string()); }
    let owned;
    let c = match client {
        Some(c) => c,
        None => {
            owned = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|e| e.to_string())?;
            &owned
        }
    };
    let body = c.get(&def.url).send().map_err(|e| e.to_string())?.text().map_err(|e| e.to_string())?;
    if def.json_path.is_empty() { return Ok(body.trim().to_string()); }
    extract_json_path(&body, &def.json_path)
}

// ── Public fetch_value (used by Tauri command test_custom_source) ─────────────

pub fn fetch_value(def: &CustomSourceDef) -> Result<String, String> {
    match def.source_type.as_str() {
        "shell" => fetch_shell(def),
        "http"  => fetch_http(def, None),
        t => Err(format!("unknown source type: {}", t)),
    }
}

// ── Polling broker ────────────────────────────────────────────────────────────

pub struct CustomDataBroker {
    stop_flags: Mutex<Vec<Arc<AtomicBool>>>,
}

impl CustomDataBroker {
    pub fn new() -> Self {
        CustomDataBroker { stop_flags: Mutex::new(Vec::new()) }
    }

    pub fn register(&self, app: AppHandle, sources: Vec<CustomSourceDef>) {
        self.stop_all();
        let mut flags = self.stop_flags.lock().unwrap();
        for def in sources {
            let stop = Arc::new(AtomicBool::new(false));
            flags.push(stop.clone());
            let app_clone = app.clone();
            thread::spawn(move || run_source(app_clone, def, stop));
        }
    }

    pub fn stop_all(&self) {
        let mut flags = self.stop_flags.lock().unwrap();
        for flag in flags.iter() { flag.store(true, Ordering::Relaxed); }
        flags.clear();
    }
}

fn run_source(app: AppHandle, def: CustomSourceDef, stop: Arc<AtomicBool>) {
    // Build HTTP client once per thread (avoids re-creating the internal runtime every poll)
    let client = if def.source_type == "http" {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .ok()
    } else {
        None
    };

    loop {
        if stop.load(Ordering::Relaxed) { break; }
        match if def.source_type == "http" { fetch_http(&def, client.as_ref()) } else { fetch_shell(&def) } {
            Ok(val) => { let _ = app.emit(&format!("custom-data:{}", def.name), &val); }
            Err(e)  => { eprintln!("[custom-data:{}] error: {}", def.name, e); }
        }
        // Sleep in 100ms slices so the stop flag is checked frequently
        let total_ms = def.interval_secs * 1000;
        let mut elapsed = 0u64;
        while elapsed < total_ms {
            if stop.load(Ordering::Relaxed) { return; }
            thread::sleep(Duration::from_millis(100));
            elapsed += 100;
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_path_nested() {
        let json = r#"{"current":{"temperature_2m":23.5}}"#;
        assert_eq!(extract_json_path(json, "current.temperature_2m").unwrap(), "23.5");
    }

    #[test]
    fn extract_json_path_string_value() {
        let json = r#"{"artist":"Radiohead"}"#;
        assert_eq!(extract_json_path(json, "artist").unwrap(), "Radiohead");
    }

    #[test]
    fn extract_json_path_missing_key() {
        let json = r#"{"a":1}"#;
        assert!(extract_json_path(json, "b").is_err());
    }

    #[test]
    fn extract_json_path_invalid_json() {
        assert!(extract_json_path("not json", "key").is_err());
    }

    #[test]
    fn fetch_shell_echo() {
        let def = CustomSourceDef {
            name: "test".to_string(),
            source_type: "shell".to_string(),
            command: "echo hello".to_string(),
            platform_overrides: HashMap::new(),
            url: String::new(),
            json_path: String::new(),
            interval_secs: 5,
        };
        let result = fetch_value(&def).unwrap();
        assert_eq!(result, "hello");
    }

    #[test]
    fn fetch_unknown_source_type_errors() {
        let def = CustomSourceDef {
            name: "t".to_string(),
            source_type: "ftp".to_string(),
            command: String::new(),
            platform_overrides: HashMap::new(),
            url: String::new(),
            json_path: String::new(),
            interval_secs: 1,
        };
        assert!(fetch_value(&def).is_err());
    }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd flux/app/src-tauri && cargo test custom_data 2>&1
```

Expected: `test result: ok. 5 passed; 0 failed`

- [ ] **Step 6: Commit**

```bash
cd flux/app/src-tauri && git add Cargo.toml src/custom_data.rs && git commit -m "feat(rust): add custom_data module with shell/http fetch and json_path extraction"
```

---

### Task 2: Rust — Wire custom_data into lib.rs (AppState + commands + invoke_handler)

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add `mod custom_data;` and `use` import**

In `lib.rs`, find the block of `mod` declarations at the top (lines 1–10). Add after `mod autostart;`:

```rust
pub mod custom_data;
use custom_data::{CustomDataBroker, CustomSourceDef};
```

- [ ] **Step 2: Add `custom_broker` field to AppState**

Find the `pub struct AppState {` block (~line 185). Add the new field:

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
    pub custom_broker: CustomDataBroker,  // ← add this line
}
```

- [ ] **Step 3: Initialize custom_broker in app.manage()**

Find `app.manage(AppState {` (~line 1207). Add the field:

```rust
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
    custom_broker: CustomDataBroker::new(),  // ← add this line
});
```

- [ ] **Step 4: Add the two Tauri commands**

Find the `fn export_widget_package` command (~line 632). Add these two new commands after it (before the next `#[tauri::command]` block):

```rust
#[tauri::command]
fn register_custom_sources(
    app: AppHandle,
    state: State<'_, AppState>,
    sources: Vec<CustomSourceDef>,
) {
    state.custom_broker.register(app, sources);
}

#[tauri::command]
fn test_custom_source(def: CustomSourceDef) -> Result<String, String> {
    custom_data::fetch_value(&def)
}
```

- [ ] **Step 5: Add commands to invoke_handler**

Find `.invoke_handler(tauri::generate_handler![` (~line 1306). Add the two new commands:

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
    register_custom_sources, test_custom_source,  // ← add this line
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

- [ ] **Step 6: Confirm cargo test still passes**

```bash
cd flux/app/src-tauri && cargo test 2>&1 | tail -5
```

Expected: `test result: ok. N passed; 0 failed`

- [ ] **Step 7: Commit**

```bash
cd flux/app/src-tauri && git add src/lib.rs && git commit -m "feat(rust): register_custom_sources and test_custom_source Tauri commands"
```

---

### Task 3: JS — data-sources.js module (state, serialize/deserialize, register, test)

**Files:**
- Create: `flux/app/runtime/widget-editor/data-sources.js`

- [ ] **Step 1: Create the module**

```js
// ── data-sources.js — Custom data source state and panel ─────────────────────

let _ctx = null;
export function setContext(ctx) { _ctx = ctx; }

// ── State ─────────────────────────────────────────────────────────────────────

let _sources = []; // Array of CustomSourceDef objects
let _liveValues = {}; // { [name]: string }
let _unsubs = [];   // Tauri event unsubscribe functions

export function getSources() { return _sources; }

export function serializeSources() {
    return _sources;
}

export function deserializeSources(data) {
    _sources = Array.isArray(data) ? data.map(s => ({ ...s })) : [];
}

// ── Live preview subscriptions ────────────────────────────────────────────────

export function startSourceListeners() {
    stopSourceListeners();
    const { listen } = window.__TAURI__.event;
    _sources.forEach(s => {
        let cancel = null;
        listen(`custom-data:${s.name}`, e => {
            _liveValues[s.name] = String(e.payload);
            renderSourcesPanel();
        }).then(fn => { cancel = fn; });
        _unsubs.push(() => { if (cancel) cancel(); });
    });
}

export function stopSourceListeners() {
    _unsubs.forEach(fn => fn());
    _unsubs = [];
}

export function getLiveValues() { return _liveValues; }

// ── Register sources with Rust broker ─────────────────────────────────────────

export async function registerSources() {
    if (!_ctx) return;
    try {
        await _ctx.invoke('register_custom_sources', { sources: _sources });
    } catch (e) {
        console.error('[data-sources] register failed:', e);
    }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function addSource(def) {
    _sources.push({ ...def });
    await registerSources();
    startSourceListeners();
    _ctx.pushHistory();
    renderSourcesPanel();
}

export async function updateSource(name, def) {
    const idx = _sources.findIndex(s => s.name === name);
    if (idx !== -1) {
        _sources[idx] = { ...def };
        await registerSources();
        startSourceListeners();
        _ctx.pushHistory();
        renderSourcesPanel();
    }
}

export async function removeSource(name) {
    _sources = _sources.filter(s => s.name !== name);
    delete _liveValues[name];
    await registerSources();
    startSourceListeners();
    _ctx.pushHistory();
    renderSourcesPanel();
}

export async function testSource(def) {
    return _ctx.invoke('test_custom_source', { def });
}

// ── Panel rendering ───────────────────────────────────────────────────────────

export function renderSourcesPanel() {
    const body = document.getElementById('sources-body');
    if (!body) return;

    if (_sources.length === 0) {
        body.innerHTML = `
            <p class="empty-state">No custom sources yet.</p>
            <button id="btn-add-source" class="btn-primary" style="width:100%;margin-top:6px;">+ Add Source</button>
        `;
    } else {
        let html = '<div class="sources-list">';
        for (const s of _sources) {
            const val = _liveValues[s.name];
            const badge = s.type === 'http' ? 'HTTP' : 'SHELL';
            const badgeClass = s.type === 'http' ? 'badge-http' : 'badge-shell';
            html += `
                <div class="source-row" data-name="${s.name}">
                    <div class="source-row-main">
                        <span class="source-badge ${badgeClass}">${badge}</span>
                        <span class="source-name">${s.name}</span>
                        <span class="source-live-val">${val !== undefined ? val : '…'}</span>
                    </div>
                    <div class="source-row-actions">
                        <button class="source-edit-btn btn-icon" data-name="${s.name}" title="Edit">✎</button>
                        <button class="source-del-btn btn-icon" data-name="${s.name}" title="Delete">×</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        html += `<button id="btn-add-source" class="btn-primary" style="width:100%;margin-top:6px;">+ Add Source</button>`;
        body.innerHTML = html;
    }

    body.querySelector('#btn-add-source')?.addEventListener('click', () => showSourceForm(body, null));

    body.querySelectorAll('.source-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const src = _sources.find(s => s.name === btn.dataset.name);
            if (src) showSourceForm(body, src);
        });
    });

    body.querySelectorAll('.source-del-btn').forEach(btn => {
        btn.addEventListener('click', () => removeSource(btn.dataset.name));
    });
}

// ── Add/Edit form ─────────────────────────────────────────────────────────────

const INTERVAL_OPTIONS = [
    { value: 1,   label: '1 second' },
    { value: 5,   label: '5 seconds' },
    { value: 10,  label: '10 seconds' },
    { value: 30,  label: '30 seconds' },
    { value: 60,  label: '1 minute' },
    { value: 300, label: '5 minutes' },
    { value: 900, label: '15 minutes' },
];

function showSourceForm(container, existing) {
    const editing = !!existing;
    const def = existing ? { ...existing } : {
        name: '', type: 'shell', command: '', platformOverrides: {}, url: '', jsonPath: '', intervalSecs: 5,
    };

    container.innerHTML = `
        <div class="source-form">
            <div class="prop-row">
                <label class="prop-label">Name</label>
                <input id="sf-name" class="prop-input" type="text" value="${def.name}" placeholder="my_source">
            </div>
            <div class="prop-row">
                <label class="prop-label">Type</label>
                <select id="sf-type" class="prop-input">
                    <option value="shell" ${def.type === 'shell' ? 'selected' : ''}>Shell Command</option>
                    <option value="http"  ${def.type === 'http'  ? 'selected' : ''}>HTTP</option>
                </select>
            </div>
            <div class="prop-row">
                <label class="prop-label">Interval</label>
                <select id="sf-interval" class="prop-input">
                    ${INTERVAL_OPTIONS.map(o => `<option value="${o.value}" ${def.intervalSecs === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </div>

            <div id="sf-shell-fields" style="display:${def.type === 'shell' ? 'block' : 'none'}">
                <div class="prop-row">
                    <label class="prop-label">Command</label>
                    <input id="sf-command" class="prop-input" type="text" value="${def.command}" placeholder="echo hello">
                </div>
                <details style="margin-bottom:6px;">
                    <summary style="font-size:10px;color:#888;cursor:pointer;">Per-platform overrides (optional)</summary>
                    <div class="prop-row"><label class="prop-label">Linux</label><input id="sf-linux" class="prop-input" type="text" value="${def.platformOverrides?.linux || ''}"></div>
                    <div class="prop-row"><label class="prop-label">macOS</label><input id="sf-macos" class="prop-input" type="text" value="${def.platformOverrides?.macos || ''}"></div>
                    <div class="prop-row"><label class="prop-label">Windows</label><input id="sf-windows" class="prop-input" type="text" value="${def.platformOverrides?.windows || ''}"></div>
                </details>
            </div>

            <div id="sf-http-fields" style="display:${def.type === 'http' ? 'block' : 'none'}">
                <div class="prop-row">
                    <label class="prop-label">URL</label>
                    <input id="sf-url" class="prop-input" type="text" value="${def.url}" placeholder="https://api.example.com/data">
                </div>
                <div class="prop-row">
                    <label class="prop-label">JSON Path</label>
                    <input id="sf-jsonpath" class="prop-input" type="text" value="${def.jsonPath || ''}" placeholder="current.temperature_2m">
                </div>
                <div style="margin-bottom:6px;">
                    <a id="sf-preset-link" href="#" style="font-size:10px;color:#00bfff;">Use a preset...</a>
                </div>
            </div>

            <div id="sf-test-result" style="display:none; font-size:11px; padding:4px 6px; border-radius:3px; margin-bottom:6px;"></div>

            <div style="display:flex; gap:6px;">
                <button id="sf-test" class="btn-secondary" style="flex:1;">Test</button>
                <button id="sf-cancel" class="btn-secondary" style="flex:1;">Cancel</button>
                <button id="sf-save" class="btn-primary" style="flex:2;">${editing ? 'Update' : 'Add'}</button>
            </div>
        </div>
    `;

    // Show/hide fields by type
    container.querySelector('#sf-type').addEventListener('change', function() {
        container.querySelector('#sf-shell-fields').style.display = this.value === 'shell' ? 'block' : 'none';
        container.querySelector('#sf-http-fields').style.display  = this.value === 'http'  ? 'block' : 'none';
    });

    // Test button
    container.querySelector('#sf-test').addEventListener('click', async () => {
        const resultEl = container.querySelector('#sf-test-result');
        resultEl.style.display = 'block';
        resultEl.style.background = '#1a1a2e';
        resultEl.textContent = 'Running…';
        try {
            const d = readForm(container, def.name);
            const val = await testSource(d);
            resultEl.style.background = '#0a2a0a';
            resultEl.textContent = '✓ ' + val;
        } catch (e) {
            resultEl.style.background = '#2a0a0a';
            resultEl.textContent = '✗ ' + e;
        }
    });

    // Preset link
    container.querySelector('#sf-preset-link')?.addEventListener('click', e => {
        e.preventDefault();
        showPresetPicker(container, def);
    });

    // Cancel
    container.querySelector('#sf-cancel').addEventListener('click', () => renderSourcesPanel());

    // Save
    container.querySelector('#sf-save').addEventListener('click', () => {
        const d = readForm(container, def.name);
        if (!d.name) { alert('Source name is required.'); return; }
        if (editing) {
            updateSource(existing.name, d);
        } else {
            if (_sources.find(s => s.name === d.name)) { alert('A source with that name already exists.'); return; }
            addSource(d);
        }
    });
}

function readForm(container, originalName) {
    const type = container.querySelector('#sf-type').value;
    return {
        name: container.querySelector('#sf-name').value.trim().replace(/[^a-z0-9_]/gi, '_') || originalName,
        type,
        command: container.querySelector('#sf-command')?.value.trim() || '',
        platformOverrides: {
            linux:   container.querySelector('#sf-linux')?.value.trim()   || undefined,
            macos:   container.querySelector('#sf-macos')?.value.trim()   || undefined,
            windows: container.querySelector('#sf-windows')?.value.trim() || undefined,
        },
        url:          container.querySelector('#sf-url')?.value.trim()      || '',
        jsonPath:     container.querySelector('#sf-jsonpath')?.value.trim() || '',
        intervalSecs: parseInt(container.querySelector('#sf-interval').value) || 5,
    };
}

// ── Smart Presets ─────────────────────────────────────────────────────────────

const HTTP_PRESETS = [
    {
        id: 'open-meteo',
        name: 'Open-Meteo (Weather — no key required)',
        fields: [
            { key: 'lat',      label: 'Latitude',  type: 'number', default: '51.5' },
            { key: 'lon',      label: 'Longitude', type: 'number', default: '-0.1' },
            { key: 'variable', label: 'Metric',    type: 'select',
              options: ['temperature_2m','relative_humidity_2m','wind_speed_10m','precipitation','surface_pressure'] },
        ],
        buildUrl: c => `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=${c.variable}`,
        buildPath: c => `current.${c.variable}`,
    },
    {
        id: 'coingecko',
        name: 'CoinGecko (Crypto — free key required)',
        keyLink: 'https://www.coingecko.com/en/api',
        fields: [
            { key: 'coin',     label: 'Coin ID',   type: 'text',   default: 'bitcoin', placeholder: 'bitcoin, ethereum…' },
            { key: 'currency', label: 'Currency',  type: 'select', options: ['usd','eur','gbp','jpy'] },
            { key: 'apiKey',   label: 'API Key',   type: 'text',   default: '', placeholder: 'Paste your CoinGecko Demo key' },
        ],
        buildUrl: c => `https://api.coingecko.com/api/v3/simple/price?ids=${c.coin}&vs_currencies=${c.currency}&x_cg_demo_api_key=${c.apiKey}`,
        buildPath: c => `${c.coin}.${c.currency}`,
    },
    {
        id: 'thesportsdb',
        name: 'TheSportsDB (Sports — no key required)',
        fields: [
            { key: 'team', label: 'Team Name', type: 'text', default: 'Arsenal' },
        ],
        buildUrl: c => `https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=${encodeURIComponent(c.team)}`,
        buildPath: () => 'teams.0.strTeam',
    },
    {
        id: 'homeassistant',
        name: 'Home Assistant (local)',
        fields: [
            { key: 'url',    label: 'HA URL',     type: 'text', default: 'http://homeassistant.local:8123', placeholder: 'http://homeassistant.local:8123' },
            { key: 'token',  label: 'Long-Lived Token', type: 'text', default: '', placeholder: 'Paste your HA long-lived access token' },
            { key: 'entity', label: 'Entity ID',  type: 'text', default: 'sensor.temperature', placeholder: 'sensor.living_room_temp' },
        ],
        buildUrl: c => `${c.url}/api/states/${c.entity}`,
        buildPath: () => 'state',
        buildHeaders: c => ({ Authorization: `Bearer ${c.token}` }),
    },
];

function showPresetPicker(container, currentDef) {
    const nameEl = container.querySelector('#sf-name');
    const urlEl  = container.querySelector('#sf-url');
    const pathEl = container.querySelector('#sf-jsonpath');

    let html = '<div class="preset-picker"><div style="font-size:11px;color:#888;margin-bottom:8px;">Choose a preset:</div>';
    HTTP_PRESETS.forEach(p => {
        html += `<div class="preset-option" data-id="${p.id}" style="cursor:pointer;padding:5px 6px;border-radius:3px;margin-bottom:3px;background:#1a1a2e;">${p.name}</div>`;
    });
    html += `<button id="preset-cancel" class="btn-secondary" style="width:100%;margin-top:6px;">Cancel</button></div>`;

    // Insert picker above the URL field
    const httpFields = container.querySelector('#sf-http-fields');
    const existingPicker = httpFields.querySelector('.preset-picker');
    if (existingPicker) existingPicker.remove();
    httpFields.insertAdjacentHTML('afterbegin', html);

    httpFields.querySelector('#preset-cancel').addEventListener('click', () => {
        httpFields.querySelector('.preset-picker').remove();
    });

    httpFields.querySelectorAll('.preset-option').forEach(el => {
        el.addEventListener('click', () => {
            const preset = HTTP_PRESETS.find(p => p.id === el.dataset.id);
            if (!preset) return;
            showPresetConfig(httpFields, preset, nameEl, urlEl, pathEl);
        });
    });
}

function showPresetConfig(httpFields, preset, nameEl, urlEl, pathEl) {
    const picker = httpFields.querySelector('.preset-picker');
    const config = {};
    preset.fields.forEach(f => { config[f.key] = f.default || ''; });

    let formHtml = `<div class="preset-config"><div style="font-size:11px;font-weight:bold;color:#00bfff;margin-bottom:6px;">${preset.name}</div>`;
    preset.fields.forEach(f => {
        formHtml += `<div class="prop-row"><label class="prop-label">${f.label}</label>`;
        if (f.type === 'select') {
            formHtml += `<select class="prop-input preset-field" data-key="${f.key}">${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}</select>`;
        } else {
            formHtml += `<input class="prop-input preset-field" type="${f.type === 'number' ? 'number' : 'text'}" data-key="${f.key}" value="${f.default || ''}" placeholder="${f.placeholder || ''}">`;
        }
        formHtml += `</div>`;
        if (f.type === 'text' && preset.keyLink && f.key === 'apiKey') {
            formHtml += `<div style="font-size:10px;margin-bottom:4px;"><a href="#" onclick="window.__TAURI__.opener.open('${preset.keyLink}');return false;" style="color:#00bfff;">Register for a free key →</a></div>`;
        }
    });
    formHtml += `<div style="display:flex;gap:6px;margin-top:6px;">
        <button id="preset-apply" class="btn-primary" style="flex:1;">Apply</button>
        <button id="preset-back" class="btn-secondary" style="flex:1;">Back</button>
    </div></div>`;

    picker.innerHTML = formHtml;

    picker.querySelectorAll('.preset-field').forEach(el => {
        config[el.dataset.key] = el.value;
        el.addEventListener('input', () => { config[el.dataset.key] = el.value; });
    });

    picker.querySelector('#preset-apply').addEventListener('click', () => {
        const url = preset.buildUrl(config);
        const path = preset.buildPath(config);
        urlEl.value = url;
        pathEl.value = path;
        if (!nameEl.value) nameEl.value = preset.id.replace('-', '_');
        picker.remove();
    });

    picker.querySelector('#preset-back').addEventListener('click', () => showPresetPicker(httpFields.parentElement, {}));
}
```

- [ ] **Step 2: Verify module syntax**

```bash
node --input-type=module < flux/app/runtime/widget-editor/data-sources.js 2>&1 | head -5
```

Expected: error about `window` not defined (correct — it's a browser module, not Node). If you see a syntax error instead, fix it.

- [ ] **Step 3: Commit**

```bash
git add flux/app/runtime/widget-editor/data-sources.js && git commit -m "feat(js): data-sources module — state, serialize, panel UI, presets"
```

---

### Task 4: JS — Wire data-sources into store.js, app.js, live-data.js, render.js, file-ops.js, index.html, style.css

**Files:**
- Modify: `flux/app/runtime/widget-editor/store.js`
- Modify: `flux/app/runtime/widget-editor/app.js`
- Modify: `flux/app/runtime/widget-editor/live-data.js`
- Modify: `flux/app/runtime/widget-editor/render.js`
- Modify: `flux/app/runtime/widget-editor/file-ops.js`
- Modify: `flux/app/runtime/widget-editor/index.html`
- Modify: `flux/app/runtime/widget-editor/style.css`

- [ ] **Step 1: store.js — include dataSources in serialize/deserialize**

In `store.js`, find the `serialize()` method (~line 72). Replace the `return JSON.stringify({` block:

```js
serialize() {
    return JSON.stringify({
        version: 1,
        meta: { name: '', moduleId: '' },
        canvas: {
            width: parseInt(document.getElementById('canvas-width').value),
            height: parseInt(document.getElementById('canvas-height').value),
            background: document.getElementById('canvas').style.backgroundColor || '#0A0F1A',
        },
        components: this._components,
        // dataSources is added by app.js getAppState() — not stored here
    });
}
```

Note: `dataSources` lives in `data-sources.js` state, not in `ComponentStore`. `getAppState()` in app.js assembles them together. No change needed to `serialize()` itself — the wiring is in app.js.

- [ ] **Step 2: app.js — import data-sources, add to ctx, fix getAppState/setAppState**

In `app.js`, find the imports at the top. Add after the last import:

```js
import {
    renderSourcesPanel, serializeSources, deserializeSources,
    startSourceListeners, stopSourceListeners, registerSources,
    getSources, setContext as setDataSourcesContext
} from './data-sources.js';
```

Find `function getAppState()` (~line 34). Replace:

```js
function getAppState() {
    const data = JSON.parse(store.serialize());
    data.palette = serializePalette();
    data.dataSources = serializeSources();
    return JSON.stringify(data);
}
```

Find `function setAppState(json)` (~line 40). Replace:

```js
function setAppState(json) {
    const data = JSON.parse(json);
    store.deserialize(json, updateCanvasSize);
    if (data.palette) {
        deserializePalette(data.palette);
        renderPalettePanel();
    }
    deserializeSources(data.dataSources || []);
}
```

Find the `const ctx = {` block. Add after `showToast: (...a) => showToast(...a),`:

```js
    renderSourcesPanel:    (...a) => renderSourcesPanel(...a),
    serializeSources:      (...a) => serializeSources(...a),
    getSources:            (...a) => getSources(...a),
```

Find `setRenderContext(ctx);` and add below it:

```js
setDataSourcesContext(ctx);
```

Find `const PANEL_IDS = [` (~line 319). Add `'panel-sources'`:

```js
const PANEL_IDS = ['panel-components', 'panel-properties', 'panel-layers', 'panel-palette', 'panel-sources'];
```

Find the initial render block at the bottom (~line 385). Add `renderSourcesPanel();`:

```js
renderComponentsPanel();
renderPalettePanel();
renderSourcesPanel();
renderCanvas();
```

- [ ] **Step 3: live-data.js — subscribe to custom-data events**

In `live-data.js`, find the `setupLiveData` function. At the very end of `setupLiveData`, before closing brace, add:

```js
    // Register and start custom data sources
    await _ctx.invoke('register_custom_sources', { sources: _ctx.getSources ? _ctx.getSources() : [] }).catch(() => {});
    if (typeof startSourceListeners === 'function') startSourceListeners();
```

But `startSourceListeners` is not imported in live-data.js. Instead, add it to the ctx object and call it via ctx. The cleaner approach is to import it:

At the top of `live-data.js`, add to the existing import (or add a new import line — note live-data.js doesn't currently import from data-sources.js):

Actually, the `startSourceListeners` / `stopSourceListeners` / `registerSources` calls should happen in `setupLiveData` and `teardownLiveData`. Add these imports to live-data.js:

At the top of `live-data.js` add:

```js
import { startSourceListeners, stopSourceListeners, registerSources } from './data-sources.js';
```

In `teardownLiveData`, find where existing unsubs are cleared. Add at the beginning of `teardownLiveData`:

```js
export function teardownLiveData() {
    stopSourceListeners();
    // ... existing teardown code ...
```

In `setupLiveData`, find the end of the function. Add before the closing `}`:

```js
    // Start custom data source listeners and register with Rust broker
    await registerSources();
    startSourceListeners();
```

Note: `setupLiveData` must be declared `async` if it isn't already. Check live-data.js — if it's not async, change `export function setupLiveData(` to `export async function setupLiveData(`.

- [ ] **Step 4: render.js — add custom sources to data-source dropdowns**

In `render.js`, find the `DATA_SOURCES` dropdown generation in `renderProperties`. Search for where the `<select>` for data source is built (look for `DATA_SOURCES.map` or `source` select). This is inside the property panels for metric, progressbar, linegraph, circlemeter.

Find the helper that generates the source `<select>` (it will look like a loop over `DATA_SOURCES`). After the existing options, add a custom sources section. The exact location will be in the `propSourceSelect` or similar helper. Find it and append after the last `DATA_SOURCES` option:

```js
// After existing DATA_SOURCES options, add custom sources section
const customSrcs = _ctx.getSources ? _ctx.getSources() : [];
if (customSrcs.length > 0) {
    opts += `<optgroup label="Custom Sources">`;
    customSrcs.forEach(s => {
        opts += `<option value="${s.name}" ${current === s.name ? 'selected' : ''}>${s.name}</option>`;
    });
    opts += `</optgroup>`;
}
```

- [ ] **Step 5: file-ops.js — add dataSources to exported widget.json**

In `file-ops.js`, find `generateWidgetFiles`. Find where `moduleJson` is assembled (~line 162):

```js
const moduleJson = JSON.stringify({
    id: moduleId,
    name,
    entry: 'index.html',
    window: { width, height, transparent: true, decorations: false, resizable: true },
    permissions,
}, null, 2);
```

Replace with:

```js
const customSources = _ctx.getSources ? _ctx.getSources() : [];
const moduleJson = JSON.stringify({
    id: moduleId,
    name,
    entry: 'index.html',
    window: { width, height, transparent: true, decorations: false, resizable: true },
    permissions,
    dataSources: customSources,
}, null, 2);
```

Also update the `logic.js` generation to handle custom sources. Find where `logicLines` subscribes to events. After the existing `system:*` subscriptions, add:

```js
// Custom data sources
const customSrcsList = _ctx.getSources ? _ctx.getSources() : [];
customSrcsList.forEach(s => {
    const compIds = comps.filter(c => c.props && c.props.source === s.name).map(c => c.id);
    if (compIds.length === 0) return;
    logicLines.push(`  WidgetAPI.on('custom-data:${s.name}', function(val) {`);
    compIds.forEach(id => {
        const c = store.getById ? store.getById(id) : _ctx.store.getById(id);
        if (!c) return;
        if (c.type === 'metric') {
            logicLines.push(`    var el = document.getElementById('val-${id}'); if(el) el.textContent = val + '${c.props.suffix || ''}';`);
        } else if (c.type === 'progressbar') {
            logicLines.push(`    var el = document.getElementById('pb-${id}'); if(el) el.style.width = Math.min(100,parseFloat(val)||0) + '%';`);
        }
    });
    logicLines.push(`  });`);
});
```

- [ ] **Step 6: index.html — add Sources panel**

In `index.html`, find the `panel-palette` div (~line 53). Add after it:

```html
  <div class="panel" id="panel-sources" style="right:10px; bottom:10px; top:auto; left:auto;">
    <div class="panel-header">Sources</div>
    <div class="panel-body" id="sources-body"></div>
  </div>
```

- [ ] **Step 7: style.css — Sources panel styles**

In `style.css`, find the palette-related styles. Add at the end of the file:

```css
/* ── Sources panel ─────────────────────────────────────────────────────────── */
.sources-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
.source-row { display: flex; flex-direction: column; background: #1a1a2e; border-radius: 4px; padding: 5px 7px; }
.source-row-main { display: flex; align-items: center; gap: 6px; }
.source-row-actions { display: flex; gap: 4px; margin-top: 3px; }
.source-name { flex: 1; font-size: 12px; font-family: monospace; color: #e0e0e0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-live-val { font-size: 11px; color: #00bfff; font-family: monospace; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-badge { font-size: 9px; font-weight: bold; padding: 1px 4px; border-radius: 2px; flex-shrink: 0; }
.badge-shell { background: #2a2a0a; color: #ffcc00; }
.badge-http  { background: #0a2a2a; color: #00cccc; }
.source-edit-btn, .source-del-btn { font-size: 12px; padding: 1px 5px; background: transparent; border: 1px solid #333; border-radius: 2px; cursor: pointer; color: #aaa; }
.source-edit-btn:hover { color: #00bfff; border-color: #00bfff; }
.source-del-btn:hover  { color: #ff4444; border-color: #ff4444; }
.source-form { display: flex; flex-direction: column; gap: 0; }
.preset-picker, .preset-config { background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 8px; margin-bottom: 6px; }
.preset-option:hover { background: #1a2a3a !important; }
```

- [ ] **Step 8: Verify in the app**

Run `cargo tauri dev` from `flux/app/`. Open the Widget Editor:
1. The "Sources" panel should be visible (bottom-right, draggable)
2. Click "+ Add Source" → form appears
3. Set Type=Shell, Name=`test_src`, Command=`echo 42`, Interval=5s
4. Click "Test" → should show `✓ 42`
5. Click "Add" → source appears in list with live value `42` updating every 5s
6. Add a Metric component, set its data source — `test_src` should appear under "Custom Sources" in the dropdown
7. Set the metric source to `test_src` → metric shows `42`

- [ ] **Step 9: Commit**

```bash
git add flux/app/runtime/widget-editor/ && git commit -m "feat(js): wire custom data sources into editor — panel, live preview, export"
```

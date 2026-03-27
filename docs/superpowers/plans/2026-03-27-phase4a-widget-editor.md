# Widget Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a WYSIWYG widget editor that allows users to create, save, and export custom widgets without writing code.
**Architecture:** A standalone Tauri window (`widget-editor`) served from the runtime directory, communicating with the Rust backend for file operations and widget installation. The frontend uses a floating panel system and a JS-based component model with live preview.
**Tech Stack:** Rust (Tauri 2.0, zip-rs), TypeScript, Vanilla CSS, WidgetAPI.

---

### Task 1: Rust Backend Commands

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`
- Modify: `flux/app/src-tauri/src/archive.rs`

- [ ] **Step 1: Move and expose `do_install_archive`**
`do_install_archive` currently lives as a private fn in `lib.rs` at line ~446. Move it to `archive.rs` as `pub fn` so Task 12's `export_widget_package` can call `archive::do_install_archive`.

In `flux/app/src-tauri/src/archive.rs`, add (requires importing `ThemeInfo` and path helpers from lib — easiest to keep the function in `lib.rs` but make it `pub(crate)`):

Alternative (simpler, no move needed): change `fn do_install_archive` to `pub(crate) fn do_install_archive` in `lib.rs`. Then `export_widget_package` can call it directly since both are in the same crate.

Use the simpler path — change the visibility in `lib.rs`:
```rust
// lib.rs line ~446: change fn to pub(crate) fn
pub(crate) fn do_install_archive(path: &std::path::Path, resource_dir: &std::path::Path) -> Result<ThemeInfo, String> {
```
No import changes needed.

- [ ] **Step 2: Implement `open_widget_editor`**
In `flux/app/src-tauri/src/lib.rs`:
```rust
#[tauri::command]
fn open_widget_editor(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("widget-editor") {
        let _ = win.show();
        let _ = win.set_focus();
        Ok(())
    } else {
        let url = WebviewUrl::CustomProtocol(
            "flux-module://_flux/widget-editor/index.html".parse::<tauri::Url>().unwrap()
        );
        WebviewWindowBuilder::new(&app, "widget-editor", url)
            .title("Widget Editor")
            .inner_size(1280.0, 900.0)
            .min_inner_size(960.0, 640.0)
            .decorations(true)
            .transparent(false)
            .build()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
```

- [ ] **Step 3: Implement `save_fluxwidget` and `load_fluxwidget`**
Use atomic write (`.tmp` → rename) consistent with `write_config` in `config.rs`.
In `flux/app/src-tauri/src/lib.rs`:
```rust
#[tauri::command]
fn save_fluxwidget(path: String, json: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("fluxwidget.tmp");
    std::fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
fn load_fluxwidget(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Implement `export_widget_package` skeleton**
In `flux/app/src-tauri/src/lib.rs`:
```rust
#[tauri::command]
fn export_widget_package(
    app: AppHandle,
    name: String,
    module_id: String,
    files_json: String
) -> Result<ThemeInfo, String> {
    // Implementation details in Task 12
    Err("Not implemented yet".to_string())
}
```

- [ ] **Step 5: Register commands and verify build**
Add to `tauri::generate_handler!`.
Run: `cargo check`

---

### Task 2: Editor Window Skeleton

**Files:**
- Create: `flux/app/runtime/widget-editor/index.html`
- Create: `flux/app/runtime/widget-editor/style.css`
- Create: `flux/app/runtime/widget-editor/app.js`

- [ ] **Step 1: Create HTML structure**
Top bar with controls, canvas container, and placeholders for three panels.
- [ ] **Step 2: Add basic styling**
Dark theme, flex layout, absolute positioning for floating panels.
- [ ] **Step 3: Wire `open_widget_editor` to Command Center**
Add button to `flux/app/runtime/command-center/index.html` and click handler in `app.js`.
- [ ] **Step 4: Verify window opens**
Run: `npm run tauri dev` and click "New Widget…".

---

### Task 3: Floating Panel System

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`
- Modify: `flux/app/runtime/widget-editor/style.css`

- [ ] **Step 1: Implement draggable headers**
Add mousedown/mousemove/mouseup handlers to panel headers.
- [ ] **Step 2: Persist positions to localStorage**
Save `top`/`left` on mouseup; load on init.
- [ ] **Step 3: Test dragging**
Verify panels move and stay put after refresh.

---

### Task 4: Component Model + Canvas Rendering

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`

- [ ] **Step 1: Create `ComponentStore` class**
Methods: `add(type, props)`, `remove(id)`, `update(id, props)`, `getAll()`, `serialize()`, `deserialize(json)`.
- [ ] **Step 2: Implement canvas renderer**
Iterate `ComponentStore.getAll()` and render absolutely-positioned divs.
- [ ] **Step 3: Add selection logic**
Click component to set `activeId`, show selection border.
- [ ] **Step 4: Test add/remove**
Verify components appear on canvas and can be deleted.

---

### Task 5: Drag-to-move + Resize Handles

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`
- Modify: `flux/app/runtime/widget-editor/style.css`

- [ ] **Step 1: Implement move logic**
Drag component body to update `x`/`y`.
- [ ] **Step 2: Add 8 resize handles**
Render handles around active component; drag to update `width`/`height`.
- [ ] **Step 3: Implement 8px grid snapping**
Round coordinates and dimensions to nearest 8px when snap is enabled.
- [ ] **Step 4: Test move/resize**
Verify component updates correctly on canvas.

---

### Task 6: Undo/Redo

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`

- [ ] **Step 1: Implement `HistoryStack`**
Array of state snapshots with pointer. Max 50 states.
- [ ] **Step 2: Push snapshot after mutations**
Call `history.push(store.serialize())` after move, resize, property change.
- [ ] **Step 3: Wire Ctrl+Z and Ctrl+Shift+Z**
- [ ] **Step 4: Test undo/redo**
Add component, move it, undo, verify it returns to original position.

---

### Task 7: Components Panel + Component Types

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`

- [ ] **Step 1: Render 7 component types in panel**
- [ ] **Step 2: Implement type-specific rendering on canvas**
- [ ] **Step 3: Initialize live data for preview**
Components use `WidgetAPI.system.subscribe` to show live data while editing.
- [ ] **Step 4: Test all types**
Verify each component type renders its unique structure (e.g. Clock shows time, Metric shows value).

---

### Task 8: Properties Panel

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`

- [ ] **Step 1: Implement dynamic field rendering**
Render fields based on `selectedComponent.type`.
- [ ] **Step 2: Add common fields**
X, Y, W, H, Opacity.
- [ ] **Step 3: Add per-type fields**
Metric source dropdown, Clock format, Text content, etc.
- [ ] **Step 4: Test property updates**
Change Metric source and verify canvas preview updates.

---

### Task 9: Layers Panel

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`

- [ ] **Step 1: Render component list**
Reverse order (top = highest z-index).
- [ ] **Step 2: Implement drag-to-reorder**
Update `zIndex` in store based on list position.
- [ ] **Step 3: Add visibility toggle**
Eye icon toggles `visible` property.
- [ ] **Step 4: Test layering**
Overlap two components and swap their order in the list.

---

### Task 10: Aesthetic Presets

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`

- [ ] **Step 1: Add preset swatches to top bar**
- [ ] **Step 2: Implement preset application logic**
Update canvas background and default colors for new components.
- [ ] **Step 3: Test presets**
Click Death Stranding preset, verify canvas becomes `#0A0F1A`.

---

### Task 11: Save / Load (.fluxwidget)

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`

- [ ] **Step 1: Implement "New" (Clear canvas)**
- [ ] **Step 2: Implement "Open"**
Use `tauri-plugin-dialog` to pick file → `load_fluxwidget` → deserialize.
- [ ] **Step 3: Implement "Save" / "Save As"**
Use `save_fluxwidget` command.
- [ ] **Step 4: Test roundtrip**
Save a complex widget, clear canvas, load it back.

---

### Task 12: Export Widget

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`
- Modify: `flux/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Implement export dialog in JS**
Gather name, moduleId, and generate file strings.
- [ ] **Step 2: Implement `export_widget_package` in Rust**
In `flux/app/src-tauri/src/lib.rs`:
```rust
#[tauri::command]
fn export_widget_package(
    app: AppHandle,
    name: String,
    module_id: String,
    files_json: String
) -> Result<ThemeInfo, String> {
    let files: HashMap<String, String> = serde_json::from_str(&files_json)
        .map_err(|e| format!("Invalid files JSON: {}", e))?;
    let temp_zip = std::env::temp_dir().join(format!("flux-export-{}.zip", module_id));
    let file = std::fs::File::create(&temp_zip).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    let root = format!("flux-widget-{}", module_id);
    
    // theme.json
    zip.start_file(format!("{}/theme.json", root), options).map_err(|e| e.to_string())?;
    let theme_json = serde_json::json!({
        "id": format!("flux-widget-{}", module_id),
        "name": name,
        "modules": [module_id]
    });
    use std::io::Write;
    zip.write_all(theme_json.to_string().as_bytes()).map_err(|e| e.to_string())?;

    // modules/<id>/...
    for (filename, content) in files {
        zip.start_file(format!("{}/modules/{}/{}", root, module_id, filename), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    }
    
    zip.finish().map_err(|e| e.to_string())?;
    
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let info = archive::do_install_archive(&temp_zip, &resource_dir)?;
    let _ = std::fs::remove_file(&temp_zip);
    Ok(info)
}
```
- [ ] **Step 3: Test export and install**
Export a widget and verify it appears in the Command Center theme list.


---

### Task 13: Command Center + Tray Integration

**Files:**
- Modify: `flux/app/runtime/command-center/index.html`
- Modify: `flux/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add "New Widget…" button to CC header**
- [ ] **Step 2: Add "Widget Editor" to tray menu**
- [ ] **Step 3: Final verification**
Verify the editor can be launched from both locations and works as expected.

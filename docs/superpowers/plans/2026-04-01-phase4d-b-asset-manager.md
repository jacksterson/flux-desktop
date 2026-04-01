# Phase 4d-b: Font & Asset Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global font/asset library and per-widget asset bundle to the editor, plus an `image` component type, so widgets can include custom fonts, images, and any file — bundled into the export zip.

**Architecture:** A new Rust module (`assets.rs`) manages the `~/.local/share/flux/assets/` global library with CRUD commands. The export pipeline is extended to resolve asset references and copy binary files into the widget zip (decoding base64 sent from JS). The JS side adds an "Assets" modal, integrates font pickers with library fonts, adds an `image` component, and rewrites `flux://asset/` URLs on export.

**Tech Stack:** Rust (std::fs, base64 decoding), Tauri 2 commands, vanilla ES modules (no bundler).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `flux/app/src-tauri/src/paths.rs` | Modify | Add `flux_assets_dir()` and subdirectory helpers |
| `flux/app/src-tauri/src/assets.rs` | Create | `list_assets`, `import_asset`, `delete_asset`, `get_asset_data_url` |
| `flux/app/src-tauri/src/lib.rs` | Modify | Add mod, mime types, Tauri commands, invoke_handler, binary zip writing |
| `flux/app/runtime/widget-editor/asset-manager.js` | Create | Modal UI, Library tab, This Widget tab |
| `flux/app/runtime/widget-editor/store.js` | Modify | Add `image` type defaults, `localAssets` to serialize/deserialize |
| `flux/app/runtime/widget-editor/render.js` | Modify | `image` component render + properties, font picker library section |
| `flux/app/runtime/widget-editor/file-ops.js` | Modify | Asset export pipeline — scan, copy, `@font-face`, `flux://asset/` rewrite |
| `flux/app/runtime/widget-editor/app.js` | Modify | Import asset-manager, setContext, wire toolbar button |
| `flux/app/runtime/widget-editor/index.html` | Modify | Assets toolbar button |
| `flux/app/runtime/widget-editor/style.css` | Modify | Asset modal styles |

---

### Task 1: Rust — paths.rs asset directories + assets.rs CRUD commands

**Files:**
- Modify: `flux/app/src-tauri/src/paths.rs`
- Create: `flux/app/src-tauri/src/assets.rs`

- [ ] **Step 1: Write failing tests for new path functions**

At the end of the `#[cfg(test)]` block in `paths.rs` (~line 59), add:

```rust
    #[test]
    fn flux_assets_dir_is_under_local_share_flux() {
        let result = flux_assets_dir();
        let data = flux_user_data_dir();
        assert!(result.starts_with(&data));
        assert_eq!(result.file_name().unwrap(), "assets");
    }

    #[test]
    fn flux_assets_fonts_dir_is_under_assets() {
        let result = flux_assets_fonts_dir();
        assert!(result.starts_with(flux_assets_dir()));
        assert_eq!(result.file_name().unwrap(), "fonts");
    }

    #[test]
    fn ensure_flux_dirs_creates_asset_dirs() {
        ensure_flux_dirs().expect("should not fail");
        assert!(flux_assets_fonts_dir().exists());
        assert!(flux_assets_images_dir().exists());
        assert!(flux_assets_other_dir().exists());
    }
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd flux/app/src-tauri && cargo test paths 2>&1 | grep -E "FAILED|error"
```

Expected: compile errors (functions not defined).

- [ ] **Step 3: Implement path functions in paths.rs**

Add these functions to `paths.rs` (after `flux_module_settings_dir`):

```rust
/// Returns ~/.local/share/flux/assets — global widget asset library.
pub fn flux_assets_dir() -> PathBuf {
    flux_user_data_dir().join("assets")
}

/// Returns ~/.local/share/flux/assets/fonts
pub fn flux_assets_fonts_dir() -> PathBuf {
    flux_assets_dir().join("fonts")
}

/// Returns ~/.local/share/flux/assets/images
pub fn flux_assets_images_dir() -> PathBuf {
    flux_assets_dir().join("images")
}

/// Returns ~/.local/share/flux/assets/other
pub fn flux_assets_other_dir() -> PathBuf {
    flux_assets_dir().join("other")
}

/// Returns the correct asset subdirectory for a given category string.
/// Returns None if the category is unrecognised.
pub fn flux_assets_category_dir(category: &str) -> Option<PathBuf> {
    match category {
        "fonts"  => Some(flux_assets_fonts_dir()),
        "images" => Some(flux_assets_images_dir()),
        "other"  => Some(flux_assets_other_dir()),
        _ => None,
    }
}
```

Update `ensure_flux_dirs()` to create asset directories:

```rust
pub fn ensure_flux_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(flux_modules_dir())?;
    std::fs::create_dir_all(flux_skins_dir())?;
    std::fs::create_dir_all(flux_user_themes_dir())?;
    std::fs::create_dir_all(flux_module_settings_dir())?;
    std::fs::create_dir_all(flux_assets_fonts_dir())?;
    std::fs::create_dir_all(flux_assets_images_dir())?;
    std::fs::create_dir_all(flux_assets_other_dir())?;
    Ok(())
}
```

- [ ] **Step 4: Run path tests to confirm they pass**

```bash
cd flux/app/src-tauri && cargo test paths 2>&1 | tail -5
```

Expected: `test result: ok. N passed; 0 failed`

- [ ] **Step 5: Write failing tests for assets.rs**

Create `flux/app/src-tauri/src/assets.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::env::temp_dir;

    #[test]
    fn asset_category_from_filename_fonts() {
        assert_eq!(asset_category_from_filename("MyFont.ttf"), "fonts");
        assert_eq!(asset_category_from_filename("Bold.otf"), "fonts");
        assert_eq!(asset_category_from_filename("web.woff2"), "fonts");
    }

    #[test]
    fn asset_category_from_filename_images() {
        assert_eq!(asset_category_from_filename("logo.png"), "images");
        assert_eq!(asset_category_from_filename("bg.jpg"), "images");
        assert_eq!(asset_category_from_filename("icon.svg"), "images");
        assert_eq!(asset_category_from_filename("anim.gif"), "images");
        assert_eq!(asset_category_from_filename("photo.webp"), "images");
    }

    #[test]
    fn asset_category_from_filename_other() {
        assert_eq!(asset_category_from_filename("config.json"), "other");
        assert_eq!(asset_category_from_filename("data.csv"), "other");
    }
}
```

- [ ] **Step 6: Run tests to confirm they fail**

```bash
cd flux/app/src-tauri && cargo test assets 2>&1 | grep -E "FAILED|error" | head -5
```

Expected: compile errors.

- [ ] **Step 7: Implement assets.rs**

```rust
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::paths::{flux_assets_category_dir, flux_assets_fonts_dir, flux_assets_images_dir, flux_assets_other_dir};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssetInfo {
    pub filename: String,
    pub category: String,
    pub size_bytes: u64,
}

/// Determines the asset category (fonts/images/other) from the file extension.
pub fn asset_category_from_filename(filename: &str) -> &'static str {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "ttf" | "otf" | "woff" | "woff2" => "fonts",
        "png" | "jpg" | "jpeg" | "svg" | "gif" | "webp" => "images",
        _ => "other",
    }
}

/// Lists all assets in a given category directory.
pub fn list_category(category: &str) -> Result<Vec<AssetInfo>, String> {
    let dir = crate::paths::flux_assets_category_dir(category)
        .ok_or_else(|| format!("unknown category: {}", category))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut assets = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            assets.push(AssetInfo { filename, category: category.to_string(), size_bytes });
        }
    }
    assets.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(assets)
}

/// Copies a file from an arbitrary path into the appropriate category directory.
/// Returns the AssetInfo of the imported file.
pub fn import_file(src_path: &str) -> Result<AssetInfo, String> {
    let src = Path::new(src_path);
    let filename = src.file_name()
        .ok_or("source has no filename")?
        .to_string_lossy()
        .to_string();
    // Reject filenames with path components
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("invalid filename".to_string());
    }
    let category = asset_category_from_filename(&filename);
    let dest_dir = crate::paths::flux_assets_category_dir(category).unwrap();
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest = dest_dir.join(&filename);
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    let size_bytes = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(AssetInfo { filename, category: category.to_string(), size_bytes })
}

/// Deletes an asset from the library. Validates that the file is inside the category dir.
pub fn delete_file(category: &str, filename: &str) -> Result<(), String> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("invalid filename".to_string());
    }
    let dir = crate::paths::flux_assets_category_dir(category)
        .ok_or_else(|| format!("unknown category: {}", category))?;
    let path = dir.join(filename);
    if !path.exists() { return Err(format!("{} not found", filename)); }
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Reads an asset file and returns it as a base64-encoded data URL for use in the browser.
pub fn get_data_url(category: &str, filename: &str) -> Result<String, String> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("invalid filename".to_string());
    }
    let dir = crate::paths::flux_assets_category_dir(category)
        .ok_or_else(|| format!("unknown category: {}", category))?;
    let path = dir.join(filename);
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let ext = Path::new(filename).extension().and_then(|e| e.to_str()).unwrap_or("");
    let mime = match ext.to_lowercase().as_str() {
        "ttf"  => "font/ttf",
        "otf"  => "font/otf",
        "woff" => "font/woff",
        "woff2"=> "font/woff2",
        "png"  => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg"  => "image/svg+xml",
        "gif"  => "image/gif",
        "webp" => "image/webp",
        _      => "application/octet-stream",
    };
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Reads an asset file and returns raw bytes. Used by the export pipeline.
pub fn read_bytes(category: &str, filename: &str) -> Result<Vec<u8>, String> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("invalid filename".to_string());
    }
    let dir = crate::paths::flux_assets_category_dir(category)
        .ok_or_else(|| format!("unknown category: {}", category))?;
    std::fs::read(dir.join(filename)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_category_from_filename_fonts() {
        assert_eq!(asset_category_from_filename("MyFont.ttf"), "fonts");
        assert_eq!(asset_category_from_filename("Bold.otf"), "fonts");
        assert_eq!(asset_category_from_filename("web.woff2"), "fonts");
    }

    #[test]
    fn asset_category_from_filename_images() {
        assert_eq!(asset_category_from_filename("logo.png"), "images");
        assert_eq!(asset_category_from_filename("bg.jpg"), "images");
        assert_eq!(asset_category_from_filename("icon.svg"), "images");
        assert_eq!(asset_category_from_filename("anim.gif"), "images");
        assert_eq!(asset_category_from_filename("photo.webp"), "images");
    }

    #[test]
    fn asset_category_from_filename_other() {
        assert_eq!(asset_category_from_filename("config.json"), "other");
        assert_eq!(asset_category_from_filename("data.csv"), "other");
    }
}
```

- [ ] **Step 8: Add base64 to Cargo.toml**

In `Cargo.toml`, add after `reqwest`:

```toml
base64 = "0.22"
```

- [ ] **Step 9: Run asset tests**

```bash
cd flux/app/src-tauri && cargo test assets 2>&1 | tail -5
```

Expected: `test result: ok. 3 passed; 0 failed`

- [ ] **Step 10: Run all tests**

```bash
cd flux/app/src-tauri && cargo test 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
cd flux/app/src-tauri && git add src/paths.rs src/assets.rs Cargo.toml && git commit -m "feat(rust): add asset library paths and assets module with CRUD + base64 data URLs"
```

---

### Task 2: Rust — Wire assets into lib.rs + extend export to handle binary files

**Files:**
- Modify: `flux/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add mod and imports**

In `lib.rs` at the top, add after `pub mod custom_data;`:

```rust
pub mod assets;
```

Also add `flux_assets_category_dir` to the `use paths::` import:

```rust
use paths::{ensure_flux_dirs, flux_config_path, flux_modules_dir, flux_user_dir,
            flux_user_themes_dir, flux_module_settings_dir, flux_assets_category_dir};
```

- [ ] **Step 2: Add four Tauri commands for the asset library**

Add these commands after the `test_custom_source` command:

```rust
#[tauri::command]
fn list_assets(category: String) -> Result<Vec<assets::AssetInfo>, String> {
    assets::list_category(&category)
}

#[tauri::command]
fn import_asset(src_path: String) -> Result<assets::AssetInfo, String> {
    assets::import_file(&src_path)
}

#[tauri::command]
fn delete_asset(category: String, filename: String) -> Result<(), String> {
    assets::delete_file(&category, &filename)
}

#[tauri::command]
fn get_asset_data_url(category: String, filename: String) -> Result<String, String> {
    assets::get_data_url(&category, &filename)
}
```

- [ ] **Step 3: Extend export_widget_package to write binary assets**

The current `export_widget_package` only accepts `HashMap<String, String>` (text files). We need to also accept binary asset references.

Find `fn export_widget_package` (~line 632). Replace the signature and early deserialization:

```rust
#[tauri::command]
fn export_widget_package(
    app: AppHandle,
    name: String,
    module_id: String,
    files_json: String,
    asset_refs_json: String,  // ← new parameter: JSON array of {category, filename}
) -> Result<ThemeInfo, String> {
    use std::collections::HashMap;
    use std::io::Write;

    #[derive(serde::Deserialize)]
    struct AssetRef {
        category: String,
        filename: String,
    }

    let files: HashMap<String, String> = serde_json::from_str(&files_json)
        .map_err(|e| format!("Invalid files JSON: {}", e))?;
    let asset_refs: Vec<AssetRef> = serde_json::from_str(&asset_refs_json)
        .unwrap_or_default();

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
    zip.write_all(theme_json.to_string().as_bytes()).map_err(|e| e.to_string())?;

    // modules/<id>/<text files>
    for (filename, content) in &files {
        zip.start_file(format!("{}/modules/{}/{}", root, module_id, filename), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    }

    // modules/<id>/assets/<binary files>
    for asset_ref in &asset_refs {
        let bytes = assets::read_bytes(&asset_ref.category, &asset_ref.filename)
            .map_err(|e| format!("asset '{}': {}", asset_ref.filename, e))?;
        zip.start_file(
            format!("{}/modules/{}/assets/{}", root, module_id, asset_ref.filename),
            options,
        ).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let result = do_install_archive(&temp_zip, &resource_dir);
    let _ = std::fs::remove_file(&temp_zip);
    result
}
```

- [ ] **Step 4: Add new commands to invoke_handler**

Find the `invoke_handler` list. Add:

```rust
list_assets, import_asset, delete_asset, get_asset_data_url,
```

- [ ] **Step 5: Run cargo test**

```bash
cd flux/app/src-tauri && cargo test 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd flux/app/src-tauri && git add src/lib.rs && git commit -m "feat(rust): asset library Tauri commands + binary file support in export_widget_package"
```

---

### Task 3: JS — asset-manager.js modal (Library tab + This Widget tab)

**Files:**
- Create: `flux/app/runtime/widget-editor/asset-manager.js`

- [ ] **Step 1: Create the module**

```js
// ── asset-manager.js — Global asset library + per-widget asset bundle ─────────

let _ctx = null;
export function setContext(ctx) { _ctx = ctx; }

// ── Per-widget local assets: { filename: dataURL } ────────────────────────────

let _localAssets = {}; // { [filename]: { dataUrl, category, sizeBytes } }

export function getLocalAssets() { return _localAssets; }

export function serializeLocalAssets() {
    // Returns { [filename]: dataUrl } — stored in .fluxwidget
    const result = {};
    for (const [name, asset] of Object.entries(_localAssets)) {
        result[name] = asset.dataUrl;
    }
    return result;
}

export function deserializeLocalAssets(data) {
    _localAssets = {};
    if (data && typeof data === 'object') {
        for (const [filename, dataUrl] of Object.entries(data)) {
            const category = categoryFromFilename(filename);
            const sizeBytes = Math.round((dataUrl.length * 3) / 4); // rough estimate
            _localAssets[filename] = { dataUrl, category, sizeBytes };
        }
    }
}

export function resolveAssetUrl(filename) {
    // Returns a usable URL for the given asset filename.
    // Checks local assets first, then falls back to asking Rust for a data URL.
    if (_localAssets[filename]) return _localAssets[filename].dataUrl;
    return null; // caller should fetch from library via get_asset_data_url
}

function categoryFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['ttf','otf','woff','woff2'].includes(ext)) return 'fonts';
    if (['png','jpg','jpeg','svg','gif','webp'].includes(ext)) return 'images';
    return 'other';
}

// ── Get all library font names (for font picker) ─────────────────────────────

export async function getLibraryFontNames() {
    try {
        const fonts = await _ctx.invoke('list_assets', { category: 'fonts' });
        return fonts.map(f => f.filename.replace(/\.[^.]+$/, '')); // strip extension
    } catch { return []; }
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function openAssetManager() {
    let modal = document.getElementById('asset-modal');
    if (modal) { modal.remove(); return; } // toggle

    modal = document.createElement('div');
    modal.id = 'asset-modal';
    modal.className = 'asset-modal-overlay';
    modal.innerHTML = `
        <div class="asset-modal">
            <div class="asset-modal-header">
                <div class="asset-modal-tabs">
                    <button class="asset-tab active" data-tab="library">Library</button>
                    <button class="asset-tab" data-tab="widget">This Widget</button>
                </div>
                <button id="asset-modal-close" class="btn-icon" style="font-size:16px;">×</button>
            </div>
            <div id="asset-tab-content" class="asset-tab-content"></div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('asset-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    modal.querySelectorAll('.asset-tab').forEach(btn => {
        btn.addEventListener('click', function() {
            modal.querySelectorAll('.asset-tab').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            renderTab(this.dataset.tab);
        });
    });

    renderTab('library');
}

async function renderTab(tab) {
    const content = document.getElementById('asset-tab-content');
    if (!content) return;

    if (tab === 'library') {
        await renderLibraryTab(content);
    } else {
        renderWidgetTab(content);
    }
}

async function renderLibraryTab(content) {
    content.innerHTML = '<p style="color:#888;font-size:12px;padding:8px;">Loading…</p>';
    try {
        const [fonts, images, other] = await Promise.all([
            _ctx.invoke('list_assets', { category: 'fonts' }),
            _ctx.invoke('list_assets', { category: 'images' }),
            _ctx.invoke('list_assets', { category: 'other' }),
        ]);
        content.innerHTML = '';
        content.appendChild(buildCategorySection('Fonts', fonts, 'library', 'fonts'));
        content.appendChild(buildCategorySection('Images', images, 'library', 'images'));
        content.appendChild(buildCategorySection('Other', other, 'library', 'other'));
        wireImportButton(content, 'library');
    } catch (e) {
        content.innerHTML = `<p style="color:#ff4444;padding:8px;">Error loading library: ${e}</p>`;
    }
}

function renderWidgetTab(content) {
    const entries = Object.entries(_localAssets);
    content.innerHTML = '';

    const categories = { fonts: [], images: [], other: [] };
    entries.forEach(([filename, asset]) => {
        categories[asset.category]?.push({ filename, ...asset });
    });

    content.appendChild(buildCategorySection('Fonts',  categories.fonts,  'widget', 'fonts'));
    content.appendChild(buildCategorySection('Images', categories.images, 'widget', 'images'));
    content.appendChild(buildCategorySection('Other',  categories.other,  'widget', 'other'));
    wireImportButton(content, 'widget');
}

function buildCategorySection(label, items, source, category) {
    const section = document.createElement('div');
    section.className = 'asset-category';
    let html = `<div class="asset-category-label">${label}</div>`;
    if (items.length === 0) {
        html += `<p class="empty-state" style="font-size:11px;">No ${label.toLowerCase()} yet.</p>`;
    } else {
        html += '<div class="asset-grid">';
        items.forEach(item => {
            const filename = item.filename;
            const sizeKb = Math.round((item.size_bytes || item.sizeBytes || 0) / 1024);
            html += `
                <div class="asset-item" data-filename="${filename}" data-category="${category}" data-source="${source}">
                    <div class="asset-preview">${previewHtml(filename, category)}</div>
                    <div class="asset-item-name" title="${filename}">${filename}</div>
                    <div class="asset-item-size">${sizeKb} KB</div>
                    <button class="asset-del-btn btn-icon" data-filename="${filename}" data-category="${category}" data-source="${source}" title="Remove">×</button>
                    ${source === 'library' ? `<button class="asset-embed-btn btn-icon" data-filename="${filename}" data-category="${category}" title="Add to this widget">📦</button>` : ''}
                </div>
            `;
        });
        html += '</div>';
    }
    section.innerHTML = html;

    // Delete buttons
    section.querySelectorAll('.asset-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm(`Remove ${btn.dataset.filename}?`)) return;
            if (btn.dataset.source === 'library') {
                await _ctx.invoke('delete_asset', { category: btn.dataset.category, filename: btn.dataset.filename });
            } else {
                delete _localAssets[btn.dataset.filename];
                _ctx.pushHistory();
            }
            renderTab(btn.dataset.source === 'library' ? 'library' : 'widget');
        });
    });

    // Embed into widget buttons (library → widget)
    section.querySelectorAll('.asset-embed-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                const dataUrl = await _ctx.invoke('get_asset_data_url', { category: btn.dataset.category, filename: btn.dataset.filename });
                const sizeBytes = Math.round((dataUrl.length * 3) / 4);
                _localAssets[btn.dataset.filename] = { dataUrl, category: btn.dataset.category, sizeBytes };
                _ctx.pushHistory();
                _ctx.showToast(`${btn.dataset.filename} added to widget`);
            } catch (e) {
                _ctx.showToast('Failed to embed asset: ' + e, 'error');
            }
        });
    });

    return section;
}

function previewHtml(filename, category) {
    if (category === 'images') {
        return `<span style="font-size:20px;">🖼</span>`;
    } else if (category === 'fonts') {
        return `<span style="font-size:14px;font-family:'${filename.replace(/\.[^.]+$/,'')}',monospace;">Aa</span>`;
    }
    return `<span style="font-size:14px;color:#888;">📄</span>`;
}

function wireImportButton(content, source) {
    const btn = document.createElement('button');
    btn.className = 'btn-secondary';
    btn.style.cssText = 'width:100%;margin-top:8px;';
    btn.textContent = source === 'library' ? '+ Import to Library' : '+ Import to Widget';
    btn.addEventListener('click', () => handleImport(source));
    content.appendChild(btn);
}

async function handleImport(destination) {
    try {
        const { open } = window.__TAURI__.dialog;
        const paths = await open({
            filters: [
                { name: 'Fonts',  extensions: ['ttf','otf','woff','woff2'] },
                { name: 'Images', extensions: ['png','jpg','jpeg','svg','gif','webp'] },
                { name: 'All Files', extensions: ['*'] },
            ],
            multiple: true,
        });
        if (!paths) return;
        const list = Array.isArray(paths) ? paths : [paths];
        for (const p of list) {
            if (destination === 'library') {
                await _ctx.invoke('import_asset', { srcPath: p });
            } else {
                // Read directly and store as data URL locally
                const { readFile } = window.__TAURI__.fs;
                const bytes = await readFile(p);
                const filename = p.split(/[/\\]/).pop();
                const category = categoryFromFilename(filename);
                const mime = mimeFromFilename(filename);
                const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
                const dataUrl = `data:${mime};base64,${b64}`;
                const sizeBytes = bytes.byteLength;
                _localAssets[filename] = { dataUrl, category, sizeBytes };
                _ctx.pushHistory();
            }
        }
        renderTab(destination === 'library' ? 'library' : 'widget');
    } catch (e) {
        _ctx.showToast('Import failed: ' + e, 'error');
    }
}

function mimeFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        svg: 'image/svg+xml', gif: 'image/gif', webp: 'image/webp',
    };
    return map[ext] || 'application/octet-stream';
}
```

- [ ] **Step 2: Verify module syntax**

```bash
node --input-type=module < flux/app/runtime/widget-editor/asset-manager.js 2>&1 | head -3
```

Expected: error about `window` (not a Node module) — no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add flux/app/runtime/widget-editor/asset-manager.js && git commit -m "feat(js): asset-manager module — modal, library tab, widget tab, import/embed"
```

---

### Task 4: JS — `image` component type in store.js and render.js

**Files:**
- Modify: `flux/app/runtime/widget-editor/store.js`
- Modify: `flux/app/runtime/widget-editor/render.js`

- [ ] **Step 1: Add `image` to store.js**

In `store.js`, find the `defaults` object inside `add()`. Add the `image` entry after `shader`:

```js
image: { src: '', objectFit: 'contain', cssEffects: [] },
```

Find the width/height ternary on the `width:` line (~line 39). Add `image` case:

```js
width:  type === 'divider' ? 200 : (type === 'progressbar' ? 180 : (type === 'rawhtml' ? 200 : (type === 'shader' ? 180 : (type === 'image' ? 120 : (type === 'linegraph' || type === 'circlemeter' ? 120 : 120))))),
height: type === 'divider' ? 2   : (type === 'progressbar' ? 16  : (type === 'rawhtml' ? 120 : (type === 'shader' ? 120 : (type === 'image' ? 80  : (type === 'linegraph' || type === 'circlemeter' ? 80  : 40))))),
```

Find `COMPONENT_TYPES` (~line 136). Add after the `shader` entry:

```js
{ type: 'image', label: 'Image', icon: '🖼' },
```

- [ ] **Step 2: Add `image` rendering to render.js**

In `render.js`, find `renderComponentContent`. Find the `switch (c.type)` block. Add after the `shader` case:

```js
case 'image': {
    const src = _ctx.resolveColor ? (c.props.src || '') : (c.props.src || '');
    // Resolve flux://asset/ to a local data URL if available
    let resolvedSrc = src;
    if (src.startsWith('flux://asset/')) {
        const filename = src.replace('flux://asset/', '');
        // Try local assets first, then skip (data URL not available at render time)
        const localAssets = window._assetManagerGetLocal ? window._assetManagerGetLocal() : {};
        if (localAssets[filename]) resolvedSrc = localAssets[filename].dataUrl;
    }
    el.innerHTML = resolvedSrc
        ? `<img src="${resolvedSrc}" style="width:100%;height:100%;object-fit:${c.props.objectFit || 'contain'};display:block;">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#555;font-size:11px;">No image</div>`;
    break;
}
```

Add the image properties panel inside `renderProperties`. Find the switch for component types (where `text`, `metric`, etc. are handled). Add after `shader`:

```js
case 'image':
    html += `
        <div class="prop-row"><label class="prop-label">Image</label>
            <div style="display:flex;gap:4px;">
                <input class="prop-input" id="prop-img-src" type="text" value="${escHtml(c.props.src || '')}" placeholder="flux://asset/filename.png" style="flex:1;">
                <button id="prop-img-pick" class="btn-secondary" style="padding:3px 7px;">Pick</button>
            </div>
        </div>
        <div class="prop-row"><label class="prop-label">Fit</label>
            <select class="prop-input" id="prop-img-fit">
                ${['contain','cover','fill','none'].map(v => `<option value="${v}" ${c.props.objectFit===v?'selected':''}>${v}</option>`).join('')}
            </select>
        </div>
    `;
    break;
```

Wire the image properties in the `applyPropChange`-equivalent wiring section. After rendering, wire:

```js
document.getElementById('prop-img-src')?.addEventListener('change', function() {
    _ctx.store.updateProps(primaryId, { src: this.value });
    _ctx.pushHistory(); _ctx.renderCanvas();
});
document.getElementById('prop-img-fit')?.addEventListener('change', function() {
    _ctx.store.updateProps(primaryId, { objectFit: this.value });
    _ctx.pushHistory(); _ctx.renderCanvas();
});
document.getElementById('prop-img-pick')?.addEventListener('click', () => {
    // Import from asset manager
    import('./asset-manager.js').then(({ openAssetManager }) => openAssetManager());
});
```

- [ ] **Step 3: Wire `_assetManagerGetLocal` for render.js access**

In `app.js`, after `openAssetManager` is imported and `setContext` is called, add:

```js
import { getLocalAssets } from './asset-manager.js';
// Expose for render.js (which can't import it directly due to circular dependency)
window._assetManagerGetLocal = getLocalAssets;
```

- [ ] **Step 4: Verify in the app**

Run `cargo tauri dev`. In the Widget Editor:
1. The "Components" panel should show an Image entry (🖼)
2. Add an Image component — canvas shows "No image" placeholder
3. In Properties, paste a valid image URL or `flux://asset/test.png`

- [ ] **Step 5: Commit**

```bash
git add flux/app/runtime/widget-editor/store.js flux/app/runtime/widget-editor/render.js && git commit -m "feat(js): add image component type — store defaults, canvas render, properties panel"
```

---

### Task 5: JS — Wire asset-manager into app.js, index.html, style.css + font picker enhancement

**Files:**
- Modify: `flux/app/runtime/widget-editor/app.js`
- Modify: `flux/app/runtime/widget-editor/render.js`
- Modify: `flux/app/runtime/widget-editor/index.html`
- Modify: `flux/app/runtime/widget-editor/style.css`

- [ ] **Step 1: app.js — import and wire asset-manager**

Add to imports in `app.js`:

```js
import {
    openAssetManager, serializeLocalAssets, deserializeLocalAssets,
    getLocalAssets, setContext as setAssetManagerContext
} from './asset-manager.js';
```

Update `getAppState()`:

```js
function getAppState() {
    const data = JSON.parse(store.serialize());
    data.palette = serializePalette();
    data.dataSources = serializeSources();
    data.localAssets = serializeLocalAssets();
    return JSON.stringify(data);
}
```

Update `setAppState()`:

```js
function setAppState(json) {
    const data = JSON.parse(json);
    store.deserialize(json, updateCanvasSize);
    if (data.palette) {
        deserializePalette(data.palette);
        renderPalettePanel();
    }
    deserializeSources(data.dataSources || []);
    deserializeLocalAssets(data.localAssets || {});
}
```

After `setDataSourcesContext(ctx);`, add:

```js
setAssetManagerContext(ctx);
window._assetManagerGetLocal = getLocalAssets;
```

Wire the toolbar button (added in the next step):

```js
document.getElementById('btn-assets')?.addEventListener('click', openAssetManager);
```

- [ ] **Step 2: index.html — add Assets toolbar button**

In `index.html`, find the `tb-right` div:

```html
    <div class="tb-right">
      <button id="btn-grid" class="toggle-btn">Grid</button>
      <button id="btn-snap" class="toggle-btn">Snap</button>
      <button id="btn-assets" class="toggle-btn">Assets</button>
      <button id="btn-refresh">&#8635; Refresh</button>
      ...
```

Add `<button id="btn-assets" class="toggle-btn">Assets</button>` after `btn-snap`.

- [ ] **Step 3: render.js — font picker shows library fonts**

In `render.js`, find where `fontFamily` property is rendered (look for `prop-font-family` or similar input for the `text`, `metric`, `clock` components). This is typically a `<select>` or `<input>` for font family.

If it's currently a plain text input, keep it as an input but add an `<datalist>` below it populated with library fonts. Find the font family input rendering and replace with:

```js
// In the font family row, add a datalist for library fonts
const libraryFonts = window._assetManagerGetLocal
    ? Object.keys(window._assetManagerGetLocal()).filter(f => ['ttf','otf','woff','woff2'].some(e => f.endsWith(e))).map(f => f.replace(/\.[^.]+$/,''))
    : [];
const fontOptions = ['monospace','sans-serif','serif','cursive','fantasy', ...libraryFonts];
html += `<div class="prop-row"><label class="prop-label">Font Family</label>
    <input class="prop-input" id="prop-font-family" list="font-family-list" value="${escHtml(c.props.fontFamily || 'monospace')}">
    <datalist id="font-family-list">
        ${fontOptions.map(f => `<option value="${f}">`).join('')}
    </datalist>
</div>`;
```

This approach works for existing font inputs — replace any hardcoded font `<select>` or plain `<input>` with this pattern. Look for all instances of `fontFamily` in the properties rendering.

- [ ] **Step 4: style.css — asset modal styles**

Add at end of `style.css`:

```css
/* ── Asset Manager Modal ───────────────────────────────────────────────────── */
.asset-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 9999; display: flex; align-items: center; justify-content: center; }
.asset-modal { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; width: 560px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; }
.asset-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #30363d; }
.asset-modal-tabs { display: flex; gap: 6px; }
.asset-tab { background: transparent; border: 1px solid #333; border-radius: 4px; color: #888; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.asset-tab.active { border-color: #00bfff; color: #00bfff; }
.asset-tab-content { flex: 1; overflow-y: auto; padding: 12px 14px; }
.asset-category { margin-bottom: 16px; }
.asset-category-label { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: 0.8px; margin-bottom: 6px; }
.asset-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.asset-item { width: 90px; background: #1a1a2e; border: 1px solid #30363d; border-radius: 5px; padding: 6px; display: flex; flex-direction: column; align-items: center; gap: 3px; position: relative; cursor: default; }
.asset-item:hover { border-color: #00bfff; }
.asset-preview { width: 50px; height: 40px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.asset-item-name { font-size: 10px; color: #ccc; text-align: center; word-break: break-all; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-item-size { font-size: 9px; color: #666; }
.asset-del-btn { position: absolute; top: 2px; right: 2px; font-size: 11px; padding: 0 3px; background: transparent; border: none; color: #555; cursor: pointer; }
.asset-del-btn:hover { color: #ff4444; }
.asset-embed-btn { font-size: 10px; padding: 1px 4px; background: transparent; border: 1px solid #333; border-radius: 2px; cursor: pointer; color: #888; margin-top: 2px; }
.asset-embed-btn:hover { color: #00bfff; border-color: #00bfff; }
```

- [ ] **Step 5: Verify in the app**

Run `cargo tauri dev`:
1. "Assets" button appears in toolbar
2. Clicking it opens the modal
3. Library tab shows empty font/image/other sections
4. Import a .ttf font from your system → it appears in Library under Fonts
5. The font name now appears in the font family datalist in Properties for text/metric/clock components
6. Clicking "📦" on a library font embeds it in "This Widget" tab

- [ ] **Step 6: Commit**

```bash
git add flux/app/runtime/widget-editor/ && git commit -m "feat(js): wire asset manager — toolbar button, font picker, getAppState/setAppState integration"
```

---

### Task 6: JS — file-ops.js asset export pipeline

**Files:**
- Modify: `flux/app/runtime/widget-editor/file-ops.js`

- [ ] **Step 1: Update runExport to collect asset references**

In `file-ops.js`, find `async function runExport(modal)`. At the end, replace the `invoke('export_widget_package', ...)` call:

```js
    const assetRefs = collectAssetRefs(files);

    try {
        await _ctx.invoke('export_widget_package', {
            name,
            moduleId,
            filesJson: JSON.stringify(files),
            assetRefsJson: JSON.stringify(assetRefs),
        });
        modal.remove();
        _ctx.showToast('Widget installed — activate from Command Center', 'info');
    } catch (e) {
        statusEl.textContent = 'Export failed: ' + e;
        console.error('Export failed:', e);
    }
```

- [ ] **Step 2: Add collectAssetRefs and update generateWidgetFiles**

Add this function before `generateWidgetFiles`:

```js
function collectAssetRefs(files) {
    // Scans all generated files for flux://asset/ references and font-family names
    // that correspond to library assets.
    const refs = new Set();
    const allText = Object.values(files).join('\n');

    // flux://asset/<filename> references in HTML/CSS
    const assetPattern = /flux:\/\/asset\/([^"'\s)]+)/g;
    let m;
    while ((m = assetPattern.exec(allText)) !== null) {
        const filename = m[1];
        const category = filename.match(/\.(ttf|otf|woff2?)$/i) ? 'fonts'
                       : filename.match(/\.(png|jpe?g|svg|gif|webp)$/i) ? 'images'
                       : 'other';
        refs.add(JSON.stringify({ category, filename }));
    }

    // @font-face src references (added by the CSS generator)
    const fontSrcPattern = /url\(['"]?\.\/assets\/([^'")]+)['"]?\)/g;
    while ((m = fontSrcPattern.exec(allText)) !== null) {
        refs.add(JSON.stringify({ category: 'fonts', filename: m[1] }));
    }

    return [...refs].map(s => JSON.parse(s));
}
```

- [ ] **Step 3: Generate @font-face declarations in the CSS**

In `generateWidgetFiles`, find where `fullCss` is assembled (~line 200):

```js
const fullCss = generatePaletteCSS() + '\n\n' + cssRules + ...
```

Before that line, add:

```js
    // Generate @font-face for any custom fonts used by components
    const usedFonts = new Set(
        comps
            .filter(c => c.props && c.props.fontFamily)
            .map(c => c.props.fontFamily)
            .filter(f => !['monospace','sans-serif','serif','cursive','fantasy'].includes(f))
    );
    const fontFaceRules = [...usedFonts].map(name => {
        // Find the file in local assets or library (by font name without extension)
        const extensions = ['woff2','woff','otf','ttf'];
        for (const ext of extensions) {
            const filename = `${name}.${ext}`;
            const format = ext === 'ttf' ? 'truetype' : ext === 'otf' ? 'opentype' : ext;
            return `@font-face { font-family: '${name}'; src: url('./assets/${filename}') format('${format}'); }`;
        }
        return '';
    }).filter(Boolean).join('\n');
```

Then update `fullCss`:

```js
    const fullCss = (fontFaceRules ? fontFaceRules + '\n\n' : '') + generatePaletteCSS() + '\n\n' + cssRules + (rawCssRules ? '\n\n/* Raw HTML component styles */\n' + rawCssRules : '');
```

- [ ] **Step 4: Rewrite flux://asset/ URLs in exported HTML/CSS**

After `fullCss` is assembled, add:

```js
    // Rewrite flux://asset/ → ./assets/ for exported widget
    const rewriteAsset = s => s.replace(/flux:\/\/asset\//g, './assets/');
    const exportedHtml = rewriteAsset(indexHtml);
    const exportedCss  = rewriteAsset(fullCss);
```

Then in the returned `files` object, use `exportedHtml` and `exportedCss` instead of `indexHtml` and `fullCss`.

- [ ] **Step 5: Verify in the app**

Run `cargo tauri dev`:
1. Import a font (e.g., `RobotoMono.ttf`) into the asset library
2. Add a text component, set font family to `RobotoMono`
3. Export the widget
4. Open the installed widget's directory in `~/Flux/modules/<id>/`
5. Confirm `assets/RobotoMono.ttf` exists in the module folder
6. Confirm `style.css` contains `@font-face { font-family: 'RobotoMono'; src: url('./assets/RobotoMono.ttf') ... }`

- [ ] **Step 6: Commit**

```bash
git add flux/app/runtime/widget-editor/file-ops.js && git commit -m "feat(js): asset export pipeline — @font-face generation, flux://asset/ rewrite, binary zip entries"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Rust asset library (`~/.local/share/flux/assets/`) — Task 1
- ✅ Global + per-widget assets — Tasks 1, 3
- ✅ list/import/delete/get_data_url commands — Task 2
- ✅ Asset manager modal, Library tab, This Widget tab — Task 3
- ✅ `image` component type — Task 4
- ✅ Font picker datalist showing library fonts — Task 5
- ✅ Toolbar button, getAppState/setAppState — Task 5
- ✅ Export pipeline: @font-face, flux://asset/ rewrite, binary assets in zip — Task 6
- ✅ export_widget_package extended for binary files — Task 2

**Placeholder scan:** None found.

**Type consistency:**
- `AssetInfo.size_bytes` (Rust snake_case) vs JS side using both `size_bytes` and `sizeBytes`. Fix: Task 3 buildCategorySection reads `item.size_bytes || item.sizeBytes` — covers both. ✅
- `import_asset` command param is `srcPath` (camelCase for Tauri). Rust command uses `src_path: String`. Tauri 2 auto-converts `srcPath` ↔ `src_path`. ✅
- `asset_refs_json` parameter in `export_widget_package` — Tauri will convert JS `assetRefsJson` to `asset_refs_json`. ✅

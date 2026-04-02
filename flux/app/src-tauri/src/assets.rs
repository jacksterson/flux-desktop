use std::path::Path;
use serde::{Deserialize, Serialize};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssetInfo {
    pub filename: String,
    pub category: String,
    pub size_bytes: u64,
}

// ── Category inference ────────────────────────────────────────────────────────

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

// ── CRUD ──────────────────────────────────────────────────────────────────────

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
        "ttf"          => "font/ttf",
        "otf"          => "font/otf",
        "woff"         => "font/woff",
        "woff2"        => "font/woff2",
        "png"          => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg"          => "image/svg+xml",
        "gif"          => "image/gif",
        "webp"         => "image/webp",
        _              => "application/octet-stream",
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

// ── Tests ─────────────────────────────────────────────────────────────────────

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

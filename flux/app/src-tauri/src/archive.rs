use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static EXTRACT_COUNTER: AtomicU64 = AtomicU64::new(0);

pub enum ArchiveKind {
    Zip,
    TarGz,
    SevenZ,
}

pub fn detect_kind(path: &Path) -> Option<ArchiveKind> {
    let s = path.to_string_lossy().to_lowercase();
    if s.ends_with(".zip") {
        Some(ArchiveKind::Zip)
    } else if s.ends_with(".tar.gz") || s.ends_with(".tgz") {
        Some(ArchiveKind::TarGz)
    } else if s.ends_with(".7z") {
        Some(ArchiveKind::SevenZ)
    } else {
        None
    }
}

/// Extract archive to a fresh temp directory. Caller must delete it when done.
pub fn extract_to_temp(path: &Path) -> Result<PathBuf, String> {
    let kind = detect_kind(path).ok_or_else(|| "Unsupported archive type".to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let counter = EXTRACT_COUNTER.fetch_add(1, Ordering::SeqCst);
    let dest = std::env::temp_dir().join(format!("flux-extract-{}-{}-{}", ts, std::process::id(), counter));
    fs::create_dir_all(&dest).map_err(|e| format!("Could not create temp dir: {}", e))?;
    match kind {
        ArchiveKind::Zip => extract_zip(path, &dest),
        ArchiveKind::TarGz => extract_tar_gz(path, &dest),
        ArchiveKind::SevenZ => extract_7z(path, &dest),
    }?;
    Ok(dest)
}

/// Guard against zip-slip: reject any entry whose name contains "..".
fn safe_entry_path(dest: &Path, entry_name: &str) -> Result<PathBuf, String> {
    let entry_name = entry_name.trim_start_matches('/');
    if entry_name.contains("..") {
        return Err(format!("archive entry '{}' contains path traversal (..), rejected", entry_name));
    }
    Ok(dest.join(entry_name))
}

fn extract_zip(src: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(src).map_err(|e| format!("Could not open archive: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Could not extract archive: {}", e))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let out_path = safe_entry_path(dest, entry.name())?;
        if entry.name().ends_with('/') {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn extract_tar_gz(src: &Path, dest: &Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    let file = fs::File::open(src).map_err(|e| format!("Could not open archive: {}", e))?;
    let gz = GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);
    for entry in archive.entries().map_err(|e| format!("Could not extract archive: {}", e))? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path().map_err(|e| e.to_string())?;
        let entry_str = entry_path.to_string_lossy();
        if entry_str.contains("..") {
            return Err(format!("archive entry '{}' contains path traversal (..), rejected", entry_str));
        }
        entry.unpack_in(dest).map_err(|e| format!("Could not extract archive: {}", e))?;
    }
    Ok(())
}

fn extract_7z(src: &Path, dest: &Path) -> Result<(), String> {
    sevenz_rust::decompress_file(src, dest).map_err(|e| format!("Could not extract archive: {}", e))
}

/// Validate an extracted theme directory.
/// Requires `theme.json` at the root with a non-empty `id` field.
/// Returns `(theme_id, theme_name)`.
pub fn validate_extracted(dir: &Path) -> Result<(String, String), String> {
    let manifest_path = dir.join("theme.json");
    if !manifest_path.exists() {
        return Err("Invalid theme: missing theme.json".to_string());
    }
    let content = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&content)
        .map_err(|_| "Invalid theme: theme.json is not valid JSON".to_string())?;
    let id = v.get("id")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Invalid theme: theme.json has no 'id' field".to_string())?
        .to_string();
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid theme: theme id contains invalid characters".to_string());
    }
    let name = v.get("name")
        .and_then(|x| x.as_str())
        .unwrap_or(&id)
        .to_string();
    Ok((id, name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip_with_manifest(dir: &Path, theme_id: &str) -> PathBuf {
        let zip_path = dir.join("test.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("theme.json", opts).unwrap();
        let manifest = format!(r#"{{"id":"{}","name":"Test Theme","modules":[]}}"#, theme_id);
        zip.write_all(manifest.as_bytes()).unwrap();
        zip.finish().unwrap();
        zip_path
    }

    #[test]
    fn detect_kind_zip() {
        assert!(matches!(detect_kind(Path::new("a.zip")), Some(ArchiveKind::Zip)));
    }

    #[test]
    fn detect_kind_tar_gz() {
        assert!(matches!(detect_kind(Path::new("a.tar.gz")), Some(ArchiveKind::TarGz)));
        assert!(matches!(detect_kind(Path::new("a.tgz")), Some(ArchiveKind::TarGz)));
    }

    #[test]
    fn detect_kind_7z() {
        assert!(matches!(detect_kind(Path::new("a.7z")), Some(ArchiveKind::SevenZ)));
    }

    #[test]
    fn detect_kind_unsupported() {
        assert!(detect_kind(Path::new("a.txt")).is_none());
    }

    #[test]
    fn extract_zip_and_validate_returns_id() {
        let tmp = tempfile_dir("flux_arc_test_ok");
        let zip_path = make_zip_with_manifest(&tmp, "my-theme");
        let extract_dir = extract_to_temp(&zip_path).unwrap();
        let (id, _name) = validate_extracted(&extract_dir).unwrap();
        assert_eq!(id, "my-theme");
        fs::remove_dir_all(&extract_dir).ok();
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn validate_fails_when_no_manifest() {
        let tmp = tempfile_dir("flux_arc_test_no_manifest");
        let err = validate_extracted(&tmp).unwrap_err();
        assert!(err.contains("missing theme.json"), "got: {}", err);
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn validate_fails_when_id_missing() {
        let tmp = tempfile_dir("flux_arc_test_no_id");
        fs::write(tmp.join("theme.json"), r#"{"name":"Foo","modules":[]}"#).unwrap();
        let err = validate_extracted(&tmp).unwrap_err();
        assert!(err.contains("no 'id' field"), "got: {}", err);
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn zip_slip_rejected() {
        let tmp = tempfile_dir("flux_arc_test_slip");
        let zip_path = tmp.join("evil.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("../../evil.txt", opts).unwrap();
        zip.write_all(b"pwned").unwrap();
        zip.finish().unwrap();
        let result = extract_to_temp(&zip_path);
        assert!(result.is_err(), "zip-slip should be rejected");
        fs::remove_dir_all(&tmp).ok();
    }

    fn tempfile_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("{}-{}", name, std::process::id()));
        fs::create_dir_all(&d).unwrap();
        d
    }
}

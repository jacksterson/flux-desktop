// claude_usage.rs — Tauri commands for reading Claude Code session data
//
// Provides:
//   list_claude_session_files — returns Vec<String> of all *.jsonl paths under ~/.claude/projects/
//   read_text_file            — reads a file at an allowed path (restricted to ~/.claude/)

use std::fs;
use std::path::PathBuf;

fn claude_projects_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home".to_string());
    PathBuf::from(home).join(".claude").join("projects")
}

/// Returns the absolute paths of every *.jsonl file under ~/.claude/projects/.
/// Structure is: ~/.claude/projects/<project-dir>/*.jsonl (2 levels deep).
#[tauri::command]
pub fn list_claude_session_files() -> Vec<String> {
    let root = claude_projects_dir();
    let mut files = Vec::new();

    let Ok(top_entries) = fs::read_dir(&root) else {
        return files;
    };

    for top in top_entries.flatten() {
        let project_dir = top.path();
        if !project_dir.is_dir() {
            continue;
        }

        let Ok(entries) = fs::read_dir(&project_dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                if let Some(s) = path.to_str() {
                    files.push(s.to_string());
                }
            }
        }
    }

    files
}

/// Reads a text file at `path`. Restricted to paths under ~/.claude/ to prevent
/// arbitrary file reads from widget code.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home".to_string());
    let allowed_root = PathBuf::from(&home).join(".claude");

    // Canonicalize the requested path to resolve any .. traversal attempts.
    // The file must already exist for canonicalize to succeed.
    let file_path = PathBuf::from(&path);
    let canonical = file_path
        .canonicalize()
        .map_err(|e| format!("cannot resolve path: {}", e))?;

    // Reject anything outside ~/.claude/
    if !canonical.starts_with(&allowed_root) {
        return Err(format!("path '{}' is outside the allowed directory", path));
    }

    fs::read_to_string(&canonical).map_err(|e| format!("read error: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal() {
        // A path outside ~/.claude/ should be rejected after canonicalization.
        // We use /etc/passwd as a known-to-exist file outside the allowed root.
        let result = read_text_file("/etc/passwd".to_string());
        assert!(result.is_err(), "should reject /etc/passwd");
        let err = result.unwrap_err();
        assert!(err.contains("outside the allowed directory") || err.contains("cannot resolve"),
            "unexpected error: {}", err);
    }

    #[test]
    fn list_returns_only_jsonl() {
        // If the projects dir doesn't exist we get an empty vec, not a panic.
        // Real integration testing requires ~/.claude/projects/ to exist.
        let files = list_claude_session_files();
        for f in &files {
            assert!(f.ends_with(".jsonl"), "unexpected file in list: {}", f);
        }
    }
}

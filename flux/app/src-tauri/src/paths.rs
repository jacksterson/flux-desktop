use std::path::PathBuf;

/// Returns ~/Flux — the user-facing directory for widgets and skins.
/// Same path on all platforms: users never need to know about AppData or Library.
pub fn flux_user_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Flux")
}

/// Returns ~/Flux/modules — where community widget folders live.
pub fn flux_modules_dir() -> PathBuf {
    flux_user_dir().join("modules")
}

/// Returns ~/Flux/skins — reserved for future global skin overrides.
pub fn flux_skins_dir() -> PathBuf {
    flux_user_dir().join("skins")
}

/// Creates ~/Flux/modules and ~/Flux/skins if they do not exist.
/// Called once at app startup.
pub fn ensure_flux_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(flux_modules_dir())?;
    std::fs::create_dir_all(flux_skins_dir())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flux_user_dir_is_under_home() {
        let result = flux_user_dir();
        let home = dirs::home_dir().expect("home dir must exist");
        assert!(result.starts_with(&home), "expected {:?} to start with {:?}", result, home);
        assert_eq!(result.file_name().unwrap(), "Flux");
    }

    #[test]
    fn flux_modules_dir_is_under_flux_user_dir() {
        let result = flux_modules_dir();
        assert!(result.starts_with(flux_user_dir()));
        assert_eq!(result.file_name().unwrap(), "modules");
    }

    #[test]
    fn flux_skins_dir_is_under_flux_user_dir() {
        let result = flux_skins_dir();
        assert!(result.starts_with(flux_user_dir()));
        assert_eq!(result.file_name().unwrap(), "skins");
    }
}

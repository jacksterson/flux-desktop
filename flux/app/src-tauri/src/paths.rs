use std::path::PathBuf;

/// Returns ~/Flux — the user-facing directory for widgets and skins.
/// Same path on all platforms: users never need to know about AppData or Library.
pub fn flux_user_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Flux requires a home directory. Set the HOME environment variable and restart.")
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

/// Returns the XDG data dir for Flux: ~/.local/share/flux on Linux/macOS,
/// %LOCALAPPDATA%\flux on Windows.
pub fn flux_user_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".local/share")
        })
        .join("flux")
}

/// Returns ~/.local/share/flux/themes — where user-installed theme packs live.
pub fn flux_user_themes_dir() -> PathBuf {
    flux_user_data_dir().join("themes")
}

/// Returns ~/.local/share/flux/config.toml — the engine config file.
pub fn flux_config_path() -> PathBuf {
    flux_user_data_dir().join("config.toml")
}

/// Returns ~/.local/share/flux/settings — where per-module settings files live.
pub fn flux_module_settings_dir() -> PathBuf {
    flux_user_data_dir().join("settings")
}

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

/// Creates ~/Flux/modules, ~/Flux/skins, ~/.local/share/flux/themes, and
/// ~/.local/share/flux/settings if they do not exist.
/// Called once at app startup.
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

    #[test]
    fn ensure_flux_dirs_creates_directories() {
        ensure_flux_dirs().expect("ensure_flux_dirs should not fail");
        assert!(flux_modules_dir().exists(), "modules dir should exist after ensure_flux_dirs");
        assert!(flux_skins_dir().exists(), "skins dir should exist after ensure_flux_dirs");
        assert!(flux_module_settings_dir().exists(), "settings dir should exist after ensure_flux_dirs");
    }

    #[test]
    fn flux_user_themes_dir_is_under_local_share_flux() {
        let result = flux_user_themes_dir();
        assert!(result.ends_with("flux/themes") || result.ends_with("flux\\themes"),
            "expected path to end with flux/themes, got {:?}", result);
    }

    #[test]
    fn flux_config_path_ends_with_config_toml() {
        let result = flux_config_path();
        assert_eq!(result.file_name().unwrap(), "config.toml");
    }

    #[test]
    fn flux_module_settings_dir_is_under_local_share_flux() {
        let result = flux_module_settings_dir();
        let data = flux_user_data_dir();
        assert!(result.starts_with(&data), "settings dir {:?} should be under {:?}", result, data);
        assert_eq!(result.file_name().unwrap(), "settings");
    }

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
}

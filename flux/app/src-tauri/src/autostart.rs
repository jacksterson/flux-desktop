/// Autostart — write/remove OS login entries for Flux.
///
/// Linux:   ~/.config/autostart/flux.desktop
/// Windows: HKCU\Software\Microsoft\Windows\CurrentVersion\Run via `reg`
/// macOS:   ~/Library/LaunchAgents/io.flux.flux.plist

use std::path::PathBuf;

#[cfg(target_os = "linux")]
fn entry_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("autostart")
        .join("flux.desktop")
}

#[cfg(target_os = "macos")]
fn entry_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join("Library/LaunchAgents/io.flux.flux.plist")
}

pub fn enable() -> std::io::Result<()> {
    let exe = std::env::current_exe()?;

    #[cfg(target_os = "linux")]
    {
        let path = entry_path();
        std::fs::create_dir_all(path.parent().unwrap())?;
        let content = format!(
            "[Desktop Entry]\nType=Application\nName=Flux\nExec={exe}\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n",
            exe = exe.display()
        );
        std::fs::write(path, content)
    }

    #[cfg(target_os = "windows")]
    {
        let exe_str = exe.to_string_lossy().into_owned();
        std::process::Command::new("reg")
            .args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v", "Flux", "/t", "REG_SZ", "/d", &exe_str, "/f",
            ])
            .status()
            .map(|_| ())
    }

    #[cfg(target_os = "macos")]
    {
        let path = entry_path();
        std::fs::create_dir_all(path.parent().unwrap())?;
        let exe_str = exe.to_string_lossy();
        let content = format!(
r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>io.flux.flux</string>
    <key>ProgramArguments</key>
    <array><string>{exe}</string></array>
    <key>RunAtLoad</key><true/>
</dict>
</plist>"#,
            exe = exe_str
        );
        std::fs::write(path, content)
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = exe;
        Ok(())
    }
}

pub fn disable() -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let path = entry_path();
        if path.exists() { std::fs::remove_file(path)?; }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("reg")
            .args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v", "Flux", "/f",
            ])
            .status()
            .map(|_| ())
    }

    #[cfg(target_os = "macos")]
    {
        let path = entry_path();
        if path.exists() { std::fs::remove_file(path)?; }
        Ok(())
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    Ok(())
}

pub fn is_enabled() -> bool {
    #[cfg(target_os = "linux")]
    { entry_path().exists() }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v", "Flux",
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "macos")]
    { entry_path().exists() }

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    false
}

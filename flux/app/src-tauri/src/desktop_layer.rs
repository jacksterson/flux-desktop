use tauri::WebviewWindow;
use crate::WindowLevel;

/// Apply desktop-layer window behaviour for the given window.
/// Returns `true` if Wayland layer shell was successfully applied
/// (caller should track this to guard drag/position events).
pub fn apply(window: &WebviewWindow, level: &WindowLevel, initial_margins: Option<(i32, i32)>) -> bool {
    if *level != WindowLevel::Desktop {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        return apply_linux(window, initial_margins);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, initial_margins);
        false
    }
}

/// Update margins on an existing Wayland layer-shell window.
/// No-op on non-Linux or non-Wayland.
pub fn set_margins(window: &WebviewWindow, left: i32, top: i32) {
    #[cfg(target_os = "linux")]
    set_margins_linux(window, left, top);
    #[cfg(not(target_os = "linux"))]
    let _ = (window, left, top);
}

#[cfg(target_os = "linux")]
fn apply_linux(window: &WebviewWindow, initial_margins: Option<(i32, i32)>) -> bool {
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        apply_wayland(window, initial_margins)
    } else {
        apply_x11(window);
        false  // X11 does not use margin-based drag
    }
}

// Wayland implementation — filled in Task 5
#[cfg(target_os = "linux")]
fn apply_wayland(_window: &WebviewWindow, _initial_margins: Option<(i32, i32)>) -> bool {
    false  // stub — replaced in Task 5
}

// X11 implementation — filled in Task 6
#[cfg(target_os = "linux")]
fn apply_x11(_window: &WebviewWindow) {
    // stub — replaced in Task 6
}

#[cfg(target_os = "linux")]
fn set_margins_linux(_window: &WebviewWindow, _left: i32, _top: i32) {
    // stub — replaced in Task 5
}

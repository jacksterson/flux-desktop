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
    { let _ = (window, left, top); }
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
fn apply_wayland(window: &WebviewWindow, initial_margins: Option<(i32, i32)>) -> bool {
    use gtk_layer_shell::{Layer, Edge, KeyboardMode, LayerShell};

    let Ok(gtk_win) = window.gtk_window() else { return false; };
    if !gtk_layer_shell::is_supported() {
        return false;
    }

    gtk_win.init_layer_shell();
    gtk_win.set_layer(Layer::Bottom);
    gtk_win.set_keyboard_mode(KeyboardMode::None);
    gtk_win.set_exclusive_zone(-1);

    // Anchor top-left; margins define the widget's (x, y) position on screen
    gtk_win.set_anchor(Edge::Left, true);
    gtk_win.set_anchor(Edge::Top, true);

    let (left, top) = initial_margins.unwrap_or((0, 0));
    gtk_win.set_layer_shell_margin(Edge::Left, left);
    gtk_win.set_layer_shell_margin(Edge::Top, top);

    true
}

// X11 implementation — filled in Task 6
#[cfg(target_os = "linux")]
fn apply_x11(_window: &WebviewWindow) {
    // stub — replaced in Task 6
}

#[cfg(target_os = "linux")]
fn set_margins_linux(window: &WebviewWindow, left: i32, top: i32) {
    if std::env::var("WAYLAND_DISPLAY").is_err() {
        return;
    }
    use gtk_layer_shell::{Edge, LayerShell};
    let Ok(gtk_win) = window.gtk_window() else { return; };
    if !gtk_layer_shell::is_supported() {
        return;
    }
    gtk_win.set_layer_shell_margin(Edge::Left, left);
    gtk_win.set_layer_shell_margin(Edge::Top, top);
}

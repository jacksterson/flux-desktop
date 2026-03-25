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

// X11 implementation
#[cfg(target_os = "linux")]
fn apply_x11(window: &WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as XProtoExt, PropMode};
    use x11rb::rust_connection::RustConnection;
    use x11rb::wrapper::ConnectionExt;

    // Obtain the raw X11 window ID via raw-window-handle (Tauri 2 implements HasWindowHandle).
    let xlib_win: u32 = match window.window_handle().map(|h| h.as_raw()) {
        Ok(RawWindowHandle::Xlib(h)) => h.window as u32,
        Ok(RawWindowHandle::Xcb(h)) => h.window.get(),
        _ => return,
    };

    let Ok((conn, _screen)) = RustConnection::connect(None) else { return; };

    // Intern the atoms we need
    let wm_type_cookie = match conn.intern_atom(false, b"_NET_WM_WINDOW_TYPE") {
        Ok(c) => c,
        Err(_) => return,
    };
    let type_desktop_cookie = match conn.intern_atom(false, b"_NET_WM_WINDOW_TYPE_DESKTOP") {
        Ok(c) => c,
        Err(_) => return,
    };
    let wm_state_cookie = match conn.intern_atom(false, b"_NET_WM_STATE") {
        Ok(c) => c,
        Err(_) => return,
    };
    let state_below_cookie = match conn.intern_atom(false, b"_NET_WM_STATE_BELOW") {
        Ok(c) => c,
        Err(_) => return,
    };

    let Ok(wm_type) = wm_type_cookie.reply() else { return; };
    let Ok(type_desktop) = type_desktop_cookie.reply() else { return; };
    let Ok(wm_state) = wm_state_cookie.reply() else { return; };
    let Ok(state_below) = state_below_cookie.reply() else { return; };

    // _NET_WM_WINDOW_TYPE = _NET_WM_WINDOW_TYPE_DESKTOP
    let _ = conn.change_property32(
        PropMode::REPLACE,
        xlib_win,
        wm_type.atom,
        AtomEnum::ATOM,
        &[type_desktop.atom],
    );

    // _NET_WM_STATE = _NET_WM_STATE_BELOW
    let _ = conn.change_property32(
        PropMode::REPLACE,
        xlib_win,
        wm_state.atom,
        AtomEnum::ATOM,
        &[state_below.atom],
    );

    let _ = conn.flush();
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

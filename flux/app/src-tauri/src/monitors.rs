use tauri::AppHandle;

#[derive(Debug, Clone, serde::Serialize)]
pub struct MonitorInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale_factor: f64,
}

/// Stable string identifier for a monitor: "name:WxH@x,y"
pub fn monitor_fingerprint(m: &MonitorInfo) -> String {
    format!("{}:{}x{}@{},{}", m.name, m.width, m.height, m.x, m.y)
}

/// Returns true if the point (x, y) does not fall within any monitor's bounds.
pub fn is_topleft_offscreen(x: i32, y: i32, monitors: &[MonitorInfo]) -> bool {
    !monitors.iter().any(|m| {
        x >= m.x
            && x < m.x + m.width as i32
            && y >= m.y
            && y < m.y + m.height as i32
    })
}

/// Returns the monitor that contains (x, y), or None if off all monitors.
pub fn monitor_for_position<'a>(x: i32, y: i32, monitors: &'a [MonitorInfo]) -> Option<&'a MonitorInfo> {
    monitors.iter().find(|m| {
        x >= m.x
            && x < m.x + m.width as i32
            && y >= m.y
            && y < m.y + m.height as i32
    })
}

/// Returns the monitor at (0, 0), or the first monitor if none is at the origin.
pub fn primary_monitor(monitors: &[MonitorInfo]) -> Option<&MonitorInfo> {
    monitors
        .iter()
        .find(|m| m.x == 0 && m.y == 0)
        .or_else(|| monitors.first())
}

/// Collects all currently connected monitors from the OS via Tauri.
pub fn collect_monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| MonitorInfo {
            name: m.name().cloned().unwrap_or_else(|| "Unknown".to_string()),
            width: m.size().width,
            height: m.size().height,
            x: m.position().x,
            y: m.position().y,
            scale_factor: m.scale_factor(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_monitor(name: &str, w: u32, h: u32, x: i32, y: i32) -> MonitorInfo {
        MonitorInfo { name: name.to_string(), width: w, height: h, x, y, scale_factor: 1.0 }
    }

    #[test]
    fn fingerprint_format() {
        let m = make_monitor("DP-1", 2560, 1440, 0, 0);
        assert_eq!(monitor_fingerprint(&m), "DP-1:2560x1440@0,0");
    }

    #[test]
    fn fingerprint_negative_offset() {
        let m = make_monitor("HDMI-1", 1920, 1080, -1920, 0);
        assert_eq!(monitor_fingerprint(&m), "HDMI-1:1920x1080@-1920,0");
    }

    #[test]
    fn on_primary_monitor_not_offscreen() {
        let monitors = vec![make_monitor("DP-1", 2560, 1440, 0, 0)];
        assert!(!is_topleft_offscreen(100, 100, &monitors));
        assert!(!is_topleft_offscreen(0, 0, &monitors));
        assert!(!is_topleft_offscreen(2559, 1439, &monitors));
    }

    #[test]
    fn just_outside_right_edge_is_offscreen() {
        let monitors = vec![make_monitor("DP-1", 2560, 1440, 0, 0)];
        assert!(is_topleft_offscreen(2560, 0, &monitors));
    }

    #[test]
    fn on_secondary_monitor_not_offscreen() {
        let monitors = vec![
            make_monitor("DP-1", 2560, 1440, 0, 0),
            make_monitor("HDMI-1", 1920, 1080, 2560, 0),
        ];
        assert!(!is_topleft_offscreen(2700, 100, &monitors));
    }

    #[test]
    fn between_monitors_is_offscreen() {
        let monitors = vec![
            make_monitor("DP-1", 2560, 1440, 0, 0),
            make_monitor("HDMI-1", 1920, 1080, 3000, 0),
        ];
        assert!(is_topleft_offscreen(2600, 100, &monitors));
    }

    #[test]
    fn monitor_for_position_finds_correct_monitor() {
        let monitors = vec![
            make_monitor("DP-1", 2560, 1440, 0, 0),
            make_monitor("HDMI-1", 1920, 1080, 2560, 0),
        ];
        let m = monitor_for_position(2600, 50, &monitors);
        assert!(m.is_some());
        assert_eq!(m.unwrap().name, "HDMI-1");
    }

    #[test]
    fn primary_monitor_at_origin() {
        let monitors = vec![
            make_monitor("HDMI-1", 1920, 1080, -1920, 0),
            make_monitor("DP-1", 2560, 1440, 0, 0),
        ];
        let p = primary_monitor(&monitors);
        assert!(p.is_some());
        assert_eq!(p.unwrap().name, "DP-1");
    }

    #[test]
    fn primary_monitor_fallback_to_first() {
        let monitors = vec![make_monitor("HDMI-1", 1920, 1080, 100, 0)];
        let p = primary_monitor(&monitors);
        assert!(p.is_some());
        assert_eq!(p.unwrap().name, "HDMI-1");
    }
}

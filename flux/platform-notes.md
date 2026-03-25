# Flux Platform Notes

A living log of cross-platform constraints discovered during development.
Updated whenever a new limitation or workaround is found.
Feeds directly into the Widget Authoring Guide.

---

## 2026-03-24

### Disk I/O Throughput — Linux Only
**Affected platforms:** Windows, Mac (unavailable)
**Symptom:** `disk_read` and `disk_write` in `SystemStats` are `null` on non-Linux platforms.
**Reason:** Linux exposes disk I/O counters via `/proc/diskstats`. No equivalent cross-platform API exists in the `sysinfo` crate. `sysinfo::Disks` only provides storage capacity, not throughput.
**Workaround:** Widgets must check for `null` and hide the disk I/O section gracefully. See Authoring Guide — Handling Unavailable Stats.

### GPU Stats — Platform Coverage
**Affected platforms:** Partial
**Coverage:**
- Linux AMD: available via `/sys/class/drm/` (DRM subsystem)
- Linux NVIDIA: available via `nvml_wrapper`
- Windows NVIDIA: available via `nvml_wrapper` (requires NVIDIA driver)
- Windows AMD/Intel: unavailable
- Mac (all): unavailable
**Workaround:** `gpu` field in `SystemStats` is `null` when unavailable. Widgets must handle `gpu === null`. See Authoring Guide — Handling Unavailable Stats.

### Window Desktop Layer — Phase 2 In Progress
**Affected platforms:** All
**Status:** Wayland (KDE Plasma) and X11 implemented; Mac deferred to hardware; Windows out of scope.

#### Linux Wayland — Implemented (2026-03-25)
`zwlr_layer_shell_v1` via `gtk-layer-shell 0.8`. Layer: `Bottom` (above wallpaper, below app windows). Drag via `move_module(id, dx, dy)` command (margins-based); `drag_window` is a no-op on layer-shell surfaces. Position persists via separate `margins` map in `window_state.json`.

**Known risk — window realization order:** `gtk_layer_shell::init_layer_shell()` must be called before the GTK window is realized. Tauri may realize the window during `builder.build()`, before `desktop_layer::apply` is called. If widgets do not appear in the desktop layer during testing, this is the first thing to investigate. Fix would require calling `init_layer_shell` pre-build or using Tauri's window creation hooks.

#### Linux X11 — Implemented (2026-03-25)
`_NET_WM_WINDOW_TYPE_DESKTOP` + `_NET_WM_STATE_BELOW` via `x11rb`. Set post-build via `change_property32`. Some WMs may treat `_NET_WM_WINDOW_TYPE_DESKTOP` as fixed-position (no drag) — if so, drop the type hint and use only `_NET_WM_STATE_BELOW`.

**Known risk — mapping order:** EWMH properties should ideally be set before window mapping. Tauri maps the window during `builder.build()`. If properties are ignored by the WM, a pre-map approach is needed.

#### Windows — Out of Scope
`WorkerW`/`Progman` parenting not planned for this phase.

#### Mac — Deferred
`NSWindowLevel.desktopIconLevel` via `objc2`. Will be implemented on hardware.

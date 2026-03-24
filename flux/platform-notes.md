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

### Window Desktop Layer — Not Yet Implemented
**Affected platforms:** All
**Status:** Phase 2
**Notes:** The default `windowLevel: "desktop"` currently maps to a normal non-topmost window. True desktop-layer behaviour (above wallpaper, below all app windows) requires platform-specific implementation:
- Linux X11: `_NET_WM_WINDOW_TYPE_DESKTOP`
- Linux Wayland: compositor-dependent
- Windows: `WorkerW`/`Progman` parenting (Win32 API)
- Mac: `NSWindowLevel.desktopIconLevel`
Will be implemented and documented per platform in Phase 2.

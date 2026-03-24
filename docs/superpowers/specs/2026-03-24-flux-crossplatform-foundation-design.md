# Flux: Cross-Platform Foundation Design

**Date:** 2026-03-24
**Status:** Approved
**Scope:** Engine foundations, project structure, marketing sequence

---

## 1. What We're Building

Flux is a cross-platform desktop widget engine. It hosts HTML/CSS/JS widgets in transparent, always-on-top Tauri windows. Anyone can author a widget by writing a webpage — or asking an AI to write one.

**Bridges** is the default bundled theme/widget pack that ships with Flux. It showcases what the engine is capable of. It is not the identity of Flux — it is one contributor's theme. Other community themes will follow.

The engine must work on Linux, Mac, and Windows. **Before any new feature is written, cross-platform viability must be verified for all three.**

---

## 2. Path Resolution

### Problem
`lib.rs` contains two hard-coded absolute paths:
- `/home/jack/bridgegap/flux/modules` — breaks on every other machine
- `/home/jack/bridgegap/flux/window_state.json` — breaks on every other machine and OS

### Solution

| Data | Path | Rationale |
|------|------|-----------|
| Bundled modules (Bridges, etc.) | Inside app package via `resource_dir()` | Read-only, ships with the app |
| User modules (community widgets) | `~/Flux/modules/` | User-facing, visible in file browser |
| User skins/themes | `~/Flux/skins/` | User-facing, visible in file browser |
| Window state | OS app data dir via `app_data_dir()` | Hidden is fine, user never touches this |

`~/Flux/` is the same path to explain on any platform. Users download a widget from GitHub, unzip it into `~/Flux/modules/`, and Flux picks it up. No knowledge of `%APPDATA%` or `~/Library` required.

On first run, Flux creates `~/Flux/modules/` and `~/Flux/skins/` if they do not exist.

### Module Loading Order
Flux loads modules from both `resource_dir()/modules/` (bundled) and `~/Flux/modules/` (user). Rules:
- If a module `id` exists in both locations, the user version shadows the bundled one entirely
- `list_modules` returns one entry per unique `id` — the user version if both exist
- Schema version mismatches on load: log a warning, skip the module, do not crash

### tauri.conf.json Requirements
Bundled modules must be declared in `tauri.conf.json` under `bundle.resources` so they are included in production builds. The `flux-module://` custom protocol requires a CSP entry permitting it. These changes are part of the path resolution implementation task.

### Window State Versioning
`PersistentState` will include a `version` integer field. On schema mismatch (version unrecognised), Flux discards the saved state and starts fresh rather than crashing. This is acceptable for now.

---

## 3. System Stats — Cross-Platform

### Problem
Three Linux-only reads in `lib.rs`:

| Code | Issue |
|------|-------|
| `/proc/diskstats` | Linux procfs only |
| `/sys/class/drm/.../gpu_busy_percent` | Linux DRM only |
| `/sys/class/drm/.../mem_info_vram_*` | Linux DRM only |

### Solution

**Disk I/O:** `sysinfo::Disks` provides storage capacity only — it does not expose read/write throughput. Disk I/O rates are scoped to Linux-only, matching the GPU pattern. On non-Linux platforms, `disk_read` and `disk_write` return `null` in `SystemStats`. The widget hides the disk I/O section when these values are null.

**GPU Stats:**

| Platform | Method | Status |
|----------|--------|--------|
| Linux AMD | `/sys/class/drm/` reads | Keep, wrap in `#[cfg(target_os = "linux")]` |
| Linux NVIDIA | `nvml_wrapper` | Keep as-is |
| Windows NVIDIA | `nvml_wrapper` | Works if NVIDIA driver is installed; silent fail otherwise |
| Mac (all GPU) | — | Returns `gpu: null` — widget hides GPU section |
| Windows AMD/Intel | — | Returns `gpu: null` — widget hides GPU section |

### cfg Wrapping Scope
The following items in `lib.rs` are wrapped in `#[cfg(target_os = "linux")]`:
- The entire `get_linux_gpu_usage()` function
- The entire `get_linux_vram_best()` function
- The call site block inside `get_system_stats()` that invokes both functions
- The `/proc/diskstats` read block inside `get_system_stats()`

On non-Linux targets, `disk_read`, `disk_write` are set to `None`, and the fallback Linux GPU block is skipped entirely. `nvml_wrapper` GPU detection still runs on all platforms.

### Widget Null Handling
When `gpu` is `null` or disk I/O values are `null`, the frontend hides those sections cleanly rather than showing dashes or a "not supported" label. Less UI noise for users on platforms where stats are unavailable.

CPU, RAM, and network stats already use `sysinfo` and are cross-platform with no changes needed.

---

## 4. Project Structure

### Two Repos

| Repo | Visibility | Contents |
|------|-----------|---------|
| `bridgegap` | Private | Personal workspace: all projects, Obsidian docs, personal notes, dev tools |
| `flux` | Public | Engine only: app, bundled modules, website, public docs |

The public `flux` repo is what the community sees, forks, stars, and contributes to.

### Public `flux` Repo Structure

```
flux/
  app/              # Tauri engine (Rust + TypeScript)
  modules/
    bridges/        # Default bundled theme — one palette currently (cyan)
  website/          # Landing page with Ko-fi link and email signup
  docs/             # Public-facing documentation + widget authoring guide
  README.md         # Hero screenshots, AI-native pitch, Ko-fi badge, install guide
```

### Bridges Theme

- Lives at `flux/modules/bridges/`
- Name: "Bridges" — no IP references anywhere
- Currently one palette (cyan/default)
- Palette swap system and robust settings menu planned before marketing push
- Multiple palette variants needed for marketing screenshots (dedicated brainstorm session pending)

### Skins Architecture
Each module owns its skins in a `skins/` subdirectory (e.g. `modules/bridges/skins/cyan/skin.json`). A skin defines the color palette and font choices for that module. The `~/Flux/skins/` user directory is reserved for future global skin overrides that apply across all modules simultaneously — not implemented in this phase.

### Palette Schema (draft)
A `skin.json` defines a palette with at minimum:

```json
{
  "name": "Cyan",
  "theme": {
    "primary": "#00BFFF",
    "primary_soft": "#4FC3F7",
    "neutral": "#E8EAED",
    "safe": "#39FF14",
    "caution": "#FFC107",
    "alert": "#FF6B1A",
    "danger": "#FF2020",
    "chiral": "#9B59B6",
    "bg_base": "#0A0F1A",
    "bg_panel": "rgba(0,191,255,0.10)",
    "border_default": "rgba(79,195,247,0.45)",
    "font_main": "Rajdhani",
    "font_tech": "Share Tech Mono",
    "font_header": "Orbitron"
  }
}
```

Palette variants are additional `skin.json` files under `modules/bridges/skins/<palette-name>/`. The settings menu lists available palettes by scanning that directory.

---

## 5. Widget Authoring Guide & Cross-Platform Compliance

**Cross-platform compatibility is Flux's identity.** If a widget is published for Flux, it must run on Linux, Mac, and Windows. The authoring guide is the standard that makes this promise enforceable.

### What the Guide Is

The authoring guide is a **living document** — started now, never finished. Every time a cross-platform constraint is discovered during Flux development, it is documented immediately in the guide with the problem, the platform it affects, and the workaround. Nothing gets buried in a commit message.

It serves two roles simultaneously:
1. **Reference for widget authors** — tells humans and AI assistants exactly what APIs are available, what is platform-limited, and how to handle each case
2. **Compliance standard** — widget repos include a `COMPATIBILITY.md` checklist based on this guide; community reviewers use it

The AI-native pitch becomes concrete: "Ask AI to build your widget and point it at our authoring guide." A well-prompted AI with the guide produces Flux-compliant widgets reliably.

### Guide Structure (`docs/authoring-guide.md` in public repo)

1. **The Flux API** — what every widget can call:
   - `invoke("get_system_stats")` — CPU, RAM, GPU, network, disk (with platform availability noted per field)
   - `invoke("drag_window")` — initiates window drag
   - `invoke("list_modules")` / `invoke("toggle_module", { id })` — module management
   - `flux-module://<module-id>/<file>` — custom protocol for loading module assets
   - `module.json` manifest — id, name, version, author, entry point, window config, permissions

2. **Cross-Platform Rules** — must-follow constraints:
   - No absolute file paths (use relative paths within the module directory only)
   - No direct OS API calls from the frontend (all system data comes through Flux invoke commands)
   - No Node.js APIs (widgets run in a webview, not Node)
   - Handle `null` gracefully for any stat that may be unavailable on some platforms
   - GPU and disk I/O stats are Linux-primary; always code a fallback UI state

3. **Known Platform Constraints** (living log — grows during development):
   - GPU stats: full on Linux, NVIDIA-only on Windows, unavailable on Mac
   - Disk I/O throughput: Linux only
   - *(more added here as discovered)*

4. **Widget Checklist (`COMPATIBILITY.md`)** — every published widget repo includes:
   - [ ] Tested on Linux
   - [ ] Handles `gpu: null` without UI breakage
   - [ ] Handles `disk_read: null` / `disk_write: null` without UI breakage
   - [ ] No hard-coded paths
   - [ ] No direct OS calls from frontend
   - [ ] `module.json` valid and complete

5. **AI Prompting Guide** — how to ask an AI to build a Flux-compliant widget:
   - Include the Flux API reference in your prompt
   - Instruct the AI to handle null stats
   - Link to the guide directly: "follow the Flux authoring guide at [url]"

### Platform Notes Log (`docs/platform-notes.md` in public repo)

A running log of discovered constraints and their workarounds, dated. Example format:

```
## 2026-03-24
- Disk I/O throughput (bytes/sec) is Linux-only. sysinfo::Disks does not expose throughput.
  Workaround: disk_read/disk_write return null on non-Linux; widgets hide the section when null.
```

This log is updated whenever a new constraint is found during development.

---

## 6. Community Feedback System

**GitHub Issues** with structured labels:

| Label | Purpose |
|-------|---------|
| `bug` | Something broken |
| `feature-request` | New capability ask |
| `widget-feedback` | Feedback on specific widgets/modules |
| `platform: linux` | Linux-specific issue |
| `platform: windows` | Windows-specific issue |
| `platform: mac` | Mac-specific issue |
| `good first issue` | Community contribution opportunity |

A pinned Reddit post template will be created for each community launch to funnel structured feedback to GitHub Issues.

---

## 7. Distribution

**Phase 1 (Linux launch):**
- GitHub Releases with pre-built AppImage for Linux (broadest compatibility, no install required)
- AUR package (targets Arch/CachyOS users — the primary audience)

**Phase 2 (Windows):**
- GitHub Releases: portable `.exe` zip + `.msi` installer
- Do not post to `r/Rainmeter` until Windows GPU and disk stats are fully functional

**Phase 3 (Mac):**
- GitHub Releases: `.dmg`
- Requires Apple signing/notarization to avoid Gatekeeper warnings — plan accordingly

Builds are automated via GitHub Actions CI on tagged releases.

---

## 8. Marketing Sequence

**Stream A — Technical Foundation (unblocks everything else):**
1. Initialize git in `bridgegap/` (private)
2. Fix hard-coded paths → `~/Flux/` and `app_data_dir()`, update `tauri.conf.json`
3. Scope disk I/O and GPU Linux code with `#[cfg(target_os = "linux")]`
4. Add `PersistentState` version field
5. Extract public `flux` repo from `bridgegap`
6. Set up GitHub Actions for AppImage build on tag

**Stream B — Bridges Polish (unblocks marketing screenshots):**
1. Brainstorm session: define 3-4 palette variants
2. Implement palette swap system in Bridges settings menu
3. Capture clean desktop screenshots of each palette

**Stream C — Marketing Assets (runs after A + B):**
1. Ko-fi page: Bridges screenshots as hero, supporter tier = early access to new palette drops
2. GitHub README: badges, screenshots, AI-native pitch, install guide, Ko-fi link
3. Landing page: Ko-fi link, email signup, branding aligned to Bridges cyan
4. Reddit launch: `r/unixporn` and `r/linux` first (Linux audience)
5. Reddit `r/Rainmeter`: only after Windows support is solid
6. Facebook business page (lower priority, long-term discoverability)

**No public launch until Stream A and B are complete.**

---

## 9. Window Layering

Flux widgets are **not always-on-top by default.** The default behavior is desktop layer — widgets sit above the wallpaper and below all application windows. They feel like part of the desktop, not an intrusion on it.

### Three Window Modes (per widget, configurable)

| Mode | Behavior | Default |
|------|----------|---------|
| `desktop` | Above wallpaper, below all windows | **Yes** |
| `top` | Floats above all windows | No |
| `normal` | Standard window z-ordering | No |

Defined in `module.json` as `"windowLevel": "desktop" | "top" | "normal"`.

The current hardcoded `always_on_top: true` in `lib.rs` is replaced by this per-widget setting.

### Cross-Platform Implementation

| Platform | Mechanism |
|----------|-----------|
| **Windows** | Parent window to shell's `WorkerW`/`Progman` process — same technique used by Rainmeter and Wallpaper Engine. Requires Win32 API calls via the `windows` crate. |
| **Linux X11** | Set `_NET_WM_WINDOW_TYPE_DESKTOP` or `_NET_WM_STATE_BELOW` — well supported across WMs. |
| **Linux Wayland** | Compositor-dependent. KDE Plasma supports it via its own protocols. GNOME is more restrictive. Document known-working compositors in `platform-notes.md` as tested. |
| **Mac** | Set `NSWindowLevel` to `desktopIconLevel` or below via `objc` bindings. Achievable and documented. |

Window layering is a **Phase 2 implementation task** — the engine ships first with `normal` window mode working everywhere, then desktop layer support is added per platform and documented in `platform-notes.md` as each one is confirmed working.

### Out of Scope
Mobile (Android/iOS) is explicitly out of scope. The desktop layering paradigm and system stats access do not translate to mobile. Not pursued.

---

## 10. Key Constraints

- Cross-platform first: verify Mac/Windows/Linux compatibility before writing any feature
- Default window mode is `desktop` layer (above wallpaper, below all windows) — not always-on-top
- No IP references in Bridges theme — name only, aesthetic speaks for itself
- `bridgegap` stays private; only `flux` is public
- Honor system monetization: Ko-fi + Sponsor-ware (premium Bridges palette drops for supporters)
- Income is the highest priority — keep scope tight, ship fast
- Mobile is out of scope

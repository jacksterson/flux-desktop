# Flux Phase 1 — Multi-Widget & Config System Design

**Date:** 2026-03-26
**Scope:** TOML engine config, multi-widget launch, theme installation, Command Center, tray menu, Phase 0 cleanup
**Status:** Approved

---

## Overview

Phase 1 makes Flux a real multi-widget engine. Users can install themes, toggle individual modules on/off from a persistent Command Center, and mix modules from different themes. Configuration persists across restarts via a TOML file. The system tray provides quick access to the Command Center and themes folder.

---

## 1. TOML Engine Config

### File Location

`~/.local/share/flux/config.toml`

### Format

```toml
[engine]
broadcast_interval_ms = 2000
active_modules = ["system-stats", "time-date", "weather"]
```

- `broadcast_interval_ms` — push broadcaster tick rate (was hardcoded at 2000ms in Phase 0)
- `active_modules` — list of module IDs currently running; these are opened as Tauri windows on startup

### Behaviour

- If the file does not exist on launch (first run), Flux opens the Command Center and waits for user input before writing the file.
- When a module is toggled in the Command Center, `active_modules` is updated immediately and the corresponding window is opened or closed.
- `broadcast_interval_ms` is read once at startup; changing it requires a restart (configuring live reload is out of scope for Phase 1).

### Rust

A `EngineConfig` struct (serde + toml) handles read/write. A `save_config` helper writes atomically (write to temp file, rename). Stored in `AppState` behind a `Mutex`.

---

## 2. Multi-Widget Launch

On startup, Flux reads `config.toml` and opens one Tauri window per module ID in `active_modules`, using the existing window creation logic. Each window is independent — positions restore from `window_state.json` as before.

### New Tauri Commands

| Command | Description |
|---|---|
| `list_themes` | Returns all installed themes (bundled + user-installed) with their modules and active status |
| `activate_theme(id)` | Adds all modules from the given theme to `active_modules`, opens their windows |
| `deactivate_theme(id)` | Removes all modules from the given theme from `active_modules`, closes their windows |
| `toggle_module(id, enabled)` | Adds or removes a single module ID from `active_modules`, opens or closes its window |
| `get_config` | Returns the full engine config (for Command Center to read) |
| `set_broadcast_interval(ms)` | Updates `broadcast_interval_ms` in config (takes effect on next restart) |

The existing `toggle_module` command is updated to also update `config.toml` (Phase 0 only toggled the in-memory window map).

---

## 3. Theme Installation

### User Themes Directory

`~/.local/share/flux/themes/`

Same folder structure as bundled themes:
```
~/.local/share/flux/themes/
  my-theme/
    theme.json
    modules/
      my-widget/
        module.json
        index.html
        ...
```

### Installation

Users drop a theme folder into `~/.local/share/flux/themes/`. The Command Center has a "Browse Themes Folder" button that opens this directory in the system file manager. Flux discovers the theme on the next `list_themes` call (no hot-reload in Phase 1 — user refreshes the Command Center or restarts).

Zip/archive extraction is out of scope for Phase 1.

### Theme Preview Image

`theme.json` gains an optional `preview` field:
```json
{
  "id": "my-theme",
  "name": "My Theme",
  "description": "...",
  "version": "1.0.0",
  "modules": ["my-widget"],
  "preview": "preview.png"
}
```

If `preview` is set, the Command Center displays the image. If absent, a placeholder is shown. The image path is relative to the theme directory root.

### Discovery Update

`list_themes` scans in priority order:
1. `~/.local/share/flux/themes/*/` (user-installed)
2. `resource_dir/themes/*/` (bundled)

Module discovery within each theme reads `modules/*/module.json`. Deduplication by module ID: user themes shadow bundled ones of the same ID.

### Legacy Path Removal

The legacy `resource_dir/modules/` flat scan path (kept for Phase 0 backwards compat) is removed. All modules now live under `themes/`.

---

## 4. Command Center

A persistent Tauri window (engine UI, not a module). Opens on first run and whenever the user selects "Open Command Center" from the tray.

### Window Properties

- Standard decorated window (not layer-shell, not transparent)
- Minimum size: 800×600
- Not listed as a module; managed separately by the engine

### UI Structure

- **Header:** Flux logo, "Browse Themes Folder" button
- **Theme cards:** One card per installed theme, showing:
  - Preview image (or placeholder)
  - Theme name and description
  - "Activate All" / "Deactivate All" buttons (shortcuts that toggle all modules in the theme at once)
  - Expandable module list: each module has a name and an on/off toggle
- **Active state:** Modules currently in `active_modules` show their toggle as on, regardless of which theme they came from

### Behaviour

- Toggling a module applies immediately — the window opens or closes in real time
- "Activate All" adds all theme modules to `active_modules`; "Deactivate All" removes them
- The Command Center does not close automatically; the user closes it manually
- If already open when triggered from the tray, it focuses rather than opening a second instance

### Serving

Served from `resource_dir/command-center/index.html` via the existing `flux-module://` scheme. A new reserved path `_flux/command-center/` is added alongside `_flux/widget-api.js`. The Command Center uses `WidgetAPI` for its own drag and close.

### Tauri Command

`open_command_center` — opens the Command Center window if not already open; focuses it if it is.

---

## 5. System Tray Menu

Right-click menu items:

- **Open Command Center** — calls `open_command_center`
- **Browse Themes Folder** — opens `~/.local/share/flux/themes/` in the system file manager (`opener` crate or `tauri-plugin-shell`)
- *(separator)*
- **Quit Flux**

---

## 6. Phase 0 Cleanup

### Automatic `widget-api.js` Injection

The URI scheme handler is updated to inject `<script src="flux-module://_flux/widget-api.js"></script>` automatically when serving any `index.html` file from a module directory. The manual `<script>` tags in all three Bridges modules are removed.

Detection: after reading the file bytes, scan for `</head>` or `<body` and insert the script tag before it. If neither is found, prepend it.

### Remove Legacy Flat Modules Path

The `resource_dir/modules/` scan path added in Phase 0 for backwards compatibility is removed from `list_modules`, `toggle_module`, and the `flux-module://` URI handler.

---

## Out of Scope (Phase 2+)

- Zip/archive theme installation
- Hot-reload of newly installed themes without Command Center refresh
- Live `broadcast_interval_ms` changes without restart
- Per-module settings UI within the Command Center
- Theme creation / visual editor (Phase 4)
- Community theme registry (Phase 6)

---

## Checklist

- [ ] `EngineConfig` struct with TOML read/write; stored in `AppState`
- [ ] Startup reads `active_modules` and opens windows for each
- [ ] First-run detection (no config file) opens Command Center
- [ ] `list_themes` command scans user + bundled theme dirs
- [ ] `activate_theme` / `deactivate_theme` commands
- [ ] `toggle_module` updated to persist to config
- [ ] `get_config` command
- [ ] User themes directory: `~/.local/share/flux/themes/`
- [ ] `theme.json` `preview` field support in `list_themes`
- [ ] `open_command_center` command
- [ ] Command Center HTML/CSS/JS — theme cards with module toggles
- [ ] Tray menu updated: Open Command Center, Browse Themes Folder, Quit
- [ ] `widget-api.js` auto-injected by URI handler; manual tags removed from Bridges modules
- [ ] Legacy `resource_dir/modules/` scan path removed
- [ ] Existing tests updated/passing
- [ ] New tests: config read/write, list_themes deduplication, first-run detection

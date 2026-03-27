# Flux Phase 2 — First-Run Wizard, Archive Install, Per-Module Settings

**Date:** 2026-03-27
**Scope:** First-run wizard window, zip/7z/tar.gz theme archive installation, per-module settings schema + slide-in panel in Command Center
**Status:** Approved

---

## Overview

Phase 2 gives first-time users a guided setup experience and gives all users two new power features: one-click theme archive installation and per-module settings surfaced directly in the Command Center.

---

## 1. First-Run Wizard

### Trigger

The wizard opens instead of the Command Center when `config.toml` does not exist at startup. Once the wizard writes `config.toml` (or the user closes/Esc), the first-run path is permanently bypassed.

### Window

- Separate decorated Tauri window, label `"wizard"`
- Size: 720×520, min 640×480
- Not resizable beyond min. Not in system tray.
- URL: `flux-module://_flux/wizard/index.html`

### Steps

Progress indicator at the top shows current step number (1–4).

#### Step 1 — Welcome
- Flux logo, tagline, one-liner about what Flux does
- Single "Get Started →" button advances to Step 2
- Esc anywhere in the wizard triggers the **escape path** (see below)

#### Step 2 — Choose Theme
- Grid of theme cards: preview image (falls back to placeholder), theme name, short description
- Single-select; selected card gets a highlight border
- "Skip →" link in the footer advances to Step 3 with no theme selected
- "Next →" button (enabled once a card is selected) advances to Step 3

#### Step 3 — Pick Modules
- List of modules from the selected theme (or all available modules if Step 2 was skipped)
- Each row: module name + toggle switch; all on by default
- "Select all" / "None" links at the top
- "Next →" button enabled only when ≥1 module is toggled on
- "← Back" returns to Step 2

#### Step 4 — Launch
- Summary text: "Starting X modules from [Theme Name]" (or "Starting X modules" if no theme)
- Large "Launch Flux" button:
  1. Writes `config.toml` with `active_modules` and default `broadcast_interval_ms`
  2. Opens one window per selected module
  3. Closes the wizard window
- "← Back" returns to Step 3

### Escape Path

Closing the wizard window or pressing Esc at any point:
1. Writes `config.toml` with whatever is currently selected (even if empty lists)
2. Opens the Command Center
3. Closes the wizard window

This ensures the user is never stuck — the Command Center is always the fallback.

### New Tauri Commands

| Command | Description |
|---|---|
| `launch_wizard` | Opens the wizard window (focus-or-create, same pattern as Command Center) |
| `wizard_launch(active_modules)` | Called from Step 4: writes config, opens module windows, triggers wizard-close |
| `wizard_escape(active_modules)` | Called on close/Esc: writes config (may be empty), opens Command Center, closes wizard |

### Runtime Files

```
flux/app/runtime/wizard/
  index.html
  style.css
  app.js
```

---

## 2. Archive Theme Installation

### Triggers

Two entry points, same install pipeline:

1. **"Install Theme…" button** in the Command Center header → opens a native file picker filtered to `.zip`, `.7z`, `.tar.gz`, `.tgz`
2. **Drag-and-drop** a theme archive file onto the Command Center window → auto-detects the dropped file

### Install Pipeline

```
receive path
  → extract to temp dir
  → validate: manifest.toml exists at root of extracted dir
  → read theme id from manifest.toml [theme].id
  → check for duplicate: ~/.local/share/flux/themes/<id>/ must not already exist
  → move extracted dir to ~/.local/share/flux/themes/<id>/
  → emit "theme-installed" event to Command Center
  → Command Center refreshes theme list
```

Supported formats: `.zip` (Rust `zip` crate), `.tar.gz` / `.tgz` (Rust `tar` + `flate2`), `.7z` (Rust `sevenz-rust` crate).

### Error Cases

All errors are reported inline in the Command Center (below the install button area), not in a modal. The error clears when the user starts a new install attempt.

| Error | Message |
|---|---|
| No `manifest.toml` in archive | "Invalid theme: missing manifest.toml" |
| `[theme].id` missing in manifest | "Invalid theme: manifest has no [theme] id" |
| Theme ID already installed | "Theme '[id]' is already installed" |
| Unsupported file format | "Unsupported archive type" |
| Extraction failure | "Could not extract archive: [reason]" |

### New Tauri Commands

| Command | Description |
|---|---|
| `install_theme_archive(path)` | Full pipeline: extract → validate → move → return ThemeInfo or error string |
| `uninstall_theme(id)` | Removes `~/.local/share/flux/themes/<id>/` directory (guard: deactivate first) |

### Command Center UI Changes

- "Install Theme…" button added to the header row (right-aligned, secondary style)
- Drop-zone: the entire Command Center window listens for `dragover` / `drop` events; a subtle overlay appears on drag-enter
- Inline status area below header: shows "Installing…" spinner, success "Theme '[name]' installed", or error message

---

## 3. Per-Module Settings

### Settings Schema

Each module declares optional settings in its `manifest.toml` under one or more `[[settings]]` entries:

```toml
[[settings]]
key = "update_interval_ms"
label = "Update interval"
type = "range"
default = 2000
min = 500
max = 10000
step = 100

[[settings]]
key = "units"
label = "Units"
type = "select"
options = ["metric", "imperial"]
default = "metric"

[[settings]]
key = "show_seconds"
label = "Show seconds"
type = "toggle"
default = true
```

Supported field types: `range`, `select`, `toggle`, `text`.

If a module has no `[[settings]]` entries, no ⚙ icon is shown for it.

### Settings Storage

Per-module settings are persisted to individual files:

```
~/.local/share/flux/settings/<module-id>.toml
```

Key-value pairs only (no sections). Example:

```toml
update_interval_ms = 3000
units = "imperial"
show_seconds = false
```

On first access, if the file does not exist, defaults from the schema are used and the file is written.

### Command Center UI Changes

- Module cards gain a ⚙ icon button (only rendered if the module has ≥1 setting)
- Clicking ⚙ opens the **settings side panel** — a fixed-width panel (240 px) that slides in from the right edge of the Command Center window
- The card grid area narrows to accommodate the panel; no individual cards reflow
- Panel header: module name + "×" close button
- Panel body: one field per setting, rendered generically from the schema (range → `<input type=range>` + current value label, select → `<select>`, toggle → toggle switch, text → `<input type=text>`)
- Changes write immediately on `input`/`change` events (no save/cancel)
- Panel closes: "×" button, Esc key, or clicking outside the panel
- Only one panel open at a time; clicking ⚙ on a different card switches the panel to that module

### Module Reading Settings

`widget-api.js` gains a `getSettings()` async function. The module ID is derived from the Tauri window label (already available via `window.__TAURI__.window.getCurrent().label`):

```js
async function getSettings() {
  const moduleId = await window.__TAURI__.window.getCurrent().label;
  return await window.__TAURI__.core.invoke('get_module_settings', { moduleId });
}
```

Returns a plain object `{ key: value, ... }` (merged defaults + saved values).

### New Tauri Commands

| Command | Description |
|---|---|
| `get_module_settings(module_id)` | Returns merged settings object (defaults + saved file) |
| `set_module_setting(module_id, key, value)` | Writes a single key to the module's settings file |
| `get_module_settings_schema(module_id)` | Returns the `[[settings]]` array from the module's manifest |

---

## File Layout (new files only)

```
flux/app/runtime/wizard/
  index.html
  style.css
  app.js

flux/app/src-tauri/src/
  archive.rs          ← archive extraction + validation logic
  module_settings.rs  ← settings read/write helpers

~/.local/share/flux/
  settings/           ← created by ensure_flux_dirs() (new in Phase 2)
    <module-id>.toml  ← per-module settings (created on first access)
```

---

## Out of Scope (Phase 2)

- Bridges module implementation / new module content
- Live `broadcast_interval_ms` change (requires restart, unchanged from Phase 1)
- Theme marketplace / remote theme download
- Module position configuration in wizard
- Updating / overwriting an already-installed theme (uninstall first)

# Flux Phase 4a — Widget Editor Core

**Date:** 2026-03-27
**Scope:** WYSIWYG widget editor with live preview, floating panels, save/load, and zip export
**Status:** Approved

---

## Overview

A visual widget creation tool served inside Flux. Users drag components onto a canvas, bind them to live system metrics, tweak properties, and export a standard theme `.zip` that installs immediately via the existing archive pipeline. No coding required.

Design philosophy: blank canvas, floating panels (maximises canvas space), live data in the editor itself, mandatory full project lifecycle at launch (no "Coming Soon" traps).

---

## Window

- Tauri window label: `widget-editor`
- Decorated, resizable. Default size: 1280×900, min: 960×640
- URL: `flux-module://_flux/widget-editor/index.html`
- Loads `widget-api.js` so components display live system data while editing
- Launched via "New Widget…" button in Command Center header and tray right-click menu
- New Rust command `open_widget_editor` opens or focuses the window

---

## Layout

### Top Bar (fixed, full width)
Left cluster: **New** · **Open** · **Save** · **Save As** · **Export Widget**
Center: **Width** / **Height** number inputs (canvas widget dimensions, default 400×300)
Right cluster: **Grid** toggle · **Snap** toggle · **Hard Refresh** button · preset swatches (3)

### Canvas (fills remaining space)
- Dark background, dimensions set by top bar width/height inputs
- Components rendered as absolutely-positioned divs with live data active
- Click component to select; drag to move; 8-handle resize on selection border
- Click empty canvas to deselect
- Delete/Backspace removes selected component
- Ctrl+Z / Ctrl+Shift+Z undo/redo (50-state stack)
- Optional grid lines (CSS overlay); snap rounds x/y/w/h to nearest 8px when enabled

### Three Floating Panels
Each panel has a draggable header bar, remembers last position in localStorage.

**Components panel** (default: top-left)
Lists the 7 component types. Click to add at canvas center; drag directly onto canvas to place.
- Text
- Metric (single live value)
- Progress Bar
- Line Graph
- Circle Meter
- Clock
- Divider

**Properties panel** (default: top-right)
Shows the selected component's editable properties. Empty state: "Select a component to edit."
Common to all types: X, Y, Width, Height (number inputs), Opacity (0–100 slider).
Per-type fields listed in Component Definitions below.

**Layers panel** (default: bottom-right)
Ordered list of all components, top = highest z-index. Click row to select. Drag row to reorder z-index. Eye icon toggles visibility (hidden components are excluded from export).

---

## Aesthetic Presets

Three one-click palettes in the top bar. Applying a preset sets:
- Canvas background colour
- Default text/value colour for newly added components
- Does not override properties already set on existing components

| Preset | Background | Primary colour |
|---|---|---|
| Death Stranding HUD | `#0A0F1A` | `#00BFFF` |
| Minimal Dark | `#111111` | `#EEEEEE` |
| Minimal Light | `#F5F5F5` | `#222222` |

---

## Component Definitions

### Text
Properties: `content` (textarea), `fontSize` (px), `color`, `fontFamily`, `fontWeight`, `textAlign` (left/center/right), `letterSpacing` (px).

### Metric
Displays a single live numeric value with an optional label and unit suffix.
Properties: `source` (dropdown — see Data Sources), `label` (text, optional), `suffix` (text, e.g. "%"), `fontSize`, `color`, `fontFamily`, `decimalPlaces` (0–3).

### Progress Bar
Properties: `source`, `orientation` (horizontal/vertical), `fgColor`, `bgColor`, `borderRadius` (px).
Value range always 0–100 (sources are normalised to percent).

### Line Graph
Rolling history sparkline.
Properties: `source`, `lineColor`, `fillColor` (rgba), `maxPoints` (10–120), `showBaseline` (bool).

### Circle Meter
Arc progress indicator.
Properties: `source`, `color`, `trackColor`, `strokeWidth` (px), `startAngle` (deg, default -90), `showValue` (bool), `fontSize`, `valueColor`.

### Clock
Properties: `format` (strftime-style: `HH:mm:ss`, `HH:mm`, `hh:mm A`), `timezone` (IANA tz string or "local"), `fontSize`, `color`, `fontFamily`.

### Divider
Properties: `orientation` (horizontal/vertical), `color`, `thickness` (px), `margin` (px each side).

---

## Data Sources

Available sources for Metric, Progress Bar, Line Graph, Circle Meter:

| Label | Key | Unit | Event |
|---|---|---|---|
| CPU Usage % | `cpu_avg` | % | `system:cpu` |
| CPU Temp °C | `cpu_temp` | °C | `system:cpu` |
| RAM Usage % | `ram_pct` | % | `system:memory` |
| RAM Used GB | `ram_used_gb` | GB | `system:memory` |
| GPU Usage % | `gpu_pct` | % | `system:gpu` |
| GPU Temp °C | `gpu_temp` | °C | `system:gpu` |
| VRAM Usage % | `vram_pct` | % | `system:gpu` |
| Network In KB/s | `net_in_kbps` | KB/s | `system:network` |
| Network Out KB/s | `net_out_kbps` | KB/s | `system:network` |
| Disk Read MB/s | `disk_read_mbps` | MB/s | `system:disk-io` |
| Disk Write MB/s | `disk_write_mbps` | MB/s | `system:disk-io` |
| Battery % | `battery_pct` | % | `system:battery` |

Progress Bar, Circle Meter: sources are pre-normalised to 0–100 where the unit is already %; KB/s and MB/s sources are normalised against a configurable max (default: 100 KB/s, 100 MB/s) — user sets max in properties.

---

## Project Format (.fluxwidget)

JSON file saved by the editor. Contains all state needed to reconstruct the canvas exactly.

```json
{
  "version": 1,
  "meta": { "name": "My Widget", "moduleId": "my-widget" },
  "canvas": { "width": 400, "height": 300, "background": "#0A0F1A" },
  "components": [
    {
      "id": "uuid-v4",
      "type": "metric",
      "x": 20, "y": 20, "width": 120, "height": 40,
      "opacity": 100, "visible": true, "zIndex": 0,
      "props": { "source": "cpu_avg", "label": "CPU", "suffix": "%", "fontSize": 28, "color": "#00BFFF", "fontFamily": "monospace", "decimalPlaces": 1 }
    }
  ]
}
```

**New / Open / Save / Save As** map to standard file operations via `tauri-plugin-dialog` (already a dependency) + `tauri-plugin-fs` file read/write. No new Rust commands needed beyond `save_fluxwidget(path, json)` and `load_fluxwidget(path) → json`.

---

## Export

1. User clicks **Export Widget**
2. Dialog (inline in editor, not a new window): widget name (text), module ID (auto-slugified from name, editable), confirm canvas width/height
3. JS generates four files in memory:
   - `module.json` — manifest (id, name, entry: "index.html", window: {width, height, transparent: true, decorations: false, resizable: true}, permissions based on sources used)
   - `index.html` — component divs + script tags
   - `style.css` — absolute positioning, colors, fonts, opacity per component
   - `logic.js` — WidgetAPI subscriptions for all live sources used; drag/resize wiring via WidgetAPI
4. Calls `export_widget_package(name, moduleId, filesJson)` Rust command
5. Rust writes a `.zip` with structure: `flux-widget-<id>/theme.json` + `flux-widget-<id>/modules/<id>/{four files}`
6. Rust calls existing `do_install_archive` → returns `ThemeInfo`
7. Editor shows success toast: "Widget installed — activate from Command Center"

`theme.json` generated by Rust: `{ "id": "flux-widget-<moduleId>", "name": "<name>", "modules": ["<moduleId>"] }`.

---

## New Rust Surface

| Command | Signature | Notes |
|---|---|---|
| `open_widget_editor` | `(app) → Result<()>` | Opens or focuses window |
| `save_fluxwidget` | `(path: String, json: String) → Result<()>` | Atomic write via tmp rename |
| `load_fluxwidget` | `(path: String) → Result<String>` | Returns raw JSON |
| `export_widget_package` | `(name: String, module_id: String, files_json: String) → Result<ThemeInfo>` | Generates zip, installs, returns ThemeInfo |

---

## Command Center Integration

- Add **"New Widget…"** button to the Command Center header (next to Install Theme)
- Calls `open_widget_editor`
- Tray right-click menu: add "Widget Editor" item between "Open Command Center" and "Browse Themes Folder"

---

## Out of Scope (Phase 4b)

- Mustache / template binding in Text components (`{{system.cpu.avgUsage}}`)
- CSS variable theme system
- External data hooks (shell scripts, HTTP endpoints)
- Multi-monitor assignment panel
- Font / asset manager
- AI assistant
- Component grouping / multi-select
- Animation keyframes

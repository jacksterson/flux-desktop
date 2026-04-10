# Flux — Project Context for Claude

## Three-Layer Architecture

This project has three distinct layers. Do NOT conflate them:

| Layer | What it is | Location |
|-------|-----------|----------|
| **Flux engine** | Rust/Tauri 2.x desktop widget runner | `app/` |
| **Chiral UI** | Death Stranding-inspired design language | `themes/bridges/shared-hud.css` + `docs/DESIGN_SYSTEM.md` |
| **Koji Pro Suite** | First official theme pack (= the `bridges` theme) | `themes/bridges/` |

## Key Facts

- `themes/bridges/` IS the Koji Pro Suite. "bridges" and "Koji Pro" refer to the same thing.
- `shared-hud.css` is served at `/shared-hud.css` by the engine — use a leading slash in all `<link>` tags.
- `WidgetAPI` is injected by the engine before `</head>` in every `index.html` — do NOT manually include it.
- No build step in widgets. No npm. No React. Vanilla JS + HTML/CSS only.
- All widgets use the `widget-container` + `background-layers` ambient float pattern (see any module for reference).

## Module Structure

Each module: `index.html` + `logic.js` + optional `settings.html` + `module.json`

## WidgetAPI Surface

- `WidgetAPI.widget.drag(mouseEvent)` — initiate window drag
- `WidgetAPI.widget.openSettings()` — open settings.html panel
- `WidgetAPI.widget.closeSettings()` — close settings panel
- `WidgetAPI.system.subscribe(metric, callback)` — subscribe to system metrics
- `WidgetAPI.system.uptime()` — returns Promise<seconds>
- `WidgetAPI.invoke(command, args)` — call Tauri backend commands

## Modules

| ID | Name | Status |
|----|------|--------|
| `weather` | Koji Pro // Weather | Active |
| `system-stats` | Koji Pro // Stats | Active |
| `time-date` | Koji Pro // Chronos | Active |
| `ai-usage` | Koji Pro // AI.OPS | Active |

## Shared Visual Pattern (widget-container)

All modules use this ambient float container — NOT `hud-container`:
```html
<div class="widget-container" id="main-container">
  <div class="background-layers"><div class="widget-background"></div></div>
  <div class="scanlines"></div>
  <div class="pattern-layer"></div>
  <div class="dot-matrix-pattern"></div>
  <div class="mouse-glow"></div>
  <div class="resizer resizer-rb" data-direction="SouthEast"></div>
  <!-- content -->
</div>
```

CSS for `widget-container` and `background-layers` is defined inline in each module's `<style>` block (not in shared-hud.css). The scanlines/pattern-layer/dot-matrix-pattern/mouse-glow classes ARE provided by shared-hud.css.

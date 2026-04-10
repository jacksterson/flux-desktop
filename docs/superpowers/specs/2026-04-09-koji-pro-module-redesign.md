# Koji Pro Suite — Module Redesign & AI Usage Monitor

**Date:** 2026-04-09
**Status:** Approved

---

## Overview

Unify the three existing Koji Pro modules (weather, system-stats, time-date) under a single visual language matching the weather widget's ambient floating aesthetic from Google AI Studio, ensure full Flux engine compliance, and add a new AI Usage Monitor module.

---

## Visual Language (All Modules)

### Container Pattern

All modules use `widget-container` as root (not `hud-container`). No hard border — the ambient float effect comes from:

```html
<div class="widget-container">
  <div class="background-layers">
    <div class="widget-background"></div>
  </div>
  <div class="scanlines"></div>
  <div class="pattern-layer"></div>
  <div class="mouse-glow"></div>
  <!-- content -->
</div>
```

**`background-layers`**: `position: absolute; inset: -40px` with radial-gradient mask vignette (bleeds beyond container edges for soft ambient look).

**`widget-background`**: `background: radial-gradient(ellipse closest-side at center, var(--bg-base) 20%, transparent 90%); backdrop-filter: blur(25px)`.

**`scanlines`**, **`pattern-layer`**, **`mouse-glow`**: imported from shared-hud.css (these classes already exist there).

### Typography

| Role | Font | Weight | Example |
|------|------|--------|---------|
| Primary hero number | Orbitron | 900 | temperature, CPU%, clock |
| Data values | Share Tech Mono | 400 | token counts, speeds |
| Labels / headers | Rajdhani | 500/700 | section names |

### Glow Color System

Mapped to shared-hud.css tokens:

| State | Token | Hex |
|-------|-------|-----|
| Nominal | `--color-hud-primary` (cyan) | `#00BFFF` |
| Warning | `--color-hud-warning` (amber) | `#FF6B1A` |
| Danger | `--color-hud-danger` (red) | `#FF2020` |

Each module defines its own thresholds in `logic.js`.

### Shared Patterns

- **Scan bars**: `div`-based horizontal fill bars (not canvas) for single-value meters. Width driven by CSS custom property `--fill: 78%`.
- **Spark bars**: small inline bar charts (7 bars for weekly view), each a `div` with height driven by data.
- **Section dividers**: `1px solid var(--color-border-default)` with `opacity: 0.4`.
- **Mouse glow**: `mousemove` handler sets `--mouse-x` / `--mouse-y` on widget-container.
- **Drag**: `mousedown` on non-interactive areas calls `WidgetAPI.widget.drag(e)`.
- **Settings**: `WidgetAPI.widget.openSettings()` triggered by gear icon click.

### Flux Compliance Checklist (all modules)

- [ ] No build step (no npm, no Vite, no React)
- [ ] `index.html` loads `logic.js` via `<script src="logic.js">` at bottom of body
- [ ] `/shared-hud.css` referenced in `<head>` (leading slash — engine-served path)
- [ ] `WidgetAPI` used (engine-injected, no manual include)
- [ ] `module.json` present with correct `id`, `name`, `author: "Bridges"`, `window` config
- [ ] `window._fluxCleanup` function exported from `logic.js` to clear intervals
- [ ] `resizer` div present in HTML for resize handle
- [ ] Settings use `localStorage` for persistence, `storage` event for cross-window sync

---

## Module 1 — Weather (Port / Fix)

### Goal

Convert from broken React/Vite project structure to proper Flux widget. Zero logic changes — the Google AI Studio design in `src/main.js` is kept intact.

### File Changes

| Action | Path |
|--------|------|
| Keep (rename) | `src/main.js` → `logic.js` |
| Keep (restructure) | `src/style.css` → inline `<style>` block in `index.html` |
| Rewrite | `index.html` — proper widget shell |
| Extract | settings modal from `logic.js` → `settings.html` |
| Keep | `module.json` |
| **Delete** | `src/`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `node_modules/` |

### CSS Changes

- Remove `body { min-height: 100vh; background: url(unsplash...) }` — widget is transparent over desktop
- Remove `width: 600px` from `.widget-container` — fills Tauri window
- Replace local vars `--cyan`, `--amber`, `--danger` with `var(--color-hud-primary)`, `var(--color-hud-warning)`, `var(--color-hud-danger)`
- Replace `--font-orbitron`, `--font-rajdhani`, `--font-tech` with shared-hud.css token equivalents: `var(--font-header)`, `var(--font-label)`, `var(--font-tech)`

### Logic Changes (minimal)

- `WidgetAPI.widget.drag(e)` — already in main.js, confirm wiring
- `WidgetAPI.widget.openSettings()` — wire to settings gear icon
- Settings panel (location, units, service toggle) extracted to `settings.html`, persists via `localStorage`

### module.json

```json
{
  "id": "weather",
  "name": "Koji Pro // Weather",
  "version": "2.0.0",
  "author": "Bridges",
  "window": {
    "width": 600,
    "height": 900,
    "transparent": true,
    "decorations": false,
    "windowLevel": "desktop",
    "resizable": true
  },
  "permissions": ["window:drag"],
  "entry": "index.html"
}
```

---

## Module 2 — System Stats (Redesign)

### Layout

```
┌──────────────────────────────┐
│ KOJI // SYS.STATS   [⚙]  [↕] │  header + drag handle
├──────────────────────────────┤
│        78%                   │  hero: CPU% — Orbitron 900, glow color
│       CPU LOAD               │  label: Rajdhani
├──────────────────────────────┤
│ CPU  ████████░░  78%  3.2GHz │  scan bar row
│ GPU  █████░░░░░  51%  68°C   │  scan bar row
│ RAM  ███████░░░  71%  11.2G  │  scan bar row
│ DISK ██░░░░░░░░  22%  420G   │  scan bar row
├──────────────────────────────┤
│ [FluxGraph canvas — CPU]     │  history graph (keep existing class)
├──────────────────────────────┤
│ NET↑ 1.2MB/s   NET↓ 3.4MB/s │  metrics row
│ TEMP 72°C      SWAP 0.8G    │  metrics row
└──────────────────────────────┘
```

### Glow Thresholds

- CPU/GPU/RAM usage: cyan < 60%, amber 60–85%, danger > 85%
- Temperature: cyan < 70°C, amber 70–85°C, danger > 85°C

### Changes from Current

- Replace `hud-container` shell with `widget-container` + `background-layers` ambient pattern
- Redesign CSS layout: current uses flex column with gap — keep structure, update visual treatment
- Replace hard borders/background with ambient float
- Update `module.json`: author already "Bridges" ✓, name already "Koji Pro // Stats" ✓

### module.json

```json
{
  "id": "system-stats",
  "name": "Koji Pro // Stats",
  "version": "2.0.0",
  "author": "Bridges",
  "window": {
    "width": 400,
    "height": 650,
    "transparent": true,
    "decorations": false,
    "windowLevel": "desktop",
    "resizable": true
  },
  "permissions": ["system:stats", "window:drag"],
  "entry": "index.html"
}
```

---

## Module 3 — Time-Date (Redesign)

### Layout

```
┌──────────────────────────────┐
│ KOJI // CHRONOS      [drag]  │  header
├──────────────────────────────┤
│                              │
│       23:41:07               │  hero: Orbitron 900, ~5rem, cyan glow
│                              │
│    2026.04.09 // THU         │  Share Tech Mono, amber
│                              │
├──────────────────────────────┤
│  MT 04:21:33  ☀ 06:14/20:47 │  mission time + sunrise/sunset
└──────────────────────────────┘
```

### Sunrise/Sunset

Fetched from Open-Meteo `/v1/forecast?daily=sunrise,sunset` using lat/lon from `localStorage` key `koji_weather_location` (written by weather widget). Falls back gracefully if no location set (hides row).

### Changes from Current

- Replace `hud-container` shell with `widget-container` + `background-layers`
- Increase clock font size (currently 4.5rem → target ~5.5rem, Orbitron 900)
- Add sunrise/sunset row
- Update `module.json`: change `"author": "Flux Core"` → `"Bridges"`, name → `"Koji Pro // Chronos"`

### module.json

```json
{
  "id": "time-date",
  "name": "Koji Pro // Chronos",
  "version": "2.0.0",
  "author": "Bridges",
  "window": {
    "width": 350,
    "height": 220,
    "transparent": true,
    "decorations": false,
    "windowLevel": "desktop",
    "resizable": true
  },
  "permissions": ["window:drag"],
  "entry": "index.html"
}
```

---

## Module 4 — AI Usage Monitor (New)

### Layout

```
┌──────────────────────────────┐
│ KOJI // AI.OPS       [⚙]     │  header
├──────────────────────────────┤
│ CLAUDE                  PRO  │  service row header
│ ██████████░░░░  2,373 in     │  input token bar
│ ████░░░░░░░░░░ 52,722 out    │  output token bar
│ 1.2k msg/hr  week ▂▄▆█▇▅▃   │  hourly rate + 7-day spark
├──────────────────────────────┤
│ GEMINI                 FREE  │  service row header
│ ████░░░░░░░░░░  14 rpm       │  requests per minute bar
│ ██░░░░░░░░░░░░  892 req/day  │  daily request bar
│ -- msg/hr    week ▁▂▁▃▂▁▂    │  hourly rate + 7-day spark
├──────────────────────────────┤
│ TODAY: 55.1k tokens total    │  summary
└──────────────────────────────┘
```

### Data Sources

**Claude:**
- Parses `~/.claude/projects/*/` JSONL files
- Reads entries with `message.usage.input_tokens` and `message.usage.output_tokens`
- Filters by timestamp (today / past 7 days)
- No API key needed — local files only
- Refresh interval: 60 seconds

**Gemini:**
- Reads `~/.gemini/logs/` if present (future-proof)
- Falls back to `localStorage` counter (`koji_gemini_requests`)
- Widget increments counter via a `postMessage` bridge if Gemini MCP is active (future enhancement)
- For now: shows localStorage counter + manual tier config

**Limits (from settings):**
- User selects tier per service: Free / Pro / API
- Known limits stored in `logic.js` constant (e.g., Claude Pro: no hard token limit, soft daily context; Gemini Free: 15 RPM, 1500 req/day)
- Bars show `used / configured_limit`

### Glow Thresholds (all bars)

- < 50% used: cyan
- 50–80%: amber
- > 80%: danger red

### Settings Panel (`settings.html`)

- Toggle service on/off (Claude, Gemini)
- Tier selection per service (Free / Pro / API)
- Custom limit override fields
- Reset daily counters button
- Persists via `localStorage`

### module.json

```json
{
  "id": "ai-usage",
  "name": "Koji Pro // AI.OPS",
  "version": "1.0.0",
  "author": "Bridges",
  "window": {
    "width": 400,
    "height": 500,
    "transparent": true,
    "decorations": false,
    "windowLevel": "desktop",
    "resizable": true
  },
  "permissions": ["window:drag"],
  "entry": "index.html"
}
```

---

## Cleanup Tasks

- Delete `themes/bridges/modules/weather-old/`
- Remove `"*Created by Gemini CLI via UI/UX Pro Max Skill.*"` from `docs/DESIGN_SYSTEM.md`
- Add `CLAUDE.md` to project root explaining three-layer architecture

---

## Out of Scope

- Canvas-based scan graphs in weather (keep as-is — the 168-bar div implementation stays)
- Flux engine changes (no Rust/Tauri changes)
- MemPalace integration (deferred)
- Cross-widget live data sharing (future: Flux IPC)

# Koji Pro Suite — Module Redesign & AI Usage Monitor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port weather widget to proper Flux structure, redesign system-stats and time-date to match weather's ambient aesthetic, and build a new AI Usage Monitor module — all in Koji Pro Suite visual language.

**Architecture:** Each module is a flat directory: `index.html` + `logic.js` + optional `settings.html` + `module.json`. No build step. No npm. WidgetAPI is engine-injected. All modules use the `widget-container` + `background-layers` ambient float pattern from the weather widget, referencing `/shared-hud.css` for tokens.

**Tech Stack:** Vanilla JS, HTML/CSS, Open-Meteo API (weather + time-date), Flux WidgetAPI (engine-injected), localStorage for persistence/settings sync

**Spec:** `docs/superpowers/specs/2026-04-09-koji-pro-module-redesign.md`

**Shared token reference (shared-hud.css):**
- Colors: `--color-hud-primary` (cyan), `--color-hud-caution` (amber), `--color-hud-alert` (orange), `--color-hud-danger` (red), `--color-hud-safe` (green), `--color-hud-neutral` (white), `--color-bg-base`, `--color-border-default`
- Fonts: `--font-header` (Orbitron), `--font-main` (Rajdhani), `--font-tech` (Share Tech Mono)

**Shared widget-container HTML shell (used by ALL modules):**
```html
<div class="widget-container" id="main-container">
  <div class="background-layers">
    <div class="widget-background"></div>
  </div>
  <div class="scanlines"></div>
  <div class="pattern-layer"></div>
  <div class="dot-matrix-pattern"></div>
  <div class="mouse-glow"></div>
  <div class="resizer resizer-rb" data-direction="SouthEast"></div>
  <!-- module content here -->
</div>
```

**Shared widget-container CSS (included in EVERY module's `<style>` block):**
```css
.widget-container {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 1.2rem 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  touch-action: none;
  font-family: var(--font-main);
  color: var(--color-hud-neutral);
  overflow: hidden;
}
.background-layers {
  position: absolute;
  inset: -40px;
  -webkit-mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%);
  mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%);
  pointer-events: none;
  z-index: 0;
}
.widget-background {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse closest-side at center, rgba(10,15,26,0.55) 20%, transparent 90%);
  backdrop-filter: blur(25px);
}
.scanlines {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.08) 50%);
  background-size: 100% 4px;
  pointer-events: none;
  z-index: 1;
}
.resizer { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: se-resize; z-index: 50; }
```

**Shared JS boilerplate (in every logic.js):**
```js
// --- Mouse glow + drag ---
const container = document.getElementById('main-container');
window.addEventListener('mousemove', (e) => {
  const r = container.getBoundingClientRect();
  container.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
  container.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
  const inBounds = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  container.style.setProperty('--pattern-opacity', inBounds ? '1' : '0');
});
container.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-no-drag]')) return;
  WidgetAPI.widget.drag(e);
});
document.querySelector('[data-open-settings]')?.addEventListener('click', () => WidgetAPI.widget.openSettings());
// --- Cleanup ---
window._fluxCleanup = () => { /* clear intervals below */ };
```

---

### Task 1: Port weather module — new index.html shell

**Files:**
- Rewrite: `themes/bridges/modules/weather/index.html`

The current `index.html` loads `src/main.js` directly. We need it to load `logic.js` (not yet renamed) and use the widget-container shell. The CSS from `src/style.css` gets embedded here (minus the standalone `body` rules).

- [ ] **Step 1: Read current index.html and src/style.css**

```bash
cat themes/bridges/modules/weather/index.html
cat themes/bridges/modules/weather/src/style.css
```

- [ ] **Step 2: Write new index.html**

Replace the entire file with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KOJI PRO // WEATHER</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared-hud.css">
  <style>
    /* --- Widget Container (shared pattern) --- */
    .widget-container {
      position: relative; width: 100%; height: 100%;
      padding: 1.2rem 1.4rem;
      display: flex; flex-direction: column; gap: 1rem;
      touch-action: none; font-family: var(--font-main); color: var(--color-hud-neutral); overflow: hidden;
    }
    .background-layers {
      position: absolute; inset: -40px;
      -webkit-mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%);
      mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%);
      pointer-events: none; z-index: 0;
    }
    .widget-background {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse closest-side at center, rgba(10,15,26,0.55) 20%, transparent 90%);
      backdrop-filter: blur(25px);
    }
    .scanlines {
      position: absolute; inset: 0;
      background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.08) 50%);
      background-size: 100% 4px; pointer-events: none; z-index: 1;
    }
    .resizer { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: se-resize; z-index: 50; }

    /* --- Weather-specific styles (from src/style.css, cleaned up) --- */
    .content { position: relative; z-index: 10; display: flex; flex-direction: column; gap: 1rem; height: 100%; }

    header {
      display: flex; justify-content: space-between; align-items: flex-end;
      border-bottom: 1px solid var(--color-border-default); padding-bottom: 0.4rem;
      flex-shrink: 0;
    }
    header h1 {
      font-family: var(--font-header); font-size: 0.8rem; letter-spacing: 2px;
      color: var(--color-hud-neutral); opacity: 0.8; text-transform: uppercase; cursor: pointer;
    }
    header h1:hover { opacity: 1; text-shadow: 0 0 10px var(--color-hud-primary); }
    .header-right { display: flex; align-items: center; gap: 0.8rem; }

    /* Temperature hero */
    .temp-display { text-align: center; position: relative; }
    .temp-value {
      font-family: var(--font-header); font-weight: 900; font-size: 6rem; line-height: 1;
      color: var(--current-glow); text-shadow: 0 0 40px var(--current-glow), 0 0 80px color-mix(in srgb, var(--current-glow) 40%, transparent);
      transition: color 1s ease, text-shadow 1s ease;
    }
    .temp-unit { font-family: var(--font-tech); font-size: 1.5rem; vertical-align: super; opacity: 0.7; }
    .weather-condition {
      font-family: var(--font-tech); font-size: 0.85rem; letter-spacing: 2px;
      color: var(--color-hud-primary-soft); margin-top: 0.2rem; text-transform: uppercase;
    }
    .location-display {
      font-family: var(--font-tech); font-size: 0.75rem; color: var(--color-hud-primary-soft);
      opacity: 0.7; letter-spacing: 1px; text-transform: uppercase;
    }
    .feels-like { font-family: var(--font-tech); font-size: 0.75rem; color: var(--color-hud-primary-soft); opacity: 0.6; }

    /* Hourly forecast */
    .hourly-section { flex-shrink: 0; }
    .hourly-label {
      font-family: var(--font-tech); font-size: 0.65rem; letter-spacing: 2px;
      color: var(--color-hud-primary); opacity: 0.5; text-transform: uppercase; margin-bottom: 0.4rem;
    }
    .hourly-grid { display: flex; gap: 0.5rem; overflow: hidden; }
    .hourly-item {
      flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.2rem;
      background: rgba(0,191,255,0.05); border: 1px solid rgba(0,191,255,0.1);
      border-radius: 4px; padding: 0.4rem 0.3rem; font-family: var(--font-tech); font-size: 0.7rem;
    }
    .hourly-temp { color: var(--color-hud-neutral); }
    .hourly-time { color: var(--color-hud-primary-soft); opacity: 0.6; font-size: 0.65rem; }
    .hourly-icon { font-size: 1rem; }

    /* Scan bar graph */
    .scan-section { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .scan-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 0.4rem;
    }
    .scan-label { font-family: var(--font-tech); font-size: 0.65rem; letter-spacing: 2px; color: var(--color-hud-primary); opacity: 0.5; text-transform: uppercase; }
    .scan-tabs { display: flex; gap: 0.4rem; }
    .scan-tab {
      font-family: var(--font-tech); font-size: 0.6rem; padding: 0.15rem 0.4rem;
      border: 1px solid rgba(0,191,255,0.2); color: var(--color-hud-primary-soft);
      opacity: 0.5; cursor: pointer; border-radius: 2px; background: transparent;
    }
    .scan-tab.active { opacity: 1; border-color: var(--color-hud-primary); color: var(--color-hud-neutral); }
    .scan-bars-container { flex: 1; display: flex; align-items: flex-end; gap: 1px; min-height: 60px; overflow: hidden; }
    .scan-bar {
      flex: 1; background: var(--color-hud-primary); opacity: 0.6;
      transition: height 0.5s ease, background 0.5s ease; min-height: 2px;
    }
    .scan-bar.current { opacity: 1; box-shadow: 0 0 4px var(--color-hud-primary); }
    .scan-day-labels { display: flex; justify-content: space-between; margin-top: 0.3rem; }
    .scan-day-label { font-family: var(--font-tech); font-size: 0.55rem; color: var(--color-hud-primary-soft); opacity: 0.5; }

    /* Metrics grid */
    .metrics-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; flex-shrink: 0;
    }
    .metric-item {
      background: rgba(0,191,255,0.05); border: 1px solid rgba(0,191,255,0.1);
      border-radius: 4px; padding: 0.5rem 0.6rem;
    }
    .metric-label { font-family: var(--font-tech); font-size: 0.6rem; letter-spacing: 1px; color: var(--color-hud-primary-soft); opacity: 0.6; text-transform: uppercase; }
    .metric-value { font-family: var(--font-tech); font-size: 0.9rem; color: var(--color-hud-neutral); margin-top: 0.15rem; }

    /* C/F toggle */
    .unit-toggle {
      font-family: var(--font-tech); font-size: 0.7rem; cursor: pointer;
      color: var(--color-hud-primary-soft); letter-spacing: 1px;
      background: none; border: 1px solid rgba(0,191,255,0.2); padding: 0.1rem 0.4rem; border-radius: 2px;
    }
    .unit-toggle:hover { border-color: var(--color-hud-primary); color: var(--color-hud-neutral); }

    /* Settings gear */
    .settings-btn {
      font-size: 0.8rem; cursor: pointer; color: var(--color-hud-primary-soft);
      opacity: 0.6; background: none; border: none; padding: 0;
    }
    .settings-btn:hover { opacity: 1; color: var(--color-hud-neutral); }

    /* Loading / error */
    .status-msg {
      text-align: center; font-family: var(--font-tech); font-size: 0.75rem;
      color: var(--color-hud-primary-soft); opacity: 0.6; padding: 2rem 0;
    }

    /* Flicker mount animation */
    .flicker-on-mount { animation: flicker 0.3s steps(1) 3; }
    @keyframes flicker { 0%,100%{opacity:1} 50%{opacity:0} }
  </style>
</head>
<body>
  <div class="widget-container flicker-on-mount" id="main-container">
    <div class="background-layers"><div class="widget-background"></div></div>
    <div class="scanlines"></div>
    <div class="pattern-layer"></div>
    <div class="dot-matrix-pattern"></div>
    <div class="mouse-glow"></div>
    <div class="resizer resizer-rb" data-direction="SouthEast"></div>

    <div class="content">
      <header>
        <h1 data-open-settings>KOJI // WEATHER</h1>
        <div class="header-right">
          <button class="unit-toggle" id="unit-toggle">°C</button>
          <button class="settings-btn" data-open-settings>⚙</button>
        </div>
      </header>

      <div class="temp-display">
        <div class="temp-value"><span id="temp-value">--</span><span class="temp-unit" id="temp-unit">°C</span></div>
        <div class="weather-condition" id="condition">LOADING...</div>
        <div class="location-display" id="location">--</div>
        <div class="feels-like" id="feels-like"></div>
      </div>

      <div class="hourly-section">
        <div class="hourly-label">HOURLY FORECAST</div>
        <div class="hourly-grid" id="hourly-grid"></div>
      </div>

      <div class="scan-section">
        <div class="scan-header">
          <span class="scan-label">7-DAY SCAN</span>
          <div class="scan-tabs" id="scan-tabs">
            <button class="scan-tab active" data-mode="temp">TMP</button>
            <button class="scan-tab" data-mode="humidity">HUM</button>
            <button class="scan-tab" data-mode="precip">PCP</button>
            <button class="scan-tab" data-mode="wind">WND</button>
          </div>
        </div>
        <div class="scan-bars-container" id="scan-bars"></div>
        <div class="scan-day-labels" id="scan-day-labels"></div>
      </div>

      <div class="metrics-grid" id="metrics-grid">
        <div class="metric-item"><div class="metric-label">WIND</div><div class="metric-value" id="metric-wind">--</div></div>
        <div class="metric-item"><div class="metric-label">HUMIDITY</div><div class="metric-value" id="metric-humidity">--</div></div>
        <div class="metric-item"><div class="metric-label">PRECIP</div><div class="metric-value" id="metric-precip">--</div></div>
        <div class="metric-item"><div class="metric-label">UV INDEX</div><div class="metric-value" id="metric-uv">--</div></div>
      </div>
    </div>
  </div>
  <script src="logic.js"></script>
</body>
</html>
```

- [ ] **Step 3: Verify file saved**

```bash
head -5 themes/bridges/modules/weather/index.html
```
Expected: `<!DOCTYPE html>` opening with no reference to `src/main.js`

---

### Task 2: Port weather module — logic.js

**Files:**
- Copy + modify: `themes/bridges/modules/weather/src/main.js` → `themes/bridges/modules/weather/logic.js`

The logic is kept intact. We make targeted replacements: CSS var names, settings modal extraction, WidgetAPI wiring.

- [ ] **Step 1: Copy src/main.js to logic.js**

```bash
cp themes/bridges/modules/weather/src/main.js themes/bridges/modules/weather/logic.js
```

- [ ] **Step 2: Replace old CSS variable names with shared-hud.css tokens**

In `logic.js`, find all uses of the old standalone var names and replace:

| Find | Replace |
|------|---------|
| `--cyan` | `--color-hud-primary` |
| `--amber` | `--color-hud-alert` |
| `--danger` | `--color-hud-danger` |

These appear in lines that set `container.style.setProperty('--current-glow', ...)` or similar. Use search to confirm occurrences:

```bash
grep -n "\-\-cyan\|\-\-amber\|\-\-danger" themes/bridges/modules/weather/logic.js
```

Replace each occurrence. Example pattern in the file:
```js
// Before:
container.style.setProperty('--current-glow', 'var(--cyan)');
// After:
container.style.setProperty('--current-glow', 'var(--color-hud-primary)');
```

- [ ] **Step 3: Update WidgetAPI.widget.drag wiring**

Find the existing `WidgetAPI.widget.drag` call and verify it matches the shared boilerplate. The file already has this — confirm:

```bash
grep -n "WidgetAPI" themes/bridges/modules/weather/logic.js
```

Expected: drag call and possibly settings call already present. If settings uses an inline modal, update that call to use `WidgetAPI.widget.openSettings()`:

```bash
grep -n "openSettings\|settings-modal\|modal" themes/bridges/modules/weather/logic.js | head -10
```

Replace any inline modal open/close logic with `WidgetAPI.widget.openSettings()`.

- [ ] **Step 4: Add _fluxCleanup export**

Find the `clearInterval` / cleanup section at the bottom of logic.js. Ensure it is exported as:

```js
window._fluxCluxCleanup = function() {
  // all clearInterval calls here
};
```

If already present under a different name, rename it to `window._fluxCleanup`.

- [ ] **Step 5: Verify no import/require statements**

```bash
grep -n "^import\|^require\|from '" themes/bridges/modules/weather/logic.js | head -10
```

Expected: no output (vanilla JS, no module imports). If any exist, they'll need inlining.

- [ ] **Step 6: Verify in browser**

Open `themes/bridges/modules/weather/index.html` directly in a browser (or via `python3 -m http.server` from themes/bridges/):

```bash
cd /home/jack/Projects/flux/themes/bridges && python3 -m http.server 8888 &
# Open http://localhost:8888/modules/weather/index.html
```

Expected: widget renders, temperature loads from Open-Meteo (or shows loading state), no console errors.

---

### Task 3: Port weather module — settings.html + cleanup

**Files:**
- Create: `themes/bridges/modules/weather/settings.html`
- Delete: `themes/bridges/modules/weather/src/`
- Delete: `themes/bridges/modules/weather/package.json`, `vite.config.ts`, `tsconfig*.json`
- Update: `themes/bridges/modules/weather/module.json`

- [ ] **Step 1: Create settings.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Weather Settings</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;700&family=Share+Tech+Mono&family=Orbitron:wght@700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared-hud.css">
  <style>
    body { padding: 1.2rem; font-family: var(--font-main); color: var(--color-hud-neutral); }
    h2 { font-family: var(--font-header); font-size: 0.85rem; letter-spacing: 2px; color: var(--color-hud-primary); margin-bottom: 1rem; text-transform: uppercase; }
    .field { margin-bottom: 1rem; }
    label { display: block; font-family: var(--font-tech); font-size: 0.7rem; color: var(--color-hud-primary-soft); margin-bottom: 0.3rem; letter-spacing: 1px; text-transform: uppercase; }
    input[type="text"] {
      width: 100%; background: rgba(0,191,255,0.05); border: 1px solid var(--color-border-default);
      color: var(--color-hud-neutral); font-family: var(--font-tech); font-size: 0.85rem;
      padding: 0.4rem 0.6rem; border-radius: 2px; outline: none;
    }
    input[type="text"]:focus { border-color: var(--color-border-active); }
    .toggle-row { display: flex; align-items: center; gap: 0.8rem; margin-bottom: 1rem; }
    .toggle-label { font-family: var(--font-tech); font-size: 0.75rem; color: var(--color-hud-primary-soft); }
    input[type="checkbox"] { accent-color: var(--color-hud-primary); width: 14px; height: 14px; }
    .save-btn {
      font-family: var(--font-header); font-size: 0.7rem; letter-spacing: 2px;
      background: rgba(0,191,255,0.1); border: 1px solid var(--color-border-default);
      color: var(--color-hud-primary); padding: 0.5rem 1.2rem; cursor: pointer;
      text-transform: uppercase; border-radius: 2px; width: 100%;
    }
    .save-btn:hover { background: rgba(0,191,255,0.2); border-color: var(--color-border-active); }
    .divider { border: none; border-top: 1px solid var(--color-border-default); opacity: 0.4; margin: 1rem 0; }
  </style>
</head>
<body>
  <h2>KOJI // WEATHER</h2>

  <div class="field">
    <label>Location (city or lat,lon)</label>
    <input type="text" id="location" placeholder="e.g. London or 51.5,-0.12">
  </div>

  <hr class="divider">

  <div class="toggle-row">
    <input type="checkbox" id="use-simulation">
    <span class="toggle-label">Use simulation (demo mode)</span>
  </div>

  <div class="toggle-row">
    <input type="checkbox" id="show-7-hourly">
    <span class="toggle-label">Show 7 hourly items (default: 5)</span>
  </div>

  <hr class="divider">

  <button class="save-btn" id="save-btn">SAVE SETTINGS</button>

  <script>
    const KEYS = {
      location: 'koji_weather_location',
      simulation: 'koji_weather_simulation',
      hourly7: 'koji_weather_hourly7',
    };
    // Load
    document.getElementById('location').value = localStorage.getItem(KEYS.location) || '';
    document.getElementById('use-simulation').checked = localStorage.getItem(KEYS.simulation) === 'true';
    document.getElementById('show-7-hourly').checked = localStorage.getItem(KEYS.hourly7) === 'true';
    // Save
    document.getElementById('save-btn').addEventListener('click', () => {
      localStorage.setItem(KEYS.location, document.getElementById('location').value.trim());
      localStorage.setItem(KEYS.simulation, document.getElementById('use-simulation').checked);
      localStorage.setItem(KEYS.hourly7, document.getElementById('show-7-hourly').checked);
      window.dispatchEvent(new StorageEvent('storage', { key: KEYS.location }));
      WidgetAPI?.widget?.closeSettings?.();
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Update module.json**

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
  "entry": "index.html",
  "settings": "settings.html"
}
```

- [ ] **Step 3: Delete build artifacts**

```bash
rm -rf themes/bridges/modules/weather/src
rm -f themes/bridges/modules/weather/package.json
rm -f themes/bridges/modules/weather/package-lock.json
rm -f themes/bridges/modules/weather/vite.config.ts
rm -f themes/bridges/modules/weather/tsconfig.json
rm -f themes/bridges/modules/weather/tsconfig.node.json
rm -rf themes/bridges/modules/weather/node_modules
```

- [ ] **Step 4: Verify clean structure**

```bash
ls themes/bridges/modules/weather/
```

Expected: `index.html  logic.js  module.json  settings.html`

- [ ] **Step 5: Commit**

```bash
cd /home/jack/Projects/flux
git add themes/bridges/modules/weather/
git commit -m "feat(weather): port to Flux widget structure — no build step, logic.js, settings.html"
```

---

### Task 4: Redesign system-stats — new index.html

**Files:**
- Rewrite: `themes/bridges/modules/system-stats/index.html`

Replace `hud-container` shell with `widget-container` + `background-layers` ambient float. Layout matches spec: hero CPU% → scan bars → history graph → metrics row.

- [ ] **Step 1: Read current index.html**

```bash
cat themes/bridges/modules/system-stats/index.html
```

Note the current element IDs used by logic.js (e.g., `#cpu-pct`, `#gpu-bar`, `#ram-bar`, canvas IDs). These IDs must be preserved exactly — only the surrounding HTML structure and CSS change.

- [ ] **Step 2: Read current logic.js to confirm element IDs**

```bash
grep -n "getElementById\|querySelector" themes/bridges/modules/system-stats/logic.js
```

List all IDs. These are fixed constraints.

- [ ] **Step 3: Write new index.html**

Structure:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KOJI PRO // SYS.STATS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Rajdhani:wght@500;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared-hud.css">
  <style>
    /* shared widget-container pattern */
    .widget-container { position: relative; width: 100%; height: 100%; padding: 0.8rem 1rem; display: flex; flex-direction: column; gap: 0.6rem; touch-action: none; font-family: var(--font-main); color: var(--color-hud-neutral); overflow: hidden; }
    .background-layers { position: absolute; inset: -40px; -webkit-mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%); mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%); pointer-events: none; z-index: 0; }
    .widget-background { position: absolute; inset: 0; background: radial-gradient(ellipse closest-side at center, rgba(10,15,26,0.55) 20%, transparent 90%); backdrop-filter: blur(25px); }
    .scanlines { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.08) 50%); background-size: 100% 4px; pointer-events: none; z-index: 1; }
    .resizer { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: se-resize; z-index: 50; }
    .content { position: relative; z-index: 10; display: flex; flex-direction: column; gap: 0.6rem; height: 100%; }

    /* header */
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--color-border-default); padding-bottom: 0.4rem; flex-shrink: 0; }
    header h1 { font-family: var(--font-header); font-size: 0.8rem; letter-spacing: 2px; color: var(--color-hud-neutral); opacity: 0.8; text-transform: uppercase; cursor: pointer; }
    header h1:hover { opacity: 1; text-shadow: 0 0 10px var(--color-hud-primary); }
    .settings-btn { font-size: 0.8rem; cursor: pointer; color: var(--color-hud-primary-soft); opacity: 0.6; background: none; border: none; padding: 0; }
    .settings-btn:hover { opacity: 1; }

    /* hero */
    .hero { text-align: center; padding: 0.4rem 0; flex-shrink: 0; }
    .hero-value { font-family: var(--font-header); font-weight: 900; font-size: 4rem; line-height: 1; color: var(--current-glow, var(--color-hud-primary)); text-shadow: 0 0 30px var(--current-glow, var(--color-hud-primary)); transition: color 0.5s, text-shadow 0.5s; }
    .hero-label { font-family: var(--font-main); font-size: 0.7rem; letter-spacing: 2px; color: var(--color-hud-primary-soft); opacity: 0.6; text-transform: uppercase; margin-top: 0.1rem; }

    /* scan bars */
    .scan-bars { display: flex; flex-direction: column; gap: 0.45rem; flex-shrink: 0; }
    .bar-row { display: flex; align-items: center; gap: 0.5rem; }
    .bar-key { font-family: var(--font-tech); font-size: 0.65rem; color: var(--color-hud-primary-soft); opacity: 0.7; width: 2.8rem; flex-shrink: 0; text-transform: uppercase; }
    .bar-track { flex: 1; height: 6px; background: rgba(0,191,255,0.1); border-radius: 2px; overflow: hidden; position: relative; }
    .bar-fill { height: 100%; width: var(--fill, 0%); border-radius: 2px; background: var(--bar-color, var(--color-hud-primary)); transition: width 0.4s ease, background 0.4s ease; box-shadow: 0 0 6px var(--bar-color, var(--color-hud-primary)); }
    .bar-meta { font-family: var(--font-tech); font-size: 0.65rem; color: var(--color-hud-neutral); width: 5.5rem; text-align: right; flex-shrink: 0; opacity: 0.85; }

    /* graph canvas */
    .graph-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .graph-label { font-family: var(--font-tech); font-size: 0.6rem; color: var(--color-hud-primary); opacity: 0.4; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 0.2rem; flex-shrink: 0; }
    .graph-canvas-wrap { flex: 1; min-height: 0; }
    .graph-canvas-wrap canvas { width: 100%; height: 100%; display: block; }

    /* metrics footer */
    .metrics-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; flex-shrink: 0; }
    .metric { background: rgba(0,191,255,0.04); border: 1px solid rgba(0,191,255,0.08); border-radius: 3px; padding: 0.3rem 0.5rem; }
    .metric-label { font-family: var(--font-tech); font-size: 0.55rem; color: var(--color-hud-primary-soft); opacity: 0.5; text-transform: uppercase; letter-spacing: 1px; }
    .metric-value { font-family: var(--font-tech); font-size: 0.8rem; color: var(--color-hud-neutral); margin-top: 0.1rem; }

    .flicker-on-mount { animation: flicker 0.3s steps(1) 3; }
    @keyframes flicker { 0%,100%{opacity:1} 50%{opacity:0} }
  </style>
</head>
<body>
  <div class="widget-container flicker-on-mount" id="main-container">
    <div class="background-layers"><div class="widget-background"></div></div>
    <div class="scanlines"></div>
    <div class="pattern-layer"></div>
    <div class="dot-matrix-pattern"></div>
    <div class="mouse-glow"></div>
    <div class="resizer resizer-rb" data-direction="SouthEast"></div>

    <div class="content">
      <header>
        <h1 id="open-settings" data-open-settings>KOJI // SYS.STATS</h1>
        <button class="settings-btn" data-open-settings>⚙</button>
      </header>

      <div class="hero">
        <div class="hero-value" id="hero-value">--%</div>
        <div class="hero-label">CPU LOAD</div>
      </div>

      <div class="scan-bars" id="scan-bars">
        <div class="bar-row">
          <span class="bar-key">CPU</span>
          <div class="bar-track"><div class="bar-fill" id="cpu-bar-fill"></div></div>
          <span class="bar-meta" id="cpu-bar-meta">--%</span>
        </div>
        <div class="bar-row">
          <span class="bar-key">GPU</span>
          <div class="bar-track"><div class="bar-fill" id="gpu-bar-fill"></div></div>
          <span class="bar-meta" id="gpu-bar-meta">--%</span>
        </div>
        <div class="bar-row">
          <span class="bar-key">RAM</span>
          <div class="bar-track"><div class="bar-fill" id="ram-bar-fill"></div></div>
          <span class="bar-meta" id="ram-bar-meta">--G</span>
        </div>
        <div class="bar-row">
          <span class="bar-key">DISK</span>
          <div class="bar-track"><div class="bar-fill" id="disk-bar-fill"></div></div>
          <span class="bar-meta" id="disk-bar-meta">--%</span>
        </div>
      </div>

      <div class="graph-section">
        <div class="graph-label">CPU HISTORY</div>
        <div class="graph-canvas-wrap">
          <canvas id="cpu-graph"></canvas>
        </div>
      </div>

      <div class="metrics-row">
        <div class="metric"><div class="metric-label">NET ↑</div><div class="metric-value" id="net-up">--</div></div>
        <div class="metric"><div class="metric-label">NET ↓</div><div class="metric-value" id="net-down">--</div></div>
        <div class="metric"><div class="metric-label">CPU TEMP</div><div class="metric-value" id="cpu-temp">--°C</div></div>
        <div class="metric"><div class="metric-label">SWAP</div><div class="metric-value" id="swap-used">--G</div></div>
      </div>
    </div>
  </div>
  <script src="logic.js"></script>
</body>
</html>
```

**Note:** The element IDs above (`cpu-bar-fill`, `gpu-bar-fill`, etc.) are NEW — check them against the existing logic.js IDs from Step 2 and align. If logic.js uses `#cpu-pct` you keep `#cpu-pct`; just update the surrounding HTML structure.

- [ ] **Step 4: Verify HTML renders**

```bash
cd /home/jack/Projects/flux/themes/bridges && python3 -m http.server 8889 &
# Open http://localhost:8889/modules/system-stats/index.html
```

Expected: ambient widget shell renders, bars/graphs populate from WidgetAPI.

---

### Task 5: Redesign system-stats — update logic.js

**Files:**
- Modify: `themes/bridges/modules/system-stats/logic.js`

The existing FluxGraph class and all WidgetAPI.system.subscribe calls stay. We add the new scan bar updater function and update element ID references to match new HTML.

- [ ] **Step 1: Read current logic.js**

```bash
cat themes/bridges/modules/system-stats/logic.js
```

- [ ] **Step 2: Add glow color helper**

Add near the top, after the formatters:

```js
function getGlowColor(val, warnAt, dangerAt) {
  if (val >= dangerAt) return 'var(--color-hud-danger)';
  if (val >= warnAt) return 'var(--color-hud-caution)';
  return 'var(--color-hud-primary)';
}
```

- [ ] **Step 3: Add scan bar updater**

Add this function (called from the main update loop):

```js
function updateBar(fillId, metaId, value, max, metaText, warnAt, dangerAt) {
  const fill = document.getElementById(fillId);
  const meta = document.getElementById(metaId);
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const color = getGlowColor(pct, warnAt, dangerAt);
  if (fill) {
    fill.style.setProperty('--fill', pct + '%');
    fill.style.setProperty('--bar-color', color);
  }
  if (meta) meta.textContent = metaText;
}
```

- [ ] **Step 4: Update hero element ID**

Find where the main CPU percentage is written. Update it to target `hero-value`:

```js
document.getElementById('hero-value').textContent = `${cpuPct}%`;
// Also update the glow color on the container:
document.getElementById('main-container').style.setProperty('--current-glow', getGlowColor(cpuPct, 60, 85));
```

- [ ] **Step 5: Wire scan bars in the update callback**

In the WidgetAPI.system.subscribe callback where CPU/GPU/RAM are read, call:

```js
updateBar('cpu-bar-fill', 'cpu-bar-meta', cpuPct, 100, `${cpuPct}%  ${toGHz(cpuFreq)}GHz`, 60, 85);
updateBar('gpu-bar-fill', 'gpu-bar-meta', gpuPct, 100, `${gpuPct}%  ${gpuTemp}°C`, 60, 85);
updateBar('ram-bar-fill', 'ram-bar-meta', ramUsed, ramTotal, `${toGiB(ramUsed)}G`, 60, 85);
updateBar('disk-bar-fill', 'disk-bar-meta', diskPct, 100, `${diskPct}%`, 70, 90);
```

Adjust variable names to match what WidgetAPI actually delivers.

- [ ] **Step 6: Add shared mouse-glow + drag boilerplate**

At the bottom of logic.js (replacing the current drag setup if different):

```js
const container = document.getElementById('main-container');
window.addEventListener('mousemove', (e) => {
  const r = container.getBoundingClientRect();
  container.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
  container.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
  const inBounds = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  container.style.setProperty('--pattern-opacity', inBounds ? '1' : '0');
});
container.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-no-drag]')) return;
  WidgetAPI.widget.drag(e);
});
document.querySelectorAll('[data-open-settings]').forEach(el =>
  el.addEventListener('click', () => WidgetAPI.widget.openSettings())
);
```

- [ ] **Step 7: Commit**

```bash
git add themes/bridges/modules/system-stats/
git commit -m "feat(system-stats): redesign to ambient widget-container aesthetic, add scan bars"
```

---

### Task 6: Redesign time-date

**Files:**
- Rewrite: `themes/bridges/modules/time-date/index.html`
- Modify: `themes/bridges/modules/time-date/logic.js`
- Update: `themes/bridges/modules/time-date/module.json`

- [ ] **Step 1: Write new index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KOJI PRO // CHRONOS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Rajdhani:wght@500;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared-hud.css">
  <style>
    .widget-container { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; touch-action: none; font-family: var(--font-main); color: var(--color-hud-neutral); overflow: hidden; }
    .background-layers { position: absolute; inset: -40px; -webkit-mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%); mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%); pointer-events: none; z-index: 0; }
    .widget-background { position: absolute; inset: 0; background: radial-gradient(ellipse closest-side at center, rgba(10,15,26,0.55) 20%, transparent 90%); backdrop-filter: blur(25px); }
    .scanlines { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.08) 50%); background-size: 100% 4px; pointer-events: none; z-index: 1; }
    .resizer { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: se-resize; z-index: 50; }

    header { position: absolute; top: 0.8rem; left: 1rem; right: 1rem; display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--color-border-default); padding-bottom: 0.3rem; z-index: 15; pointer-events: auto; }
    header h1 { font-family: var(--font-header); font-size: 0.75rem; letter-spacing: 2px; color: var(--color-hud-neutral); opacity: 0.7; text-transform: uppercase; cursor: pointer; }
    header h1:hover { opacity: 1; text-shadow: 0 0 10px var(--color-hud-primary); }

    .time-core { position: relative; z-index: 15; display: flex; flex-direction: column; align-items: center; gap: 0.3rem; pointer-events: none; }
    #clock { font-family: var(--font-header); font-weight: 900; font-size: 5.5rem; line-height: 1; letter-spacing: -3px; color: var(--color-hud-primary); text-shadow: 0 0 30px var(--color-hud-primary), 0 0 60px rgba(0,191,255,0.3); }
    #date { font-family: var(--font-tech); font-size: 1rem; color: var(--color-hud-alert); letter-spacing: 4px; text-transform: uppercase; opacity: 0.9; }

    .footer-row { position: absolute; bottom: 0.8rem; left: 1rem; right: 1rem; display: flex; justify-content: space-between; align-items: center; z-index: 15; }
    .footer-item { font-family: var(--font-tech); font-size: 0.68rem; color: var(--color-hud-primary-soft); opacity: 0.55; letter-spacing: 1px; }
    #sun-times { opacity: 0; transition: opacity 0.5s; }
    #sun-times.loaded { opacity: 0.55; }

    .bridges-bg { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-family: var(--font-header); font-weight: 900; font-size: 9rem; color: var(--color-hud-primary); opacity: 0.025; pointer-events: none; z-index: 5; letter-spacing: -12px; }

    .flicker-on-mount { animation: flicker 0.3s steps(1) 3; }
    @keyframes flicker { 0%,100%{opacity:1} 50%{opacity:0} }
  </style>
</head>
<body>
  <div class="widget-container flicker-on-mount" id="main-container">
    <div class="background-layers"><div class="widget-background"></div></div>
    <div class="scanlines"></div>
    <div class="pattern-layer"></div>
    <div class="dot-matrix-pattern"></div>
    <div class="mouse-glow"></div>
    <div class="resizer resizer-rb" data-direction="SouthEast"></div>

    <div class="bridges-bg">BRG</div>

    <header>
      <h1 id="open-settings">KOJI // CHRONOS</h1>
    </header>

    <div class="time-core">
      <div id="clock">00:00:00</div>
      <div id="date">YYYY.MM.DD // ---</div>
    </div>

    <div class="footer-row">
      <span class="footer-item">MT: <span id="uptime">00:00:00</span></span>
      <span class="footer-item" id="sun-times">☀ --:-- / --:--</span>
    </div>
  </div>
  <script src="logic.js"></script>
</body>
</html>
```

- [ ] **Step 2: Update logic.js — add sunrise/sunset fetch**

Keep the existing clock/date/uptime logic. Add sunrise/sunset fetch after the existing code:

```js
// --- Sunrise / Sunset (from Open-Meteo, using same location as weather widget) ---
async function fetchSunTimes() {
  const loc = localStorage.getItem('koji_weather_location');
  if (!loc) return;

  let lat, lon;
  if (loc.includes(',')) {
    [lat, lon] = loc.split(',').map(s => parseFloat(s.trim()));
  } else {
    try {
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1`);
      const gd = await geo.json();
      if (!gd.results?.length) return;
      lat = gd.results[0].latitude;
      lon = gd.results[0].longitude;
    } catch { return; }
  }

  try {
    const today = new Date().toISOString().slice(0,10);
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=auto&start_date=${today}&end_date=${today}`);
    const d = await r.json();
    if (!d.daily?.sunrise?.[0]) return;
    const rise = d.daily.sunrise[0].slice(11,16);  // HH:MM
    const set  = d.daily.sunset[0].slice(11,16);
    const el = document.getElementById('sun-times');
    el.textContent = `☀ ${rise} / ${set}`;
    el.classList.add('loaded');
  } catch { /* silent fail */ }
}

fetchSunTimes();
// Re-fetch at midnight
const msToMidnight = () => { const n = new Date(); return (86400 - n.getHours()*3600 - n.getMinutes()*60 - n.getSeconds()) * 1000; };
setTimeout(() => { fetchSunTimes(); setInterval(fetchSunTimes, 86400000); }, msToMidnight());
```

- [ ] **Step 3: Add shared mouse-glow + drag boilerplate to logic.js**

Same as system-stats Task 5 Step 6 — replace any existing drag setup with the shared version.

- [ ] **Step 4: Update module.json**

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

- [ ] **Step 5: Commit**

```bash
git add themes/bridges/modules/time-date/
git commit -m "feat(time-date): redesign to ambient aesthetic, add sunrise/sunset, update branding"
```

---

### Task 7: Build AI Usage Monitor — index.html + settings.html

**Files:**
- Create: `themes/bridges/modules/ai-usage/index.html`
- Create: `themes/bridges/modules/ai-usage/module.json`
- Create: `themes/bridges/modules/ai-usage/settings.html`

- [ ] **Step 1: Create module directory**

```bash
mkdir -p themes/bridges/modules/ai-usage
```

- [ ] **Step 2: Create module.json**

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
  "entry": "index.html",
  "settings": "settings.html"
}
```

- [ ] **Step 3: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KOJI PRO // AI.OPS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Rajdhani:wght@500;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared-hud.css">
  <style>
    .widget-container { position: relative; width: 100%; height: 100%; padding: 0.8rem 1rem; display: flex; flex-direction: column; gap: 0.6rem; touch-action: none; font-family: var(--font-main); color: var(--color-hud-neutral); overflow: hidden; }
    .background-layers { position: absolute; inset: -40px; -webkit-mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%); mask-image: radial-gradient(ellipse closest-side at center, black 20%, transparent 90%); pointer-events: none; z-index: 0; }
    .widget-background { position: absolute; inset: 0; background: radial-gradient(ellipse closest-side at center, rgba(10,15,26,0.55) 20%, transparent 90%); backdrop-filter: blur(25px); }
    .scanlines { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.08) 50%); background-size: 100% 4px; pointer-events: none; z-index: 1; }
    .resizer { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: se-resize; z-index: 50; }
    .content { position: relative; z-index: 10; display: flex; flex-direction: column; gap: 0.6rem; height: 100%; }

    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--color-border-default); padding-bottom: 0.4rem; flex-shrink: 0; }
    header h1 { font-family: var(--font-header); font-size: 0.8rem; letter-spacing: 2px; color: var(--color-hud-neutral); opacity: 0.8; text-transform: uppercase; cursor: pointer; }
    header h1:hover { opacity: 1; text-shadow: 0 0 10px var(--color-hud-primary); }
    .settings-btn { font-size: 0.8rem; cursor: pointer; color: var(--color-hud-primary-soft); opacity: 0.6; background: none; border: none; padding: 0; }
    .settings-btn:hover { opacity: 1; }

    /* Service block */
    .service { flex-shrink: 0; padding: 0.5rem 0; }
    .service + .service { border-top: 1px solid rgba(0,191,255,0.12); }
    .service-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
    .service-name { font-family: var(--font-header); font-size: 0.75rem; letter-spacing: 2px; color: var(--color-hud-neutral); text-transform: uppercase; }
    .tier-badge { font-family: var(--font-tech); font-size: 0.6rem; padding: 0.1rem 0.35rem; border: 1px solid; border-radius: 2px; text-transform: uppercase; letter-spacing: 1px; }
    .tier-badge.free { color: var(--color-hud-caution); border-color: var(--color-hud-caution); }
    .tier-badge.pro { color: var(--color-hud-primary); border-color: var(--color-hud-primary); }
    .tier-badge.api { color: var(--color-hud-safe); border-color: var(--color-hud-safe); }

    /* Usage bars */
    .usage-bar-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem; }
    .usage-bar-key { font-family: var(--font-tech); font-size: 0.58rem; color: var(--color-hud-primary-soft); opacity: 0.6; width: 2.2rem; flex-shrink: 0; text-transform: uppercase; }
    .bar-track { flex: 1; height: 5px; background: rgba(0,191,255,0.08); border-radius: 2px; overflow: hidden; }
    .bar-fill { height: 100%; width: var(--fill, 0%); border-radius: 2px; background: var(--bar-color, var(--color-hud-primary)); transition: width 0.6s ease, background 0.6s ease; box-shadow: 0 0 4px var(--bar-color, var(--color-hud-primary)); }
    .usage-bar-val { font-family: var(--font-tech); font-size: 0.65rem; color: var(--color-hud-neutral); width: 6rem; text-align: right; flex-shrink: 0; opacity: 0.8; }

    /* Rate + spark row */
    .rate-row { display: flex; justify-content: space-between; align-items: center; margin-top: 0.1rem; }
    .rate-val { font-family: var(--font-tech); font-size: 0.65rem; color: var(--color-hud-primary-soft); opacity: 0.55; }
    .spark { display: flex; align-items: flex-end; gap: 2px; height: 16px; }
    .spark-bar { width: 6px; background: var(--color-hud-primary); opacity: 0.5; border-radius: 1px; min-height: 2px; transition: height 0.4s ease; }
    .spark-bar.today { opacity: 1; box-shadow: 0 0 4px var(--color-hud-primary); }

    /* Footer summary */
    .summary { margin-top: auto; padding-top: 0.5rem; border-top: 1px solid rgba(0,191,255,0.12); flex-shrink: 0; }
    .summary-text { font-family: var(--font-tech); font-size: 0.7rem; color: var(--color-hud-primary-soft); opacity: 0.65; }
    .summary-text span { color: var(--color-hud-neutral); opacity: 1; }

    .flicker-on-mount { animation: flicker 0.3s steps(1) 3; }
    @keyframes flicker { 0%,100%{opacity:1} 50%{opacity:0} }
  </style>
</head>
<body>
  <div class="widget-container flicker-on-mount" id="main-container">
    <div class="background-layers"><div class="widget-background"></div></div>
    <div class="scanlines"></div>
    <div class="pattern-layer"></div>
    <div class="dot-matrix-pattern"></div>
    <div class="mouse-glow"></div>
    <div class="resizer resizer-rb" data-direction="SouthEast"></div>

    <div class="content">
      <header>
        <h1 data-open-settings>KOJI // AI.OPS</h1>
        <button class="settings-btn" data-open-settings>⚙</button>
      </header>

      <!-- Claude service block -->
      <div class="service" id="claude-block">
        <div class="service-header">
          <span class="service-name">CLAUDE</span>
          <span class="tier-badge pro" id="claude-tier">PRO</span>
        </div>
        <div class="usage-bar-row">
          <span class="usage-bar-key">IN</span>
          <div class="bar-track"><div class="bar-fill" id="claude-in-fill"></div></div>
          <span class="usage-bar-val" id="claude-in-val">-- tokens</span>
        </div>
        <div class="usage-bar-row">
          <span class="usage-bar-key">OUT</span>
          <div class="bar-track"><div class="bar-fill" id="claude-out-fill"></div></div>
          <span class="usage-bar-val" id="claude-out-val">-- tokens</span>
        </div>
        <div class="rate-row">
          <span class="rate-val" id="claude-rate">-- req/hr</span>
          <div class="spark" id="claude-spark"></div>
        </div>
      </div>

      <!-- Gemini service block -->
      <div class="service" id="gemini-block">
        <div class="service-header">
          <span class="service-name">GEMINI</span>
          <span class="tier-badge free" id="gemini-tier">FREE</span>
        </div>
        <div class="usage-bar-row">
          <span class="usage-bar-key">RPM</span>
          <div class="bar-track"><div class="bar-fill" id="gemini-rpm-fill"></div></div>
          <span class="usage-bar-val" id="gemini-rpm-val">-- / 15</span>
        </div>
        <div class="usage-bar-row">
          <span class="usage-bar-key">DAY</span>
          <div class="bar-track"><div class="bar-fill" id="gemini-day-fill"></div></div>
          <span class="usage-bar-val" id="gemini-day-val">-- / 1500</span>
        </div>
        <div class="rate-row">
          <span class="rate-val" id="gemini-rate">-- req/hr</span>
          <div class="spark" id="gemini-spark"></div>
        </div>
      </div>

      <div class="summary">
        <div class="summary-text">TODAY  <span id="total-tokens">--</span> tokens total</div>
      </div>
    </div>
  </div>
  <script src="logic.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create settings.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AI.OPS Settings</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;700&family=Share+Tech+Mono&family=Orbitron:wght@700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared-hud.css">
  <style>
    body { padding: 1.2rem; font-family: var(--font-main); color: var(--color-hud-neutral); }
    h2 { font-family: var(--font-header); font-size: 0.85rem; letter-spacing: 2px; color: var(--color-hud-primary); margin-bottom: 1rem; text-transform: uppercase; }
    h3 { font-family: var(--font-tech); font-size: 0.7rem; color: var(--color-hud-primary-soft); letter-spacing: 1px; text-transform: uppercase; margin: 0.8rem 0 0.4rem; opacity: 0.8; }
    .field { margin-bottom: 0.7rem; }
    label { display: block; font-family: var(--font-tech); font-size: 0.65rem; color: var(--color-hud-primary-soft); margin-bottom: 0.2rem; letter-spacing: 1px; text-transform: uppercase; }
    select, input[type="number"] {
      width: 100%; background: rgba(0,191,255,0.05); border: 1px solid var(--color-border-default);
      color: var(--color-hud-neutral); font-family: var(--font-tech); font-size: 0.8rem;
      padding: 0.3rem 0.5rem; border-radius: 2px; outline: none;
    }
    select:focus, input:focus { border-color: var(--color-border-active); }
    select option { background: #0a0f1a; }
    .toggle-row { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem; }
    .toggle-label { font-family: var(--font-tech); font-size: 0.7rem; color: var(--color-hud-primary-soft); }
    input[type="checkbox"] { accent-color: var(--color-hud-primary); }
    .divider { border: none; border-top: 1px solid var(--color-border-default); opacity: 0.3; margin: 0.8rem 0; }
    .save-btn {
      font-family: var(--font-header); font-size: 0.7rem; letter-spacing: 2px;
      background: rgba(0,191,255,0.1); border: 1px solid var(--color-border-default);
      color: var(--color-hud-primary); padding: 0.5rem 1.2rem; cursor: pointer;
      text-transform: uppercase; border-radius: 2px; width: 100%; margin-top: 0.5rem;
    }
    .save-btn:hover { background: rgba(0,191,255,0.2); border-color: var(--color-border-active); }
    .reset-btn {
      font-family: var(--font-tech); font-size: 0.65rem;
      background: none; border: 1px solid rgba(255,32,32,0.3);
      color: var(--color-hud-danger); padding: 0.3rem 0.8rem; cursor: pointer;
      border-radius: 2px; width: 100%; margin-top: 0.3rem;
    }
    .reset-btn:hover { background: rgba(255,32,32,0.1); }
  </style>
</head>
<body>
  <h2>KOJI // AI.OPS</h2>

  <h3>Claude</h3>
  <div class="field">
    <label>Tier</label>
    <select id="claude-tier">
      <option value="free">Free</option>
      <option value="pro" selected>Pro</option>
      <option value="api">API (custom)</option>
    </select>
  </div>
  <div class="field">
    <label>Daily token limit (0 = unlimited)</label>
    <input type="number" id="claude-limit" value="0" min="0">
  </div>
  <div class="toggle-row">
    <input type="checkbox" id="claude-enabled" checked>
    <span class="toggle-label">Show Claude block</span>
  </div>

  <hr class="divider">

  <h3>Gemini</h3>
  <div class="field">
    <label>Tier</label>
    <select id="gemini-tier">
      <option value="free" selected>Free (15 RPM / 1500 req/day)</option>
      <option value="flash">Flash 1.5 (1000 RPM)</option>
      <option value="pro">Pro (360 RPM)</option>
    </select>
  </div>
  <div class="toggle-row">
    <input type="checkbox" id="gemini-enabled" checked>
    <span class="toggle-label">Show Gemini block</span>
  </div>

  <hr class="divider">

  <button class="save-btn" id="save-btn">SAVE SETTINGS</button>
  <button class="reset-btn" id="reset-btn">RESET DAILY COUNTERS</button>

  <script>
    const cfg = JSON.parse(localStorage.getItem('koji_aiops_cfg') || '{}');
    document.getElementById('claude-tier').value = cfg.claudeTier || 'pro';
    document.getElementById('claude-limit').value = cfg.claudeLimit ?? 0;
    document.getElementById('claude-enabled').checked = cfg.claudeEnabled !== false;
    document.getElementById('gemini-tier').value = cfg.geminiTier || 'free';
    document.getElementById('gemini-enabled').checked = cfg.geminiEnabled !== false;

    document.getElementById('save-btn').addEventListener('click', () => {
      const data = {
        claudeTier: document.getElementById('claude-tier').value,
        claudeLimit: parseInt(document.getElementById('claude-limit').value) || 0,
        claudeEnabled: document.getElementById('claude-enabled').checked,
        geminiTier: document.getElementById('gemini-tier').value,
        geminiEnabled: document.getElementById('gemini-enabled').checked,
      };
      localStorage.setItem('koji_aiops_cfg', JSON.stringify(data));
      window.dispatchEvent(new StorageEvent('storage', { key: 'koji_aiops_cfg' }));
      WidgetAPI?.widget?.closeSettings?.();
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
      localStorage.removeItem('koji_gemini_requests_today');
      localStorage.removeItem('koji_gemini_req_history');
      window.dispatchEvent(new StorageEvent('storage', { key: 'koji_aiops_cfg' }));
    });
  </script>
</body>
</html>
```

---

### Task 8: Build AI Usage Monitor — logic.js

**Files:**
- Create: `themes/bridges/modules/ai-usage/logic.js`

This is the most complex task. The Claude parser reads local JSONL files via `fetch()` (works for local file:// or engine-served paths). Gemini tracking uses localStorage.

- [ ] **Step 1: Create logic.js**

```js
// Koji Pro // AI.OPS Logic
// Reads ~/.claude/projects/ JSONL files for real token counts.
// Gemini tracked via localStorage counter.

// --- Config ---
const CLAUDE_PROJECTS_PATH = '/claude-projects';  // Engine must serve this path, or use Tauri invoke
const REFRESH_INTERVAL = 60000; // 60s
const GEMINI_LIMITS = {
  free:  { rpm: 15, rpd: 1500 },
  flash: { rpm: 1000, rpd: 0 },
  pro:   { rpm: 360, rpd: 0 },
};

let cfg = JSON.parse(localStorage.getItem('koji_aiops_cfg') || '{}');
window.addEventListener('storage', () => {
  cfg = JSON.parse(localStorage.getItem('koji_aiops_cfg') || '{}');
  refresh();
});

// --- Helpers ---
function fmtTokens(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n/1000).toFixed(1) + 'k';
  return String(n);
}

function barColor(pct) {
  if (pct >= 80) return 'var(--color-hud-danger)';
  if (pct >= 50) return 'var(--color-hud-caution)';
  return 'var(--color-hud-primary)';
}

function setBar(fillId, valId, value, limit, label) {
  const fill = document.getElementById(fillId);
  const val  = document.getElementById(valId);
  const pct  = limit > 0 ? Math.min(100, (value / limit) * 100) : 10; // no limit = small fill
  const color = barColor(pct);
  if (fill) { fill.style.setProperty('--fill', pct + '%'); fill.style.setProperty('--bar-color', color); }
  if (val)  val.textContent = label;
}

function renderSpark(containerId, weekData) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const max = Math.max(...weekData, 1);
  const today = new Date().getDay(); // 0=Sun
  el.innerHTML = weekData.map((v, i) => {
    const h = Math.max(2, Math.round((v / max) * 16));
    const isToday = (i === (today === 0 ? 6 : today - 1)); // Mon-Sun index
    return `<div class="spark-bar${isToday ? ' today' : ''}" style="height:${h}px"></div>`;
  }).join('');
}

// --- Claude JSONL Parser ---
async function parseClaudeUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  let todayIn = 0, todayOut = 0, todayMsgs = 0;
  const dailyCounts = new Array(7).fill(0); // Mon-Sun

  try {
    // Fetch directory listing of ~/.claude/projects/ via Tauri invoke
    // Falls back to a known path list if invoke not available
    let projectDirs = [];
    try {
      projectDirs = await WidgetAPI?.invoke?.('list_claude_projects') || [];
    } catch {
      // Fallback: try to fetch a manifest file the engine might provide
      // This is a best-effort approach for the initial implementation
    }

    // If Tauri invoke not available, use fetch on known session files
    // The engine should expose ~/.claude/ under a local server path
    // For now, attempt via a relative path that the engine may serve
    const resp = await fetch('/__claude_projects_index__').catch(() => null);
    if (resp?.ok) {
      const index = await resp.json();
      projectDirs = index.files || [];
    }

    for (const filePath of projectDirs) {
      const fileResp = await fetch(filePath).catch(() => null);
      if (!fileResp?.ok) continue;
      const text = await fileResp.text();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const ts = entry.timestamp || '';
          if (!ts || ts.slice(0,10) < weekAgo) continue;
          const usage = entry?.message?.usage;
          if (!usage) continue;
          const date = ts.slice(0,10);
          const dayIdx = (new Date(date).getDay() + 6) % 7; // 0=Mon
          if (date === today) {
            todayIn  += usage.input_tokens  || 0;
            todayOut += usage.output_tokens || 0;
            todayMsgs++;
          }
          dailyCounts[dayIdx] += (usage.input_tokens || 0) + (usage.output_tokens || 0);
        } catch { /* skip malformed lines */ }
      }
    }
  } catch { /* silent fail — display zeros */ }

  return { todayIn, todayOut, todayMsgs, dailyCounts };
}

// --- Gemini Counter ---
function getGeminiUsage() {
  const todayKey = `koji_gemini_today_${new Date().toISOString().slice(0,10)}`;
  const todayCount = parseInt(localStorage.getItem(todayKey) || '0');
  let history = [];
  try { history = JSON.parse(localStorage.getItem('koji_gemini_req_history') || '[]'); } catch {}
  if (history.length < 7) history = new Array(7).fill(0);
  return { todayCount, history: history.slice(-7) };
}

// --- Render ---
async function refresh() {
  const tierClaude  = cfg.claudeTier  || 'pro';
  const tierGemini  = cfg.geminiTier  || 'free';
  const claudeLimit = cfg.claudeLimit || 0;

  // Claude block visibility
  const claudeBlock = document.getElementById('claude-block');
  if (claudeBlock) claudeBlock.style.display = cfg.claudeEnabled === false ? 'none' : '';

  // Gemini block visibility
  const geminiBlock = document.getElementById('gemini-block');
  if (geminiBlock) geminiBlock.style.display = cfg.geminiEnabled === false ? 'none' : '';

  // Claude tier badge
  const claudeTierEl = document.getElementById('claude-tier');
  if (claudeTierEl) {
    claudeTierEl.textContent = tierClaude.toUpperCase();
    claudeTierEl.className = `tier-badge ${tierClaude}`;
  }

  // Gemini tier badge
  const geminiTierEl = document.getElementById('gemini-tier');
  if (geminiTierEl) {
    geminiTierEl.textContent = tierGemini.toUpperCase();
    geminiTierEl.className = `tier-badge ${tierGemini === 'free' ? 'free' : 'pro'}`;
  }

  // Claude data
  const { todayIn, todayOut, todayMsgs, dailyCounts } = await parseClaudeUsage();
  const inPct  = claudeLimit > 0 ? (todayIn  / claudeLimit) * 100 : Math.min(100, todayIn  / 50000 * 100);
  const outPct = claudeLimit > 0 ? (todayOut / claudeLimit) * 100 : Math.min(100, todayOut / 200000 * 100);
  setBar('claude-in-fill',  'claude-in-val',  todayIn,  claudeLimit || 50000,  `${fmtTokens(todayIn)} in`);
  setBar('claude-out-fill', 'claude-out-val', todayOut, claudeLimit || 200000, `${fmtTokens(todayOut)} out`);

  const hourlyRate = Math.round(todayMsgs / Math.max(1, new Date().getHours() + 1));
  const rateEl = document.getElementById('claude-rate');
  if (rateEl) rateEl.textContent = `${hourlyRate} req/hr`;
  renderSpark('claude-spark', dailyCounts);

  // Gemini data
  const { todayCount, history: geminiHistory } = getGeminiUsage();
  const gLimits = GEMINI_LIMITS[tierGemini] || GEMINI_LIMITS.free;
  setBar('gemini-rpm-fill', 'gemini-rpm-val', 0, gLimits.rpm, `-- / ${gLimits.rpm}`);
  setBar('gemini-day-fill', 'gemini-day-val', todayCount, gLimits.rpd || 99999, `${todayCount} / ${gLimits.rpd || '∞'}`);
  const geminiRateEl = document.getElementById('gemini-rate');
  if (geminiRateEl) geminiRateEl.textContent = `${Math.round(todayCount / Math.max(1, new Date().getHours() + 1))} req/hr`;
  renderSpark('gemini-spark', geminiHistory);

  // Summary
  const totalEl = document.getElementById('total-tokens');
  if (totalEl) totalEl.textContent = fmtTokens(todayIn + todayOut);
}

// --- Mouse glow + drag ---
const container = document.getElementById('main-container');
window.addEventListener('mousemove', (e) => {
  const r = container.getBoundingClientRect();
  container.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
  container.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
  const inBounds = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  container.style.setProperty('--pattern-opacity', inBounds ? '1' : '0');
});
container.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-no-drag]')) return;
  WidgetAPI.widget.drag(e);
});
document.querySelectorAll('[data-open-settings]').forEach(el =>
  el.addEventListener('click', () => WidgetAPI.widget.openSettings())
);

// --- Init ---
refresh();
const _refreshInterval = setInterval(refresh, REFRESH_INTERVAL);
window._fluxCleanup = () => clearInterval(_refreshInterval);
```

- [ ] **Step 2: Commit**

```bash
git add themes/bridges/modules/ai-usage/
git commit -m "feat(ai-usage): add Koji Pro AI Usage Monitor module — Claude JSONL parser, Gemini tracker"
```

---

### Task 9: Cleanup

**Files:**
- Delete: `themes/bridges/modules/weather-old/`
- Modify: `docs/DESIGN_SYSTEM.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Delete weather-old**

```bash
rm -rf themes/bridges/modules/weather-old
```

- [ ] **Step 2: Remove Gemini attribution from DESIGN_SYSTEM.md**

```bash
grep -n "Gemini CLI\|UI/UX Pro Max" themes/bridges/docs/DESIGN_SYSTEM.md
```

Find the line(s) and remove them. Expected line: `*Created by Gemini CLI via UI/UX Pro Max Skill.*`

- [ ] **Step 3: Create CLAUDE.md at flux project root**

```markdown
# Flux — Project Context for Claude

## Three-Layer Architecture

This project has three distinct layers. Do NOT conflate them:

| Layer | What it is | Location |
|-------|-----------|----------|
| **Flux engine** | Rust/Tauri 2.x desktop widget runner | `app/` |
| **Chiral UI** | Death Stranding-inspired design language | `themes/bridges/shared-hud.css` + `docs/DESIGN_SYSTEM.md` |
| **Koji Pro Suite** | First official theme pack (= `bridges` theme) | `themes/bridges/` |

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
- `WidgetAPI.system.subscribe(metric, callback)` — subscribe to system metrics
- `WidgetAPI.system.uptime()` — returns Promise<seconds>

## Modules

| ID | Name | Status |
|----|------|--------|
| `weather` | Koji Pro // Weather | Active |
| `system-stats` | Koji Pro // Stats | Active |
| `time-date` | Koji Pro // Chronos | Active |
| `ai-usage` | Koji Pro // AI.OPS | Active |
```

- [ ] **Step 4: Final commit**

```bash
cd /home/jack/Projects/flux
git add CLAUDE.md docs/ themes/bridges/modules/
git commit -m "chore: add CLAUDE.md architecture guide, remove weather-old, clean DESIGN_SYSTEM.md"
```

---

## Post-Implementation Checklist

- [ ] Weather widget loads in browser, temp glow correct, scan bars work, no console errors
- [ ] System-stats ambient container renders, all bars update from WidgetAPI, hero CPU% glows
- [ ] Time-date clock displays, sunrise/sunset appears when `koji_weather_location` is set
- [ ] AI.OPS reads Claude token counts from JSONL files, Gemini counter visible
- [ ] All four modules share visual language: background-layers, ambient float, same font stack
- [ ] `weather-old/` directory deleted
- [ ] `CLAUDE.md` present at project root
- [ ] All module.json files have `"author": "Bridges"` and correct names
- [ ] No build artifacts remain in weather module directory

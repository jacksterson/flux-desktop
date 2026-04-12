# Weather Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add glitch icon effects, dot-pixel scan bars, and a full settings panel to the weather widget; extend the engine to serve `app/assets/`; fix system-stats graph rendering.

**Architecture:** Engine extended to serve `app/assets/` via `flux-module://`. Weather widget adopts the icon pack with a two-layer CSS glitch system driven by a `GlitchManager` class. Settings persist under a single `koji_weather_cfg` localStorage key. System-stats fix moves `setTransform` into the draw loop so it survives canvas resets.

**Tech Stack:** Rust/Tauri 2.x (engine), Vanilla JS + HTML/CSS (widgets), Open-Meteo API (weather data).

---

## File Map

| File | Task(s) | What changes |
|------|---------|--------------|
| `app/src-tauri/src/lib.rs` | 1 | Add `app/assets/` dev + release paths to `flux-module://` handler |
| `app/src-tauri/tauri.conf.json` | 1 | Add `"../assets": "assets"` to bundle resources |
| `themes/bridges/modules/system-stats/logic.js` | 2 | Re-apply `setTransform` inside `_draw`/`_drawChan`; guard canvas reset |
| `themes/bridges/modules/weather/index.html` | 3 | Hero icon markup, glitch CSS, dot-pixel scan bar CSS, remove inline SVG symbols |
| `themes/bridges/modules/weather/logic.js` | 4, 5, 6 | `ICON_MAP`, `GLITCH_NEIGHBORS`, `GlitchManager`, `DEFAULT_CFG`, full rendering updates |
| `themes/bridges/modules/weather/settings.html` | 7 | Full redesign — 6 sections, segmented controls, `koji_weather_cfg` |

---

## Task 1: Engine — serve `app/assets/` via `flux-module://`

**Files:**
- Modify: `app/src-tauri/src/lib.rs` (~line 384)
- Modify: `app/src-tauri/tauri.conf.json`

- [ ] **Step 1: Add `dev_assets` variable alongside the existing dev path declarations in `lib.rs`**

The block starting at line ~384 currently reads:
```rust
let project_root = PathBuf::from(".."); // Assuming we run from app/src-tauri
let dev_runtime = project_root.join("runtime");
let dev_themes = project_root.join("..").join("themes");
```

Change it to:
```rust
let project_root = PathBuf::from(".."); // Assuming we run from app/src-tauri
let dev_runtime = project_root.join("runtime");
let dev_themes = project_root.join("..").join("themes");
let dev_assets = project_root.join("assets");
```

- [ ] **Step 2: Add asset path lookups after the `user_m_base` check in `lib.rs`**

The block starting at ~line 396 currently reads:
```rust
let user_m_base = paths::flux_modules_dir();
if let Ok(c) = fs::read(user_m_base.join(path_part)) { return finalize_response(ctx.app_handle().clone(), path_part, c); }

// Search theme packs (module AND theme root)
```

Change it to:
```rust
let user_m_base = paths::flux_modules_dir();
if let Ok(c) = fs::read(user_m_base.join(path_part)) { return finalize_response(ctx.app_handle().clone(), path_part, c); }

// Assets (shared icon/font/image pack)
if let Ok(c) = fs::read(dev_assets.join(path_part)) { return finalize_response(ctx.app_handle().clone(), path_part, c); }
let assets_base = res_dir.join("assets");
if let Ok(c) = fs::read(assets_base.join(path_part)) { return finalize_response(ctx.app_handle().clone(), path_part, c); }

// Search theme packs (module AND theme root)
```

- [ ] **Step 3: Update `app/src-tauri/tauri.conf.json` to bundle the assets directory**

The `bundle.resources` block currently reads:
```json
"resources": {
  "../runtime": "runtime",
  "../../themes": "themes"
}
```

Change it to:
```json
"resources": {
  "../runtime": "runtime",
  "../../themes": "themes",
  "../assets": "assets"
}
```

- [ ] **Step 4: Verify the build compiles**

```bash
cd /home/jack/Projects/flux/app && cargo build 2>&1 | tail -5
```

Expected: `Finished` with no errors. (Warnings are fine.)

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/lib.rs app/src-tauri/tauri.conf.json
git commit -m "feat(engine): serve app/assets/ via flux-module:// protocol"
```

---

## Task 2: System-Stats — Fix Graph Rendering

**Files:**
- Modify: `themes/bridges/modules/system-stats/logic.js`

**Context:** Setting `canvas.width` resets the 2D context state including any active transform. The current code calls `setTransform` only in `_onResize`. If the ResizeObserver fires before layout is complete (zero dimensions), the transform is never set, and all subsequent draws use identity-transform coordinates, collapsing the graph to a single dot row.

**Fix:** Re-apply `setTransform` at the start of every `_draw` / `_drawChan` call. Also guard the `canvas.width` / `canvas.height` assignment so it only resets the canvas when dimensions actually changed.

- [ ] **Step 1: Replace `DotGraph._onResize` and `DotGraph._draw`**

Find and replace the entire `DotGraph` class methods. Current `_onResize`:
```js
  _onResize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._draw();
  }
```

Replace with:
```js
  _onResize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this._draw();
  }
```

Current `_draw` starts with:
```js
  _draw() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.ctx.clearRect(0, 0, w, h);
```

Replace with:
```js
  _draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
```

- [ ] **Step 2: Replace `DualGraph._onResize` and `DualGraph._drawChan`**

Current `_onResize`:
```js
  _onResize() {
    const dpr = window.devicePixelRatio || 1;
    const ctxMap = [[this.canvasA, this.ctxA], [this.canvasB, this.ctxB]];
    for (const [c, ctx] of ctxMap) {
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) continue;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this._draw();
  }
```

Replace with:
```js
  _onResize() {
    const dpr = window.devicePixelRatio || 1;
    const ctxMap = [[this.canvasA, this.ctxA], [this.canvasB, this.ctxB]];
    for (const [c, ctx] of ctxMap) {
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) continue;
      const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      if (c.width !== bw || c.height !== bh) {
        c.width = bw;
        c.height = bh;
      }
    }
    this._draw();
  }
```

Current `_drawChan` starts with:
```js
  _drawChan(ctx, canvas, hist, color, fromTop) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
```

Replace with:
```js
  _drawChan(ctx, canvas, hist, color, fromTop) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
```

- [ ] **Step 3: Verify the file saved correctly**

```bash
grep -n "setTransform" themes/bridges/modules/system-stats/logic.js
```

Expected output — 3 lines, one in `_draw`, one in `_drawChan`, none in `_onResize`:
```
87:    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
163:    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

- [ ] **Step 4: Commit**

```bash
git add themes/bridges/modules/system-stats/logic.js
git commit -m "fix(system-stats): re-apply setTransform per draw call to fix collapsed graphs"
```

---

## Task 3: Weather HTML — Hero Icon, Glitch CSS, Dot-Pixel Bars

**Files:**
- Modify: `themes/bridges/modules/weather/index.html`

- [ ] **Step 1: Remove the inline SVG symbol block**

Delete lines 170–195 (the `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">` block containing `icon-clear`, `icon-cloudy`, `icon-rain`, `icon-storm` symbols). The file should go straight from `</style>` to `</head>` to `<body>`.

- [ ] **Step 2: Add glitch CSS and icon wrapper styles inside `<style>`**

Add the following before the closing `</style>` tag (after the existing `.flicker-on-mount` rule):

```css
    /* --- Icon glitch system --- */
    .hero-icon-wrap { display: flex; justify-content: center; margin-bottom: 0.5rem; }
    .icon-glitch-wrap { position: relative; width: 52px; height: 52px; }
    .icon-layer {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      filter: drop-shadow(0 0 6px var(--color-hud-primary));
      color: var(--color-hud-primary);
    }
    .icon-layer.icon-neighbor { opacity: 0; }

    @keyframes glitch-out-subtle {
      0%   { clip-path: inset(0 0 0 0); opacity: 1; }
      20%  { clip-path: inset(20% 0 60% 0); opacity: 0.8; }
      40%  { clip-path: inset(60% 0 20% 0); opacity: 0.9; }
      60%  { clip-path: inset(40% 0 40% 0); opacity: 0.85; }
      80%  { clip-path: inset(0 0 80% 0); opacity: 0.9; }
      100% { clip-path: inset(0 0 100% 0); opacity: 0; }
    }
    @keyframes glitch-in-subtle {
      0%   { clip-path: inset(0 0 100% 0); opacity: 0; }
      20%  { clip-path: inset(80% 0 0 0); opacity: 0.9; }
      40%  { clip-path: inset(40% 0 40% 0); opacity: 0.85; }
      60%  { clip-path: inset(20% 0 60% 0); opacity: 0.9; }
      80%  { clip-path: inset(60% 0 20% 0); opacity: 0.8; }
      100% { clip-path: inset(0 0 0 0); opacity: 1; }
    }
    @keyframes glitch-out-normal {
      0%   { clip-path: inset(0 0 0 0); opacity: 1; }
      15%  { clip-path: inset(40% 0 50% 0); opacity: 0.7; transform: translateX(-2px); }
      35%  { clip-path: inset(10% 0 70% 0); opacity: 0.8; transform: translateX(2px); }
      55%  { clip-path: inset(60% 0 10% 0); opacity: 0.7; transform: translateX(-1px); }
      75%  { clip-path: inset(0 0 90% 0); opacity: 0.6; transform: translateX(0); }
      100% { clip-path: inset(0 0 100% 0); opacity: 0; transform: translateX(0); }
    }
    @keyframes glitch-in-normal {
      0%   { clip-path: inset(0 0 100% 0); opacity: 0; transform: translateX(0); }
      25%  { clip-path: inset(90% 0 0 0); opacity: 0.6; transform: translateX(2px); }
      45%  { clip-path: inset(10% 0 60% 0); opacity: 0.7; transform: translateX(-2px); }
      65%  { clip-path: inset(70% 0 10% 0); opacity: 0.8; transform: translateX(1px); }
      85%  { clip-path: inset(50% 0 40% 0); opacity: 0.9; transform: translateX(0); }
      100% { clip-path: inset(0 0 0 0); opacity: 1; transform: translateX(0); }
    }
    @keyframes glitch-out-wild {
      0%   { clip-path: inset(0 0 0 0); opacity: 1; transform: translate(0,0); }
      10%  { clip-path: inset(60% 0 20% 0); opacity: 0.5; transform: translate(-4px,1px); }
      25%  { clip-path: inset(10% 0 65% 0); opacity: 0.7; transform: translate(4px,-2px); }
      40%  { clip-path: inset(45% 0 35% 0); opacity: 0.4; transform: translate(-3px,2px); filter: hue-rotate(90deg); }
      55%  { clip-path: inset(75% 0 5% 0); opacity: 0.6; transform: translate(2px,0); filter: none; }
      70%  { clip-path: inset(5% 0 80% 0); opacity: 0.3; transform: translate(-2px,1px); }
      85%  { clip-path: inset(0 0 95% 0); opacity: 0.5; transform: translate(0,0); }
      100% { clip-path: inset(0 0 100% 0); opacity: 0; transform: translate(0,0); }
    }
    @keyframes glitch-in-wild {
      0%   { clip-path: inset(0 0 100% 0); opacity: 0; transform: translate(0,0); }
      15%  { clip-path: inset(95% 0 0 0); opacity: 0.5; transform: translate(3px,-1px); }
      30%  { clip-path: inset(5% 0 75% 0); opacity: 0.6; transform: translate(-4px,2px); }
      45%  { clip-path: inset(80% 0 5% 0); opacity: 0.4; transform: translate(2px,-2px); filter: hue-rotate(-90deg); }
      60%  { clip-path: inset(35% 0 45% 0); opacity: 0.7; transform: translate(-2px,0); filter: none; }
      75%  { clip-path: inset(65% 0 10% 0); opacity: 0.8; transform: translate(1px,1px); }
      90%  { clip-path: inset(20% 0 60% 0); opacity: 0.9; transform: translate(0,0); }
      100% { clip-path: inset(0 0 0 0); opacity: 1; transform: translate(0,0); }
    }

    .glitching .icon-current { animation: glitch-out-normal 0.4s ease forwards; }
    .glitching .icon-neighbor { opacity: 1; animation: glitch-in-normal 0.4s ease forwards; }
    .glitching.intensity-subtle .icon-current { animation: glitch-out-subtle 0.35s ease forwards; }
    .glitching.intensity-subtle .icon-neighbor { opacity: 1; animation: glitch-in-subtle 0.35s ease forwards; }
    .glitching.intensity-wild .icon-current { animation: glitch-out-wild 0.5s ease forwards; }
    .glitching.intensity-wild .icon-neighbor { opacity: 1; animation: glitch-in-wild 0.5s ease forwards; }

    /* Hourly icon size */
    .wx-icon { width: 20px; height: 20px; }

    /* --- Dot-pixel scan bars --- */
    .scan-bar {
      flex: 1;
      background-image: radial-gradient(circle, var(--bar-color, var(--color-hud-primary)) 1.7px, transparent 1.7px);
      background-size: 4px 4px;
      background-position: 0 bottom;
      background-repeat: repeat;
      opacity: 0.75;
      transition: height 0.5s ease;
      min-height: 2px;
    }
    .scan-bar.current { opacity: 1; filter: drop-shadow(0 0 3px var(--color-hud-primary)); }
```

Note: this replaces the existing `.scan-bar` rule (remove the old one at line ~125–128).

- [ ] **Step 3: Add hero icon HTML inside `.temp-display`**

The current `.temp-display` block is:
```html
      <div class="temp-display">
        <div class="temp-value"><span id="temp-value">--</span><span class="temp-unit" id="temp-unit">°C</span></div>
        <div class="weather-condition" id="condition">LOADING...</div>
        <div class="location-display" id="location">--</div>
        <div class="feels-like" id="feels-like"></div>
      </div>
```

Replace with:
```html
      <div class="temp-display">
        <div class="hero-icon-wrap">
          <div class="icon-glitch-wrap" id="hero-icon">
            <img class="icon-layer icon-current" id="hero-icon-current" src="" alt="">
            <img class="icon-layer icon-neighbor" id="hero-icon-neighbor" src="" alt="">
          </div>
        </div>
        <div class="temp-value"><span id="temp-value">--</span><span class="temp-unit" id="temp-unit">°C</span></div>
        <div class="weather-condition" id="condition">LOADING...</div>
        <div class="location-display" id="location">--</div>
        <div class="feels-like" id="feels-like"></div>
        <div class="sunrise-sunset" id="sunrise-sunset" style="display:none;font-family:var(--font-tech);font-size:0.65rem;color:var(--color-hud-primary-soft);opacity:0.45;margin-top:0.15rem;letter-spacing:1px;"></div>
      </div>
```

- [ ] **Step 4: Verify the HTML is well-formed**

```bash
grep -c "icon-glitch-wrap" themes/bridges/modules/weather/index.html
```

Expected: `1`

```bash
grep -c "icon-clear\|icon-cloudy\|icon-rain\|icon-storm" themes/bridges/modules/weather/index.html
```

Expected: `0` (old symbols gone)

- [ ] **Step 5: Commit**

```bash
git add themes/bridges/modules/weather/index.html
git commit -m "feat(weather): add hero icon, glitch CSS keyframes, dot-pixel scan bars"
```

---

## Task 4: Weather Logic — Icon Constants and GlitchManager

**Files:**
- Modify: `themes/bridges/modules/weather/logic.js`

- [ ] **Step 1: Replace the top of `logic.js` — mock data stays, add icon constants before the state declaration**

After the `MOCK_DATA` block (line 43) and before `let _scanBarsInitialized = false;`, insert:

```js
// --- Icon system ---
const ICON_BASE = 'flux-module://assets/icons/weather/';

const ICON_MAP = {
  0: 'sun.svg',
  1: 'cloud-sun-01.svg', 2: 'cloud-sun-02.svg',
  3: 'cloudy.svg',
  45: 'fog.svg', 48: 'fog.svg',
  51: 'cloud-raining-01.svg', 53: 'cloud-raining-01.svg', 55: 'cloud-raining-02.svg',
  56: 'sleet.svg', 57: 'sleet.svg',
  61: 'rain.svg', 63: 'rain.svg', 65: 'cloud-raining-03.svg',
  66: 'sleet.svg', 67: 'sleet.svg',
  71: 'snow.svg', 73: 'snow.svg', 75: 'cloud-snowing-01.svg', 77: 'snow.svg',
  80: 'cloud-raining-04.svg', 81: 'cloud-raining-04.svg', 82: 'cloud-raining-05.svg',
  85: 'cloud-snowing-01.svg', 86: 'cloud-snowing-02.svg',
  95: 'thunderstorm.svg', 96: 'cloud-lightning.svg', 99: 'cloud-lightning.svg',
};

const GLITCH_NEIGHBORS = {
  'sun.svg':              ['cloud-sun-01.svg'],
  'cloud-sun-01.svg':     ['sun.svg', 'cloud-sun-02.svg'],
  'cloud-sun-02.svg':     ['cloud-sun-01.svg', 'cloudy.svg'],
  'cloudy.svg':           ['cloud-sun-02.svg', 'cloud-01.svg'],
  'fog.svg':              ['cloud-01.svg', 'cloud-02.svg'],
  'cloud-raining-01.svg': ['cloud-raining-02.svg', 'droplets-01.svg'],
  'cloud-raining-02.svg': ['cloud-raining-01.svg', 'droplets-01.svg'],
  'sleet.svg':            ['cloud-snowing-01.svg', 'cloud-raining-01.svg'],
  'rain.svg':             ['cloud-raining-03.svg', 'cloud-raining-04.svg'],
  'cloud-raining-03.svg': ['rain.svg', 'cloud-raining-04.svg'],
  'cloud-raining-04.svg': ['rain.svg', 'cloud-raining-03.svg'],
  'cloud-raining-05.svg': ['cloud-raining-04.svg', 'cloud-raining-03.svg'],
  'snow.svg':             ['cloud-snowing-01.svg', 'sleet.svg'],
  'cloud-snowing-01.svg': ['snow.svg', 'cloud-snowing-02.svg'],
  'cloud-snowing-02.svg': ['cloud-snowing-01.svg', 'sleet.svg'],
  'thunderstorm.svg':     ['cloud-lightning.svg', 'lightning-01.svg'],
  'cloud-lightning.svg':  ['thunderstorm.svg', 'lightning-01.svg'],
  'lightning-01.svg':     ['cloud-lightning.svg', 'thunderstorm.svg'],
};

function getIconSrc(wmoCode) {
  return ICON_BASE + (ICON_MAP[wmoCode] || 'cloudy.svg');
}
```

- [ ] **Step 2: Replace `getWeatherIconId` with the new `getIconSrc` function**

Remove the old function (lines ~69–78):
```js
const getWeatherIconId = (code) => {
  if (code === 0) return '#icon-clear';
  ...
};
```

It's replaced by `getIconSrc` added in Step 1. No further changes needed here.

- [ ] **Step 3: Add `GlitchManager` class after `getIconSrc`**

```js
// --- Glitch system ---
// Frequency ranges (ms): 0=slow, 1=normal, 2=fast
const GLITCH_FREQ = [
  [10000, 20000],
  [4000,  12000],
  [2000,   6000],
];
// Intensity CSS class suffix: 0=off, 1=subtle, 2=normal(default), 3=wild
const GLITCH_CLASS = ['', 'intensity-subtle', '', 'intensity-wild'];
// Animation duration (ms) per intensity
const GLITCH_DUR = [0, 350, 400, 500];

class GlitchManager {
  constructor(intensity, frequency) {
    this._intensity = intensity;
    this._frequency = frequency;
    this._slots = new Map(); // wrapEl → timeoutId
  }

  register(wrapEl) {
    if (this._intensity === 0) return;
    this._schedule(wrapEl);
  }

  unregister(wrapEl) {
    const id = this._slots.get(wrapEl);
    if (id != null) clearTimeout(id);
    this._slots.delete(wrapEl);
  }

  setIntensity(n) {
    this._intensity = n;
    if (n === 0) {
      for (const [el, id] of this._slots) { clearTimeout(id); }
      this._slots.clear();
    }
  }

  setFrequency(n) { this._frequency = n; }

  _schedule(wrapEl) {
    if (this._intensity === 0) return;
    const [min, max] = GLITCH_FREQ[this._frequency] || GLITCH_FREQ[1];
    const delay = min + Math.random() * (max - min);
    const id = setTimeout(() => this._glitch(wrapEl), delay);
    this._slots.set(wrapEl, id);
  }

  _glitch(wrapEl) {
    const current = wrapEl.querySelector('.icon-current');
    const neighbor = wrapEl.querySelector('.icon-neighbor');
    if (!current || !neighbor) { this._schedule(wrapEl); return; }

    const currentFile = (current.src || '').split('/').pop();
    const targets = GLITCH_NEIGHBORS[currentFile];
    if (!targets || targets.length === 0) { this._schedule(wrapEl); return; }

    const targetFile = targets[Math.floor(Math.random() * targets.length)];
    neighbor.src = ICON_BASE + targetFile;

    const cls = GLITCH_CLASS[this._intensity];
    if (cls) wrapEl.classList.add('glitching', cls);
    else wrapEl.classList.add('glitching');

    const dur = GLITCH_DUR[this._intensity];
    setTimeout(() => {
      wrapEl.classList.remove('glitching', 'intensity-subtle', 'intensity-wild');
      // Promote neighbor to current
      current.src = ICON_BASE + targetFile;
      neighbor.src = '';
      neighbor.style.opacity = '0';
      this._schedule(wrapEl);
    }, dur);
  }

  destroy() {
    for (const [, id] of this._slots) clearTimeout(id);
    this._slots.clear();
  }
}

let glitchManager = null;
```

- [ ] **Step 4: Update `render()` to set the hero icon src**

In the `render()` function, after the line that sets `conditionEl.textContent`, add:

```js
  // Hero icon
  const heroCurrentEl = document.getElementById('hero-icon-current');
  if (heroCurrentEl) heroCurrentEl.src = getIconSrc(w.condition);
```

- [ ] **Step 5: Update `renderHourlyForecast()` to use two-layer icon wrappers and register with GlitchManager**

Replace the entire `renderHourlyForecast` function:

```js
function renderHourlyForecast() {
  const grid = document.getElementById('hourly-grid');
  if (!grid) return;

  // Unregister old hourly slots from GlitchManager
  grid.querySelectorAll('.icon-glitch-wrap').forEach(el => glitchManager?.unregister(el));

  const count = cfg.hourlyCount || 5;
  const fmt = cfg.timeFormat === '12h'
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: '2-digit', minute: '2-digit', hour12: false };

  grid.innerHTML = state.weather.hourly.slice(0, count).map((hour, i) => {
    const src = getIconSrc(hour.code);
    return `<div class="hourly-item">
      <span class="hourly-time">${hour.time}</span>
      <div class="hourly-icon">
        <div class="icon-glitch-wrap" style="width:20px;height:20px;" data-hourly="${i}">
          <img class="icon-layer icon-current wx-icon" src="${src}" alt="">
          <img class="icon-layer icon-neighbor wx-icon" src="" alt="" style="opacity:0">
        </div>
      </div>
      <span class="hourly-temp">${displayTemp(hour.temp).toFixed(0)}°</span>
    </div>`;
  }).join('');

  // Register new slots
  grid.querySelectorAll('.icon-glitch-wrap').forEach(el => glitchManager?.register(el));
}
```

Note: the `fmt` variable is defined but hourly time format from the API is a pre-formatted string. The live format will be applied in Task 6 when `fetchRealWeather` is updated to use `cfg.timeFormat`.

- [ ] **Step 6: Add temporary cfg stub and initialize GlitchManager at the bottom of `logic.js`**

Add the temporary cfg stub immediately after the `GLITCH_NEIGHBORS` constants (will be fully replaced in Task 5):

```js
// Temporary cfg stub — replaced in Task 5
let cfg = {
  glitchIntensity: 2, glitchFrequency: 1, hourlyCount: 5, timeFormat: '24h',
  defaultTab: 'temp', forecastDays: 7, unit: 'C', windUnit: 'kmh',
  precipUnit: 'mm', updateInterval: 10, simulation: false, showSunriseSunset: true,
  location: '', metrics: ['wind','humidity','precipitation','uv'],
};
```

Replace the existing initialization block (lines ~368–380) with a version that does NOT call `loadCfg` or `scheduleRefresh` (those are added in Task 5):

```js
// Listen for settings changes (expanded in Task 5)
window.addEventListener('storage', () => {
  const loc = localStorage.getItem('koji_weather_location');
  const sim = localStorage.getItem('koji_weather_simulation') === 'true';
  if (sim) setState({ isSimulation: true, weather: MOCK_DATA });
  else if (loc !== null) fetchRealWeather(loc || undefined);
});

attachEventListeners();

glitchManager = new GlitchManager(cfg.glitchIntensity, cfg.glitchFrequency);
const heroWrap = document.getElementById('hero-icon');
if (heroWrap) glitchManager.register(heroWrap);

render();

const savedSim = localStorage.getItem('koji_weather_simulation') === 'true';
const savedLoc = localStorage.getItem('koji_weather_location');
if (!savedSim) fetchRealWeather(savedLoc || undefined);

window._fluxCleanup = function() { glitchManager?.destroy(); };
```

- [ ] **Step 7: Verify**

```bash
grep -c "GlitchManager\|ICON_MAP\|GLITCH_NEIGHBORS\|getIconSrc" themes/bridges/modules/weather/logic.js
```

Expected: `> 0` for each.

- [ ] **Step 8: Commit**

```bash
git add themes/bridges/modules/weather/logic.js
git commit -m "feat(weather): add GlitchManager, ICON_MAP, two-layer icon rendering"
```

---

## Task 5: Weather Logic — Config System

**Files:**
- Modify: `themes/bridges/modules/weather/logic.js`

- [ ] **Step 1: Replace the temporary `cfg` stub with the full config system**

Find and remove the temporary stub added in Task 4:
```js
// Temporary cfg stub — replaced in Task 5
let cfg = { glitchIntensity: 2, glitchFrequency: 1, hourlyCount: 5, timeFormat: '24h' };
```

Replace with the full config block (place it after the `GLITCH_NEIGHBORS` / `getIconSrc` block and before the `GlitchManager` class):

```js
// --- Config ---
const DEFAULT_CFG = {
  location: '',
  updateInterval: 10,
  unit: 'C',
  windUnit: 'kmh',
  precipUnit: 'mm',
  timeFormat: '24h',
  hourlyCount: 5,
  forecastDays: 7,
  defaultTab: 'temp',
  metrics: ['wind', 'humidity', 'precipitation', 'uv'],
  glitchIntensity: 2,
  glitchFrequency: 1,
  simulation: false,
  showSunriseSunset: true,
};

function loadCfg() {
  const raw = localStorage.getItem('koji_weather_cfg');
  if (raw) {
    try { return { ...DEFAULT_CFG, ...JSON.parse(raw) }; } catch (_) {}
  }
  // Migrate old individual keys
  const oldLoc = localStorage.getItem('koji_weather_location');
  const oldSim = localStorage.getItem('koji_weather_simulation') === 'true';
  const oldH7  = localStorage.getItem('koji_weather_hourly7') === 'true';
  return {
    ...DEFAULT_CFG,
    location: oldLoc || '',
    simulation: oldSim,
    hourlyCount: oldH7 ? 7 : 5,
  };
}

let cfg = loadCfg();
```

- [ ] **Step 2: Update the `state` object to use cfg for unit and windUnit**

Current `state` initialisation (lines ~47–54):
```js
let state = {
  weather: MOCK_DATA,
  loading: false,
  isSimulation: true,
  unit: 'C',
  graphMode: 'temp',
  windUnit: 'km/h',
};
```

Replace with:
```js
let state = {
  weather: MOCK_DATA,
  loading: false,
  isSimulation: cfg.simulation,
  unit: cfg.unit,
  graphMode: cfg.defaultTab || 'temp',
  windUnit: cfg.windUnit,
};
```

- [ ] **Step 3: Replace the storage event listener**

Remove the old listener (lines ~357–366):
```js
window.addEventListener('storage', () => {
  const loc = localStorage.getItem('koji_weather_location');
  const sim = localStorage.getItem('koji_weather_simulation') === 'true';
  if (sim) {
    setState({ isSimulation: true, weather: MOCK_DATA });
  } else if (loc !== null) {
    fetchRealWeather(loc || undefined);
  }
});
```

Replace with:
```js
window.addEventListener('storage', () => {
  cfg = loadCfg();
  glitchManager?.setIntensity(cfg.glitchIntensity);
  glitchManager?.setFrequency(cfg.glitchFrequency);
  if (cfg.simulation) {
    setState({ isSimulation: true, weather: MOCK_DATA, unit: cfg.unit, graphMode: cfg.defaultTab || 'temp' });
  } else {
    fetchRealWeather(cfg.location || undefined);
  }
});
```

- [ ] **Step 4: Update the init block at the bottom to use cfg**

Replace:
```js
const savedSim = localStorage.getItem('koji_weather_simulation') === 'true';
const savedLoc = localStorage.getItem('koji_weather_location');
if (!savedSim) {
  fetchRealWeather(savedLoc || undefined);
}
```

With:
```js
if (!cfg.simulation) {
  fetchRealWeather(cfg.location || undefined);
}

// Refresh timer
let _refreshTimer = null;
function scheduleRefresh() {
  clearInterval(_refreshTimer);
  if (!cfg.simulation) {
    _refreshTimer = setInterval(() => fetchRealWeather(cfg.location || undefined), cfg.updateInterval * 60 * 1000);
  }
}
scheduleRefresh();
```

Also update `_fluxCleanup`:
```js
window._fluxCleanup = function() {
  glitchManager?.destroy();
  clearInterval(_refreshTimer);
};
```

- [ ] **Step 5: Verify config loads**

```bash
grep -c "loadCfg\|DEFAULT_CFG\|koji_weather_cfg" themes/bridges/modules/weather/logic.js
```

Expected: `> 0` for each.

- [ ] **Step 6: Commit**

```bash
git add themes/bridges/modules/weather/logic.js
git commit -m "feat(weather): add cfg system with old-key migration and refresh timer"
```

---

## Task 6: Weather Logic — Full Rendering Updates

**Files:**
- Modify: `themes/bridges/modules/weather/logic.js`

- [ ] **Step 1: Update `fetchRealWeather` to use cfg and fetch additional fields**

Replace the entire `fetchRealWeather` function:

```js
const fetchRealWeather = async (customLocation) => {
  setState({ loading: true, isSimulation: false });
  try {
    let latitude, longitude, locName;

    if (customLocation && customLocation.trim() !== '') {
      // Check if it's lat,lon format
      const coordMatch = customLocation.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
      if (coordMatch) {
        latitude = parseFloat(coordMatch[1]);
        longitude = parseFloat(coordMatch[2]);
        locName = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
      } else {
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(customLocation)}&count=1`);
        const geoData = await geoRes.json();
        if (geoData.results && geoData.results.length > 0) {
          latitude = geoData.results[0].latitude;
          longitude = geoData.results[0].longitude;
          locName = `${geoData.results[0].name}, ${geoData.results[0].country_code}`;
        } else {
          throw new Error('Location not found');
        }
      }
    } else {
      if (!navigator.geolocation) throw new Error('Geolocation not supported');
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
      locName = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
    }

    const days = cfg.forecastDays || 7;
    const windParam = cfg.windUnit === 'kmh' ? 'kmh' : cfg.windUnit === 'mph' ? 'mph' : cfg.windUnit === 'ms' ? 'ms' : 'kmh';
    const precipParam = cfg.precipUnit === 'inch' ? 'inch' : 'mm';

    const url = [
      `https://api.open-meteo.com/v1/forecast`,
      `?latitude=${latitude}&longitude=${longitude}`,
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,surface_pressure,visibility,cloud_cover`,
      `&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code,dew_point_2m`,
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset`,
      `&forecast_days=${days}`,
      `&wind_speed_unit=${windParam}`,
      `&precipitation_unit=${precipParam}`,
      `&timezone=auto`,
    ].join('');

    const res = await fetch(url);
    const data = await res.json();

    const currentIndex = data.hourly.time.findIndex(t => new Date(t).getTime() >= Date.now());
    const startIndex = currentIndex > -1 ? currentIndex : 0;

    const timeFmt = cfg.timeFormat === '12h'
      ? { hour: 'numeric', minute: '2-digit', hour12: true }
      : { hour: '2-digit', minute: '2-digit', hour12: false };

    const hourly = data.hourly.time.slice(startIndex, startIndex + 7).map((t, i) => ({
      time: new Date(t).toLocaleTimeString([], timeFmt),
      temp: data.hourly.temperature_2m[startIndex + i],
      code: data.hourly.weather_code[startIndex + i],
    }));

    const daily = data.daily.time.slice(0, days).map((t, i) => ({
      date: i === 0 ? 'TODAY' : new Date(t).toLocaleDateString([], { weekday: 'short' }).toUpperCase(),
      max: data.daily.temperature_2m_max[i],
      min: data.daily.temperature_2m_min[i],
      code: data.daily.weather_code[i],
      precip: data.daily.precipitation_sum[i],
      wind: data.daily.wind_speed_10m_max[i],
    }));

    const totalHours = days * 24;
    const fullHourly = Array.from({ length: totalHours }).map((_, i) => ({
      temp: data.hourly.temperature_2m[i] || 0,
      humidity: data.hourly.relative_humidity_2m[i] || 0,
      precip: data.hourly.precipitation[i] || 0,
      wind: data.hourly.wind_speed_10m[i] || 0,
    }));

    const precipSuffix = cfg.precipUnit === 'inch' ? ' in' : ' mm';
    const windSuffix = { kmh: ' km/h', mph: ' mph', ms: ' m/s', knots: ' kn' }[cfg.windUnit] || ' km/h';

    setState({
      weather: {
        temperature: data.current.temperature_2m,
        feelsLike: data.current.apparent_temperature,
        condition: data.current.weather_code,
        location: locName,
        humidity: data.current.relative_humidity_2m,
        windSpeed: data.current.wind_speed_10m,
        windSuffix,
        precipitation: data.current.precipitation,
        precipSuffix,
        uvIndex: data.daily.uv_index_max[0],
        high: data.daily.temperature_2m_max[0],
        low: data.daily.temperature_2m_min[0],
        pressure: data.current.surface_pressure,
        visibility: data.current.visibility,
        cloudCover: data.current.cloud_cover,
        dewPoint: data.hourly.dew_point_2m[startIndex],
        sunrise: data.daily.sunrise?.[0],
        sunset: data.daily.sunset?.[0],
        hourly,
        daily,
        fullHourly,
      },
      loading: false,
    });
    scheduleRefresh();
  } catch (err) {
    setState({
      weather: { ...state.weather, location: 'ERROR / NOT FOUND' },
      loading: false,
    });
  }
};
```

- [ ] **Step 2: Update `renderScanBars` to use `cfg.forecastDays` and `cfg.defaultTab`**

Replace the `renderScanBars` function, specifically the part that reads `state.graphMode` and uses `fullHourly` (the function stays largely the same, but bars now use `--bar-color` CSS variable and `.scan-bar` uses inline style):

```js
function renderScanBars() {
  const container = document.getElementById('scan-bars');
  const labelsEl = document.getElementById('scan-day-labels');
  if (!container) return;

  const { fullHourly, daily } = state.weather;
  if (!fullHourly || fullHourly.length === 0) return;

  const minT = Math.min(...fullHourly.map(h => h.temp), 0);
  const maxT = Math.max(...fullHourly.map(h => h.temp), 1);
  const rangeT = maxT - minT || 1;
  const maxP = Math.max(...fullHourly.map(h => h.precip), 0.1);
  const maxW = Math.max(...fullHourly.map(h => h.wind), 0.1);

  const bars = fullHourly.map((h, idx) => {
    let heightPct = 0;
    let barColor = 'var(--color-hud-primary)';
    if (state.graphMode === 'temp') {
      heightPct = Math.max(5, ((h.temp - minT) / rangeT) * 100);
      barColor = getGlowColor(h.temp);
    } else if (state.graphMode === 'humidity') {
      heightPct = Math.max(2, (h.humidity / 100) * 100);
    } else if (state.graphMode === 'precip') {
      heightPct = Math.max(2, (h.precip / maxP) * 100);
    } else if (state.graphMode === 'wind') {
      heightPct = Math.max(5, (h.wind / maxW) * 100);
      barColor = 'var(--color-hud-alert)';
    }
    const gap = idx % 24 === 23 ? 'margin-right:2px;' : '';
    return `<div class="scan-bar" style="height:${heightPct}%;--bar-color:${barColor};${gap}"></div>`;
  });

  container.innerHTML = bars.join('');

  if (!_scanBarsInitialized) {
    const barEls = container.querySelectorAll('.scan-bar');
    barEls.forEach((bar, i) => {
      const targetH = bar.style.height;
      bar.style.height = '0';
      setTimeout(() => { bar.style.height = targetH; }, i * 40);
    });
    _scanBarsInitialized = true;
  }

  if (labelsEl && daily) {
    labelsEl.innerHTML = daily.map(d =>
      `<span class="scan-day-label">${d.date}</span>`
    ).join('');
  }
}
```

- [ ] **Step 3: Replace `renderMetrics` to support the dynamic cfg.metrics array**

```js
const METRIC_DEFS = {
  wind:        { label: 'WIND',       icon: '↗', getValue: (w) => `${w.windSpeed}${w.windSuffix || ' km/h'}` },
  humidity:    { label: 'HUMIDITY',   icon: '≋', getValue: (w) => `${w.humidity}%` },
  precipitation:{ label: 'PRECIP',   icon: '↓', getValue: (w) => `${w.precipitation}${w.precipSuffix || ' mm'}` },
  uv:          { label: 'UV INDEX',   icon: '◉', getValue: (w) => `${w.uvIndex ?? '--'}` },
  feelsLike:   { label: 'FEELS LIKE', icon: '~', getValue: (w) => `${displayTemp(w.feelsLike).toFixed(1)}°` },
  pressure:    { label: 'PRESSURE',   icon: '⊙', getValue: (w) => `${w.pressure != null ? Math.round(w.pressure) + ' hPa' : '--'}` },
  visibility:  { label: 'VISIBILITY', icon: '◎', getValue: (w) => `${w.visibility != null ? (w.visibility / 1000).toFixed(1) + ' km' : '--'}` },
  dewPoint:    { label: 'DEW POINT',  icon: '·', getValue: (w) => `${w.dewPoint != null ? displayTemp(w.dewPoint).toFixed(1) + '°' : '--'}` },
  cloudCover:  { label: 'CLOUD CVR',  icon: '☁', getValue: (w) => `${w.cloudCover != null ? w.cloudCover + '%' : '--'}` },
};

function renderMetrics() {
  const grid = document.querySelector('.metrics-grid');
  if (!grid) return;
  const w = state.weather;
  const metrics = cfg.metrics || DEFAULT_CFG.metrics;

  grid.innerHTML = metrics.slice(0, 4).map(key => {
    const def = METRIC_DEFS[key];
    if (!def) return '';
    return `<div class="metric-item">
      <div class="metric-label">${def.label}</div>
      <div class="metric-value"><span class="metric-icon">${def.icon}</span><span class="metric-val">${def.getValue(w)}</span></div>
    </div>`;
  }).join('');
}
```

- [ ] **Step 4: Update `render()` to show sunrise/sunset and use cfg.unit**

In `render()`, add after the hero icon line:

```js
  // Sunrise/sunset
  const srssEl = document.getElementById('sunrise-sunset');
  if (srssEl) {
    if (cfg.showSunriseSunset && w.sunrise && w.sunset) {
      const fmt = cfg.timeFormat === '12h'
        ? { hour: 'numeric', minute: '2-digit', hour12: true }
        : { hour: '2-digit', minute: '2-digit', hour12: false };
      const sr = new Date(w.sunrise).toLocaleTimeString([], fmt);
      const ss = new Date(w.sunset).toLocaleTimeString([], fmt);
      srssEl.textContent = `↑ ${sr}  ·  ↓ ${ss}`;
      srssEl.style.display = '';
    } else {
      srssEl.style.display = 'none';
    }
  }
```

Also update the `render()` function's `displayTemp` usage to sync with cfg unit:

Replace:
```js
  const tempUnitEl = document.getElementById('temp-unit');
  if (tempUnitEl) tempUnitEl.textContent = `°${state.unit}`;

  const unitToggleEl = document.getElementById('unit-toggle');
  if (unitToggleEl) unitToggleEl.textContent = `°${state.unit === 'C' ? 'F' : 'C'}`;
```

With:
```js
  const tempUnitEl = document.getElementById('temp-unit');
  if (tempUnitEl) tempUnitEl.textContent = `°${cfg.unit}`;

  const unitToggleEl = document.getElementById('unit-toggle');
  if (unitToggleEl) unitToggleEl.textContent = `°${cfg.unit === 'C' ? 'F' : 'C'}`;
```

And update `displayTemp` to use cfg:
```js
const displayTemp = (tempC) => cfg.unit === 'C' ? tempC : (tempC * 9/5) + 32;
```

And the unit toggle event to persist to cfg:
```js
  const unitToggleBtn = document.getElementById('unit-toggle');
  unitToggleBtn?.addEventListener('click', () => {
    cfg.unit = cfg.unit === 'C' ? 'F' : 'C';
    localStorage.setItem('koji_weather_cfg', JSON.stringify(cfg));
    setState({ unit: cfg.unit });
  });
```

- [ ] **Step 5: Verify**

```bash
grep -c "METRIC_DEFS\|fetchRealWeather\|renderMetrics\|forecastDays" themes/bridges/modules/weather/logic.js
```

Expected: `> 0` for each.

- [ ] **Step 6: Commit**

```bash
git add themes/bridges/modules/weather/logic.js
git commit -m "feat(weather): full rendering updates — cfg units, metrics, forecast days, sunrise/sunset"
```

---

## Task 7: Weather Settings — Full Redesign

**Files:**
- Modify: `themes/bridges/modules/weather/settings.html`

- [ ] **Step 1: Replace the entire file with the new settings panel**

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
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 1rem 1.2rem 1.4rem;
      font-family: var(--font-main);
      color: var(--color-hud-neutral);
      background: rgba(8,12,22,0.95);
      overflow-y: auto;
    }
    h2 {
      font-family: var(--font-header); font-size: 0.8rem; letter-spacing: 3px;
      color: var(--color-hud-primary); margin: 0 0 1.2rem; text-transform: uppercase;
      border-bottom: 1px solid rgba(0,191,255,0.15); padding-bottom: 0.6rem;
    }
    .section { margin-bottom: 1.2rem; }
    .section-title {
      font-family: var(--font-tech); font-size: 0.58rem; letter-spacing: 2px;
      color: rgba(0,191,255,0.5); text-transform: uppercase; margin-bottom: 0.6rem;
    }
    .field { margin-bottom: 0.8rem; }
    .field-label {
      display: block; font-family: var(--font-tech); font-size: 0.62rem;
      color: var(--color-hud-primary-soft); margin-bottom: 0.25rem;
      letter-spacing: 1px; text-transform: uppercase;
    }
    .field-hint {
      font-family: var(--font-tech); font-size: 0.55rem;
      color: rgba(0,191,255,0.35); margin-top: 0.2rem; line-height: 1.4;
    }
    input[type="text"] {
      width: 100%; background: rgba(0,191,255,0.05);
      border: 1px solid rgba(0,191,255,0.2);
      color: var(--color-hud-neutral); font-family: var(--font-tech); font-size: 0.8rem;
      padding: 0.35rem 0.6rem; border-radius: 2px; outline: none;
    }
    input[type="text"]:focus { border-color: var(--color-hud-primary); }
    .locate-row { display: flex; gap: 0.5rem; align-items: center; }
    .locate-row input { flex: 1; }
    .locate-btn {
      font-family: var(--font-tech); font-size: 0.58rem; letter-spacing: 1px;
      background: rgba(0,191,255,0.08); border: 1px solid rgba(0,191,255,0.25);
      color: var(--color-hud-primary); padding: 0.35rem 0.65rem;
      cursor: pointer; border-radius: 2px; white-space: nowrap; text-transform: uppercase;
    }
    .locate-btn:hover { background: rgba(0,191,255,0.18); }
    /* Segmented control */
    .seg { display: flex; border: 1px solid rgba(0,191,255,0.2); border-radius: 3px; overflow: hidden; }
    .seg button {
      flex: 1; font-family: var(--font-tech); font-size: 0.58rem; padding: 0.3rem 0.4rem;
      background: none; border: none; border-right: 1px solid rgba(0,191,255,0.15);
      color: rgba(0,191,255,0.45); cursor: pointer; letter-spacing: 1px; text-transform: uppercase;
      transition: background 0.15s, color 0.15s;
    }
    .seg button:last-child { border-right: none; }
    .seg button.active {
      background: rgba(0,191,255,0.15); color: var(--color-hud-primary);
      box-shadow: inset 0 0 8px rgba(0,191,255,0.15);
    }
    /* Toggle */
    .toggle-row { display: flex; align-items: flex-start; gap: 0.7rem; margin-bottom: 0.7rem; }
    .toggle-switch {
      position: relative; width: 32px; height: 16px; flex-shrink: 0; margin-top: 1px;
    }
    .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .toggle-track {
      position: absolute; inset: 0; background: rgba(0,191,255,0.1);
      border: 1px solid rgba(0,191,255,0.25); border-radius: 8px; cursor: pointer;
      transition: background 0.2s;
    }
    .toggle-track::after {
      content: ''; position: absolute; left: 2px; top: 2px;
      width: 10px; height: 10px; background: rgba(0,191,255,0.4);
      border-radius: 50%; transition: transform 0.2s, background 0.2s;
    }
    .toggle-switch input:checked + .toggle-track { background: rgba(0,191,255,0.2); border-color: var(--color-hud-primary); }
    .toggle-switch input:checked + .toggle-track::after { transform: translateX(16px); background: var(--color-hud-primary); }
    .toggle-text { font-family: var(--font-tech); font-size: 0.65rem; }
    .toggle-desc { font-family: var(--font-tech); font-size: 0.55rem; color: rgba(0,191,255,0.35); margin-top: 0.15rem; }
    /* Metrics checkboxes */
    .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
    .metric-check {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem;
      border: 1px solid rgba(0,191,255,0.12); border-radius: 3px; cursor: pointer;
      background: rgba(0,191,255,0.03); transition: border-color 0.15s, background 0.15s;
    }
    .metric-check:has(input:checked) { border-color: rgba(0,191,255,0.35); background: rgba(0,191,255,0.08); }
    .metric-check input { accent-color: var(--color-hud-primary); width: 12px; height: 12px; }
    .metric-check span { font-family: var(--font-tech); font-size: 0.6rem; letter-spacing: 1px; text-transform: uppercase; color: rgba(0,191,255,0.65); }
    .metric-check:has(input:disabled) { opacity: 0.35; cursor: not-allowed; }
    /* Divider */
    .divider { border: none; border-top: 1px solid rgba(0,191,255,0.1); margin: 1rem 0; }
    /* Save */
    .save-btn {
      font-family: var(--font-header); font-size: 0.7rem; letter-spacing: 2px;
      background: rgba(0,191,255,0.1); border: 1px solid rgba(0,191,255,0.3);
      color: var(--color-hud-primary); padding: 0.55rem 1.2rem; cursor: pointer;
      text-transform: uppercase; border-radius: 2px; width: 100%; margin-top: 0.4rem;
      transition: background 0.15s;
    }
    .save-btn:hover { background: rgba(0,191,255,0.22); }
  </style>
</head>
<body>
  <h2>KOJI // WEATHER</h2>

  <!-- LOCATION -->
  <div class="section">
    <div class="section-title">Location</div>
    <div class="field">
      <div class="locate-row">
        <input type="text" id="location" placeholder="City name or lat,lon — e.g. Berlin or 52.52,13.41">
        <button class="locate-btn" id="locate-btn">◎ LOCATE</button>
      </div>
      <div class="field-hint">Powered by Open-Meteo — free, no API key required</div>
    </div>
    <div class="field">
      <label class="field-label">Update interval</label>
      <div class="seg" id="seg-interval">
        <button data-val="5">5 MIN</button>
        <button data-val="10">10 MIN</button>
        <button data-val="30">30 MIN</button>
      </div>
    </div>
  </div>

  <hr class="divider">

  <!-- UNITS -->
  <div class="section">
    <div class="section-title">Units</div>
    <div class="field">
      <label class="field-label">Temperature</label>
      <div class="seg" id="seg-unit">
        <button data-val="C">°C</button>
        <button data-val="F">°F</button>
      </div>
    </div>
    <div class="field">
      <label class="field-label">Wind speed</label>
      <div class="seg" id="seg-wind">
        <button data-val="kmh">KM/H</button>
        <button data-val="mph">MPH</button>
        <button data-val="ms">M/S</button>
        <button data-val="knots">KNOTS</button>
      </div>
    </div>
    <div class="field">
      <label class="field-label">Precipitation</label>
      <div class="seg" id="seg-precip">
        <button data-val="mm">MM</button>
        <button data-val="inch">IN</button>
      </div>
    </div>
    <div class="field">
      <label class="field-label">Time format</label>
      <div class="seg" id="seg-time">
        <button data-val="24h">24H</button>
        <button data-val="12h">12H</button>
      </div>
    </div>
  </div>

  <hr class="divider">

  <!-- FORECAST -->
  <div class="section">
    <div class="section-title">Forecast</div>
    <div class="field">
      <label class="field-label">Hourly items</label>
      <div class="seg" id="seg-hourly">
        <button data-val="5">5</button>
        <button data-val="7">7</button>
      </div>
    </div>
    <div class="field">
      <label class="field-label">Forecast days</label>
      <div class="seg" id="seg-days">
        <button data-val="3">3</button>
        <button data-val="5">5</button>
        <button data-val="7">7</button>
      </div>
    </div>
    <div class="field">
      <label class="field-label">Default scan tab</label>
      <div class="seg" id="seg-tab">
        <button data-val="temp">TMP</button>
        <button data-val="humidity">HUM</button>
        <button data-val="precip">PCP</button>
        <button data-val="wind">WND</button>
      </div>
    </div>
  </div>

  <hr class="divider">

  <!-- METRICS GRID -->
  <div class="section">
    <div class="section-title">Metrics grid <span style="color:rgba(0,191,255,0.35);letter-spacing:0">(pick 4)</span></div>
    <div class="metrics-grid" id="metrics-grid">
      <label class="metric-check"><input type="checkbox" value="wind"><span>Wind</span></label>
      <label class="metric-check"><input type="checkbox" value="humidity"><span>Humidity</span></label>
      <label class="metric-check"><input type="checkbox" value="precipitation"><span>Precip</span></label>
      <label class="metric-check"><input type="checkbox" value="uv"><span>UV Index</span></label>
      <label class="metric-check"><input type="checkbox" value="feelsLike"><span>Feels Like</span></label>
      <label class="metric-check"><input type="checkbox" value="pressure"><span>Pressure</span></label>
      <label class="metric-check"><input type="checkbox" value="visibility"><span>Visibility</span></label>
      <label class="metric-check"><input type="checkbox" value="dewPoint"><span>Dew Point</span></label>
      <label class="metric-check"><input type="checkbox" value="cloudCover"><span>Cloud Cover</span></label>
    </div>
  </div>

  <hr class="divider">

  <!-- GLITCH -->
  <div class="section">
    <div class="section-title">Glitch effects</div>
    <div class="field">
      <label class="field-label">Intensity</label>
      <div class="seg" id="seg-glitch-intensity">
        <button data-val="0">OFF</button>
        <button data-val="1">SUBTLE</button>
        <button data-val="2">NORMAL</button>
        <button data-val="3">WILD</button>
      </div>
    </div>
    <div class="field">
      <label class="field-label">Frequency</label>
      <div class="seg" id="seg-glitch-freq">
        <button data-val="0">SLOW</button>
        <button data-val="1">NORMAL</button>
        <button data-val="2">FAST</button>
      </div>
    </div>
  </div>

  <hr class="divider">

  <!-- DISPLAY -->
  <div class="section">
    <div class="section-title">Display</div>
    <div class="toggle-row">
      <label class="toggle-switch">
        <input type="checkbox" id="toggle-simulation">
        <div class="toggle-track"></div>
      </label>
      <div>
        <div class="toggle-text">Simulation mode</div>
        <div class="toggle-desc">Show sample data instead of live weather</div>
      </div>
    </div>
    <div class="toggle-row">
      <label class="toggle-switch">
        <input type="checkbox" id="toggle-sunrise">
        <div class="toggle-track"></div>
      </label>
      <div>
        <div class="toggle-text">Show sunrise / sunset</div>
        <div class="toggle-desc">Display sunrise and sunset times below the temperature</div>
      </div>
    </div>
  </div>

  <button class="save-btn" id="save-btn">SAVE SETTINGS</button>

  <script>
    const DEFAULT_CFG = {
      location: '', updateInterval: 10, unit: 'C', windUnit: 'kmh',
      precipUnit: 'mm', timeFormat: '24h', hourlyCount: 5, forecastDays: 7,
      defaultTab: 'temp', metrics: ['wind','humidity','precipitation','uv'],
      glitchIntensity: 2, glitchFrequency: 1, simulation: false, showSunriseSunset: true,
    };

    function loadCfg() {
      const raw = localStorage.getItem('koji_weather_cfg');
      if (raw) { try { return { ...DEFAULT_CFG, ...JSON.parse(raw) }; } catch(_) {} }
      // migrate old keys
      return {
        ...DEFAULT_CFG,
        location: localStorage.getItem('koji_weather_location') || '',
        simulation: localStorage.getItem('koji_weather_simulation') === 'true',
        hourlyCount: localStorage.getItem('koji_weather_hourly7') === 'true' ? 7 : 5,
      };
    }

    let cfg = loadCfg();

    // --- Populate UI from cfg ---
    document.getElementById('location').value = cfg.location;
    document.getElementById('toggle-simulation').checked = cfg.simulation;
    document.getElementById('toggle-sunrise').checked = cfg.showSunriseSunset;

    function seg(id, val) {
      const container = document.getElementById(id);
      container.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', String(btn.dataset.val) === String(val));
      });
      container.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    }

    seg('seg-interval',         cfg.updateInterval);
    seg('seg-unit',             cfg.unit);
    seg('seg-wind',             cfg.windUnit);
    seg('seg-precip',           cfg.precipUnit);
    seg('seg-time',             cfg.timeFormat);
    seg('seg-hourly',           cfg.hourlyCount);
    seg('seg-days',             cfg.forecastDays);
    seg('seg-tab',              cfg.defaultTab);
    seg('seg-glitch-intensity', cfg.glitchIntensity);
    seg('seg-glitch-freq',      cfg.glitchFrequency);

    // Metrics checkboxes — exactly 4
    const metricsGrid = document.getElementById('metrics-grid');
    const checkboxes  = metricsGrid.querySelectorAll('input[type=checkbox]');
    checkboxes.forEach(cb => {
      cb.checked = cfg.metrics.includes(cb.value);
    });

    function updateMetricDisabled() {
      const checked = Array.from(checkboxes).filter(c => c.checked);
      checkboxes.forEach(cb => {
        cb.disabled = !cb.checked && checked.length >= 4;
      });
    }
    updateMetricDisabled();
    checkboxes.forEach(cb => cb.addEventListener('change', updateMetricDisabled));

    // LOCATE ME button
    document.getElementById('locate-btn').addEventListener('click', () => {
      if (!navigator.geolocation) { alert('Geolocation not supported by this browser.'); return; }
      navigator.geolocation.getCurrentPosition(
        pos => {
          document.getElementById('location').value =
            `${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`;
        },
        () => alert('Could not get location. Please enter it manually.')
      );
    });

    function segVal(id) {
      const active = document.querySelector(`#${id} button.active`);
      return active ? active.dataset.val : null;
    }

    // SAVE
    document.getElementById('save-btn').addEventListener('click', () => {
      const newCfg = {
        ...DEFAULT_CFG,
        location:        document.getElementById('location').value.trim(),
        updateInterval:  parseInt(segVal('seg-interval'), 10) || 10,
        unit:            segVal('seg-unit') || 'C',
        windUnit:        segVal('seg-wind') || 'kmh',
        precipUnit:      segVal('seg-precip') || 'mm',
        timeFormat:      segVal('seg-time') || '24h',
        hourlyCount:     parseInt(segVal('seg-hourly'), 10) || 5,
        forecastDays:    parseInt(segVal('seg-days'), 10) || 7,
        defaultTab:      segVal('seg-tab') || 'temp',
        metrics:         Array.from(checkboxes).filter(c => c.checked).map(c => c.value),
        glitchIntensity: parseInt(segVal('seg-glitch-intensity'), 10),
        glitchFrequency: parseInt(segVal('seg-glitch-freq'), 10),
        simulation:      document.getElementById('toggle-simulation').checked,
        showSunriseSunset: document.getElementById('toggle-sunrise').checked,
      };
      localStorage.setItem('koji_weather_cfg', JSON.stringify(newCfg));
      window.dispatchEvent(new StorageEvent('storage', { key: 'koji_weather_cfg' }));
      WidgetAPI?.widget?.closeSettings?.();
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the file was saved**

```bash
grep -c "seg-glitch-intensity\|koji_weather_cfg\|LOCATE\|metrics-grid" themes/bridges/modules/weather/settings.html
```

Expected: `> 0` for each.

- [ ] **Step 3: Commit**

```bash
git add themes/bridges/modules/weather/settings.html
git commit -m "feat(weather): redesign settings panel — 6 sections, full cfg options"
```

---

## Final Verification Checklist

- [ ] Run the app: `cd app && cargo tauri dev`
- [ ] Verify `flux-module://assets/icons/weather/sun.svg` resolves (hero icon visible in weather widget)
- [ ] Verify system-stats graphs show full-height dot columns (not a single row)
- [ ] Verify weather hero icon glitches between similar icons
- [ ] Verify hourly strip icons show and glitch
- [ ] Verify 7-day scan bars show dot-pixel fill (not solid)
- [ ] Open settings — confirm all 6 sections render, segmented controls work, LOCATE ME button works
- [ ] Change glitch intensity to OFF → no glitching
- [ ] Change glitch intensity to WILD → intense glitching
- [ ] Save settings → widget reloads with new config

# Weather Widget Redesign — Design Spec
**Date:** 2026-04-12
**Scope:** Weather widget visual redesign (glitch icons, dot-style bars, full settings panel) + engine asset-serving extension + system-stats graph rendering fix.

---

## Goals

1. Add randomised scanline-dissolve glitch effects to weather icons (glitch to similar icons only).
2. Replace inline SVG symbols with the existing icon pack at `app/assets/icons/weather/`, served via an extended `flux-module://` protocol.
3. Add a hero weather icon to the main temperature display.
4. Update 7-day forecast scan bars to use a dot-pixel fill pattern matching the system-stats aesthetic.
5. Redesign the settings panel with full user-configurable options.
6. Fix system-stats dot-matrix graphs rendering as a single collapsed row.

---

## Constraints

- Vanilla JS + HTML/CSS only — no build step.
- No changes to `shared-hud.css` or `module.json` files.
- Widget icons reference files via `flux-module://assets/icons/weather/<filename>`.
- Settings persisted under a single `localStorage` key: `koji_weather_cfg`.

---

## Part 1 — Engine: Serving `app/assets/`

### `app/src-tauri/src/lib.rs`

In the `flux-module://` URI handler, add `app/assets/` to the dev and release search paths:

**Dev path** (checked first, before theme search):
```rust
let dev_assets = project_root.join("assets"); // resolves to app/assets/
if let Ok(c) = fs::read(dev_assets.join(path_part)) {
    return finalize_response(ctx.app_handle().clone(), path_part, c);
}
```

**Release path** (checked after dev, before theme search):
```rust
let assets_base = res_dir.join("assets");
if let Ok(c) = fs::read(assets_base.join(path_part)) {
    return finalize_response(ctx.app_handle().clone(), path_part, c);
}
```

Both checks go before the existing theme search loop. A widget referencing `flux-module://assets/icons/weather/sun.svg` will resolve to `app/assets/icons/weather/sun.svg` in dev and the bundled `assets/` directory in release.

### `app/src-tauri/tauri.conf.json`

Add to `bundle.resources`:
```json
"../assets": "assets"
```

So the full resources block becomes:
```json
"resources": {
  "../runtime": "runtime",
  "../../themes": "themes",
  "../assets": "assets"
}
```

---

## Part 2 — Weather Widget

### Icon mapping

WMO weather codes map to primary icons. Each primary icon has a list of glitch-target neighbors (always within the same visual family).

```js
const ICON_MAP = {
  0:           'sun.svg',
  1:           'cloud-sun-01.svg',
  2:           'cloud-sun-02.svg',
  3:           'cloudy.svg',
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

const ICON_BASE = 'flux-module://assets/icons/weather/';
```

### Glitch system (`logic.js`)

**`GlitchManager`** — manages independent randomised glitch timers across all icon slots.

```js
class GlitchManager {
  constructor(intensity, frequency) { /* intensity: 0=off,1=subtle,2=normal,3=wild; frequency: 0=slow,1=normal,2=fast */ }
  register(wrapEl)   // add a two-layer icon wrapper element to manage
  unregister(wrapEl) // remove (called on hourly strip rebuild)
  setIntensity(n)    // 0–3
  setFrequency(n)    // 0–2
  _schedule(wrapEl)  // pick random delay from frequency range, setTimeout → _glitch
  _glitch(wrapEl)    // pick random neighbor, set neighbor img src, add .glitching class,
                     // on animationend: remove .glitching, reschedule
  destroy()          // clearTimeout all pending timers
}
```

Frequency ranges (ms between glitches):
- Slow: 10,000–20,000
- Normal: 4,000–12,000
- Fast: 2,000–6,000

Intensity affects the CSS animation:
- Off: `GlitchManager` never schedules
- Subtle: short clip depth (20% slices), low opacity flicker
- Normal: medium clip depth (40% slices)
- Wild: deep clip depth (60%+ slices), extra shake

### CSS glitch animation (`index.html`)

Four intensity variants as separate keyframe rules:

```css
@keyframes glitch-subtle {
  0%      { clip-path: inset(0 0 0 0); opacity: 1; }
  20%     { clip-path: inset(20% 0 60% 0); opacity: 0.8; }
  40%     { clip-path: inset(60% 0 20% 0); opacity: 0.9; }
  60%     { clip-path: inset(40% 0 40% 0); opacity: 0.85; }
  80%     { clip-path: inset(0 0 80% 0); opacity: 0.9; }
  100%    { clip-path: inset(0 0 0 0); opacity: 1; }
}
@keyframes glitch-normal { /* deeper clips: 40%/50% slices */ }
@keyframes glitch-wild   { /* 60%+ clips + translateX(±2px) */ }
```

Each icon wrapper `.icon-glitch-wrap` contains:
```html
<div class="icon-glitch-wrap">
  <img class="icon-layer icon-current" src="...">
  <img class="icon-layer icon-neighbor" src="..." style="opacity:0">
</div>
```

`.glitching` class triggers the animation on both layers simultaneously — `.icon-current` runs the clip dissolve out, `.icon-neighbor` runs clip dissolve in. On `animationend`, `icon-neighbor` becomes the new `icon-current` and the wrapper is reset.

### Hero icon (`index.html`)

Insert above the `.hero-value` temperature:
```html
<div class="hero-icon-wrap">
  <div class="icon-glitch-wrap" id="hero-icon">
    <img class="icon-layer icon-current" id="hero-icon-current" src="">
    <img class="icon-layer icon-neighbor" id="hero-icon-neighbor" src="" style="opacity:0">
  </div>
</div>
```

CSS:
```css
.hero-icon-wrap { display: flex; justify-content: center; margin-bottom: 0.4rem; }
.icon-glitch-wrap { position: relative; width: 48px; height: 48px; }
.icon-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
              filter: drop-shadow(0 0 6px var(--color-hud-primary)); }
```

Icon `src` set by `logic.js` when weather data arrives: `ICON_BASE + ICON_MAP[wmoCode]`.

### Hourly strip icons (`index.html` + `logic.js`)

Each hourly cell replaces its SVG `<use>` element with an `.icon-glitch-wrap` div (same two-layer pattern). The `GlitchManager` registers/unregisters cells as the strip is rebuilt on each data update.

### 7-day scan bars — dot pixel fill (`index.html`)

Replace the solid `.bar-fill` background with a CSS dot grid:

```css
.bar-fill {
  background-image: radial-gradient(circle, var(--bar-color, var(--color-hud-primary)) 1.7px, transparent 1.7px);
  background-size: 4px 4px;
  background-position: 0 center;
  width: var(--fill, 0%);
  height: 100%;
  border-radius: 0; /* dots look better without radius */
}
```

Same 4px grid / 1.7px radius as `DotGraph`. The existing `--fill` and `--bar-color` CSS vars continue to drive width and colour — no JS changes needed.

### Settings panel (`settings.html`)

**localStorage key:** `koji_weather_cfg` (replaces `koji_weather_location`, `koji_weather_simulation`, `koji_weather_hourly7`)

**Default config object:**
```js
const DEFAULT_CFG = {
  location: '',
  lat: null, lon: null,
  updateInterval: 10,       // minutes: 5 | 10 | 30
  unit: 'C',                // 'C' | 'F'
  windUnit: 'kmh',          // 'kmh' | 'mph' | 'ms' | 'knots'
  precipUnit: 'mm',         // 'mm' | 'in'
  timeFormat: '24h',        // '24h' | '12h'
  hourlyCount: 5,           // 5 | 7
  forecastDays: 7,          // 3 | 5 | 7
  defaultTab: 'TMP',        // 'TMP' | 'HUM' | 'PCP' | 'WND'
  metrics: ['wind','humidity','precipitation','uv'],  // 4 of 9
  glitchIntensity: 2,       // 0=off | 1=subtle | 2=normal | 3=wild
  glitchFrequency: 1,       // 0=slow | 1=normal | 2=fast
  simulation: false,
  showSunriseSunset: true,
};
```

**Six settings sections** (scrollable panel, Chiral HUD aesthetic):

1. **LOCATION**
   - Text input: placeholder `City name or lat,lon (e.g. Berlin or 52.52,13.41)`
   - Sub-text: *"Powered by Open-Meteo — free, no API key required"*
   - `[LOCATE ME]` button — calls `navigator.geolocation.getCurrentPosition`, fills input with `lat,lon` coordinates directly (Open-Meteo accepts coordinates natively; no reverse-geocoding service needed)
   - Update interval: segmented control `5 MIN · 10 MIN · 30 MIN`

2. **UNITS**
   - Temperature: segmented `°C · °F`
   - Wind speed: segmented `KM/H · MPH · M/S · KNOTS`
   - Precipitation: segmented `MM · IN`
   - Time format: segmented `24H · 12H`

3. **FORECAST**
   - Hourly items: segmented `5 · 7`
   - Forecast days: segmented `3 · 5 · 7`
   - Default tab: segmented `TMP · HUM · PCP · WND`

4. **METRICS GRID**
   - 9 checkboxes: Wind, Humidity, Precipitation, UV, Feels Like, Pressure, Visibility, Dew Point, Cloud Cover
   - JS enforces exactly 4 selected — un-checked items disabled once 4 chosen
   - Currently-selected items shown with cyan glow

5. **GLITCH**
   - Intensity: segmented `OFF · SUBTLE · NORMAL · WILD`
   - Frequency: segmented `SLOW · NORMAL · FAST`

6. **DISPLAY**
   - Simulation toggle (with description: *"Show sample data instead of live weather"*)
   - Sunrise/sunset toggle (with description: *"Show sunrise and sunset times in hero area"*)

**Save button:** `SAVE SETTINGS` — full width, writes `koji_weather_cfg` to localStorage, calls `window.dispatchEvent(new StorageEvent('storage'))` to notify the widget immediately.

**Segmented control CSS** (shared helper):
```css
.seg-ctrl { display: flex; border: 1px solid rgba(0,191,255,0.2); border-radius: 3px; overflow: hidden; }
.seg-ctrl button { flex: 1; font-family: var(--font-tech); font-size: 0.58rem; padding: 4px 8px;
                   background: none; border: none; color: rgba(0,191,255,0.5); cursor: pointer;
                   letter-spacing: 1px; text-transform: uppercase; }
.seg-ctrl button.active { background: rgba(0,191,255,0.15); color: var(--color-hud-primary);
                           box-shadow: inset 0 0 8px rgba(0,191,255,0.2); }
```

### `logic.js` updates

- Read `koji_weather_cfg` on init; fall back to `DEFAULT_CFG`. If `koji_weather_cfg` is absent but old keys exist (`koji_weather_location`, `koji_weather_simulation`, `koji_weather_hourly7`), migrate them into a default cfg object so existing user settings are preserved.
- Listen to `storage` event to reload config live (same pattern as other modules).
- Apply `windUnit`, `precipUnit`, `timeFormat`, `forecastDays`, `defaultTab`, `hourlyCount` in render functions.
- Pass `glitchIntensity` and `glitchFrequency` to `GlitchManager` on init and update on config reload.
- Fetch Open-Meteo with `forecast_days` param driven by `cfg.forecastDays`.
- Add `feels_like`, `pressure`, `visibility`, `dewpoint`, `cloud_cover` to the API request variables so they're available for the metrics grid.
- `renderMetrics()` reads `cfg.metrics` array to decide which 4 to display.
- `showSunriseSunset` toggle shows/hides the sunrise/sunset sub-line in the hero.

---

## Part 3 — System-Stats: Graph Rendering Fix

### Root cause

Setting `canvas.width` or `canvas.height` resets the 2D context state — including any active transform. In the current code, `setTransform(dpr, 0, 0, dpr, 0, 0)` is called only inside `_onResize()`. If the ResizeObserver fires before layout is complete (clientHeight = 0), it returns early without setting the transform. Subsequent `push()` → `_draw()` calls then draw with an identity transform, so all Y coordinates are in raw buffer pixels (scaled up by DPR) rather than CSS pixels — the graph data renders in a 4–8px band instead of 36px.

### Fix (`logic.js` — `DotGraph` and `DualGraph`)

**In `_onResize`:** Only update `canvas.width`/`canvas.height` when dimensions actually changed (avoids unnecessary context reset):

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

**In `_draw`:** Apply `setTransform` at the start of every draw call (not just on resize):

```js
_draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    // ... rest of draw unchanged
}
```

Same fix applied to `DualGraph._drawChan()` — `setTransform` at the top of the method.

---

## Files Changed

| File | Changes |
|------|---------|
| `app/src-tauri/src/lib.rs` | Add `app/assets/` dev + release paths to `flux-module://` handler |
| `app/src-tauri/tauri.conf.json` | Add `"../assets": "assets"` to bundle resources |
| `themes/bridges/modules/weather/index.html` | Hero icon, two-layer glitch wrappers, dot-pixel bar CSS, settings sections |
| `themes/bridges/modules/weather/logic.js` | `GlitchManager`, `ICON_MAP`, `GLITCH_NEIGHBORS`, full `cfg` support, metrics/units/forecast rendering |
| `themes/bridges/modules/weather/settings.html` | Full settings redesign — 6 sections, `koji_weather_cfg` |
| `themes/bridges/modules/system-stats/logic.js` | Fix `DotGraph._draw` and `DualGraph._drawChan` to re-apply `setTransform` on every draw |

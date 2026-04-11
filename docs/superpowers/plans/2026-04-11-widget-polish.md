# Widget Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Approach B full polish pass across all four Koji Pro widgets — fixing data display rough edges and elevating visual polish within the existing Chiral HUD design language.

**Architecture:** Pure CSS/HTML/JS edits, one task per widget. Each widget is self-contained in its own directory. No build step, no framework, no shared state between tasks. Cross-widget patterns (opacity ladder, header accent, staggered entry) are repeated per widget.

**Tech Stack:** Vanilla HTML/CSS/JS, Tauri desktop runtime, Orbitron/Rajdhani/Share Tech Mono fonts, shared-hud.css CSS variables.

---

## File Map

| File | What changes |
|------|-------------|
| `themes/bridges/modules/time-date/index.html` | Header accent, `@keyframes`, staggered delays, glow-breathe, sol-icon, date-sep, opacity ladder |
| `themes/bridges/modules/time-date/logic.js` | Wrap `//` in `.date-sep` span; replace `☀` with `<span class="sol-icon">` |
| `themes/bridges/modules/system-stats/index.html` | Header accent, `@keyframes`, staggered delays, metric hover, bar easing, opacity ladder |
| `themes/bridges/modules/system-stats/logic.js` | Strip `IN:` / `OUT:` / `R:` value prefixes; add grid lines to `FluxGraph.draw()` |
| `themes/bridges/modules/weather/index.html` | Header accent, `@keyframes`, staggered delays, SVG icon sizing, metric icons, metric hover, scan-bar shimmer, glow normalisation, opacity ladder |
| `themes/bridges/modules/weather/logic.js` | `getWeatherText()` underscore→space; scan bar shimmer stagger in `renderScanBars()` |
| `themes/bridges/modules/ai-usage/index.html` | Header accent, `@keyframes`, staggered delays, service block hover, spark bar sizing, summary token glow, opacity ladder |
| `themes/bridges/modules/ai-usage/logic.js` | Spark bar height calculation: `16` → `20` |

---

## Task 1: CHRONOS Polish

**Files:**
- Modify: `themes/bridges/modules/time-date/index.html`
- Modify: `themes/bridges/modules/time-date/logic.js`

- [ ] **Step 1: Add header accent bar, staggered entry, glow-breathe, sol-icon, and date-sep CSS**

In `time-date/index.html`, replace the entire `<style>` block content (everything between `<style>` and `</style>`) with the following. Changes from current: adds `header::before` accent, `@keyframes section-enter`, staggered `animation` on `header`/`.time-core`/`.footer-row`, `@keyframes glow-breathe` on `#clock`, `.sol-icon`, `.date-sep`, and bumps `.footer-item` opacity from `0.55` to `0.45`:

```css
    .widget-container {
      position: relative; width: 100%; height: 100%;
      display: flex; flex-direction: column; justify-content: center; align-items: center;
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
      background: radial-gradient(ellipse closest-side at center, rgba(10,15,26,0.75) 0%, rgba(10,15,26,0.62) 30%, rgba(10,15,26,0.45) 60%, rgba(10,15,26,0.22) 85%, rgba(10,15,26,0.05) 100%);
      backdrop-filter: blur(25px);
    }
    .scanlines {
      position: absolute; inset: 0;
      background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.08) 50%);
      background-size: 100% 4px; pointer-events: none; z-index: 1;
    }
    .resizer { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: se-resize; z-index: 50; }

    @keyframes section-enter {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    header {
      position: absolute; top: 0.8rem; left: 1rem; right: 1rem;
      display: flex; justify-content: space-between; align-items: flex-end;
      border-bottom: 1px solid rgba(0,191,255,0.18);
      box-shadow: 0 1px 0 rgba(0,191,255,0.06);
      padding-bottom: 0.3rem;
      z-index: 15; pointer-events: auto;
      animation: section-enter 0.4s ease both;
    }
    header::before {
      content: ""; position: absolute; left: -1rem; top: 0; bottom: 0.3rem;
      width: 2px; background: var(--color-hud-primary);
      box-shadow: 0 0 6px var(--color-hud-primary); opacity: 0.8;
    }
    header h1 {
      font-family: var(--font-header); font-size: 0.75rem; letter-spacing: 2px;
      color: var(--color-hud-neutral); opacity: 0.7; text-transform: uppercase; cursor: pointer;
    }
    header h1:hover { opacity: 1; text-shadow: 0 0 10px var(--color-hud-primary); }

    .time-core {
      position: relative; z-index: 15;
      display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
      pointer-events: none;
      animation: section-enter 0.4s ease both; animation-delay: 60ms;
    }
    @keyframes glow-breathe {
      0%, 100% { text-shadow: 0 0 30px var(--color-hud-primary), 0 0 60px rgba(0,191,255,0.3); }
      50%       { text-shadow: 0 0 45px var(--color-hud-primary), 0 0 90px rgba(0,191,255,0.4); }
    }
    #clock {
      font-family: var(--font-header); font-weight: 900; font-size: 2.75rem;
      line-height: 1; letter-spacing: -3px;
      color: var(--color-hud-primary);
      animation: glow-breathe 4s ease-in-out infinite;
    }
    #date {
      font-family: var(--font-tech); font-size: 2rem;
      color: var(--color-hud-alert); letter-spacing: 4px;
      text-transform: uppercase; opacity: 0.9;
    }
    .date-sep { color: var(--color-hud-alert); text-shadow: 0 0 8px var(--color-hud-alert); opacity: 0.8; }

    .footer-row {
      position: absolute; bottom: 0.8rem; left: 1rem; right: 1rem;
      display: flex; justify-content: space-between; align-items: center;
      z-index: 15;
      animation: section-enter 0.4s ease both; animation-delay: 120ms;
    }
    .footer-item {
      font-family: var(--font-tech); font-size: 1.36rem;
      color: var(--color-hud-primary-soft); opacity: 0.45; letter-spacing: 1px;
      display: flex; align-items: center; gap: 0.4rem;
    }
    #sun-times { opacity: 0; transition: opacity 0.5s; }
    #sun-times.loaded { opacity: 0.45; }

    .sol-icon {
      display: inline-block; width: 10px; height: 10px; border-radius: 50%;
      background: var(--color-hud-alert);
      box-shadow:
        0 -5px 0 1px var(--color-hud-alert),
        0  5px 0 1px var(--color-hud-alert),
        -5px 0 0 1px var(--color-hud-alert),
         5px 0 0 1px var(--color-hud-alert),
        -4px -4px 0 1px var(--color-hud-alert),
         4px -4px 0 1px var(--color-hud-alert),
        -4px  4px 0 1px var(--color-hud-alert),
         4px  4px 0 1px var(--color-hud-alert);
      opacity: 0.8; flex-shrink: 0;
    }

    .bridges-bg {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
      font-family: var(--font-header); font-weight: 900; font-size: 4.5rem;
      color: var(--color-hud-primary); opacity: 0.025;
      pointer-events: none; z-index: 5; letter-spacing: -12px;
    }

    .flicker-on-mount { animation: flicker 0.3s steps(1) 3; }
    @keyframes flicker { 0%,100%{opacity:1} 50%{opacity:0} }

    /* ── Settings Overlay ── */
    .settings-overlay { position: fixed; inset: 0; z-index: 200; display: none; align-items: center; justify-content: center; background: rgba(0,3,12,0.82); backdrop-filter: blur(6px); }
    .settings-overlay.open { display: flex; animation: fadeOverlay 0.18s ease; }
    @keyframes fadeOverlay { from { opacity: 0; } to { opacity: 1; } }
    .settings-panel { width: calc(100% - 1.6rem); max-height: calc(100% - 1.6rem); background: rgba(8,12,22,0.97); border: 1px solid rgba(0,191,255,0.4); clip-path: polygon(0 0, 93% 0, 100% 7%, 100% 100%, 7% 100%, 0 93%); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 0 40px rgba(0,191,255,0.12); }
    .sp-header { display: flex; justify-content: space-between; align-items: center; padding: 0.7rem 1rem 0.55rem; border-bottom: 1px solid rgba(0,191,255,0.18); flex-shrink: 0; }
    .sp-title { font-family: var(--font-header); font-size: 0.65rem; letter-spacing: 3px; color: var(--color-hud-neutral); text-transform: uppercase; }
    .sp-close { font-family: var(--font-tech); font-size: 0.65rem; color: #FF2020; cursor: pointer; background: rgba(255,32,32,0.08); border: 1px solid rgba(255,32,32,0.3); padding: 3px 10px; transition: all 0.15s; }
    .sp-close:hover { background: rgba(255,32,32,0.2); box-shadow: 0 0 8px rgba(255,32,32,0.3); }
    .sp-body { flex: 1; overflow-y: auto; padding: 0.7rem 1rem; }
    .sp-body::-webkit-scrollbar { width: 2px; }
    .sp-body::-webkit-scrollbar-thumb { background: rgba(0,191,255,0.3); }
    .sp-section { margin-bottom: 1rem; }
    .sp-section-title { font-family: var(--font-tech); font-size: 0.55rem; letter-spacing: 2px; color: rgba(0,191,255,0.5); text-transform: uppercase; margin-bottom: 0.45rem; padding-left: 6px; border-left: 2px solid rgba(0,191,255,0.35); }
    .sp-row { display: flex; justify-content: space-between; align-items: center; padding: 0.3rem 0.5rem; margin-bottom: 0.2rem; background: rgba(0,191,255,0.03); border: 1px solid transparent; transition: all 0.15s; }
    .sp-row:hover { background: rgba(0,191,255,0.07); border-color: rgba(0,191,255,0.12); }
    .sp-label { font-family: var(--font-tech); font-size: 0.6rem; color: rgba(79,195,247,0.8); text-transform: uppercase; letter-spacing: 1px; }
    .sp-toggle { position: relative; display: inline-block; width: 40px; height: 18px; }
    .sp-toggle input { opacity: 0; width: 0; height: 0; }
    .sp-slider { position: absolute; cursor: pointer; inset: 0; background: rgba(255,255,255,0.08); border: 1px solid rgba(0,191,255,0.3); transition: 0.3s; }
    .sp-slider:before { position: absolute; content: ""; height: 10px; width: 10px; left: 3px; bottom: 3px; background: rgba(79,195,247,0.7); transition: 0.3s; }
    input:checked + .sp-slider { background: rgba(0,191,255,0.15); border-color: var(--color-hud-primary); }
    input:checked + .sp-slider:before { transform: translateX(22px); background: var(--color-hud-primary); }
    .sp-note { font-family: var(--font-tech); font-size: 0.5rem; color: rgba(0,191,255,0.3); text-align: center; padding: 0.4rem; border-top: 1px solid rgba(0,191,255,0.08); text-transform: uppercase; letter-spacing: 2px; flex-shrink: 0; }
```

- [ ] **Step 2: Update logic.js — date separator span and sol-icon**

In `time-date/logic.js`:

Replace line 18:
```js
    document.getElementById("date").textContent = `${year}.${month}.${date} // ${days[now.getDay()]}`;
```
With:
```js
    document.getElementById("date").innerHTML = `${year}.${month}.${date}<span class="date-sep"> // </span>${days[now.getDay()]}`;
```

Replace line 45:
```js
    if (el) { el.textContent = `☀ ${rise} / ${set}`; el.classList.add('loaded'); }
```
With:
```js
    if (el) { el.innerHTML = `<span class="sol-icon"></span> ${rise} / ${set}`; el.classList.add('loaded'); }
```

- [ ] **Step 3: Verify visually**

Open the Flux app, check the CHRONOS widget:
- Header has a faint left cyan accent bar
- Clock glows slowly in/out (4s cycle)
- The `//` in the date line has a subtle orange glow matching the date colour
- Sun-times footer shows a small CSS sun dot instead of the ☀ emoji
- Sections enter with a subtle upward fade on load

- [ ] **Step 4: Commit**

```bash
git add themes/bridges/modules/time-date/index.html themes/bridges/modules/time-date/logic.js
git commit -m "feat(chronos): polish pass — glow breathe, header accent, sol-icon, date-sep, staggered entry"
```

---

## Task 2: SYS.STATS Polish

**Files:**
- Modify: `themes/bridges/modules/system-stats/index.html`
- Modify: `themes/bridges/modules/system-stats/logic.js`

- [ ] **Step 1: Add header accent, staggered entry, metric hover, bar easing, opacity ladder to index.html**

In `system-stats/index.html`, add these CSS rules inside the `<style>` block. Insert them after the existing `.resizer` rule and before `.content`:

```css
    @keyframes section-enter {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .content > *:nth-child(1) { animation: section-enter 0.4s ease both; animation-delay: 0ms; }
    .content > *:nth-child(2) { animation: section-enter 0.4s ease both; animation-delay: 60ms; }
    .content > *:nth-child(3) { animation: section-enter 0.4s ease both; animation-delay: 120ms; }
    .content > *:nth-child(4) { animation: section-enter 0.4s ease both; animation-delay: 180ms; }
    .content > *:nth-child(5) { animation: section-enter 0.4s ease both; animation-delay: 240ms; }
```

Replace the existing `header` rule block (lines ~50-71) with:
```css
    header {
      display: flex; justify-content: space-between; align-items: flex-end;
      border-bottom: 1px solid rgba(0,191,255,0.18);
      box-shadow: 0 1px 0 rgba(0,191,255,0.06);
      padding-bottom: 0.4rem; flex-shrink: 0; position: relative;
    }
    header::before {
      content: ""; position: absolute; left: -1rem; top: 0; bottom: 0.4rem;
      width: 2px; background: var(--color-hud-primary);
      box-shadow: 0 0 6px var(--color-hud-primary); opacity: 0.8;
    }
    header h1 {
      font-family: var(--font-header); font-size: 0.8rem;
      letter-spacing: 2px; color: var(--color-hud-neutral);
      opacity: 0.8; text-transform: uppercase; cursor: pointer;
    }
    header h1:hover { opacity: 1; text-shadow: 0 0 10px var(--color-hud-primary); }
    .header-right { display: flex; align-items: center; gap: 0.6rem; }
    .uptime-display {
      font-family: var(--font-tech); font-size: 1.2rem;
      color: var(--color-hud-primary-soft); opacity: 0.45;
    }
    .settings-btn {
      font-size: 0.8rem; cursor: pointer;
      color: var(--color-hud-primary-soft); opacity: 0.45;
      background: none; border: none; padding: 0;
    }
    .settings-btn:hover { opacity: 1; }
```

Update the `.bar-key` rule — change opacity from `0.7` to `0.7` (already correct), and `.graph-label` opacity from `0.4` to `0.45`:
```css
    .graph-label {
      font-family: var(--font-tech); font-size: 1.1rem;
      color: var(--color-hud-primary); opacity: 0.45;
      letter-spacing: 2px; text-transform: uppercase;
      margin-bottom: 0.2rem; flex-shrink: 0;
    }
```

Update `.hero-label` opacity from `0.6` to `0.7` and `.hero-sub` opacity from `0.5` to `0.45`:
```css
    .hero-label {
      font-family: var(--font-main); font-size: 1.3rem; letter-spacing: 2px;
      color: var(--color-hud-primary-soft); opacity: 0.7;
      text-transform: uppercase; margin-top: 0.1rem;
    }
    .hero-sub {
      font-family: var(--font-tech); font-size: 1.2rem;
      color: var(--color-hud-primary-soft); opacity: 0.45; margin-top: 0.15rem;
    }
```

Update `.metric` and add hover state:
```css
    .metric {
      background: rgba(0,191,255,0.04);
      border: 1px solid rgba(0,191,255,0.08);
      border-radius: 3px; padding: 0.3rem 0.5rem;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .metric:hover {
      border-color: rgba(0,191,255,0.25);
      box-shadow: 0 0 8px rgba(0,191,255,0.12);
    }
    .metric-label {
      font-family: var(--font-tech); font-size: 1rem;
      color: var(--color-hud-primary-soft); opacity: 0.7;
      text-transform: uppercase; letter-spacing: 1px;
    }
    .metric-value {
      font-family: var(--font-tech); font-size: 1.44rem;
      color: var(--color-hud-neutral); margin-top: 0.1rem;
    }
```

Change `.bar-fill` transition easing — find:
```css
      transition: width 0.4s ease, background 0.4s ease;
```
Replace with:
```css
      transition: width 0.4s cubic-bezier(0.2, 0, 0.4, 1), background 0.4s ease;
```

- [ ] **Step 2: Strip value prefixes in logic.js**

In `system-stats/logic.js`:

Replace line 186-187:
```js
  document.getElementById("net-in").textContent  = `IN: ${fmtBS(netIn)}`;
  document.getElementById("net-out").textContent = `OUT: ${fmtBS(netOut)}`;
```
With:
```js
  document.getElementById("net-in").textContent  = fmtBS(netIn);
  document.getElementById("net-out").textContent = fmtBS(netOut);
```

Replace line 196:
```js
  document.getElementById("disk-read").textContent  = `R: ${fmtBS(read)}`;
```
With:
```js
  document.getElementById("disk-read").textContent  = fmtBS(read);
```

- [ ] **Step 3: Add grid lines to FluxGraph.draw()**

In `system-stats/logic.js`, inside `FluxGraph.draw(max, color)` — after the `clearRect` call on line 66 and before the `if (this.history.length < 2) return;` guard on line 67, insert:

```js
    // Grid lines at 25%, 50%, 75%
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(0,191,255,0.06)';
    this.ctx.lineWidth = 1;
    [0.25, 0.50, 0.75].forEach(frac => {
      const y = h - frac * h;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(w, y);
      this.ctx.stroke();
    });
    this.ctx.restore();
```

The full updated `draw` method should look like:
```js
  draw(max, color) {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    this.ctx.clearRect(0, 0, w, h);

    // Grid lines at 25%, 50%, 75%
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(0,191,255,0.06)';
    this.ctx.lineWidth = 1;
    [0.25, 0.50, 0.75].forEach(frac => {
      const y = h - frac * h;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(w, y);
      this.ctx.stroke();
    });
    this.ctx.restore();

    if (this.history.length < 2) return;
    // ... rest of method unchanged
```

- [ ] **Step 4: Verify visually**

Open SYS.STATS widget:
- Header has a left cyan accent bar
- Sections enter with staggered fade-up on load
- Metric cards (NET IN, NET OUT, DISK R/W, RAM USED) show values without prefixes — "1.6 KB/s" not "IN: 1.6 KB/s"
- Metric cards show a subtle glow border on hover
- CPU history graph has faint horizontal lines at 25%, 50%, 75%
- Bar fills animate with a snappier easing

- [ ] **Step 5: Commit**

```bash
git add themes/bridges/modules/system-stats/index.html themes/bridges/modules/system-stats/logic.js
git commit -m "feat(sys-stats): polish pass — header accent, staggered entry, metric hover, strip prefixes, graph grid"
```

---

## Task 3: WEATHER Polish

**Files:**
- Modify: `themes/bridges/modules/weather/index.html`
- Modify: `themes/bridges/modules/weather/logic.js`

- [ ] **Step 1: Add header accent, staggered entry, SVG icon sizing, metric icons, hover states, scan shimmer, glow normalisation to index.html**

In `weather/index.html`, add inside the `<style>` block after the `.resizer` rule:

```css
    @keyframes section-enter {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .content > *:nth-child(1) { animation: section-enter 0.4s ease both; animation-delay: 0ms; }
    .content > *:nth-child(2) { animation: section-enter 0.4s ease both; animation-delay: 60ms; }
    .content > *:nth-child(3) { animation: section-enter 0.4s ease both; animation-delay: 120ms; }
    .content > *:nth-child(4) { animation: section-enter 0.4s ease both; animation-delay: 180ms; }
    .content > *:nth-child(5) { animation: section-enter 0.4s ease both; animation-delay: 240ms; }

    @keyframes scan-bar-enter {
      from { transform: scaleY(0); }
      to   { transform: scaleY(1); }
    }
    .scan-bar { transform-origin: bottom; }
    .scan-bar[data-new] { animation: scan-bar-enter 0.4s cubic-bezier(0.2, 0, 0.4, 1) both; }

    .metric-icon {
      opacity: 0.45; margin-right: 0.3rem;
      font-family: var(--font-tech); font-size: 1.4rem;
    }
```

Replace the existing `header` rule block with:
```css
    header {
      display: flex; justify-content: space-between; align-items: flex-end;
      border-bottom: 1px solid rgba(0,191,255,0.18);
      box-shadow: 0 1px 0 rgba(0,191,255,0.06);
      padding-bottom: 0.4rem; flex-shrink: 0; position: relative;
    }
    header::before {
      content: ""; position: absolute; left: -1.4rem; top: 0; bottom: 0.4rem;
      width: 2px; background: var(--color-hud-primary);
      box-shadow: 0 0 6px var(--color-hud-primary); opacity: 0.8;
    }
    header h1 {
      font-family: var(--font-header); font-size: 0.8rem; letter-spacing: 2px;
      color: var(--color-hud-neutral); opacity: 0.8; text-transform: uppercase; cursor: pointer;
    }
    header h1:hover { opacity: 1; text-shadow: 0 0 10px var(--color-hud-primary); }
    .header-right { display: flex; align-items: center; gap: 0.8rem; }
```

Normalise the temperature hero glow — replace the `.temp-value` rule:
```css
    .temp-value {
      font-family: var(--font-header); font-weight: 900; font-size: 3rem; line-height: 1;
      color: var(--current-glow, var(--color-hud-primary));
      text-shadow: 0 0 30px var(--current-glow, var(--color-hud-primary)), 0 0 60px color-mix(in srgb, var(--current-glow, var(--color-hud-primary)) 30%, transparent);
      transition: color 1s ease, text-shadow 1s ease;
    }
```

Update `.hourly-icon` to size the existing SVGs correctly:
```css
    .hourly-icon { font-size: 1rem; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
    .hourly-icon svg { width: 20px; height: 20px; display: block; }
```

Update `.weather-condition` and `.location-display` opacity for ladder:
```css
    .weather-condition {
      font-family: var(--font-tech); font-size: 1.7rem; letter-spacing: 2px;
      color: var(--color-hud-primary-soft); margin-top: 0.2rem; text-transform: uppercase; opacity: 0.7;
    }
    .location-display {
      font-family: var(--font-tech); font-size: 1.5rem; color: var(--color-hud-primary-soft);
      opacity: 0.45; letter-spacing: 1px; text-transform: uppercase;
    }
    .feels-like { font-family: var(--font-tech); font-size: 1.5rem; color: var(--color-hud-primary-soft); opacity: 0.45; }
```

Update `.section-label` opacity:
```css
    .section-label {
      font-family: var(--font-tech); font-size: 1.3rem; letter-spacing: 2px;
      color: var(--color-hud-primary); opacity: 0.45; text-transform: uppercase; margin-bottom: 0.4rem;
    }
```

Add `.metric-item` hover state:
```css
    .metric-item {
      background: rgba(0,191,255,0.05); border: 1px solid rgba(0,191,255,0.1);
      border-radius: 4px; padding: 0.5rem 0.6rem;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .metric-item:hover {
      border-color: rgba(0,191,255,0.25);
      box-shadow: 0 0 8px rgba(0,191,255,0.12);
    }
    .metric-label { font-family: var(--font-tech); font-size: 1.2rem; letter-spacing: 1px; color: var(--color-hud-primary-soft); opacity: 0.7; text-transform: uppercase; }
    .metric-value { font-family: var(--font-tech); font-size: 1.8rem; color: var(--color-hud-neutral); margin-top: 0.15rem; }
```

- [ ] **Step 2: Add metric icon spans to the 4 metric items in index.html**

In `weather/index.html`, find the metrics-grid section and update it to:
```html
      <div class="metrics-grid">
        <div class="metric-item"><div class="metric-label">WIND</div><div class="metric-value" id="metric-wind"><span class="metric-icon">↗</span>--</div></div>
        <div class="metric-item"><div class="metric-label">HUMIDITY</div><div class="metric-value" id="metric-humidity"><span class="metric-icon">≋</span>--</div></div>
        <div class="metric-item"><div class="metric-label">PRECIP</div><div class="metric-value" id="metric-precip"><span class="metric-icon">↓</span>--</div></div>
        <div class="metric-item"><div class="metric-label">UV INDEX</div><div class="metric-value" id="metric-uv"><span class="metric-icon">◉</span>--</div></div>
      </div>
```

- [ ] **Step 3: Update weather logic.js — condition text and scan bar shimmer**

In `weather/logic.js`, update `getWeatherText()` — add `.replace(/_/g, ' ')` to each return value:

```js
const getWeatherText = (code) => {
  if (code === 0)                    return 'CLEAR SKY';
  if (code >= 1  && code <= 3)       return 'PARTLY CLOUDY';
  if (code >= 51 && code <= 67)      return 'PRECIPITATION';
  if (code >= 71 && code <= 77)      return 'SNOWFALL';
  if (code >= 95)                    return 'THUNDERSTORM';
  return 'UNKNOWN ANOMALY';
};
```

Add a first-render flag above `let state = {` (around line 41):
```js
let _scanBarsInitialized = false;
```

In `renderScanBars()`, update the `barsEl.innerHTML` assignment (currently line 216) to add shimmer on first render:

```js
  const isNew = !_scanBarsInitialized;
  _scanBarsInitialized = true;

  barsEl.innerHTML = daily.map((d, i) => {
    const pct   = Math.max(5, (values[i] / maxVal) * 100);
    const color = mode === 'temp' ? getGlowColor(d.max)
                : mode === 'wind' ? 'var(--color-hud-alert)'
                : 'var(--color-hud-primary)';
    const newAttr  = isNew ? 'data-new="1"' : '';
    const delayStyle = isNew ? `animation-delay:${i * 40}ms` : '';
    return `<div class="scan-bar${i === 0 ? ' current' : ''}" ${newAttr} style="height:${pct}%;background:${color};${delayStyle}"></div>`;
  }).join('');
```

Also update metric value setters in `render()` to preserve the icon spans. Find lines 194-197 and replace:
```js
  if (mWind)   mWind.innerHTML   = `<span class="metric-icon">↗</span>${state.weather.windSpeed.toFixed(1)} km/h`;
  if (mHum)    mHum.innerHTML    = `<span class="metric-icon">≋</span>${state.weather.humidity}%`;
  if (mPrecip) mPrecip.innerHTML = `<span class="metric-icon">↓</span>${state.weather.precipitation} mm`;
  if (mUV)     mUV.innerHTML     = `<span class="metric-icon">◉</span>${state.weather.uvIndex?.toFixed(1) ?? '--'}`;
```

- [ ] **Step 4: Verify visually**

Open WEATHER widget:
- Header has a left cyan accent bar
- Sections enter with staggered fade-up on load
- Hourly icons render at 20×20px (the SVGs that were already in logic.js, now properly sized)
- Condition text shows `CLEAR SKY` not `CLEAR_SKY`
- Metric cards show icon glyphs: ↗, ≋, ↓, ◉ before their values
- Metric cards show glow border on hover
- On first load, the 7-day scan bars sweep up one by one (40ms stagger)
- Temperature hero glow is consistent with other widgets

- [ ] **Step 5: Commit**

```bash
git add themes/bridges/modules/weather/index.html themes/bridges/modules/weather/logic.js
git commit -m "feat(weather): polish pass — header accent, staggered entry, metric icons, scan shimmer, condition text, glow normalise"
```

---

## Task 4: AI.OPS Polish

**Files:**
- Modify: `themes/bridges/modules/ai-usage/index.html`

- [ ] **Step 1: Update logic.js — spark bar max height**

In `ai-usage/logic.js`, `renderSpark()` calculates bar height against a hardcoded `16`. Update to `20` to match the new CSS height:

Replace line 57:
```js
    const h = Math.max(2, Math.round((v / max) * 16));
```
With:
```js
    const h = Math.max(2, Math.round((v / max) * 20));
```

- [ ] **Step 2: Add header accent, staggered entry, service hover, spark sizing, summary glow**

In `ai-usage/index.html`, add inside the `<style>` block after the `.resizer` rule:

```css
    @keyframes section-enter {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .content > *:nth-child(1) { animation: section-enter 0.4s ease both; animation-delay: 0ms; }
    .content > *:nth-child(2) { animation: section-enter 0.4s ease both; animation-delay: 60ms; }
    .content > *:nth-child(3) { animation: section-enter 0.4s ease both; animation-delay: 120ms; }
    .content > *:nth-child(4) { animation: section-enter 0.4s ease both; animation-delay: 180ms; }
```

Replace the existing `header` rule with:
```css
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid rgba(0,191,255,0.18); box-shadow: 0 1px 0 rgba(0,191,255,0.06); padding-bottom: 0.4rem; flex-shrink: 0; position: relative; }
    header::before { content: ""; position: absolute; left: -1rem; top: 0; bottom: 0.4rem; width: 2px; background: var(--color-hud-primary); box-shadow: 0 0 6px var(--color-hud-primary); opacity: 0.8; }
    header h1 { font-family: var(--font-header); font-size: 0.8rem; letter-spacing: 2px; color: var(--color-hud-neutral); opacity: 0.8; text-transform: uppercase; cursor: pointer; }
    header h1:hover { opacity: 1; text-shadow: 0 0 10px var(--color-hud-primary); }
    .settings-btn { font-size: 0.8rem; cursor: pointer; color: var(--color-hud-primary-soft); opacity: 0.45; background: none; border: none; padding: 0; }
    .settings-btn:hover { opacity: 1; }
```

Replace the `.service` and `.service + .service` rules with:
```css
    .service { flex-shrink: 0; padding: 0.5rem 0 0.5rem 0.5rem; border-left: 2px solid transparent; transition: border-color 0.2s, background 0.2s; }
    .service + .service { border-top: 1px solid rgba(0,191,255,0.18); }
    .service:hover { background: rgba(0,191,255,0.03); border-left-color: rgba(0,191,255,0.3); }
```

Update `.service-name` opacity:
```css
    .service-name { font-family: var(--font-header); font-size: 0.75rem; letter-spacing: 2px; color: var(--color-hud-neutral); text-transform: uppercase; opacity: 0.8; }
```

Update `.usage-bar-key` opacity and `.rate-val` opacity:
```css
    .usage-bar-key { font-family: var(--font-tech); font-size: 1.16rem; color: var(--color-hud-primary-soft); opacity: 0.7; width: 2.2rem; flex-shrink: 0; text-transform: uppercase; }
    .rate-val { font-family: var(--font-tech); font-size: 1.3rem; color: var(--color-hud-primary-soft); opacity: 0.45; }
```

Replace `.spark` and `.spark-bar` rules:
```css
    .spark { display: flex; align-items: flex-end; gap: 2px; height: 20px; }
    .spark-bar { width: 8px; background: var(--color-hud-primary); opacity: 0.45; border-radius: 1px; min-height: 2px; }
    .spark-bar.today { opacity: 1; box-shadow: 0 0 4px var(--color-hud-primary); border-top: 2px solid rgba(255,255,255,0.4); }
```

Update `.summary` border and `.last-updated` opacity:
```css
    .summary { margin-top: auto; padding-top: 0.5rem; border-top: 1px solid rgba(0,191,255,0.18); flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; }
    .summary-text { font-family: var(--font-tech); font-size: 1.4rem; color: var(--color-hud-primary-soft); opacity: 0.7; }
    .summary-text span { color: var(--color-hud-neutral); opacity: 1; text-shadow: 0 0 10px rgba(0,191,255,0.4); }
    .last-updated { font-family: var(--font-tech); font-size: 1.1rem; color: var(--color-hud-primary-soft); opacity: 0.45; }
```

- [ ] **Step 3: Verify visually**

Open AI.OPS widget:
- Header has a left cyan accent bar
- Sections enter with staggered fade-up on load
- Hovering a service block (CLAUDE / GEMINI) adds a faint left accent bar and background lift
- The service separator borders are slightly more visible
- Spark bars are taller and wider; the current-day bar has a white highlight cap at top
- The token total in the summary row has a faint cyan glow

- [ ] **Step 4: Commit**

```bash
git add themes/bridges/modules/ai-usage/index.html themes/bridges/modules/ai-usage/logic.js
git commit -m "feat(ai-ops): polish pass — header accent, staggered entry, service hover, spark bars, summary glow"
```

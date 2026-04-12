# SYS.STATS btop Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-graph + metrics-grid layout with a btop-inspired 5-section streaming dot-matrix layout (CPU, GPU, MEM, NET, DISK), each with its own live canvas graph.

**Architecture:** All changes are isolated to two files — `index.html` (CSS + HTML structure) and `logic.js` (graph engine + subscription wiring). No new files, no build step. `FluxGraph` is replaced by `DotGraph` (single channel) and `DualGraph` (dual channel, outward from centre). All existing WidgetAPI subscriptions are kept.

**Tech Stack:** Vanilla HTML/CSS/JS, Canvas 2D API, ResizeObserver, `WidgetAPI.system.subscribe()`

---

## Files Changed

| File | What changes |
|------|-------------|
| `themes/bridges/modules/system-stats/index.html` | Remove old graph/metric CSS; add new section/graph CSS; replace layout HTML |
| `themes/bridges/modules/system-stats/logic.js` | Replace `FluxGraph` with `DotGraph` + `DualGraph`; update subscription callbacks + DOM IDs |

---

## Reference: Spec

Full spec: `docs/superpowers/specs/2026-04-11-sys-stats-btop-layout.md`

Key IDs used in the new HTML (for logic.js):

| Element | ID |
|---------|-----|
| CPU hero value | `cpu-usage` |
| CPU freq span | `cpu-freq` |
| CPU temp span | `cpu-temp` |
| CPU bar fill | `cpu-bar-fill` |
| CPU bar meta | `cpu-bar-meta` |
| GPU temp label | `gpu-temp-label` |
| GPU VRAM bar fill | `gpu-bar-fill` |
| GPU VRAM pct meta | `gpu-vram-pct` |
| MEM total label | `mem-total-label` |
| MEM used bar fill | `mem-used-fill` |
| MEM used value | `mem-used-val` |
| MEM avail bar fill | `mem-avail-fill` |
| MEM avail value | `mem-avail-val` |
| NET in label | `net-in-val` |
| NET out label | `net-out-val` |
| DISK read bar fill | `disk-read-fill` |
| DISK read value | `disk-read-val` |
| DISK write bar fill | `disk-write-fill` |
| DISK write value | `disk-write-val` |
| CPU DotGraph canvas | `g-cpu` |
| GPU DotGraph canvas | `g-gpu` |
| MEM DualGraph channel A canvas | `g-mem-a` |
| MEM DualGraph channel B canvas | `g-mem-b` |
| NET DualGraph channel A canvas | `g-net-a` |
| NET DualGraph channel B canvas | `g-net-b` |
| DISK DualGraph channel A canvas | `g-disk-a` |
| DISK DualGraph channel B canvas | `g-disk-b` |

---

## Task 1: CSS — Remove old styles, add new graph/section styles

**Files:**
- Modify: `themes/bridges/modules/system-stats/index.html` (lines 129–173)

- [ ] **Step 1: Remove the seven obsolete CSS blocks**

In `index.html`, delete exactly these blocks from the `<style>` tag (leave everything else untouched):

```css
/* DELETE this block: */
.graph-section {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
}
.graph-label {
  font-family: var(--font-tech); font-size: 1.1rem;
  color: var(--color-hud-primary); opacity: 0.45;
  letter-spacing: 2px; text-transform: uppercase;
  margin-bottom: 0.2rem; flex-shrink: 0;
}
.graph-wrap {
  flex: 1; min-height: 0; position: relative;
}
.graph-wrap canvas {
  width: 100%; height: 100%; display: block;
  position: absolute; inset: 0;
}

/* DELETE this block: */
.hidden-graphs { width: 1px; height: 1px; overflow: hidden; position: absolute; opacity: 0; pointer-events: none; }

/* DELETE this block: */
.metrics-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; flex-shrink: 0;
}
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

- [ ] **Step 2: Add new CSS blocks**

Immediately before the `.flicker-on-mount` line, add:

```css
/* Dot-matrix graph canvas */
.dmg {
  width: 100%; height: 36px; display: block;
  border: 1px solid rgba(0,191,255,0.1);
  background: rgba(0,191,255,0.03);
  border-radius: 2px;
  margin-top: 0.2rem; margin-bottom: 0.1rem;
}

/* Dual graph wrapper */
.dual-wrap {
  position: relative; width: 100%; height: 44px;
  border: 1px solid rgba(0,191,255,0.1);
  background: rgba(0,191,255,0.03);
  border-radius: 2px;
  margin-top: 0.2rem; overflow: hidden;
}
.dual-center {
  position: absolute; left: 0; right: 0; top: 50%; height: 1px;
  background: rgba(0,191,255,0.35);
  box-shadow: 0 0 4px rgba(0,191,255,0.4); z-index: 2;
}
.dual-up, .dual-down {
  position: absolute; left: 0; right: 0; height: 50%; overflow: hidden;
}
.dual-up   { top: 0; }
.dual-down { bottom: 0; }
.dual-up   canvas,
.dual-down canvas { display: block; width: 100%; height: 100%; }

/* Graph stat labels below graphs */
.glabels {
  display: flex; justify-content: space-between; margin-top: 0.15rem;
}
.glbl { font-family: var(--font-tech); font-size: 0.55rem; opacity: 0.7; }

/* Section divider */
.sec-div {
  height: 1px; background: rgba(0,191,255,0.1);
  margin: 0.1rem 0; flex-shrink: 0;
}

/* Section title row */
.sec-t {
  font-family: var(--font-tech); font-size: 0.56rem; opacity: 0.45;
  letter-spacing: 2px; text-transform: uppercase;
  display: flex; justify-content: space-between; margin-bottom: 0.25rem;
  flex-shrink: 0;
}
.sec-t span { color: var(--color-hud-primary); opacity: 0.7; font-size: 0.54rem; letter-spacing: 0; }

/* MEM bar gradient overrides (width still controlled by --fill) */
.bar-fill.mem-used {
  background: linear-gradient(to right, #e60012, #FF6B1A, #FFD700);
  box-shadow: 0 0 5px #FF6B1A;
}
.bar-fill.mem-avail {
  background: linear-gradient(to right, #005596, #00BFFF);
  box-shadow: 0 0 5px #00BFFF;
}
```

- [ ] **Step 3: Verify no CSS syntax errors**

Open `themes/bridges/modules/system-stats/index.html` in a browser (File → Open). Open DevTools console. Confirm no CSS parse errors. The page will look broken (no content yet) — that's fine.

- [ ] **Step 4: Commit**

```bash
git add themes/bridges/modules/system-stats/index.html
git commit -m "feat(sys-stats): add btop graph CSS, remove obsolete graph/metric CSS"
```

---

## Task 2: HTML layout — Replace the 3-section body with the 5-section btop layout

**Files:**
- Modify: `themes/bridges/modules/system-stats/index.html` (body content)

- [ ] **Step 1: Replace the `<div class="content">` inner HTML**

The current `<div class="content">` contains: header, hero, scan-bars, graph-section, metrics-row. The `hidden-graphs` div is a sibling of `content`.

Replace everything inside `<div class="content">` (keeping the div itself) AND remove the `hidden-graphs` div with the following:

```html
    <div class="content">
      <header>
        <h1 id="open-settings" data-open-settings>KOJI // SYS.STATS</h1>
        <div class="header-right">
          <div class="uptime-display">UP: <span id="uptime">00:00:00</span></div>
          <button class="settings-btn" data-open-settings>⚙</button>
        </div>
      </header>

      <!-- CPU SECTION -->
      <div class="hero">
        <div class="hero-value" id="cpu-usage">--%</div>
        <div class="hero-label">CPU LOAD</div>
        <div class="hero-sub"><span id="cpu-freq">-- GHz</span> &nbsp;|&nbsp; <span id="cpu-temp">--°C</span></div>
      </div>
      <div class="scan-bars">
        <div class="bar-row">
          <div class="bar-key">CPU</div>
          <div class="bar-track"><div class="bar-fill" id="cpu-bar-fill"></div></div>
          <div class="bar-meta" id="cpu-bar-meta">--%</div>
        </div>
      </div>
      <canvas class="dmg" id="g-cpu"></canvas>

      <!-- GPU SECTION -->
      <div class="sec-div"></div>
      <div class="sec-t">GPU <span id="gpu-temp-label">--°C</span></div>
      <div class="scan-bars">
        <div class="bar-row">
          <div class="bar-key">VRAM</div>
          <div class="bar-track"><div class="bar-fill" id="gpu-bar-fill"></div></div>
          <div class="bar-meta" id="gpu-vram-pct">--%</div>
        </div>
      </div>
      <canvas class="dmg" id="g-gpu"></canvas>

      <!-- MEM SECTION -->
      <div class="sec-div"></div>
      <div class="sec-t">MEM <span id="mem-total-label">-- GiB</span></div>
      <div class="scan-bars">
        <div class="bar-row">
          <div class="bar-key">USED</div>
          <div class="bar-track"><div class="bar-fill mem-used" id="mem-used-fill"></div></div>
          <div class="bar-meta" id="mem-used-val">-- GiB</div>
        </div>
        <div class="bar-row">
          <div class="bar-key">AVAIL</div>
          <div class="bar-track"><div class="bar-fill mem-avail" id="mem-avail-fill"></div></div>
          <div class="bar-meta" id="mem-avail-val">-- GiB</div>
        </div>
      </div>
      <div class="dual-wrap">
        <div class="dual-center"></div>
        <div class="dual-up"><canvas id="g-mem-a"></canvas></div>
        <div class="dual-down"><canvas id="g-mem-b"></canvas></div>
      </div>
      <div class="glabels">
        <div class="glbl" style="color:var(--color-hud-caution)">▲ USED</div>
        <div class="glbl" style="color:var(--color-hud-primary)">AVAIL ▼</div>
      </div>

      <!-- NET SECTION -->
      <div class="sec-div"></div>
      <div class="sec-t">NET</div>
      <div class="dual-wrap">
        <div class="dual-center"></div>
        <div class="dual-up"><canvas id="g-net-a"></canvas></div>
        <div class="dual-down"><canvas id="g-net-b"></canvas></div>
      </div>
      <div class="glabels">
        <div class="glbl" style="color:var(--color-hud-primary)">▲ IN &nbsp;<span id="net-in-val">-- B/s</span></div>
        <div class="glbl" style="color:var(--color-hud-alert)">OUT <span id="net-out-val">-- B/s</span> ▼</div>
      </div>

      <!-- DISK SECTION -->
      <div class="sec-div"></div>
      <div class="sec-t">DISK</div>
      <div class="scan-bars">
        <div class="bar-row">
          <div class="bar-key">READ</div>
          <div class="bar-track"><div class="bar-fill" id="disk-read-fill"></div></div>
          <div class="bar-meta" id="disk-read-val">-- B/s</div>
        </div>
        <div class="bar-row">
          <div class="bar-key">WRITE</div>
          <div class="bar-track"><div class="bar-fill" id="disk-write-fill"></div></div>
          <div class="bar-meta" id="disk-write-val">-- B/s</div>
        </div>
      </div>
      <div class="dual-wrap">
        <div class="dual-center"></div>
        <div class="dual-up"><canvas id="g-disk-a"></canvas></div>
        <div class="dual-down"><canvas id="g-disk-b"></canvas></div>
      </div>
      <div class="glabels">
        <div class="glbl" style="color:var(--color-hud-primary)">▲ READ</div>
        <div class="glbl" style="color:var(--color-hud-alert)">WRITE ▼</div>
      </div>
    </div>
```

- [ ] **Step 2: Verify layout renders**

Open `index.html` in a browser. Paste this mock into DevTools console to stub WidgetAPI and run `logic.js` won't crash when loaded:

```js
window.WidgetAPI = {
  system: {
    subscribe: () => () => {},
    uptime: () => Promise.resolve(0)
  },
  widget: { drag: () => {}, openSettings: () => {}, resize: () => {} }
};
```

Expected: Five labelled sections visible — CPU (hero + bar + empty canvas), GPU (sec-t + bar + canvas), MEM (sec-t + 2 bars + dual-wrap + glabels), NET (sec-t + dual-wrap + glabels), DISK (sec-t + 2 bars + dual-wrap + glabels). No console errors from HTML.

- [ ] **Step 3: Commit**

```bash
git add themes/bridges/modules/system-stats/index.html
git commit -m "feat(sys-stats): replace 3-section layout with 5-section btop layout"
```

---

## Task 3: Graph engine — Replace FluxGraph with DotGraph + DualGraph in logic.js

**Files:**
- Modify: `themes/bridges/modules/system-stats/logic.js` (lines 38–108)

- [ ] **Step 1: Delete the FluxGraph class**

Remove the entire `FluxGraph` block (lines 38–108):

```js
// DELETE — start
class FluxGraph {
  ...
}
// DELETE — end
```

- [ ] **Step 2: Insert the DotGraph class**

In the exact location where `FluxGraph` was, add:

```js
// --- Graph Engine ---
class DotGraph {
  constructor(canvas, color, max) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = color; // CSS color with 'ALPHA' placeholder, e.g. 'rgba(0,191,255,ALPHA)'
    this.max = max;
    this.history = [];
    this._ro = new ResizeObserver(() => this._onResize());
    this._ro.observe(canvas);
    this._onResize();
  }

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

  push(value) {
    this.history.push(value);
    if (this.history.length > 80) this.history.shift();
    this._draw();
  }

  _draw() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.ctx.clearRect(0, 0, w, h);

    const DOT = 4, R = 1.7;
    const numCols = Math.floor(w / DOT);
    const numRows = Math.floor(h / DOT);

    // Horizontal guide lines at 25%, 50%, 75%
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(0,191,255,0.07)';
    this.ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(f => {
      const y = h - f * h;
      this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(w, y); this.ctx.stroke();
    });
    this.ctx.restore();

    const slice = this.history.slice(-numCols);
    for (let ci = 0; ci < slice.length; ci++) {
      const colX = (numCols - slice.length + ci) * DOT;
      const filled = Math.round((Math.min(slice[ci], this.max) / this.max) * numRows);
      for (let ri = 0; ri < filled; ri++) {
        const alpha = 0.25 + (ri / Math.max(filled - 1, 1)) * 0.55;
        this.ctx.fillStyle = this.color.replace('ALPHA', alpha.toFixed(2));
        this.ctx.beginPath();
        this.ctx.arc(colX + DOT / 2, h - (ri + 0.5) * DOT, R, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }
}

class DualGraph {
  constructor(canvasA, canvasB, colorA, colorB, initialMax) {
    this.canvasA = canvasA;
    this.canvasB = canvasB;
    this.ctxA = canvasA.getContext('2d');
    this.ctxB = canvasB.getContext('2d');
    this.colorA = colorA; // 'rgba(0,191,255,ALPHA)'
    this.colorB = colorB; // 'rgba(255,107,26,ALPHA)'
    this.max = initialMax || 1;
    this.fixedMax = null; // set externally to pin scale (e.g. total RAM)
    this.histA = [];
    this.histB = [];
    this._ro = new ResizeObserver(() => this._onResize());
    this._ro.observe(canvasA);
    this._ro.observe(canvasB);
    this._onResize();
  }

  _onResize() {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvasA, this.canvasB]) {
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) continue;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.ctxA.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctxB.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._draw();
  }

  push(a, b) {
    this.histA.push(a); this.histB.push(b);
    if (this.histA.length > 80) { this.histA.shift(); this.histB.shift(); }
    if (!this.fixedMax) {
      this.max = Math.max(1, ...this.histA.slice(-60), ...this.histB.slice(-60));
    } else {
      this.max = this.fixedMax;
    }
    this._draw();
  }

  _drawChan(ctx, canvas, hist, color, fromTop) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const DOT = 4, R = 1.7;
    const numCols = Math.floor(w / DOT);
    const numRows = Math.floor(h / DOT);
    const slice = hist.slice(-numCols);
    for (let ci = 0; ci < slice.length; ci++) {
      const colX = (numCols - slice.length + ci) * DOT;
      const filled = Math.round((Math.min(slice[ci], this.max) / this.max) * numRows);
      for (let ri = 0; ri < filled; ri++) {
        const alpha = 0.25 + (ri / Math.max(filled - 1, 1)) * 0.55;
        ctx.fillStyle = color.replace('ALPHA', alpha.toFixed(2));
        const dotY = fromTop ? (ri + 0.5) * DOT : h - (ri + 0.5) * DOT;
        ctx.beginPath();
        ctx.arc(colX + DOT / 2, dotY, R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _draw() {
    this._drawChan(this.ctxA, this.canvasA, this.histA, this.colorA, false); // A: bottom→up
    this._drawChan(this.ctxB, this.canvasB, this.histB, this.colorB, true);  // B: top→down
  }
}
```

- [ ] **Step 3: Verify graph classes in isolation**

Open `index.html` in a browser. In DevTools console, run:

```js
// Mock WidgetAPI first
window.WidgetAPI = {
  system: { subscribe: () => () => {}, uptime: () => Promise.resolve(0) },
  widget: { drag: () => {}, openSettings: () => {}, resize: () => {} }
};
```

Reload the page (so `logic.js` runs with the mock). Then in console:

```js
// Push 20 fake values to CPU dot graph
for (let i = 0; i < 20; i++) gCpu.push(Math.random() * 100);
// Push 20 fake pairs to NET dual graph
for (let i = 0; i < 20; i++) gNet.push(Math.random() * 500000, Math.random() * 200000);
```

Expected: CPU canvas fills with cyan dot columns growing from the bottom. NET dual-wrap shows dots in top canvas growing from bottom edge (center), dots in bottom canvas growing from top edge (center). No console errors.

- [ ] **Step 4: Commit**

```bash
git add themes/bridges/modules/system-stats/logic.js
git commit -m "feat(sys-stats): replace FluxGraph with DotGraph + DualGraph canvas graph engine"
```

---

## Task 4: Subscription wiring — update subscriptions and DOM bindings

**Files:**
- Modify: `themes/bridges/modules/system-stats/logic.js`

- [ ] **Step 1: Replace the old graph instantiations**

Remove these five lines (after the `_unlisteners` / `_uptimeInterval` declarations):

```js
// DELETE:
const cpuGraph = new FluxGraph("cpu-graph");
const ramGraph = new FluxGraph("ram-graph");
const gpuGraph = new FluxGraph("gpu-graph");
const netGraph = new FluxGraph("net-graph");
const diskGraph = new FluxGraph("disk-graph");
```

Add in their place:

```js
const gCpu  = new DotGraph(document.getElementById('g-cpu'),  'rgba(0,191,255,ALPHA)', 100);
const gGpu  = new DotGraph(document.getElementById('g-gpu'),  'rgba(0,191,255,ALPHA)', 100);
const gMem  = new DualGraph(
  document.getElementById('g-mem-a'), document.getElementById('g-mem-b'),
  'rgba(255,107,26,ALPHA)', 'rgba(0,191,255,ALPHA)', 1
);
const gNet  = new DualGraph(
  document.getElementById('g-net-a'), document.getElementById('g-net-b'),
  'rgba(0,191,255,ALPHA)', 'rgba(255,107,26,ALPHA)', 1
);
const gDisk = new DualGraph(
  document.getElementById('g-disk-a'), document.getElementById('g-disk-b'),
  'rgba(0,191,255,ALPHA)', 'rgba(255,107,26,ALPHA)', 1
);
```

- [ ] **Step 2: Add `setBarWidth` and `dotColor` helpers**

After the existing `setBar` function, add:

```js
// For bars with CSS gradient (MEM) — only updates width, not color
function setBarWidth(fillId, metaId, pct, metaText) {
  const fill = document.getElementById(fillId);
  const meta = document.getElementById(metaId);
  if (fill) fill.style.setProperty('--fill', Math.min(100, Math.max(0, pct)) + '%');
  if (meta) meta.textContent = metaText;
}

// Returns rgba color string (with ALPHA placeholder) for dot graphs
// Uses same thresholds as getStatusColor but avoids CSS var comparison
function dotColor(val, temp) {
  if (val >= cfg.redUsage   || (temp && temp >= cfg.redTemp))   return 'rgba(255,32,32,ALPHA)';
  if (val >= cfg.amberUsage || (temp && temp >= cfg.amberTemp)) return 'rgba(255,193,7,ALPHA)';
  return 'rgba(0,191,255,ALPHA)';
}
```

- [ ] **Step 3: Update the CPU subscription**

Replace the existing `WidgetAPI.system.subscribe('cpu', ...)` callback:

```js
_unlisteners.push(WidgetAPI.system.subscribe('cpu', (data) => {
  const cpuPct  = data.avg_usage;
  const cpuTemp = data.cpu_temp || 0;

  document.getElementById('cpu-usage').textContent = `${cpuPct.toFixed(1)}%`;
  document.getElementById('cpu-temp').textContent  = `${cpuTemp.toFixed(0)}°C`;
  document.getElementById('cpu-freq').textContent  = `${toGHz(data.frequency)} GHz`;

  document.getElementById('main-container').style.setProperty(
    '--current-glow', getGlowColor(cpuPct, cfg.amberUsage, cfg.redUsage)
  );

  setBar('cpu-bar-fill', 'cpu-bar-meta', cpuPct, `${cpuPct.toFixed(1)}%`, cfg.amberUsage, cfg.redUsage);

  gCpu.color = dotColor(cpuPct, cpuTemp);
  gCpu.push(cpuPct);
}));
```

- [ ] **Step 4: Update the memory subscription**

Replace the existing `WidgetAPI.system.subscribe('memory', ...)` callback:

```js
_unlisteners.push(WidgetAPI.system.subscribe('memory', (data) => {
  const usedGiB  = parseFloat(toGiB(data.used));
  const totalGiB = parseFloat(toGiB(data.total));
  const availGiB = parseFloat((totalGiB - usedGiB).toFixed(1));
  const usedPct  = (data.used / data.total) * 100;
  const availPct = (availGiB / totalGiB) * 100;

  document.getElementById('mem-total-label').textContent = `${totalGiB} GiB`;

  setBarWidth('mem-used-fill',  'mem-used-val',  usedPct,  `${usedGiB} GiB`);
  setBarWidth('mem-avail-fill', 'mem-avail-val', availPct, `${availGiB} GiB`);

  gMem.fixedMax = totalGiB;
  gMem.push(usedGiB, availGiB);
}));
```

- [ ] **Step 5: Update the GPU subscription**

Replace the existing `WidgetAPI.system.subscribe('gpu', ...)` callback:

```js
_unlisteners.push(WidgetAPI.system.subscribe('gpu', (data) => {
  if (!data) return;
  const temp  = data.temp || 0;
  const vramP = data.vram_percentage;

  document.getElementById('gpu-temp-label').textContent = `${temp.toFixed(0)}°C`;

  setBar('gpu-bar-fill', 'gpu-vram-pct', vramP, `${vramP.toFixed(1)}%`, cfg.amberUsage, cfg.redUsage);

  gGpu.color = dotColor(vramP, temp);
  gGpu.push(vramP);
}));
```

- [ ] **Step 6: Update the network subscription**

Replace the existing `WidgetAPI.system.subscribe('network', ...)` callback:

```js
_unlisteners.push(WidgetAPI.system.subscribe('network', (data) => {
  const interfaces = Array.isArray(data) ? data : [data];
  const netIn  = interfaces.reduce((s, i) => s + (i.received    || 0), 0);
  const netOut = interfaces.reduce((s, i) => s + (i.transmitted || 0), 0);

  document.getElementById('net-in-val').textContent  = fmtBS(netIn);
  document.getElementById('net-out-val').textContent = fmtBS(netOut);

  gNet.push(netIn, netOut);
}));
```

- [ ] **Step 7: Update the disk subscription**

Replace the existing `WidgetAPI.system.subscribe('disk-io', ...)` callback:

```js
_unlisteners.push(WidgetAPI.system.subscribe('disk-io', (data) => {
  const read  = data.read  || 0;
  const write = data.write || 0;

  setBar('disk-read-fill',  'disk-read-val',  (read  / (1024 * 1024 * 50)) * 100, fmtBS(read),  cfg.amberUsage, cfg.redUsage);
  setBar('disk-write-fill', 'disk-write-val', (write / (1024 * 1024 * 50)) * 100, fmtBS(write), cfg.amberUsage, cfg.redUsage);

  gDisk.push(read, write);
}));
```

Note: Disk bars use a 50 MB/s ceiling for the bar fill percentage. The graph's max auto-scales from rolling history.

- [ ] **Step 8: Remove the uptime interval (keep uptime display)**

The uptime interval and `formatUptime` function are still needed — leave them unchanged. No removals needed here.

- [ ] **Step 9: Full integration verification**

Load `index.html` in a browser. Paste this mock and reload:

```js
window.WidgetAPI = {
  system: {
    subscribe(metric, cb) {
      const mocks = {
        cpu:      () => cb({ avg_usage: 47, cpu_temp: 62, frequency: 3800 }),
        memory:   () => cb({ used: 24.6e9, total: 32e9 }),
        gpu:      () => cb({ vram_percentage: 59, temp: 71 }),
        network:  () => cb([{ received: 1600, transmitted: 320 }]),
        'disk-io':() => cb({ read: 0, write: 0 })
      };
      const t = setInterval(mocks[metric] || (() => {}), 1000);
      mocks[metric]?.();
      return () => clearInterval(t);
    },
    uptime: () => Promise.resolve(141105)
  },
  widget: { drag: () => {}, openSettings: () => {}, resize: () => {} }
};
```

Expected:
- CPU: hero shows `47.0%`, sub-line shows `3.8 GHz | 62°C`, bar fills ~47%, DotGraph grows
- GPU: sec-t shows `GPU 71°C`, VRAM bar fills ~59%, DotGraph grows
- MEM: sec-t shows `MEM 32.0 GiB`, USED bar (gradient red→orange→gold) ~77%, AVAIL bar (gradient blue→cyan) ~23%, DualGraph grows outward
- NET: DualGraph shows IN (cyan up) / OUT (orange down), labels show `1.6 KB/s` / `320 B/s`
- DISK: both bars at 0, labels show `0 B/s`, DualGraph present
- Uptime counting up from `39:11:45`
- No console errors

- [ ] **Step 10: Commit**

```bash
git add themes/bridges/modules/system-stats/logic.js
git commit -m "feat(sys-stats): wire DotGraph/DualGraph to all subscriptions, update DOM IDs"
```

# SYS.STATS — btop Data Layout Design Spec
**Date:** 2026-04-11
**Scope:** Rework `system-stats` data layout and graph engine to match btop's information density and streaming graph style, while preserving the existing Chiral HUD visual language exactly.

---

## Goal

Replace the current single-graph + metrics-grid layout with btop-inspired per-section streaming graphs. Each stat section gets its own live dot-matrix canvas graph. NET, MEM, and DISK use a dual-channel graph where each channel grows outward from a glowing center divider line.

---

## Constraints

- **No visual language changes.** Keep the widget-container, dot matrix background, scanlines, glow effects, temperature-controlled color thresholds, hero CPU display, and horizontal scan bars exactly as they are.
- No changes to `module.json`, `settings.html`, or `shared-hud.css`.
- Vanilla JS + HTML/CSS only — no build step.
- All graphs driven by the existing `WidgetAPI.system.subscribe()` API.

---

## Layout Structure

```
┌─ SYS.STATS ──────────────────── UP: 39:11:45 ─┐
│                                                 │
│              [hero CPU % + glow]                │
│              [sub: GHz · °C]                    │
│ CPU ▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░  47%       │
│ [dot-matrix streaming graph — CPU history]      │
├─────────────────────────────────────────────────┤
│ GPU  59°C · 2.2 GiB VRAM                       │
│ LOAD ▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░  16%       │
│ [dot-matrix streaming graph — GPU history]      │
├─────────────────────────────────────────────────┤
│ MEM  30.5 GiB total                             │
│ USED ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  22.9 GiB   │
│ AVAIL▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░   7.6 GiB   │
│ CACHE▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░   6.1 GiB   │
│ [dual graph: USED ▲ outward ▼ AVAIL]            │
├─────────────────────────────────────────────────┤
│ NET                                             │
│ [dual graph: IN ▲ outward ▼ OUT]               │
│ ▲ IN  1.6 KB/s          OUT 320 B/s ▼          │
├─────────────────────────────────────────────────┤
│ DISK                                            │
│ READ ▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 B/s    │
│ WRITE▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 B/s    │
│ [dual graph: READ ▲ outward ▼ WRITE]            │
└─────────────────────────────────────────────────┘
```

---

## Graph Types

### DotGraph (single-channel)
Used for: CPU, GPU.

- Canvas element, full widget width, `36px` tall.
- Data scrolls right→left. Each tick a new column is appended at the right; the oldest column drops off the left.
- Each column is rendered as a vertical stack of filled circles (dots), each `4×4px` (dot diameter `3.4px`, centered in cell).
- Dots fill from bottom up. Column height = `(value / max) * numRows` dots.
- Dot opacity: linear ramp from `0.25` (bottom dot) to `0.8` (top dot).
- Subtle horizontal grid lines at 25%, 50%, 75% height: `rgba(0,191,255,0.07)`.
- Colour: inherits the temperature threshold colour of the stat (matches the bar to the left).

### DualGraph (dual-channel, outward from center)
Used for: NET (IN/OUT), MEM (Used/Avail), DISK (Read/Write).

- Two canvas elements stacked inside a `44px` tall wrapper div.
- Top canvas = Channel A. Bottom canvas = Channel B.
- A glowing center divider line runs between them: `1px`, `rgba(0,191,255,0.35)`, `box-shadow: 0 0 4px rgba(0,191,255,0.4)`.
- **Channel A** (top canvas): bars grow **upward from the bottom edge** of the top canvas (= the center line). Newest data right, scrolls left. Dots fill bottom-to-top, extending away from center.
- **Channel B** (bottom canvas): bars grow **upward from the top edge** of the bottom canvas (= the center line). Dots fill bottom-to-top direction from center outward.
- Same dot size and opacity ramp as DotGraph.
- The `max` for both channels is shared: `Math.max(...historyA, ...historyB)` so the two channels are always on the same scale.

---

## Sections

### CPU (unchanged hero + new graph)
- Keep hero display (big `%`, glow, GHz · °C sub-line) exactly as-is.
- Keep CPU scan bar row exactly as-is.
- **Replace** the existing `<canvas id="history-canvas">` with `<canvas id="g-cpu" class="dmg">`.
- No load-average pills.

### GPU
- Section title row: `GPU` label left, `{temp}°C` right (opacity 0.7, font-tech, small).
- One bar row: `VRAM` key, bar, `{vram_percentage}%` value. Temperature-threshold colour.
- DotGraph below: `id="g-gpu"`, colour = temperature-threshold of vram_percentage, max = 100.
- Data: `gpu` subscription → `data.vram_percentage`, `data.temp`.

### MEM
- Section title row: `MEM` label left, `{total} GiB` right.
- Three bar rows:
  - `USED` — gradient fill `#e60012 → #FF6B1A → #FFD700`, value in GiB.
  - `AVAIL` — gradient fill `#005596 → #00BFFF`, value in GiB.
  - `CACHE` — `rgba(0,191,255,0.35)` fill, value in GiB at `opacity: 0.6`.
- DualGraph below `id="g-mem"`: Channel A = USED (orange `rgba(255,107,26,ALPHA)`), Channel B = AVAIL (cyan `rgba(0,191,255,ALPHA)`). Max = total RAM in GiB (normalise values 0–total).
- Labels below graph: `▲ USED` left (caution colour), `AVAIL ▼` right (primary colour).

**Data derivation:**
- `used` — from `mem_used` subscription (bytes → GiB).
- `total` — from `mem_total` subscription (bytes → GiB).
- `avail` = `total - used`.
- `cache` — not exposed by WidgetAPI. Omit the CACHE bar row entirely.

### NET
- Section title: `NET` only.
- No bar rows (rates shown in label below graph instead).
- DualGraph `id="g-net"`: Channel A = download cyan, Channel B = upload orange. Max = shared rolling max of last 60 samples.
- Labels below: `▲ IN  {rate}` left (primary), `OUT {rate} ▼` right (alert).
- Rate display uses `fmtBS()` helper (existing).

### DISK
- Section title: `DISK` only.
- Two bar rows: `READ` (cyan) and `WRITE` (orange), values via `fmtBS()`.
- DualGraph `id="g-disk"`: Channel A = read cyan, Channel B = write orange. Max = shared rolling max.
- Labels below: `▲ READ` left, `WRITE ▼` right.

---

## Graph Engine (logic.js)

### Replace FluxGraph with two new classes

**`DotGraph`**
```js
class DotGraph {
  constructor(canvas, color, max)
  // canvas: HTMLCanvasElement
  // color: CSS color string with 'ALPHA' placeholder e.g. 'rgba(0,191,255,ALPHA)'
  // max: number (e.g. 100 for %)
  push(value)   // add new data point, redraw
  resize()      // called on ResizeObserver
  draw()        // internal
}
```

**`DualGraph`**
```js
class DualGraph {
  constructor(canvasA, canvasB, colorA, colorB, initialMax)
  // canvasA: top canvas element (channel A rises UP from bottom edge = center line)
  // canvasB: bottom canvas element (channel B rises UP from top edge)
  push(a, b)    // add new pair, redraw both
  resize()
  draw()
}
```

### ResizeObserver
Both classes attach a `ResizeObserver` on their canvas element(s) to re-initialise `numCols`/`numRows` and redraw on widget resize. Remove the old `window.addEventListener('resize', ...)` approach.

### Subscriptions
Keep all existing `WidgetAPI.system.subscribe()` calls unchanged — `cpu`, `memory`, `gpu`, `network`, `disk-io`. No new subscriptions needed.

Remove:
- References to `netGraph`, `diskGraph`, `ramGraph`, `cpuGraph` (old FluxGraph instances).
- Uptime interval and load-average display logic.

### History buffers
Each graph maintains its own rolling history array (max 80 entries). DualGraph keeps two parallel arrays. Push on each subscription callback.

---

## CSS Changes (index.html)

### New classes
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

/* Graph stat labels */
.glabels {
  display: flex; justify-content: space-between; margin-top: 0.15rem;
}
.glbl { font-family: var(--font-tech); font-size: 0.55rem; opacity: 0.7; }

/* Section title */
.sec-t {
  font-family: var(--font-tech); font-size: 0.56rem; opacity: 0.45;
  letter-spacing: 2px; text-transform: uppercase;
  display: flex; justify-content: space-between; margin-bottom: 0.25rem;
}
.sec-t span { color: var(--color-hud-primary); opacity: 0.7; font-size: 0.54rem; letter-spacing: 0; }
```

### Remove
- `.graph-container`, `#history-canvas`, `.metrics-grid`, `.metric`, `.metric-label`, `.metric-value` — replaced by new layout.
- `.hero-sub` load-avg related styles (keep `hero-sub` for GHz/temp line).

### Keep unchanged
All existing widget-container, background-layers, scanlines, pattern-layer, header, hero, scan bar, and bar-fill CSS.

---

## Files Changed

| File | Changes |
|------|---------|
| `themes/bridges/modules/system-stats/index.html` | Replace history canvas + metrics grid with 5-section layout; add new CSS classes; add canvas elements for each graph |
| `themes/bridges/modules/system-stats/logic.js` | Replace FluxGraph with DotGraph + DualGraph; update subscriptions; add mem breakdown and gpu vram display |

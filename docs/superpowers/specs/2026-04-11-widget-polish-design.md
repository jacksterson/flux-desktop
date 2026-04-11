# Widget Polish — Design Spec
**Date:** 2026-04-11
**Scope:** Approach B — Full Polish Pass across all 4 Koji Pro widgets
**Constraint:** No layout changes, no new features, no logic rewrites. Visual polish + data display fixes only.

---

## Goal

Improve all four Koji Pro Suite widgets (CHRONOS, SYS.STATS, WEATHER, AI.OPS) by fixing data display rough edges and elevating the visual polish — staying fully within the existing Chiral HUD design language.

---

## Cross-Widget Changes (all 4 files)

### Opacity Ladder
Standardise to three tiers. Replace all ad hoc opacity values:
- **Primary** (hero values, active labels): `opacity: 1.0`
- **Secondary** (sub-labels, bar keys): `opacity: 0.7`
- **Tertiary** (meta text, timestamps, graph labels): `opacity: 0.45`

### Header Left Accent Bar
Add a `::before` pseudo-element to each `header` element:
- 2px wide, full height of the header
- `background: var(--color-hud-primary)`
- `box-shadow: 0 0 6px var(--color-hud-primary)`
- `opacity: 0.8`
- No HTML changes needed.

### Section Separators
Bump all internal section border colours from `rgba(0,191,255,0.08–0.12)` to `rgba(0,191,255,0.18)`. Add `box-shadow: 0 1px 0 rgba(0,191,255,0.06)` to make separators visible against the dark background.

### Glow Normalisation
Standardise hero `text-shadow` to `0 0 30px <color>, 0 0 60px <color-at-30%-opacity>` across all widgets. Weather currently uses 40px/80px — bring it in line.

### Staggered Entry Animation
Each major content section gets an `animation: section-enter 0.4s ease both` with incremental `animation-delay` (0ms, 60ms, 120ms, 180ms…). Keyframes: `from { opacity: 0; transform: translateY(6px); }`. Applied via nth-child CSS selectors (e.g. `.content > *:nth-child(1)`, `:nth-child(2)`, etc.) — no HTML changes. Pairs with the existing `flicker-on-mount` on the container.

---

## CHRONOS (`time-date`)

### Clock Glow Breathe
Add `@keyframes glow-breathe` to the `#clock` element:
```css
@keyframes glow-breathe {
  0%, 100% { text-shadow: 0 0 30px var(--color-hud-primary), 0 0 60px rgba(0,191,255,0.3); }
  50%       { text-shadow: 0 0 45px var(--color-hud-primary), 0 0 90px rgba(0,191,255,0.4); }
}
```
Duration: `4s ease-in-out infinite`. Subtle — the glow expands and contracts slowly.

### Sun Times Icon
Replace the `☀` emoji in `#sun-times` with a CSS-only sun mark:
```html
<span class="sol-icon"></span>
```
`.sol-icon` is a 10×10px circle (`border-radius: 50%`, `background: var(--color-hud-alert)`) with 8 radial ray marks via `box-shadow`. Colour: `--color-hud-alert` (Bridges Orange) to match the date line.

### Date Separator Glow
In `logic.js`, when writing the date string, wrap the ` // ` separator in a `<span class="date-sep">`. Add CSS:
```css
.date-sep { color: var(--color-hud-alert); text-shadow: 0 0 8px var(--color-hud-alert); opacity: 0.8; }
```

---

## SYS.STATS (`system-stats`)

### Remove Redundant Value Prefixes
In `logic.js`, strip the label prefixes from metric card values — the `.metric-label` already names the field:
- `"IN: 1.6 KB/s"` → `"1.6 KB/s"`
- `"OUT: 1005 B/s"` → `"1005 B/s"`
- `"R: 0 B/s"` → `"0 B/s"` (DISK R/W card)

### Metric Card Hover State
Add to `.metric`:
```css
.metric { transition: border-color 0.2s, box-shadow 0.2s; }
.metric:hover {
  border-color: rgba(0,191,255,0.25);
  box-shadow: 0 0 8px rgba(0,191,255,0.12);
}
```

### CPU History Graph Grid Lines
In `logic.js`, inside `FluxGraph.draw(max, color)` (line ~63), draw horizontal guide lines at the start of the method, before the data line is drawn:
- Lines at 25%, 50%, 75% of canvas height
- Colour: `rgba(0,191,255,0.06)`
- No labels needed — purely visual depth.

### Bar Fill Easing
Change the CSS transition on `.bar-fill` from `width 0.4s ease` to `width 0.4s cubic-bezier(0.2, 0, 0.4, 1)`. More tactile, slightly snappier entry.

---

## WEATHER (`weather`)

### Hourly Forecast Icons
Replace emoji (☀ ☁ 🌧 ⛈) with a small inline SVG icon set. Define 4 SVG symbols in a hidden `<svg>` block at the top of `index.html`:
- `#icon-clear` — circle with 8 rays (stroked)
- `#icon-cloudy` — arc shape
- `#icon-rain` — cloud + 3 drop lines
- `#icon-storm` — cloud + lightning bolt

Each hourly item uses `<svg class="wx-icon"><use href="#icon-clear"/></svg>`. Icons stroked in `currentColor` at 20×20px — inherits the HUD palette and can glow.

In `logic.js`, map WMO weather codes to icon IDs instead of emoji strings.

### Metric Item Icons
Add a `.metric-icon` span before each value in the 4 metric items:
- WIND → `↗`
- HUMIDITY → `≋`
- PRECIP → `↓`
- UV INDEX → `◉`

```css
.metric-icon { opacity: 0.45; margin-right: 0.25rem; font-family: var(--font-tech); }
```

### Metric Card Hover State
Same as SYS.STATS — border lift + glow shadow on `.metric-item:hover`.

### Scan Bar Entry Shimmer
On first data load, each `.scan-bar` animates from `height: 0` to its target height with a stagger of `index * 40ms`. One-time animation, does not repeat. Fits the "7-day scan" metaphor of bars sweeping into place.

### Condition Text Formatting
In `logic.js`, when setting the condition display string, replace underscores with spaces:
```js
condition.replace(/_/g, ' ')
```
`CLEAR_SKY` → `CLEAR SKY`.

---

## AI.OPS (`ai-usage`)

### Service Block Hover
Add hover state to `.service`:
```css
.service { padding-left: 0.5rem; border-left: 2px solid transparent; transition: border-color 0.2s, background 0.2s; }
.service:hover { background: rgba(0,191,255,0.03); border-left-color: rgba(0,191,255,0.3); }
```

### Spark Bar Refinement
- Height: `20px` (from 16px)
- Width: `8px` (from 6px)
- `.today` bar gets a top highlight: `border-top: 2px solid rgba(255,255,255,0.4)`
- Makes the current-day bar the clear focal point.

### Summary Token Glow
The token count in the summary row (`#total-tokens`) gets:
```css
#total-tokens { color: var(--color-hud-neutral); text-shadow: 0 0 10px rgba(0,191,255,0.4); }
```
Matches the glow treatment of hero values in other widgets.

---

## Files Changed

| File | Changes |
|------|---------|
| `time-date/index.html` | Clock breathe animation, sol-icon, date-sep span, staggered entry, header accent, opacity ladder |
| `time-date/logic.js` | Wrap `//` separator in `.date-sep` span |
| `system-stats/index.html` | Metric hover, bar easing, staggered entry, header accent, opacity ladder |
| `system-stats/logic.js` | Strip value prefixes, add graph grid lines |
| `weather/index.html` | SVG icon defs, metric icons, metric hover, scan bar shimmer, staggered entry, header accent, opacity ladder |
| `weather/logic.js` | Map WMO codes to SVG IDs, condition underscore→space |
| `ai-usage/index.html` | Service hover, spark bar sizing, summary glow, staggered entry, header accent, opacity ladder |

No changes to `shared-hud.css`, `module.json`, or settings HTML files.

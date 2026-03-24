# HUD Theme System — Chiral UI
### Death Stranding 2 Inspired Holographic Design Language
> For use with Tauri + Rust desktop widget application

***

## Philosophy

This UI is designed as a **diegetic holographic projection** — every element should read as if it is being emitted from a physical wearable device, not rendered as a traditional application overlay. Core principles:

- **Cool-dominant at rest** — cyan and blue are the neutral/default state
- **Warms under pressure** — the palette shifts toward amber, orange, and red as urgency or threat increases
- **Translucency over opacity** — panels are never fully solid; the environment bleeds through at all times
- **Sharp geometry** — no friendly rounding; corners are 0–4px maximum
- **Glow over shadow** — text and icons use outer glow, never hard drop shadows

***

## Color Tokens

```css
:root {
  /* === BASE PALETTE === */
  --color-hud-primary:        #00BFFF;  /* Cyan Blue     — default UI base            */
  --color-hud-primary-soft:   #4FC3F7;  /* Ice Blue      — secondary panels, subtext  */
  --color-hud-neutral:        #E8EAED;  /* Silver White  — selected items, active text */
  --color-hud-safe:           #39FF14;  /* Signal Green  — confirmed / OK states       */
  --color-hud-caution:        #FFC107;  /* Amber Yellow  — warning, degraded state     */
  --color-hud-alert:          #FF6B1A;  /* Bridges Orange— urgent alerts, brand accent */
  --color-hud-danger:         #FF2020;  /* Critical Red  — danger, hostile zones       */
  --color-hud-chiral:         #9B59B6;  /* Chiral Purple — special / dimensional FX    */
  --color-hud-reward:         #D4AF37;  /* Chiral Gold   — rewards, premium events     */

  /* === BACKGROUNDS === */
  --color-bg-base:            #0A0F1A;  /* Deep navy-black — widget base background    */
  --color-bg-panel:           rgba(0, 191, 255, 0.10);
  --color-bg-panel-hover:     rgba(0, 191, 255, 0.18);
  --color-bg-overlay:         rgba(10, 15, 26, 0.75);

  /* === BORDERS === */
  --color-border-default:     rgba(79, 195, 247, 0.45);
  --color-border-active:      rgba(0, 191, 255, 0.85);
  --color-border-danger:      rgba(255, 32, 32, 0.70);
}
```

***

## Semantic Usage Rules

### Backgrounds & Panels

| Context | Value |
|---|---|
| Widget base | `#0A0F1A` solid |
| Panel fill | `--color-hud-primary` at 10–15% opacity |
| Panel on hover/focus | `--color-hud-primary` at 18% opacity |
| Modal / overlay scrim | `#0A0F1A` at 75% opacity |
| Panel border | `--color-hud-primary-soft` at 45% opacity, 1px solid |
| Panel glow | `box-shadow: 0 0 12px rgba(0, 191, 255, 0.25)` |

***

### Typography

| Context | Color Token | Notes |
|---|---|---|
| Body / readout text | `--color-hud-primary` | Data values, labels |
| Active / selected | `--color-hud-neutral` | Full white on selection |
| Inactive / disabled | `--color-hud-primary-soft` at 50% | Dimmed |
| Warning text | `--color-hud-caution` | Non-critical alerts |
| Critical / error | `--color-hud-danger` | Immediate action required |
| Reward / achievement | `--color-hud-reward` | Brief display, then fade |

**Recommended Fonts:**
1. `Share Tech Mono` — monospace, technical (Google Fonts, free)
2. `Rajdhani` — geometric sans, condensed (Google Fonts, free)
3. `Orbitron` — stylized headers only (Google Fonts, free)

***

### Weather Icon Tinting

```css
.weather-icon {
  filter: drop-shadow(0 0 5px currentColor);
  transition: filter 0.3s ease;
}
```

| Weather Condition | Fill Color | Token |
|---|---|---|
| Clear / Sunny | `#39FF14` | `--color-hud-safe` |
| Partly Cloudy | `#00BFFF` | `--color-hud-primary` |
| Overcast | `#4FC3F7` at 70% | `--color-hud-primary-soft` |
| Fog / Mist | `#E8EAED` at 70% | `--color-hud-neutral` |
| Rain | `#4FC3F7` | `--color-hud-primary-soft` |
| Thunderstorm | `#FFC107` | `--color-hud-caution` |
| Sleet / Freezing | `#9B59B6` | `--color-hud-chiral` |
| Snow | `#E8EAED` | `--color-hud-neutral` |
| Tornado / Extreme | `#FF2020` | `--color-hud-danger` |

***

### Status Meters & Progress Bars

| Threshold | Fill Color | Token |
|---|---|---|
| 80–100% | `#39FF14` | `--color-hud-safe` |
| 60–79% | `#00BFFF` | `--color-hud-primary` |
| 40–59% | `#FFC107` | `--color-hud-caution` |
| 20–39% | `#FF6B1A` | `--color-hud-alert` |
| 0–19% | `#FF2020` | `--color-hud-danger` |

Bar track background: `--color-hud-primary` at 15% opacity
Completion flash at 100%: brief pulse of `--color-hud-reward`

***

### Zone / Map Colors

| Zone Type | Color | Token |
|---|---|---|
| Connected / Safe | `#00BFFF` | `--color-hud-primary` |
| Border / Neutral | `#E8EAED` | `--color-hud-neutral` |
| Disconnected / Hostile | `#FF2020` | `--color-hud-danger` |
| Anomalous / Special | `#9B59B6` | `--color-hud-chiral` |

***

## Animation Conventions

| Event | Behavior |
|---|---|
| Idle panel pulse | Opacity oscillation on border/glow, 2–3s sine cycle |
| Threat escalation | `#FFC107 → #FF6B1A → #FF2020` transition over 500ms |
| Reward event | `#D4AF37` flash + `scale(1.08)` pulse, 300ms total |
| Chiral / special | `#9B59B6` shimmer, hue-rotate glitch keyframe |
| Data refresh | Opacity dip to 40% then snap back |
| Widget mount | Fade-in from 0% + `translateY(-6px)` over 200ms |

***

## Tauri-Specific Implementation

### Rust Theme Command

```rust
#[tauri::command]
fn get_theme() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("--color-hud-primary",      "#00BFFF"),
        ("--color-hud-primary-soft", "#4FC3F7"),
        ("--color-hud-neutral",      "#E8EAED"),
        ("--color-hud-safe",         "#39FF14"),
        ("--color-hud-caution",      "#FFC107"),
        ("--color-hud-alert",        "#FF6B1A"),
        ("--color-hud-danger",       "#FF2020"),
        ("--color-hud-chiral",       "#9B59B6"),
        ("--color-hud-reward",       "#D4AF37"),
        ("--color-bg-base",          "#0A0F1A"),
    ])
}
```

### Frontend Token Injection

```javascript
const theme = await invoke("get_theme");
const root = document.documentElement;
Object.entries(theme).forEach(([key, value]) => {
  root.style.setProperty(key, value);
});
```

### tauri.conf.json Window Config

```json
{
  "tauri": {
    "windows": [
      {
        "transparent": true,
        "decorations": false,
        "alwaysOnTop": true,
        "resizable": false,
        "shadow": false
      }
    ]
  }
}
```

***

## Icon Pack Resources

| Pack | Style | License | URL |
|---|---|---|---|
| Dovora Weather Icons | Monochrome SVG | CC BY-SA 4.0 | dovora.com/resources/weather-icons |
| Untitled UI Weather | Thin Line SVG | Free, no attribution | untitledui.com/free-icons/weather |
| Icons8 Outline Weather | Outline SVG | Free w/ attribution | icons8.com/icons/set/free-weather |

***

*Theme version: 1.0.0 — Chiral UI / Death Stranding 2 Inspired*
*Project: Tauri Desktop Widget System*
*Last updated: 2026-03-23*

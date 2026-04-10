# Flux Design System — Chiral UI MASTER

> Death Stranding 2 Inspired Holographic Design Language for Tauri Widgets.

## Visual Identity

| Token | Value | Hex | Usage |
|---|---|---|---|
| `--color-hud-primary` | Cyan Blue | `#00BFFF` | Default UI base, primary readouts |
| `--color-hud-primary-soft` | Ice Blue | `#4FC3F7` | Secondary panels, subtext |
| `--color-hud-neutral` | Silver White | `#E8EAED` | Selected items, active text |
| `--color-hud-safe` | Signal Green | `#39FF14` | Confirmed / OK / Sunny states |
| `--color-hud-caution` | Amber Yellow | `#FFC107` | Warnings, partly cloudy, heat |
| `--color-hud-alert` | Bridges Orange | `#FF6B1A` | Urgent alerts, brand accent |
| `--color-hud-danger` | Critical Red | `#FF2020` | Danger, hostile zones, extreme weather |
| `--color-hud-chiral` | Chiral Purple | `#9B59B6` | Special / dimensional FX, sleet |
| `--color-hud-reward` | Chiral Gold | `#D4AF37` | Rewards, achievements |

## Typography

- **Headers:** `Orbitron` (letter-spacing: 2px, uppercase)
- **Body / Labels:** `Rajdhani` (geometric sans, condensed)
- **Technical Data:** `Share Tech Mono` (monospace, strictly for values and timers)

## Design Rules

1. **Sharp Geometry:** `border-radius: 0px`. Use `clip-path` for 4px corner cutouts.
2. **Translucency:** `backdrop-filter: blur(25px)`. Base opacity `0.80` - `0.95`.
3. **Diegetic Effects:** 
    - **Scanlines:** Subtle 3px vertical/horizontal overlay at 15% opacity.
    - **Spotlight:** Pattern layer revealed on mouse hover with radial gradient mask.
    - **Flicker:** Subtle 300ms flicker animation on mount to simulate holographic bootup.
4. **Warmth Under Pressure:**
    - Palette must shift from Cyan to Amber to Red as status degrades (e.g., CPU temp, RAM usage).
    - Weather icons must be tinted according to the condition (Sunny=Green, Rain=Blue, Storm=Yellow, Extreme=Red).

## Animation Guidelines

- **Duration:** Micro-interactions should be `150-300ms`.
- **Easing:** Use `cubic-bezier(0.4, 0, 0.2, 1)` for transitions.
- **Feedback:** All tappable elements must have a pressed state (opacity change or border flash).

## Implementation Checklist

- [x] Standardize fonts to Rajdhani/Share Tech/Orbitron.
- [x] Use central `:root` variables in `flux/app/src/chiral-theme.css`.
- [x] Add `.scanlines` layer to all modules.
- [x] Implement `.flicker-on-mount` animation.
- [x] Ensure `aria-label` on all interactive elements.
- [x] Touch targets for resizers >= 10pt (expanded hitbox).

---

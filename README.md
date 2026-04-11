# Flux — Desktop Widget Engine

Flux is a desktop widget engine built on **Rust + Tauri**. It renders HTML/CSS/JS widgets as always-on-top desktop overlays with direct access to real-time system metrics — no browser bloat, no build step required to author widgets.

---

### ⚠️ Pre-Alpha — Active Development

**Current Status (April 2026):**

| Feature | Status |
|---------|--------|
| Engine (Rust/Tauri daemon) | ✅ Working |
| Widget rendering + WidgetAPI | ✅ Working |
| System metrics (CPU, RAM, GPU, Net, Disk) | ✅ Working |
| Koji Pro Suite (4 widgets) | ✅ Working |
| Widget resize + drag | ✅ Working |
| System tray | 🚧 Partially implemented — not fully accessible |
| Widget installer / marketplace | 🚧 Not yet built |
| Battery / performance mode controls | 🚧 Code exists — not yet exposed in UI |
| Windows / macOS support | 🚧 Linux only at this time |

---

## Koji Pro Suite

The first official widget pack — four widgets built on the **Chiral HUD** design language (Death Stranding-inspired ambient aesthetic):

- **CHRONOS** — Clock, date, sunrise/sunset
- **SYS.STATS** — CPU, RAM, GPU, network, disk
- **WEATHER** — Current conditions, hourly forecast, 7-day scan bars
- **AI.OPS** — Claude / Gemini token usage and request rates

---

## Writing Widgets

Widgets are plain HTML/CSS/JS — no build step, no framework required. Each widget is a directory with:

```
module.json        # metadata + default size
index.html         # widget UI
logic.js           # data binding
settings.html      # (optional) settings panel
```

The engine injects `WidgetAPI` into every widget before load:

```js
// Subscribe to live system metrics
WidgetAPI.system.subscribe('cpu_usage', (val) => { ... });
WidgetAPI.system.subscribe('mem_used',  (val) => { ... });

// Call Tauri backend commands
WidgetAPI.invoke('command_name', { arg: value });
```

---

## Tech Stack

- **Engine:** Rust + Tauri 2.x
- **Widget runtime:** Vanilla HTML / CSS / JS (no build step)
- **Metrics layer:** Rust system APIs → event-driven subscriptions via WidgetAPI
- **Design system:** Chiral HUD (`shared-hud.css` + CSS custom properties)

---

## License

Dual-licensed:
1. **Personal use:** Free and open-source under [AGPL-3.0](LICENSE)
2. **Commercial use:** Paid license required for businesses, streamers, or redistributed widget packs

---

## Support

Flux is a solo developer project. Support keeps it free for personal use.

**[☕ Ko-fi — fluxdesktop](https://ko-fi.com/fluxdesktop)**

---

*A project by jacksterson.*

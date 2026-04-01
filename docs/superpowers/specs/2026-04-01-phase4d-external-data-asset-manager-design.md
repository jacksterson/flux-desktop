# Phase 4d Design: External Data Hooks + Font/Asset Manager

**Date:** 2026-04-01
**Phase:** 4d (follows Phase 4c — Raw HTML, CSS effects, shader presets)
**Author:** Claude (Sonnet 4.6) via brainstorming session

---

## Overview

Phase 4d adds two major capabilities to the Flux widget editor:

1. **External data hooks** — shell commands and HTTP polling as custom data sources, with smart presets for popular free APIs
2. **Font/asset manager** — a global asset library plus per-widget asset bundles for fonts, images, and arbitrary files

A hard constraint throughout: **Flux must have exactly one system tray icon and one taskbar entry**. All new subsystems run inside the existing Tauri process. No new processes.

---

## Architecture

### Custom Data Broker (Rust)

A new Rust module sits alongside the existing system broadcaster. When a widget loads (in the editor or runtime), it registers its custom data sources with the broker.

Each source has:
- `name` — identifier used by components (e.g., `eth_price`, `now_playing`)
- `type` — `shell` or `http`
- `command` / `url` — the shell command string or HTTP URL
- `interval` — polling interval (1s, 5s, 10s, 30s, 1min, 5min, 15min)
- `json_path` — optional dot-notation path for JSON responses (e.g., `current.temperature_2m`); uses simple dot-separated key traversal (`a.b.c`), not full JSONPath syntax
- `platform_overrides` — optional per-OS shell commands (`linux`, `macos`, `windows`) that take precedence over the universal command

The broker runs each source on its interval in a background Tokio task, caches the last value, and emits a Tauri event `custom-data:<source-name>` with the extracted value when it changes. The JS side subscribes to these events exactly like it subscribes to `system:cpu` today — one data model, two producers.

**Shell execution:**
- Universal command: `sh -c <cmd>` on macOS/Linux, `powershell -Command <cmd>` on Windows
- Per-platform overrides take precedence when set
- stdout is captured; the first line is used as the value

**HTTP execution:**
- Standard GET request via `reqwest`
- If `json_path` is set: parse response as JSON, traverse the dot-notation path, return the value as a string
- If no `json_path`: use the full response body as the value (trimmed)

**Error handling:**
- Source errors (command not found, HTTP timeout, invalid JSON) produce no event — the last cached value is preserved
- On first-run error, the runtime shows a non-blocking toast: "Source `<name>` failed — check widget settings"

### Asset Library (Rust + filesystem)

Global library: `~/.flux/assets/` with subfolders `fonts/`, `images/`, `other/`

Per-widget assets: stored as base64-encoded entries in the `.fluxwidget` file under a `localAssets` section. Local assets override global assets of the same filename.

On export, the Rust backend:
1. Scans components for referenced fonts (by family name) and images (by filename)
2. Resolves each reference: check local assets first, then global library
3. Copies resolved assets into the zip's `assets/` folder
4. Generates `@font-face` declarations in `style.css` for bundled fonts

### Single Process Guarantee

The data broker, asset manager, widget runtime, and editor all run inside the same Tauri process that owns the single tray icon. No child processes, no separate daemons, no additional tray entries.

---

## External Data Hooks UI

### Data Sources Panel (5th floating panel)

A new floating panel labeled "Sources" (default position: bottom-right). Lists all named custom sources for the current widget. Each row shows:
- Source name
- Type badge: `SHELL` or `HTTP`
- Current live value (or `pending…` / `error`)
- Edit and delete buttons

A `+ Add Source` button opens an inline form within the panel.

**Add/edit form fields:**

| Field | Description |
|---|---|
| Name | Identifier used by components (e.g., `eth_price`) |
| Type | Shell Command / HTTP |
| Polling interval | 1s / 5s / 10s / 30s / 1min / 5min / 15min |
| Universal command (shell) | Runs via `sh -c` on Mac/Linux, `powershell` on Windows |
| Per-platform overrides (shell) | Linux / macOS / Windows fields — optional, collapsible |
| URL (HTTP) | Full URL including query parameters |
| JSON path (HTTP) | Optional dot-notation path, e.g. `current.temperature_2m` |
| Test button | Runs the source once immediately; shows raw output in an inline result box |

### Inline Per-Component Source

In the Properties panel, any data source dropdown (metric, progressbar, linegraph, circlemeter) gets a new option at the bottom: `+ New custom source…`. Clicking opens the add form pre-wired to use the new source immediately on save.

### Smart Presets

A "Use a preset" link in the HTTP form opens a preset picker. Each preset shows a friendly config form — no URL construction or JSON path knowledge required.

**Zero-friction presets (no key required):**
| Preset | Provider | Notes |
|---|---|---|
| Weather | Open-Meteo | Enter city or use geolocation; pick metric (temp, humidity, wind, etc.); CC-BY 4.0, non-commercial |
| News headlines | RSS | Pick from curated feed list (BBC, Reuters, AP, NASA, Reddit) or enter custom URL |
| Sports | TheSportsDB | Schedules, results, standings via public key `123`; live scores require user's own key |
| World time | System clock | No external API; uses `chrono` in Rust |

**BYOK presets (user enters their own key):**
| Preset | Provider | Key registration link shown in UI | Notes |
|---|---|---|---|
| Weather (alt) | OpenWeatherMap | openweathermap.org/api | Free tier: 1M calls/month |
| Crypto prices | CoinGecko Demo | coingecko.com/en/api | Free: 10k calls/month; attribution required in widget |
| Stocks | Alpha Vantage | alphavantage.co | Free: 25 calls/day — warning shown in UI |
| Music (now playing) | Last.fm | last.fm/api | Works with any scrobbling media player |
| Music (Spotify) | Spotify Web API | developer.spotify.com | High friction: user must create their own Spotify Developer App; Premium required |
| Home automation | Home Assistant | User's own HA instance | User enters their HA URL + Long-Lived Access Token |

**Platform-native now playing (no API, no key):**
- Linux: MPRIS via D-Bus
- Windows: SMTC (Windows.Media.Control WinRT API)
- macOS: not available natively; fall back to Last.fm

**Do not ship:** NewsAPI.org — production use explicitly prohibited on free tier.

---

## Font & Asset Manager

### Access

A toolbar button (📁 Assets) opens a modal overlay. Not a floating panel — asset management is occasional, not constant. The modal has two tabs:

- **Library** — global `~/.flux/assets/` (available to all widgets)
- **This Widget** — assets embedded in the current `.fluxwidget` file

### Library Tab

Three sections: Fonts, Images, Other.

- Add assets via drag-and-drop or file picker
- Fonts: show live "Aa" preview rendered in that typeface
- Images: show thumbnail
- Remove button: deletes from library with a warning if any open widget references the file
- Drag from Library → This Widget tab to embed a copy in the current widget

### This Widget Tab

Same layout. Assets stored inside the `.fluxwidget` file (base64-encoded). Shows file size per asset so users understand the tradeoff (custom fonts are typically 200–800 KB).

### Using Assets in the Editor

**Fonts:** Font family dropdowns in the Properties panel gain a section at the top — "From asset library" — listing installed/embedded fonts before system fonts. Global library fonts are marked with a 🌐 icon; per-widget fonts with a 📦 icon.

**Images:** A new `image` component type places a static image on the canvas. The source is selected from the asset library (not a URL). Supports PNG, JPG, SVG, GIF, WebP.

**In Raw HTML components:** Assets are referenced via a `flux://asset/<filename>` URL scheme (e.g., `<img src="flux://asset/logo.png">`). The scheme resolves correctly in the editor and in exported/installed widgets.

### New Component: `image`

| Property | Type | Default |
|---|---|---|
| `src` | filename from asset library | — |
| `objectFit` | `contain` / `cover` / `fill` / `none` | `contain` |
| `opacity` | 0–100 | 100 |
| `cssEffects` | array | `[]` |

Default size: 120×80px.

---

## Export & Runtime Integration

### Widget Manifest (`widget.json`)

Gains a `dataSources` array:

```json
{
  "dataSources": [
    {
      "name": "eth_price",
      "type": "http",
      "url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&x_cg_demo_api_key={{COINGECKO_KEY}}",
      "interval": "60s",
      "jsonPath": "ethereum.usd"
    },
    {
      "name": "now_playing",
      "type": "shell",
      "command": "playerctl metadata title",
      "platformOverrides": {
        "windows": "powershell -Command \"(Get-Process -Name 'Spotify' | ...\""
      },
      "interval": "5s"
    }
  ]
}
```

API keys are stored as `{{KEY_NAME}}` placeholders in the manifest. The actual key values are stored in Flux's local settings (never embedded in the widget file).

### BYOK Key Prompting

On first install, the Flux runtime reads the widget manifest, finds any `{{PLACEHOLDER}}` patterns, and prompts the user once: "This widget needs a CoinGecko API key — enter it here." The key is saved to local settings and reused for all widgets that reference the same placeholder name. Widgets using zero-friction sources (Open-Meteo, RSS, TheSportsDB) install with no prompts.

### Widget Runtime Data Registration

When the runtime loads a widget, it:
1. Reads `dataSources` from `widget.json`
2. Substitutes stored key values for `{{PLACEHOLDER}}` tokens
3. Registers each source with the Rust data broker
4. The widget's `logic.js` subscribes to `custom-data:<name>` Tauri events alongside system events — no special cases

### Asset Export Pipeline

The Rust export command:
1. Scans all components for asset references (font family names, image filenames, `flux://asset/` URLs)
2. Resolves each: check widget's local assets first, then global library
3. Copies resolved files into the zip's `assets/` folder
4. Generates `@font-face` rules in `style.css`:
   ```css
   @font-face {
     font-family: 'MyFont';
     src: url('./assets/MyFont.ttf') format('truetype');
   }
   ```
5. Rewrites `flux://asset/<filename>` in exported HTML/CSS to `./assets/<filename>`

---

## Data Flow Summary

```
Editor / Runtime
       │
       ├── System data ──── existing Rust broadcaster ──── system:cpu, system:memory, ...
       │
       └── Custom data ─── NEW Rust data broker ─────────── custom-data:eth_price
                                │                            custom-data:now_playing
                                ├── Shell tasks (Tokio)      ...
                                └── HTTP tasks (reqwest)
```

JS subscribes to both event namespaces identically. Components reference sources by name regardless of type.

---

## Out of Scope for Phase 4d

- WebSocket data sources (future phase)
- Reactive/formula sources (e.g., `source_a / source_b * 100`) — future phase
- Asset CDN or sharing — local filesystem only
- Custom GLSL editor — already cut in Phase 4c brainstorm
- Video assets
- Sound/audio component

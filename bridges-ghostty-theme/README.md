# Bridges (Death Stranding) Ghostty Theme
> A diegetic holographic terminal theme inspired by Chiral UI and Bridges from Death Stranding.

Based on the [Chiral HUD](https://github.com/your-username/bridgegap/flux) design language, this theme prioritizes high-contrast cyan, technical silver-white, and Bridges orange for a technical, wearable-device aesthetic.

## 🎨 Color Palette

- **Background:** `#0A0F1A` (Deep navy-black)
- **Foreground:** `#00BFFF` (Bridges Cyan)
- **Cursor:** `#E8EAED` (Silver White)
- **Selection:** `#4FC3F7` (Ice Blue)
- **Success:** `#39FF14` (Signal Green)
- **Alert:** `#FF6B1A` (Bridges Orange)
- **Danger:** `#FF2020` (Critical Red)

## 🚀 Installation

### 1. Link the theme
Place the `bridges-ds` file in your Ghostty themes directory:

```bash
mkdir -p ~/.config/ghostty/themes
ln -s "$(pwd)/bridges-ds" ~/.config/ghostty/themes/bridges-ds
```

### 2. Update Ghostty Config
Add these lines to your `~/.config/ghostty/config`:

```ini
theme = bridges-ds

# Holographic UI Recommendations:
background-opacity = 0.85
background-blur-radius = 25
font-family = "Share Tech Mono"
```

## 🛠️ Design Philosophy
- **Cool-dominant at rest** — cyan and blue are the neutral/default state
- **Warms under pressure** — colors shift toward amber and red
- **Translucency over opacity** — intended for use with high blur
- **Sharp geometry** — best paired with monospace fonts like `Share Tech Mono`

---
*Theme version: 1.0.0 — Part of the Bridgegap Project*

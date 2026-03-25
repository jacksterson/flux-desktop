# Flux Widget Authoring Guide

> **Cross-platform compatibility is Flux's contract.**
> If your widget runs on Flux, it runs on Linux, Windows, and Mac.
> This guide is how we keep that promise.

This is a living document. As new cross-platform constraints are discovered during
Flux development, they are added here. Check `platform-notes.md` for the raw log.

---

## Quick Start

A Flux widget is a folder containing:

```
my-widget/
  module.json     # manifest — required
  index.html      # entry point — required
  logic.js        # optional
  styles.css      # optional
  settings.html   # optional settings panel
  assets/         # optional
```

Drop it in `~/Flux/modules/` and it appears in Flux immediately.

---

## module.json Reference

```json
{
  "id": "my-widget",
  "name": "My Widget",
  "author": "Your Name",
  "version": "1.0.0",
  "entry": "index.html",
  "window": {
    "width": 400,
    "height": 300,
    "transparent": true,
    "decorations": false,
    "windowLevel": "desktop",
    "resizable": true
  },
  "permissions": []
}
```

### windowLevel
| Value | Behaviour |
|-------|-----------|
| `"desktop"` | Above wallpaper, below all windows (default) — *Phase 2: desktop layer not yet implemented; currently behaves as `"normal"`* |
| `"top"` | Always on top of all windows |
| `"normal"` | Standard window z-ordering |

---

## The Flux API

Your widget's HTML/JS has access to these Tauri commands via `__TAURI__.core.invoke`:

### `get_system_stats`
Returns live system metrics. **Some fields are platform-dependent — always check for null.**

```typescript
interface SystemStats {
  cpu_usage: number;      // 0–100 percent
  cpu_temp: number;       // Celsius
  cpu_freq: number;       // MHz
  ram_used: number;       // bytes
  ram_total: number;      // bytes
  ram_percentage: number; // 0–100
  uptime: string;         // "HH:MM:SS"
  net_in: number;         // bytes/sec
  net_out: number;        // bytes/sec
  disk_read: number | null;   // bytes/sec — Linux only, null elsewhere
  disk_write: number | null;  // bytes/sec — Linux only, null elsewhere
  gpu: GpuStats | null;       // null if unavailable on this platform
}

interface GpuStats {
  usage: number;           // 0–100 percent
  vram_used: number;       // bytes
  vram_total: number;      // bytes
  vram_percentage: number; // 0–100
  temp: number;            // Celsius
}
```

### `drag_window`
Initiates a native window drag. Call on `mousedown` of your drag handle.

```javascript
__TAURI__.core.invoke("drag_window");
```

> **Desktop layer note (Wayland):** `drag_window` does not work on `windowLevel: "desktop"` windows on Wayland — the compositor does not expose `xdg_toplevel.move()` for layer-shell surfaces. Use `mousedown`/`pointermove` event tracking + `move_module(id, dx, dy)` for drag handles in desktop-layer widgets.

### `list_modules`
Returns all available module manifests (both active and inactive).

```typescript
interface ModuleManifest {
  id: string;
  name: string;
  author: string;
  version: string;
  entry: string;
  active: boolean;
  window: {
    width: number; height: number;
    transparent: boolean; decorations: boolean;
    windowLevel: "desktop" | "top" | "normal";
    resizable: boolean;
  };
  permissions: string[];
}

// Usage
const modules = await __TAURI__.core.invoke<ModuleManifest[]>("list_modules");
```

### `toggle_module`
Shows or hides a module window by id.

```javascript
__TAURI__.core.invoke("toggle_module", { id: "my-widget" });
```

### `move_module`
Moves a desktop-layer widget by a pixel delta. **Wayland only** — on X11 and other platforms this is a no-op; use `drag_window` instead.

```javascript
// Call repeatedly during pointermove while dragging
__TAURI__.core.invoke("move_module", { id: "my-widget", dx: deltaX, dy: deltaY });
```

`dx` and `dy` are integers (pixels). The position is persisted automatically — the widget reopens at the last dragged position.

---

## Cross-Platform Rules

Follow these rules and your widget will work everywhere.

### 1. Always handle null stats
```javascript
// Bad — crashes on Windows/Mac
document.getElementById("disk-read").textContent = fmtBytes(stats.disk_read);

// Good — safe everywhere
if (stats.disk_read !== null) {
  document.getElementById("disk-section").style.display = "";
  document.getElementById("disk-read").textContent = fmtBytes(stats.disk_read);
} else {
  document.getElementById("disk-section").style.display = "none";
}
```

### 2. No absolute file paths
Your widget runs from inside the `flux-module://` protocol. Use relative paths only.

```html
<!-- Bad -->
<img src="/home/user/my-widget/logo.png">

<!-- Good -->
<img src="assets/logo.png">
```

### 3. No Node.js APIs
Widgets run in a webview, not Node. `require()`, `fs`, `path` are not available.
All system data comes through `invoke()`.

### 4. No direct OS calls
Do not attempt to call OS APIs from the frontend. Everything goes through Flux's
Rust backend via `invoke`.

---

## Widget Compatibility Checklist

Include this as `COMPATIBILITY.md` in your widget repo before publishing:

```markdown
## Flux Compatibility

- [ ] Tested on Linux
- [ ] Tested on Windows
- [ ] Tested on Mac
- [ ] Handles `gpu: null` without UI breakage
- [ ] Handles `disk_read: null` / `disk_write: null` without UI breakage
- [ ] No hard-coded file paths
- [ ] No direct OS calls from frontend
- [ ] `module.json` is valid and complete
- [ ] Tested with `windowLevel: "desktop"`, `"top"`, and `"normal"`
```

---

## AI Prompting Guide

Flux widgets are designed to be AI-friendly. To generate a Flux-compliant widget:

1. Share this authoring guide with your AI assistant
2. Include the `SystemStats` interface above in your prompt
3. Ask the AI to handle null stats gracefully
4. Ask for a `module.json` with appropriate dimensions

Example prompt:
> "Using the Flux widget API below, create a widget that shows CPU usage as an
> animated bar. Handle the case where gpu is null. Follow all cross-platform rules."
> [paste the API section above]

---

*This guide is updated as new constraints are discovered. See `platform-notes.md` for the full log.*

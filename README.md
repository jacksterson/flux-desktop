# Flux

**A cross-platform desktop widget engine. Build anything. Run anywhere.**

Flux is an open, high-performance widget engine for Windows, macOS, and Linux. Load widgets written in HTML, CSS, and JavaScript. Bind them to live system data. Position them anywhere on your desktop.

Think Rainmeter — but cross-platform, GPU-accelerated, and built for the modern web stack.

> **Status: Active Development — Pre-release**
> Core engine is functional. Not yet packaged for end-user install. If you want to tinker, build from source.

---

## What It Does

Flux runs lightweight webview windows on your desktop — click-through, always-on, positioned wherever you want. Each window is a widget: a self-contained HTML/CSS/JS file that reads live system data through a simple JavaScript API.

No proprietary scripting language. No Windows-only dependencies. Just web code.

---

## Current Features

| Feature | Status |
|---|---|
| Windows / macOS / Linux support | Done |
| System tray + background daemon | Done |
| Click-through desktop webview windows | Done |
| Live system metrics (CPU, RAM, GPU, network, disk) | Done |
| Per-metric history (configurable ring buffer) | Done |
| Alert thresholds with OS notifications | Done |
| Widget editor with drag-and-drop positioning | Done |
| Battery/performance mode controls | Done |
| Widget install from archive | Done |
| Widget gallery / marketplace | Planned |
| End-user installer | Planned |

---

## Widget API

Widgets talk to the engine through `WidgetAPI`, a JavaScript namespace injected at runtime:

```js
// Live system metrics
const cpu = await WidgetAPI.system.cpu();
const mem = await WidgetAPI.system.memory();
const net = await WidgetAPI.system.network();

// Historical data (last N ticks)
const history = await WidgetAPI.system.history("cpu", 60);

// Alert thresholds
WidgetAPI.alerts.register({
  metric: "cpu",
  op: "gt",
  threshold: 90,
  message: "CPU is on fire"
});

WidgetAPI.alerts.onAlert((alert) => {
  console.log("Fired:", alert.message);
});
```

A widget is just an HTML file. If it runs in a browser, it runs in Flux.

---

## Build From Source

**Requirements:** Rust (stable), Node.js 18+, platform build tools ([Tauri prerequisites](https://tauri.app/start/prerequisites/))

```bash
git clone https://github.com/jacksterson/flux-desktop
cd flux-desktop/app
npm install
npm run tauri dev
```

For a release build:

```bash
npm run tauri build
```

Binaries land in `app/src-tauri/target/release/`.

---

## License

**Personal use is free.**

Flux is dual-licensed:

- **Free** for personal, non-commercial use
- **Paid Commercial License** required for: streaming/content creation with monetization, business use, or redistributed widget packs sold for profit

See [LICENSE](LICENSE) for full terms. *(Coming soon.)*

---

## Support Development

Flux is built by one developer. If it's useful to you, Ko-fi sponsorships and GitHub Sponsors help keep it going.

Early sponsors get early access to the **Koji Suite** — a cinematic widget pack inspired by gaming aesthetics, and the first official pack built for Flux.

**[Support on Ko-fi](https://ko-fi.com)** <!-- replace with your link -->

---

## Contributing

The engine is the priority right now. Contributions welcome once the architecture stabilizes — watch the repo for a CONTRIBUTING guide.

Widget packs are already fair game. If you build something, open a discussion.

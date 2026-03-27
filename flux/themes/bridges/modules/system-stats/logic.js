// System Stats Module Logic
// Data is received via WidgetAPI push subscriptions — no polling.

// --- Formatting ---
const toGiB = (b) => (b / (1024 ** 3)).toFixed(1);
const toGHz = (m) => (m / 1000).toFixed(1);
const fmtBS = (b) => {
  if (b < 1024) return `${b.toFixed(0)} B/s`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB/s`;
};

// --- Config State ---
const DEFAULT_STATE = {
  cfg: { amberUsage: 70, redUsage: 90, amberTemp: 75, redTemp: 85, bgAlpha: 80 },
  theme: {
    primary: "#00BFFF",
    primary_soft: "#4FC3F7",
    caution: "#FFC107",
    danger: "#FF2020",
    font_main: "'JetBrainsMono Nerd Font', 'Rajdhani', sans-serif",
    font_tech: "'JetBrainsMono Nerd Font', 'Share Tech Mono', monospace"
  }
};

let state = JSON.parse(localStorage.getItem("flux_sys_stats_state")) || DEFAULT_STATE;

function applyState() {
  const root = document.documentElement;
  root.style.setProperty("--color-hud-primary", state.theme.primary);
  root.style.setProperty("--color-hud-primary-soft", state.theme.primary_soft);
  root.style.setProperty("--color-hud-caution", state.theme.caution);
  root.style.setProperty("--color-hud-danger", state.theme.danger);
  root.style.setProperty("--font-main", state.theme.font_main);
  root.style.setProperty("--font-tech", state.theme.font_tech);

  const r = 10, g = 15, b = 26;
  root.style.setProperty("--color-bg-base", `rgba(${r}, ${g}, ${b}, ${state.cfg.bgAlpha / 100})`);
}

// Refresh when settings window saves data
window.addEventListener('storage', () => {
  state = JSON.parse(localStorage.getItem("flux_sys_stats_state")) || DEFAULT_STATE;
  applyState();
});

// --- Graph Engine ---
class FluxGraph {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.history = [];
    this.maxPoints = 60;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0) return;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    // Use setTransform instead of scale() to reset the matrix to exactly the
    // desired DPR scale — prevents DPR accumulation across multiple resize calls.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  update(value, max, color) {
    this.history.push(value);
    if (this.history.length > this.maxPoints) this.history.shift();
    this.draw(max, color);
  }

  draw(max, color) {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    this.ctx.clearRect(0, 0, w, h);
    if (this.history.length < 2) return;

    const step = w / (this.maxPoints - 1);
    const startX = w - ((this.history.length - 1) * step);
    const m = Math.max(1, max);

    this.ctx.beginPath();
    this.ctx.moveTo(startX, h);
    for (let i = 0; i < this.history.length; i++) {
      const x = startX + (i * step);
      this.ctx.lineTo(x, h - (Math.max(0.5, this.history[i]) / m) * h);
    }
    this.ctx.lineTo(w, h);
    this.ctx.closePath();
    this.ctx.fillStyle = color + "22";
    this.ctx.fill();

    this.ctx.beginPath();
    for (let i = 0; i < this.history.length; i++) {
      const x = startX + (i * step);
      const y = h - (Math.max(0.5, this.history[i]) / m) * h;
      if (i === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
    }
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.5;
    this.ctx.shadowBlur = 4; this.ctx.shadowColor = color;
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
  }
}

function getSeverityColor(val, temp) {
  if (val >= state.cfg.redUsage || temp >= state.cfg.redTemp) return state.theme.danger;
  if (val >= state.cfg.amberUsage || temp >= state.cfg.amberTemp) return state.theme.caution;
  return state.theme.primary;
}

// --- Uptime display ---
// Fetch uptime once on load, then update the counter locally every second.
let uptimeSeconds = 0;

function formatUptime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- Cleanup registry (called by engine on hot-reload) ---
// <script src="logic.js"> is at the end of <body>, so the DOM is already fully
// parsed when this script runs — no DOMContentLoaded wrapper needed.
const _unlisteners = [];
let _uptimeInterval = null;

function _cleanup() {
  _unlisteners.forEach(fn => fn && fn());
  clearInterval(_uptimeInterval);
}
window._fluxCleanup = _cleanup;

// --- Init ---

const cpuGraph = new FluxGraph("cpu-graph");
const ramGraph = new FluxGraph("ram-graph");
const gpuGraph = new FluxGraph("gpu-graph");
const netGraph = new FluxGraph("net-graph");
const diskGraph = new FluxGraph("disk-graph");

WidgetAPI.system.uptime().then((secs) => {
  uptimeSeconds = secs;
  document.getElementById("uptime").textContent = formatUptime(uptimeSeconds);
}).catch(() => {});

_uptimeInterval = setInterval(() => {
  uptimeSeconds += 1;
  document.getElementById("uptime").textContent = formatUptime(uptimeSeconds);
}, 1000);

// --- Subscribe to pushed events ---

// CPU
_unlisteners.push(WidgetAPI.system.subscribe('cpu', (data) => {
  const cpuPct = data.avg_usage;
  const cpuTemp = data.cpu_temp != null ? data.cpu_temp : 0;
  const cpuFreqMHz = data.frequency;
  const cColor = getSeverityColor(cpuPct, cpuTemp);

  document.getElementById("cpu-usage").textContent = `${cpuPct.toFixed(1)}%`;
  document.getElementById("cpu-temp").textContent = `${cpuTemp.toFixed(0)}°C`;
  document.getElementById("cpu-freq").textContent = `${toGHz(cpuFreqMHz)} GHz`;
  document.querySelector("#cpu-section .stats-right").style.color = cColor;
  cpuGraph.update(cpuPct, 100, cColor);
}));

// Memory
_unlisteners.push(WidgetAPI.system.subscribe('memory', (data) => {
  const ramUsed = data.used;
  const ramTotal = data.total;
  const ramPct = ramTotal > 0 ? (ramUsed / ramTotal) * 100 : 0;
  const rColor = getSeverityColor(ramPct, 0);

  document.getElementById("ram-percentage").textContent = `${ramPct.toFixed(1)}%`;
  document.getElementById("ram-used").textContent = `${toGiB(ramUsed)}/${toGiB(ramTotal)} GiB`;
  document.querySelector("#ram-section .stats-right").style.color = rColor;
  ramGraph.update(ramPct, 100, rColor);
}));

// GPU — null if no GPU detected
_unlisteners.push(WidgetAPI.system.subscribe('gpu', (data) => {
  if (!data) return;
  const vramPct = data.vram_percentage;
  const gpuTemp = data.temp != null ? data.temp : 0;
  const gColor = getSeverityColor(vramPct, gpuTemp);

  document.getElementById("gpu-usage-pct").textContent = `${vramPct.toFixed(1)}%`;
  document.getElementById("gpu-temp").textContent = `${gpuTemp.toFixed(0)}°C`;
  document.getElementById("vram-info").textContent = `${toGiB(data.vram_used)}/${toGiB(data.vram_total)} GiB`;
  document.querySelector("#gpu-section .stats-right").style.color = gColor;
  gpuGraph.update(vramPct, 100, gColor);
}));

// Network — broadcaster emits an array of per-interface objects; sum across all.
_unlisteners.push(WidgetAPI.system.subscribe('network', (data) => {
  const interfaces = Array.isArray(data) ? data : [data];
  const netIn  = interfaces.reduce((sum, iface) => sum + (iface.received    || 0), 0);
  const netOut = interfaces.reduce((sum, iface) => sum + (iface.transmitted || 0), 0);

  document.getElementById("net-in").textContent  = `IN: ${fmtBS(netIn)}`;
  document.getElementById("net-out").textContent = `OUT: ${fmtBS(netOut)}`;
  netGraph.update(netIn + netOut, 1024 * 1024 * 2, state.theme.primary);
}));

// Disk I/O — fields are `read` and `write` (optional u64, null on non-Linux)
_unlisteners.push(WidgetAPI.system.subscribe('disk-io', (data) => {
  const diskRead  = data.read  != null ? data.read  : 0;
  const diskWrite = data.write != null ? data.write : 0;

  document.getElementById("disk-read").textContent  = `READ: ${fmtBS(diskRead)}`;
  document.getElementById("disk-write").textContent = `WRITE: ${fmtBS(diskWrite)}`;
  diskGraph.update(diskRead + diskWrite, 1024 * 1024 * 10, state.theme.primary);
}));

// --- Mouse / spotlight effect ---
const container = document.getElementById("main-container");
window.addEventListener("mousemove", (e) => {
  const rect = container.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  container.style.setProperty("--mouse-x", `${x}px`);
  container.style.setProperty("--mouse-y", `${y}px`);
  const buffer = 2;
  const isInside = (e.clientX >= rect.left + buffer && e.clientX <= rect.right - buffer &&
                    e.clientY >= rect.top  + buffer && e.clientY <= rect.bottom - buffer);
  container.style.setProperty("--pattern-opacity", isInside ? "1" : "0");
});

// --- Drag & Resize via WidgetAPI ---
container.addEventListener("mousedown", (e) => {
  const target = e.target;
  if (
    target.id === "main-container" ||
    target.id === "spotlight" ||
    target.closest("header") ||
    target.closest(".section-text") ||
    target.closest(".io-box")
  ) {
    if (target.id !== "open-settings" && !target.classList.contains("resizer")) {
      WidgetAPI.widget.drag(e);
    }
  }
});

document.querySelectorAll(".resizer").forEach(r => {
  r.onmousedown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const dir = r.dataset.direction;
    if (dir) WidgetAPI.widget.resize(dir, e);
  };
});

// --- Settings ---
document.getElementById("open-settings").onclick = () => {
  WidgetAPI.widget.openSettings();
};

applyState();

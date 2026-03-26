// System Stats Module Logic
const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const appWindow = getCurrentWindow();

// --- Formatting ---
const toGiB = (b) => (b / (1024 ** 3)).toFixed(1);
const toGHz = (m) => (m / 1000).toFixed(1);
const fmtBS = (b) => {
  if (b < 1024) return `${b.toFixed(0)} B/s`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / (1024 * (1024))).toFixed(1)} MB/s`;
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

// Refresh logic when settings window saves data
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
    this.ctx.scale(dpr, dpr);
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

const cpuGraph = new FluxGraph("cpu-graph");
const ramGraph = new FluxGraph("ram-graph");
const gpuGraph = new FluxGraph("gpu-graph");
const netGraph = new FluxGraph("net-graph");
const diskGraph = new FluxGraph("disk-graph");

function getSeverityColor(val, temp) {
  if (val >= state.cfg.redUsage || temp >= state.cfg.redTemp) return state.theme.danger;
  if (val >= state.cfg.amberUsage || temp >= state.cfg.amberTemp) return state.theme.caution;
  return state.theme.primary;
}

async function tick() {
  try {
    const stats = await invoke("get_system_stats");
    document.getElementById("uptime").textContent = stats.uptime;

    // CPU
    const cColor = getSeverityColor(stats.cpu_usage, stats.cpu_temp);
    document.getElementById("cpu-usage").textContent = `${stats.cpu_usage.toFixed(1)}%`;
    document.getElementById("cpu-temp").textContent = `${stats.cpu_temp.toFixed(0)}°C`;
    document.getElementById("cpu-freq").textContent = `${toGHz(stats.cpu_freq)} GHz`;
    document.querySelector("#cpu-section .stats-right").style.color = cColor;
    cpuGraph.update(stats.cpu_usage, 100, cColor);

    // GPU
    if (stats.gpu) {
      const vramPct = stats.gpu.vram_percentage;
      const gColor = getSeverityColor(vramPct, stats.gpu.temp);
      document.getElementById("gpu-usage-pct").textContent = `${vramPct.toFixed(1)}%`;
      document.getElementById("gpu-temp").textContent = `${stats.gpu.temp.toFixed(0)}°C`;
      document.getElementById("vram-info").textContent = `${toGiB(stats.gpu.vram_used)}/${toGiB(stats.gpu.vram_total)} GiB`;
      document.querySelector("#gpu-section .stats-right").style.color = gColor;
      gpuGraph.update(vramPct, 100, gColor);
    }

    // RAM
    const rColor = getSeverityColor(stats.ram_percentage, 0);
    document.getElementById("ram-percentage").textContent = `${stats.ram_percentage.toFixed(1)}%`;
    document.getElementById("ram-used").textContent = `${toGiB(stats.ram_used)}/${toGiB(stats.ram_total)} GiB`;
    document.querySelector("#ram-section .stats-right").style.color = rColor;
    ramGraph.update(stats.ram_percentage, 100, rColor);

    // IO
    document.getElementById("net-in").textContent = `IN: ${fmtBS(stats.net_in)}`;
    document.getElementById("net-out").textContent = `OUT: ${fmtBS(stats.net_out)}`;
    document.getElementById("disk-read").textContent = `READ: ${fmtBS(stats.disk_read)}`;
    document.getElementById("disk-write").textContent = `WRITE: ${fmtBS(stats.disk_write)}`;
    netGraph.update(stats.net_in + stats.net_out, 1024 * 1024 * 2, state.theme.primary);
    diskGraph.update(stats.disk_read + stats.disk_write, 1024 * 1024 * 10, state.theme.primary);

  } catch (e) { console.error(e); }
}

// Events
const container = document.getElementById("main-container");
window.addEventListener("mousemove", (e) => {
  const rect = container.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  container.style.setProperty("--mouse-x", `${x}px`);
  container.style.setProperty("--mouse-y", `${y}px`);
  const buffer = 2;
  const isInside = (e.clientX >= rect.left + buffer && e.clientX <= rect.right - buffer && e.clientY >= rect.top + buffer && e.clientY <= rect.bottom - buffer);
  container.style.setProperty("--pattern-opacity", isInside ? "1" : "0");
});

// Improved Drag & Interaction Logic
container.addEventListener("mousedown", (e) => {
  const target = e.target;
  
  // 1. Drag Trigger: If clicking background, pattern, header, or section text
  // but NOT resizers or the settings title
  if (
    target.id === "main-container" || 
    target.id === "spotlight" || 
    target.closest("header") || 
    target.closest(".section-text") ||
    target.closest(".io-box")
  ) {
    // Only drag if it's NOT the actual settings h1 or a resizer
    if (target.id !== "open-settings" && !target.classList.contains("resizer")) {
      appWindow.startDragging();
    }
  }
});

document.querySelectorAll(".resizer").forEach(r => {
  r.onmousedown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const dir = r.dataset.direction;
    if (dir) appWindow.startResizing(dir);
  };
});

document.getElementById("open-settings").onclick = () => {
  invoke("open_module_settings", { id: "system-stats" });
};

applyState();
setInterval(tick, 1000);
tick();

// Koji Pro // System Stats Logic
// Optimized for shared-hud.css and modern Flux design system.

const toGiB = (b) => (b / (1024 ** 3)).toFixed(1);
const toGHz = (m) => (m / 1000).toFixed(1);
const fmtBS = (b) => {
  if (b < 1024) return `${Math.round(b)} B/s`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB/s`;
};

// --- Config State ---
const DEFAULT_CFG = { amberUsage: 70, redUsage: 90, amberTemp: 75, redTemp: 85 };
let cfg = JSON.parse(localStorage.getItem("koji_sys_stats_cfg")) || DEFAULT_CFG;

// Refresh when settings window saves data
window.addEventListener('storage', () => {
  cfg = JSON.parse(localStorage.getItem("koji_sys_stats_cfg")) || DEFAULT_CFG;
});

// --- Color helpers ---
function getGlowColor(val, warnAt, dangerAt) {
  if (val >= dangerAt) return 'var(--color-hud-danger)';
  if (val >= warnAt) return 'var(--color-hud-caution)';
  return 'var(--color-hud-primary)';
}

function setBar(fillId, metaId, pct, metaText, warnAt, dangerAt) {
  const fill = document.getElementById(fillId);
  const meta = document.getElementById(metaId);
  const clampedPct = Math.min(100, Math.max(0, pct));
  const color = getGlowColor(clampedPct, warnAt, dangerAt);
  if (fill) { fill.style.setProperty('--fill', clampedPct + '%'); fill.style.setProperty('--bar-color', color); }
  if (meta) meta.textContent = metaText;
}

// --- Graph Engine ---
class FluxGraph {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.history = [];
    this.maxPoints = 40;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0) return;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
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
    this.ctx.fillStyle = color + "11";
    this.ctx.fill();

    this.ctx.beginPath();
    for (let i = 0; i < this.history.length; i++) {
      const x = startX + (i * step);
      const y = h - (Math.max(0.5, this.history[i]) / m) * h;
      if (i === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
    }
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }
}

function getStatusColor(val, temp) {
  const root = getComputedStyle(document.documentElement);
  if (val >= cfg.redUsage || temp >= cfg.redTemp) return root.getPropertyValue('--color-hud-danger').trim();
  if (val >= cfg.amberUsage || temp >= cfg.amberTemp) return root.getPropertyValue('--color-hud-caution').trim();
  return root.getPropertyValue('--color-hud-primary').trim();
}

// --- Uptime ---
let uptimeSeconds = 0;
function formatUptime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- Cleanup & Subs ---
const _unlisteners = [];
let _uptimeInterval = null;

function _cleanup() {
  _unlisteners.forEach(fn => fn && fn());
  clearInterval(_uptimeInterval);
}
window._fluxCleanup = _cleanup;

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

_unlisteners.push(WidgetAPI.system.subscribe('cpu', (data) => {
  const cpuPct = data.avg_usage;
  const cpuTemp = data.cpu_temp || 0;
  const color = getStatusColor(cpuPct, cpuTemp);

  // Hero display
  document.getElementById("cpu-usage").textContent = `${cpuPct.toFixed(1)}%`;
  document.getElementById("cpu-temp").textContent = `${cpuTemp.toFixed(0)}°C`;
  document.getElementById("cpu-freq").textContent = `${toGHz(data.frequency)} GHz`;

  // Hero glow
  document.getElementById("main-container").style.setProperty('--current-glow', getGlowColor(cpuPct, cfg.amberUsage, cfg.redUsage));

  // CPU scan bar
  setBar('cpu-bar-fill', 'cpu-bar-meta', cpuPct, `${cpuPct.toFixed(1)}%`, cfg.amberUsage, cfg.redUsage);

  cpuGraph.update(cpuPct, 100, color);
}));

_unlisteners.push(WidgetAPI.system.subscribe('memory', (data) => {
  const pct = (data.used / data.total) * 100;
  const color = getStatusColor(pct, 0);

  document.getElementById("ram-used").textContent = `${toGiB(data.used)}/${toGiB(data.total)} GiB`;

  // RAM scan bar (also updates ram-percentage label)
  setBar('ram-bar-fill', 'ram-percentage', pct, `${pct.toFixed(1)}%`, cfg.amberUsage, cfg.redUsage);

  ramGraph.update(pct, 100, color);
}));

_unlisteners.push(WidgetAPI.system.subscribe('gpu', (data) => {
  if (!data) return;
  const color = getStatusColor(data.vram_percentage, data.temp || 0);

  // GPU scan bar (also updates gpu-usage-pct label)
  setBar('gpu-bar-fill', 'gpu-usage-pct', data.vram_percentage, `${data.vram_percentage.toFixed(1)}%`, cfg.amberUsage, cfg.redUsage);

  gpuGraph.update(data.vram_percentage, 100, color);
}));

_unlisteners.push(WidgetAPI.system.subscribe('network', (data) => {
  const interfaces = Array.isArray(data) ? data : [data];
  const netIn  = interfaces.reduce((sum, iface) => sum + (iface.received    || 0), 0);
  const netOut = interfaces.reduce((sum, iface) => sum + (iface.transmitted || 0), 0);
  const rootStyle = getComputedStyle(document.documentElement);
  const primary = rootStyle.getPropertyValue('--color-hud-primary').trim();

  document.getElementById("net-in").textContent  = `IN: ${fmtBS(netIn)}`;
  document.getElementById("net-out").textContent = `OUT: ${fmtBS(netOut)}`;
  netGraph.update(netIn + netOut, 1024 * 1024 * 2, primary);
}));

_unlisteners.push(WidgetAPI.system.subscribe('disk-io', (data) => {
  const read  = data.read  || 0;
  const write = data.write || 0;
  const rootStyle = getComputedStyle(document.documentElement);
  const primary = rootStyle.getPropertyValue('--color-hud-primary').trim();

  document.getElementById("disk-read").textContent  = `R: ${fmtBS(read)}`;
  document.getElementById("disk-write").textContent = `W: ${fmtBS(write)}`;
  diskGraph.update(read + write, 1024 * 1024 * 10, primary);
}));

// --- Spotlight & Drag ---
const container = document.getElementById('main-container');
window.addEventListener('mousemove', (e) => {
  const r = container.getBoundingClientRect();
  container.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
  container.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
  const inBounds = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  container.style.setProperty('--pattern-opacity', inBounds ? '1' : '0');
});

container.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-no-drag]')) return;
  if (e.target.closest('[data-open-settings]')) return;
  if (e.target.closest('.resizer')) return;
  WidgetAPI.widget.drag(e);
});

document.querySelectorAll('.resizer').forEach(r => {
  r.onmousedown = (e) => {
    e.preventDefault(); e.stopPropagation();
    WidgetAPI.widget.resize(r.dataset.direction, e);
  };
});

document.querySelectorAll('[data-open-settings]').forEach(el =>
  el.addEventListener('click', () => WidgetAPI.widget.openSettings())
);

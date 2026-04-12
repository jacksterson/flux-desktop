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

// For bars with CSS gradient (MEM) — only updates width, not color
function setBarWidth(fillId, metaId, pct, metaText) {
  const fill = document.getElementById(fillId);
  const meta = document.getElementById(metaId);
  if (fill) fill.style.setProperty('--fill', Math.min(100, Math.max(0, pct)) + '%');
  if (meta) meta.textContent = metaText;
}

// Returns rgba color string (with ALPHA placeholder) for dot graphs
// Uses same thresholds as getStatusColor but avoids CSS var comparison
function dotColor(val, temp) {
  if (val >= cfg.redUsage   || (temp && temp >= cfg.redTemp))   return 'rgba(255,32,32,ALPHA)';
  if (val >= cfg.amberUsage || (temp && temp >= cfg.amberTemp)) return 'rgba(255,193,7,ALPHA)';
  return 'rgba(0,191,255,ALPHA)';
}

// --- Graph Engine ---
class DotGraph {
  constructor(canvas, color, max) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = color; // CSS color with 'ALPHA' placeholder, e.g. 'rgba(0,191,255,ALPHA)'
    this.max = max;
    this.history = [];
    this._ro = new ResizeObserver(() => this._onResize());
    this._ro.observe(canvas);
    this._onResize();
  }

  _onResize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._draw();
  }

  push(value) {
    this.history.push(value);
    if (this.history.length > 80) this.history.shift();
    this._draw();
  }

  _draw() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.ctx.clearRect(0, 0, w, h);

    const DOT = 4, R = 1.7;
    const numCols = Math.floor(w / DOT);
    const numRows = Math.floor(h / DOT);

    // Horizontal guide lines at 25%, 50%, 75%
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(0,191,255,0.07)';
    this.ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(f => {
      const y = h - f * h;
      this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(w, y); this.ctx.stroke();
    });
    this.ctx.restore();

    const slice = this.history.slice(-numCols);
    for (let ci = 0; ci < slice.length; ci++) {
      const colX = (numCols - slice.length + ci) * DOT;
      const filled = Math.round((Math.min(slice[ci], this.max) / this.max) * numRows);
      for (let ri = 0; ri < filled; ri++) {
        const alpha = 0.25 + (ri / Math.max(filled - 1, 1)) * 0.55;
        this.ctx.fillStyle = this.color.replace('ALPHA', alpha.toFixed(2));
        this.ctx.beginPath();
        this.ctx.arc(colX + DOT / 2, h - (ri + 0.5) * DOT, R, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }
}

class DualGraph {
  constructor(canvasA, canvasB, colorA, colorB, initialMax) {
    this.canvasA = canvasA;
    this.canvasB = canvasB;
    this.ctxA = canvasA.getContext('2d');
    this.ctxB = canvasB.getContext('2d');
    this.colorA = colorA; // 'rgba(0,191,255,ALPHA)'
    this.colorB = colorB; // 'rgba(255,107,26,ALPHA)'
    this.max = initialMax || 1;
    this.fixedMax = null; // set externally to pin scale (e.g. total RAM)
    this.histA = [];
    this.histB = [];
    this._ro = new ResizeObserver(() => this._onResize());
    this._ro.observe(canvasA);
    this._ro.observe(canvasB);
    this._onResize();
  }

  _onResize() {
    const dpr = window.devicePixelRatio || 1;
    const ctxMap = [[this.canvasA, this.ctxA], [this.canvasB, this.ctxB]];
    for (const [c, ctx] of ctxMap) {
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) continue;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this._draw();
  }

  push(a, b) {
    this.histA.push(a); this.histB.push(b);
    if (this.histA.length > 80) { this.histA.shift(); this.histB.shift(); }
    if (!this.fixedMax) {
      this.max = Math.max(1, ...this.histA.slice(-60), ...this.histB.slice(-60));
    } else {
      this.max = this.fixedMax;
    }
    this._draw();
  }

  _drawChan(ctx, canvas, hist, color, fromTop) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const DOT = 4, R = 1.7;
    const numCols = Math.floor(w / DOT);
    const numRows = Math.floor(h / DOT);
    const slice = hist.slice(-numCols);
    for (let ci = 0; ci < slice.length; ci++) {
      const colX = (numCols - slice.length + ci) * DOT;
      const filled = Math.round((Math.min(slice[ci], this.max) / this.max) * numRows);
      for (let ri = 0; ri < filled; ri++) {
        const alpha = 0.25 + (ri / Math.max(filled - 1, 1)) * 0.55;
        ctx.fillStyle = color.replace('ALPHA', alpha.toFixed(2));
        const dotY = fromTop ? (ri + 0.5) * DOT : h - (ri + 0.5) * DOT;
        ctx.beginPath();
        ctx.arc(colX + DOT / 2, dotY, R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _draw() {
    this._drawChan(this.ctxA, this.canvasA, this.histA, this.colorA, false); // A: bottom→up
    this._drawChan(this.ctxB, this.canvasB, this.histB, this.colorB, true);  // B: top→down
  }
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

const gCpu  = new DotGraph(document.getElementById('g-cpu'),  'rgba(0,191,255,ALPHA)', 100);
const gGpu  = new DotGraph(document.getElementById('g-gpu'),  'rgba(0,191,255,ALPHA)', 100);
const gMem  = new DualGraph(
  document.getElementById('g-mem-a'), document.getElementById('g-mem-b'),
  'rgba(255,107,26,ALPHA)', 'rgba(0,191,255,ALPHA)', 1
);
const gNet  = new DualGraph(
  document.getElementById('g-net-a'), document.getElementById('g-net-b'),
  'rgba(0,191,255,ALPHA)', 'rgba(255,107,26,ALPHA)', 1
);
const gDisk = new DualGraph(
  document.getElementById('g-disk-a'), document.getElementById('g-disk-b'),
  'rgba(0,191,255,ALPHA)', 'rgba(255,107,26,ALPHA)', 1
);

WidgetAPI.system.uptime().then((secs) => {
  uptimeSeconds = secs;
  document.getElementById("uptime").textContent = formatUptime(uptimeSeconds);
}).catch(() => {});

_uptimeInterval = setInterval(() => {
  uptimeSeconds += 1;
  document.getElementById("uptime").textContent = formatUptime(uptimeSeconds);
}, 1000);

_unlisteners.push(WidgetAPI.system.subscribe('cpu', (data) => {
  const cpuPct  = data.avg_usage;
  const cpuTemp = data.cpu_temp || 0;

  document.getElementById('cpu-usage').textContent = `${cpuPct.toFixed(1)}%`;
  document.getElementById('cpu-temp').textContent  = `${cpuTemp.toFixed(0)}°C`;
  document.getElementById('cpu-freq').textContent  = `${toGHz(data.frequency)} GHz`;

  document.getElementById('main-container').style.setProperty(
    '--current-glow', getGlowColor(cpuPct, cfg.amberUsage, cfg.redUsage)
  );

  setBar('cpu-bar-fill', 'cpu-bar-meta', cpuPct, `${cpuPct.toFixed(1)}%`, cfg.amberUsage, cfg.redUsage);

  gCpu.color = dotColor(cpuPct, cpuTemp);
  gCpu.push(cpuPct);
}));

_unlisteners.push(WidgetAPI.system.subscribe('memory', (data) => {
  const usedGiB  = parseFloat(toGiB(data.used));
  const totalGiB = parseFloat(toGiB(data.total));
  const availGiB = parseFloat((totalGiB - usedGiB).toFixed(1));
  const usedPct  = (data.used / data.total) * 100;
  const availPct = (availGiB / totalGiB) * 100;

  document.getElementById('mem-total-label').textContent = `${totalGiB} GiB`;

  setBarWidth('mem-used-fill',  'mem-used-val',  usedPct,  `${usedGiB} GiB`);
  setBarWidth('mem-avail-fill', 'mem-avail-val', availPct, `${availGiB} GiB`);

  gMem.fixedMax = totalGiB;
  gMem.push(usedGiB, availGiB);
}));

_unlisteners.push(WidgetAPI.system.subscribe('gpu', (data) => {
  if (!data) return;
  const temp  = data.temp || 0;
  const vramP = data.vram_percentage;

  document.getElementById('gpu-temp-label').textContent = `${temp.toFixed(0)}°C`;

  setBar('gpu-bar-fill', 'gpu-vram-pct', vramP, `${vramP.toFixed(1)}%`, cfg.amberUsage, cfg.redUsage);

  gGpu.color = dotColor(vramP, temp);
  gGpu.push(vramP);
}));

_unlisteners.push(WidgetAPI.system.subscribe('network', (data) => {
  const interfaces = Array.isArray(data) ? data : [data];
  const netIn  = interfaces.reduce((s, i) => s + (i.received    || 0), 0);
  const netOut = interfaces.reduce((s, i) => s + (i.transmitted || 0), 0);

  document.getElementById('net-in-val').textContent  = fmtBS(netIn);
  document.getElementById('net-out-val').textContent = fmtBS(netOut);

  gNet.push(netIn, netOut);
}));

_unlisteners.push(WidgetAPI.system.subscribe('disk-io', (data) => {
  const read  = data.read  || 0;
  const write = data.write || 0;

  setBar('disk-read-fill',  'disk-read-val',  (read  / (1024 * 1024 * 50)) * 100, fmtBS(read),  cfg.amberUsage, cfg.redUsage);
  setBar('disk-write-fill', 'disk-write-val', (write / (1024 * 1024 * 50)) * 100, fmtBS(write), cfg.amberUsage, cfg.redUsage);

  gDisk.push(read, write);
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

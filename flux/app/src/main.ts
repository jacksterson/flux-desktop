import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

// --- Types ---
interface Theme { 
  primary: string; primary_soft: string; neutral: string; safe: string; 
  caution: string; alert: string; danger: string; chiral: string;
  bg_base: string; bg_panel: string; border_default: string; 
  font_main: string; font_tech: string; font_header: string;
}

interface SkinManifest { name: string; theme: Theme; modules: any[]; }
interface GpuStats { usage: number; vram_used: number; vram_total: number; vram_percentage: number; temp: number; }
interface SystemStats { cpu_usage: number; cpu_temp: number; cpu_freq: number; ram_used: number; ram_total: number; ram_percentage: number; uptime: string; net_in: number; net_out: number; disk_read: number | null; disk_write: number | null; gpu?: GpuStats; }

const toGiB = (b: number) => (b / (1024 ** 3)).toFixed(1);
const toGHz = (m: number) => (m / 1000).toFixed(1);
const fmtBS = (b: number) => {
  if (b < 1024) return `${b.toFixed(0)} B/s`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB/s`;
};

// --- Graph Engine ---
class FluxGraph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private history: number[] = [];
  private maxPoints = 80;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    if (rect.width === 0) return;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  update(value: number, max: number, color: string) {
    this.history.push(value);
    if (this.history.length > this.maxPoints) this.history.shift();
    this.draw(max, color);
  }

  private draw(max: number, color: string) {
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

// --- System Stats Module ---
class SystemStatsModule {
  private cpuGraph = new FluxGraph("cpu-graph");
  private ramGraph = new FluxGraph("ram-graph");
  private gpuGraph = new FluxGraph("gpu-graph");
  private netGraph = new FluxGraph("net-graph");
  private diskGraph = new FluxGraph("disk-graph");

  private getChiralColor(val: number, theme: Theme) {
    if (val >= 80) return theme.safe;
    if (val >= 60) return theme.primary;
    if (val >= 40) return theme.caution;
    if (val >= 20) return theme.alert;
    return theme.danger;
  }

  update(stats: SystemStats, _cfg: any, theme: Theme) {
    const applyStyle = (id: string, color: string) => {
        const el = document.querySelector(`#${id} .stats-right`) as HTMLElement;
        if (el) el.style.color = color;
    };

    // CPU
    const cColor = this.getChiralColor(100 - stats.cpu_usage, theme);
    document.getElementById("cpu-usage")!.textContent = `${stats.cpu_usage.toFixed(1)}%`;
    document.getElementById("cpu-temp")!.textContent = `${stats.cpu_temp.toFixed(0)}°C`;
    document.getElementById("cpu-freq")!.textContent = `${toGHz(stats.cpu_freq)} GHz`;
    applyStyle("cpu-section", cColor);
    this.cpuGraph.update(stats.cpu_usage, 100, cColor);

    // GPU
    if (stats.gpu) {
      const gColor = this.getChiralColor(100 - stats.gpu.usage, theme);
      document.getElementById("gpu-usage-pct")!.textContent = `${stats.gpu.usage}%`;
      document.getElementById("gpu-temp")!.textContent = `${stats.gpu.temp.toFixed(0)}°C`;
      document.getElementById("vram-info")!.textContent = `${toGiB(stats.gpu.vram_used)}/${toGiB(stats.gpu.vram_total)} GiB`;
      applyStyle("gpu-section", gColor);
      this.gpuGraph.update(stats.gpu.usage || stats.gpu.vram_percentage, 100, gColor);
    }

    // RAM
    const rColor = this.getChiralColor(100 - stats.ram_percentage, theme);
    document.getElementById("ram-percentage")!.textContent = `${stats.ram_percentage.toFixed(1)}%`;
    document.getElementById("ram-used")!.textContent = `${toGiB(stats.ram_used)}/${toGiB(stats.ram_total)} GiB`;
    applyStyle("ram-section", rColor);
    this.ramGraph.update(stats.ram_percentage, 100, rColor);

    // IO
    document.getElementById("net-in")!.textContent = `IN: ${fmtBS(stats.net_in)}`;
    document.getElementById("net-out")!.textContent = `OUT: ${fmtBS(stats.net_out)}`;
    this.netGraph.update(stats.net_in + stats.net_out, 1024*1024*2, theme.primary);

    const diskSection = document.getElementById("disk-section");
    if (stats.disk_read !== null && stats.disk_write !== null) {
      document.getElementById("disk-read")!.textContent = `READ: ${fmtBS(stats.disk_read)}`;
      document.getElementById("disk-write")!.textContent = `WRITE: ${fmtBS(stats.disk_write)}`;
      this.diskGraph.update(stats.disk_read + stats.disk_write, 1024 * 1024 * 10, theme.primary);
      if (diskSection) diskSection.style.display = "";
    } else {
      if (diskSection) diskSection.style.display = "none";
    }
  }
}

// --- App Shell ---
class FluxShell {
  private theme!: Theme;
  private sysModule = new SystemStatsModule();
  private cfg = { amberUsage: 70, redUsage: 90, amberTemp: 75, redTemp: 85 };

  async boot() {
    const response = await fetch("/skins/chiral-hud/skin.json");
    const manifest: SkinManifest = await response.json();
    this.theme = manifest.theme;

    const saved = localStorage.getItem("flux_state");
    if (saved) {
      const state = JSON.parse(saved);
      this.theme = { ...this.theme, ...state.theme };
      this.cfg = state.cfg || this.cfg;
    }

    this.applyTheme();
    this.syncConfigUI();
    this.setupEvents();
    
    setInterval(() => this.tick(), 1000);
    this.tick();
  }

  private applyTheme() {
    const root = document.documentElement;
    root.style.setProperty("--color-hud-primary", this.theme.primary);
    root.style.setProperty("--color-hud-primary-soft", this.theme.primary_soft);
    root.style.setProperty("--color-hud-neutral", this.theme.neutral);
    root.style.setProperty("--color-hud-safe", this.theme.safe);
    root.style.setProperty("--color-hud-caution", this.theme.caution);
    root.style.setProperty("--color-hud-alert", this.theme.alert);
    root.style.setProperty("--color-hud-danger", this.theme.danger);
    root.style.setProperty("--color-hud-chiral", this.theme.chiral);
    root.style.setProperty("--color-bg-base", this.theme.bg_base);
    root.style.setProperty("--color-bg-panel", this.theme.bg_panel);
    root.style.setProperty("--color-border-default", this.theme.border_default);
    root.style.setProperty("--font-main", this.theme.font_main);
    root.style.setProperty("--font-tech", this.theme.font_tech);
    root.style.setProperty("--font-header", this.theme.font_header);
  }

  private setupEvents() {
    const container = document.getElementById("main-container")!;
    window.addEventListener("mousemove", (e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      container.style.setProperty("--mouse-x", `${x}px`);
      container.style.setProperty("--mouse-y", `${y}px`);
      const buffer = 2;
      const isInside = (e.clientX >= rect.left + buffer && e.clientX <= rect.right - buffer && e.clientY >= rect.top + buffer && e.clientY <= rect.bottom - buffer);
      if (isInside) {
        if (!container.classList.contains("has-mouse")) {
          container.classList.add("has-mouse");
          container.style.setProperty("--pattern-opacity", "1");
        }
      } else {
        container.classList.remove("has-mouse");
        container.style.setProperty("--pattern-opacity", "0");
      }
    });

    window.addEventListener("blur", () => {
      container.classList.remove("has-mouse");
      container.style.setProperty("--pattern-opacity", "0");
    });

    // Manual Drag Logic
    container.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if ((target.id === "main-container" || target.id === "spotlight") && !target.classList.contains("resizer")) {
        invoke("drag_window");
      }
    });

    document.querySelectorAll(".resizer").forEach(r => {
      (r as HTMLElement).onmousedown = (e) => {
        e.preventDefault(); e.stopPropagation();
        const dir = (r as HTMLElement).dataset.direction;
        // @ts-ignore
        if (dir) appWindow.startResizing(dir);
      };
    });

    document.getElementById("open-settings")!.onclick = () => document.getElementById("settings-panel")!.style.display = "flex";
    document.getElementById("close-settings")!.onclick = () => {
      this.saveState();
      document.getElementById("settings-panel")!.style.display = "none";
    };
  }

  private syncConfigUI() {
    (document.getElementById("cfg-amber-usage") as HTMLInputElement).value = this.cfg.amberUsage.toString();
    (document.getElementById("cfg-red-usage") as HTMLInputElement).value = this.cfg.redUsage.toString();
    (document.getElementById("cfg-amber-temp") as HTMLInputElement).value = this.cfg.amberTemp.toString();
    (document.getElementById("cfg-red-temp") as HTMLInputElement).value = this.cfg.redTemp.toString();
    (document.getElementById("cfg-clr-accent") as HTMLInputElement).value = this.theme.primary;
    (document.getElementById("cfg-clr-amber") as HTMLInputElement).value = this.theme.caution;
    (document.getElementById("cfg-clr-red") as HTMLInputElement).value = this.theme.danger;
  }

  private saveState() {
    this.cfg.amberUsage = parseInt((document.getElementById("cfg-amber-usage") as HTMLInputElement).value);
    this.cfg.redUsage = parseInt((document.getElementById("cfg-red-usage") as HTMLInputElement).value);
    this.cfg.amberTemp = parseInt((document.getElementById("cfg-amber-temp") as HTMLInputElement).value);
    this.cfg.redTemp = parseInt((document.getElementById("cfg-red-temp") as HTMLInputElement).value);
    this.theme.primary = (document.getElementById("cfg-clr-accent") as HTMLInputElement).value;
    this.theme.caution = (document.getElementById("cfg-clr-amber") as HTMLInputElement).value;
    this.theme.danger = (document.getElementById("cfg-clr-red") as HTMLInputElement).value;
    localStorage.setItem("flux_state", JSON.stringify({ cfg: this.cfg, theme: this.theme }));
    this.applyTheme();
  }

  async tick() {
    try {
      const stats = await invoke<SystemStats>("get_system_stats");
      document.getElementById("uptime")!.textContent = stats.uptime;
      this.sysModule.update(stats, this.cfg, this.theme);
    } catch (e) { console.error(e); }
  }
}

new FluxShell().boot();

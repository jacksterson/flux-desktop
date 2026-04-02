import { SOURCE_EVENTS } from './store.js';
import { resolveColor } from './palette.js';
import { startShaderLoop, stopAllShaderLoops, resolveShaderGlsl } from './shader.js';
import { startSourceListeners, stopSourceListeners, registerSources } from './data-sources.js';

let _ctx = null;
export function setContext(ctx) { _ctx = ctx; }

let _liveUnsubs = [];
const _lgHistory = {};
let _latestData = {};

function renderTemplate(tpl) {
    return tpl.replace(/{{(.*?)}}/g, (match, key) => {
        key = key.trim();
        if (key === 'time') return formatClock('HH:mm:ss', 'local');
        if (key === 'date') return new Date().toLocaleDateString();
        if (_latestData[key] !== undefined) {
            const val = parseFloat(_latestData[key]);
            if (!isNaN(val)) return val.toFixed(1);
            return _latestData[key];
        }
        return '--';
    });
}

function teardownLiveData() {
    stopSourceListeners();
    stopAllShaderLoops();
    for (const unsub of _liveUnsubs) { try { unsub(); } catch(e) {} }
    _liveUnsubs = [];
}

async function setupLiveData() {
    teardownLiveData();
    if (!window.WidgetAPI) return;

    // Collect all unique events needed by current components
    const neededEvents = new Set();
    for (const comp of _ctx.store.getAll()) {
        const src = comp.props && comp.props.source;
        if (src && SOURCE_EVENTS[src]) neededEvents.add(SOURCE_EVENTS[src]);
        if (comp.type === 'clock') neededEvents.add('clock-tick');

        if (comp.type === 'text' && comp.props.content) {
            const matches = comp.props.content.match(/{{(.*?)}}/g);
            if (matches) {
                for (const m of matches) {
                    const key = m.slice(2, -2).trim();
                    if (SOURCE_EVENTS[key]) neededEvents.add(SOURCE_EVENTS[key]);
                    if (key === 'time' || key === 'date') neededEvents.add('clock-tick');
                }
            }
        }
    }

    for (const event of neededEvents) {
        if (event === 'clock-tick') {
            continue;
        }
        const unsub = WidgetAPI.system.subscribe(event, data => {
            updateLiveElements(data);
        });
        if (unsub) _liveUnsubs.push(unsub);
    }

    // Clock: update every second
    const clockInterval = setInterval(() => {
        document.querySelectorAll('.clock-display').forEach(el => {
            const fmt = el.dataset.format || 'HH:mm:ss';
            const tz = el.dataset.tz || 'local';
            el.textContent = formatClock(fmt, tz);
        });
        document.querySelectorAll('.comp[data-template]').forEach(el => {
            if (el.dataset.template.includes('{{time}}') || el.dataset.template.includes('{{date}}')) {
                el.textContent = renderTemplate(el.dataset.template);
            }
        });
    }, 1000);
    _liveUnsubs.push(() => clearInterval(clockInterval));

    // Start shader animation loops for all shader components
    for (const comp of _ctx.store.getAll()) {
        if (comp.type !== 'shader' || !comp.visible) continue;
        const el = document.querySelector(`.comp[data-id="${comp.id}"] .shader-canvas`);
        if (el) startShaderLoop(el, resolveShaderGlsl(comp));
    }

    // Register and start custom data sources
    await registerSources();
    await startSourceListeners();
}

function updateLiveElements(data) {
    Object.assign(_latestData, data);

    // Update text component templates
    document.querySelectorAll('.comp[data-template]').forEach(el => {
        el.textContent = renderTemplate(el.dataset.template);
    });

    // Update .live-value spans
    document.querySelectorAll('.live-value[data-source]').forEach(el => {
        const src = el.dataset.source;
        if (data[src] !== undefined) {
            const compEl = el.closest('.comp');
            const compId = compEl && compEl.dataset.id;
            const comp = compId ? _ctx.store.getById(compId) : null;
            const dp = comp && comp.props.decimalPlaces !== undefined ? comp.props.decimalPlaces : 1;
            el.textContent = parseFloat(data[src]).toFixed(dp);
        }
    });
    // Update progress bar fills
    document.querySelectorAll('.pb-fill[data-source]').forEach(el => {
        const src = el.dataset.source;
        if (data[src] !== undefined) {
            const pct = Math.min(100, Math.max(0, parseFloat(data[src])));
            el.style.width = pct + '%';
        }
    });
    // Line graphs and circle meters: draw on canvas elements
    document.querySelectorAll('.lg-canvas[data-source]').forEach(el => {
        const src = el.dataset.source;
        if (data[src] !== undefined) drawLineGraph(el, parseFloat(data[src]));
    });
    document.querySelectorAll('.cm-canvas[data-source]').forEach(el => {
        const src = el.dataset.source;
        if (data[src] !== undefined) drawCircleMeter(el, parseFloat(data[src]));
    });
}

function formatClock(fmt, tz) {
    const now = tz === 'local' ? new Date() : new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    const h24 = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    const h12 = h24 % 12 || 12;
    const ampm = h24 < 12 ? 'AM' : 'PM';
    const pad = n => String(n).padStart(2, '0');
    return fmt
        .replace('HH', pad(h24)).replace('mm', pad(m)).replace('ss', pad(s))
        .replace('hh', pad(h12)).replace('A', ampm);
}

function drawLineGraph(canvasEl, value) {
    const compEl = canvasEl.closest('.comp');
    const compId = compEl && compEl.dataset.id;
    const comp = compId ? _ctx.store.getById(compId) : null;
    if (!comp) return;
    const maxPts = comp.props.maxPoints || 60;
    if (!_lgHistory[compId]) _lgHistory[compId] = [];
    const hist = _lgHistory[compId];
    hist.push(value);
    if (hist.length > maxPts) hist.shift();

    const ctx = canvasEl.getContext('2d');
    const w = canvasEl.width, h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);
    if (hist.length < 2) return;

    const max = Math.max(...hist, 1);
    const pts = hist.map((v, i) => [i / (hist.length - 1) * w, h - (v / max) * (h - 2) - 1]);

    ctx.strokeStyle = resolveColor(comp.props.lineColor) || '#00bfff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();

    if (comp.props.fillColor) {
        ctx.fillStyle = resolveColor(comp.props.fillColor);
        ctx.beginPath();
        pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        ctx.fill();
    }
}

function drawCircleMeter(canvasEl, value) {
    const compEl = canvasEl.closest('.comp');
    const compId = compEl && compEl.dataset.id;
    const comp = compId ? _ctx.store.getById(compId) : null;
    if (!comp) return;

    const ctx = canvasEl.getContext('2d');
    const w = canvasEl.width, h = canvasEl.height;
    const cx = w / 2, cy = h / 2;
    const r = Math.min(cx, cy) - (comp.props.strokeWidth || 6) / 2 - 2;
    const startDeg = (comp.props.startAngle || -90) * Math.PI / 180;
    const pct = Math.min(100, Math.max(0, value)) / 100;

    ctx.clearRect(0, 0, w, h);

    // Track
    ctx.strokeStyle = resolveColor(comp.props.trackColor) || '#1e1e1e';
    ctx.lineWidth = comp.props.strokeWidth || 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();

    // Fill
    ctx.strokeStyle = resolveColor(comp.props.color) || '#00bfff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, startDeg, startDeg + pct * 2 * Math.PI);
    ctx.stroke();

    // Value label
    if (comp.props.showValue) {
        ctx.fillStyle = resolveColor(comp.props.valueColor) || '#fff';
        ctx.font = `${comp.props.fontSize || 14}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(value) + '%', cx, cy);
    }
}

export { renderTemplate, setupLiveData, teardownLiveData, updateLiveElements, formatClock };

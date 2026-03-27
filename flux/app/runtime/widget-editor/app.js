if (!window.__TAURI__) {
  document.getElementById('canvas').innerHTML =
    '<p style="padding:20px;color:#c00">Tauri IPC not available.</p>';
  throw new Error('[WidgetEditor] window.__TAURI__ not available');
}

const { invoke } = window.__TAURI__.core;

const canvas = document.getElementById('canvas');
const canvasWidth = document.getElementById('canvas-width');
const canvasHeight = document.getElementById('canvas-height');

// ── ComponentStore ────────────────────────────────────────────────────────────

class ComponentStore {
    constructor() {
        this._components = []; // [{id, type, x, y, width, height, opacity, visible, zIndex, props}]
        this._nextZ = 0;
    }

    _genId() {
        return 'c_' + Math.random().toString(36).slice(2, 10);
    }

    add(type, props = {}) {
        const defaults = {
            text:         { content: 'Text', fontSize: 16, color: '#ffffff', fontFamily: 'monospace', fontWeight: 'normal', textAlign: 'left', letterSpacing: 0 },
            metric:       { source: 'cpu_avg', label: '', suffix: '%', fontSize: 28, color: '#00bfff', fontFamily: 'monospace', decimalPlaces: 1 },
            progressbar:  { source: 'cpu_avg', orientation: 'horizontal', fgColor: '#00bfff', bgColor: '#1e1e1e', borderRadius: 2 },
            linegraph:    { source: 'cpu_avg', lineColor: '#00bfff', fillColor: 'rgba(0,191,255,0.15)', maxPoints: 60, showBaseline: false },
            circlemeter:  { source: 'cpu_avg', color: '#00bfff', trackColor: '#1e1e1e', strokeWidth: 6, startAngle: -90, showValue: true, fontSize: 14, valueColor: '#ffffff' },
            clock:        { format: 'HH:mm:ss', timezone: 'local', fontSize: 24, color: '#ffffff', fontFamily: 'monospace' },
            divider:      { orientation: 'horizontal', color: '#333333', thickness: 1, margin: 4 },
        };
        const component = {
            id: this._genId(),
            type,
            x: 20, y: 20,
            width:  type === 'divider' ? 200 : (type === 'progressbar' ? 180 : (type === 'linegraph' || type === 'circlemeter' ? 120 : 120)),
            height: type === 'divider' ? 2   : (type === 'progressbar' ? 16  : (type === 'linegraph' || type === 'circlemeter' ? 80  : 40)),
            opacity: 100,
            visible: true,
            zIndex: this._nextZ++,
            props: Object.assign({}, defaults[type] || {}, props),
        };
        this._components.push(component);
        return component;
    }

    remove(id) {
        this._components = this._components.filter(c => c.id !== id);
    }

    update(id, changes) {
        const c = this._components.find(c => c.id === id);
        if (c) Object.assign(c, changes);
    }

    updateProps(id, propChanges) {
        const c = this._components.find(c => c.id === id);
        if (c) Object.assign(c.props, propChanges);
    }

    getAll() {
        return [...this._components].sort((a, b) => a.zIndex - b.zIndex);
    }

    getById(id) {
        return this._components.find(c => c.id === id) || null;
    }

    serialize() {
        return JSON.stringify({
            version: 1,
            meta: { name: '', moduleId: '' },
            canvas: {
                width: parseInt(document.getElementById('canvas-width').value),
                height: parseInt(document.getElementById('canvas-height').value),
                background: document.getElementById('canvas').style.backgroundColor || '#0A0F1A',
            },
            components: this._components,
        });
    }

    deserialize(json) {
        const data = JSON.parse(json);
        this._components = data.components || [];
        this._nextZ = this._components.reduce((m, c) => Math.max(m, c.zIndex + 1), 0);
        if (data.canvas) {
            document.getElementById('canvas-width').value = data.canvas.width;
            document.getElementById('canvas-height').value = data.canvas.height;
            document.getElementById('canvas').style.backgroundColor = data.canvas.background;
            updateCanvasSize();
        }
    }
}

// ── HistoryStack ──────────────────────────────────────────────────────────────

class HistoryStack {
    constructor(maxStates = 50) {
        this._stack = [];
        this._ptr = -1;
        this._max = maxStates;
    }

    push(snapshot) {
        // Discard any redo states above the pointer
        this._stack = this._stack.slice(0, this._ptr + 1);
        this._stack.push(snapshot);
        if (this._stack.length > this._max) {
            this._stack.shift();
        } else {
            this._ptr++;
        }
    }

    undo() {
        if (this._ptr <= 0) return null;
        this._ptr--;
        return this._stack[this._ptr];
    }

    redo() {
        if (this._ptr >= this._stack.length - 1) return null;
        this._ptr++;
        return this._stack[this._ptr];
    }

    canUndo() { return this._ptr > 0; }
    canRedo() { return this._ptr < this._stack.length - 1; }
}

// ── Component type definitions ────────────────────────────────────────────────

const COMPONENT_TYPES = [
    { type: 'text',        label: 'Text',         icon: 'T'  },
    { type: 'metric',      label: 'Metric',        icon: '#'  },
    { type: 'progressbar', label: 'Progress Bar',  icon: '▬'  },
    { type: 'linegraph',   label: 'Line Graph',    icon: '📈' },
    { type: 'circlemeter', label: 'Circle Meter',  icon: '○'  },
    { type: 'clock',       label: 'Clock',         icon: '🕐' },
    { type: 'divider',     label: 'Divider',       icon: '—'  },
];

// ── Live data source → event mapping ─────────────────────────────────────────

const SOURCE_EVENTS = {
    cpu_avg:        'system:cpu',
    cpu_temp:       'system:cpu',
    ram_pct:        'system:memory',
    ram_used_gb:    'system:memory',
    gpu_pct:        'system:gpu',
    gpu_temp:       'system:gpu',
    vram_pct:       'system:gpu',
    net_in_kbps:    'system:network',
    net_out_kbps:   'system:network',
    disk_read_mbps: 'system:disk-io',
    disk_write_mbps:'system:disk-io',
    battery_pct:    'system:battery',
};

const DATA_SOURCES = [
    { key: 'cpu_avg',         label: 'CPU Usage %' },
    { key: 'cpu_temp',        label: 'CPU Temp °C' },
    { key: 'ram_pct',         label: 'RAM Usage %' },
    { key: 'ram_used_gb',     label: 'RAM Used GB' },
    { key: 'gpu_pct',         label: 'GPU Usage %' },
    { key: 'gpu_temp',        label: 'GPU Temp °C' },
    { key: 'vram_pct',        label: 'VRAM Usage %' },
    { key: 'net_in_kbps',     label: 'Network In KB/s' },
    { key: 'net_out_kbps',    label: 'Network Out KB/s' },
    { key: 'disk_read_mbps',  label: 'Disk Read MB/s' },
    { key: 'disk_write_mbps', label: 'Disk Write MB/s' },
    { key: 'battery_pct',     label: 'Battery %' },
];

let _liveUnsubs = [];
const _lgHistory = {};

// ── State ─────────────────────────────────────────────────────────────────────

const store = new ComponentStore();
let activeId = null;
const history = new HistoryStack();

function pushHistory() {
    history.push(store.serialize());
}

// Single drag/resize state object
const _drag = { type: null, compId: null, ox: 0, oy: 0, startX: 0, startY: 0, startCompX: 0, startCompY: 0, startW: 0, startH: 0, handle: null };

// ── Snap helper ───────────────────────────────────────────────────────────────

function snapVal(v) {
    if (!document.getElementById('btn-snap').classList.contains('active')) return Math.round(v);
    return Math.round(v / 8) * 8;
}

// ── Drag/resize handlers ──────────────────────────────────────────────────────

function onDragMove(e) {
    if (!_drag.type) return;
    const c = store.getById(_drag.compId);
    if (!c) { _drag.type = null; return; }

    if (_drag.type === 'move') {
        c.x = snapVal(e.clientX - _drag.ox);
        c.y = snapVal(e.clientY - _drag.oy);
        renderCanvas();
    } else if (_drag.type === 'resize') {
        const dx = e.clientX - _drag.startX;
        const dy = e.clientY - _drag.startY;
        let nx = _drag.startCompX, ny = _drag.startCompY, nw = _drag.startW, nh = _drag.startH;
        const h = _drag.handle;
        if (h.includes('e')) nw = Math.max(20, snapVal(_drag.startW + dx));
        if (h.includes('s')) nh = Math.max(10, snapVal(_drag.startH + dy));
        if (h.includes('w')) { nw = Math.max(20, snapVal(_drag.startW - dx)); nx = snapVal(_drag.startCompX + dx); }
        if (h.includes('n')) { nh = Math.max(10, snapVal(_drag.startH - dy)); ny = snapVal(_drag.startCompY + dy); }
        store.update(c.id, { x: nx, y: ny, width: nw, height: nh });
        renderCanvas();
    }
}

function onDragEnd() {
    if (_drag.type) {
        pushHistory();
    }
    _drag.type = null;
}

// ── Canvas renderer ───────────────────────────────────────────────────────────

function renderCanvas() {
    const canvasEl = document.getElementById('canvas');
    // Remove all component elements (preserve non-component children if any)
    canvasEl.querySelectorAll('.comp').forEach(el => el.remove());

    for (const comp of store.getAll()) {
        if (!comp.visible) continue;
        const el = document.createElement('div');
        el.className = 'comp';
        el.dataset.id = comp.id;
        el.style.cssText = `
            position:absolute;
            left:${comp.x}px; top:${comp.y}px;
            width:${comp.width}px; height:${comp.height}px;
            opacity:${comp.opacity / 100};
            z-index:${comp.zIndex};
            box-sizing:border-box;
            overflow:hidden;
        `;
        if (activeId === comp.id) {
            el.style.outline = '2px solid #00bfff';
            el.style.outlineOffset = '1px';
            el.style.overflow = 'visible';
        }
        renderComponentContent(el, comp);

        // Component drag (move)
        el.addEventListener('mousedown', e => {
            if (e.target.classList.contains('resize-handle')) return;
            selectComponent(comp.id);
            _drag.type = 'move';
            _drag.compId = comp.id;
            _drag.ox = e.clientX - comp.x;
            _drag.oy = e.clientY - comp.y;
            e.stopPropagation();
            e.preventDefault();
        });

        // Resize handles (active component only)
        if (comp.id === activeId) {
            const handleDirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
            for (const dir of handleDirs) {
                const h = document.createElement('div');
                h.className = 'resize-handle rh-' + dir;
                h.dataset.dir = dir;
                h.addEventListener('mousedown', e => {
                    e.stopPropagation();
                    e.preventDefault();
                    _drag.type = 'resize';
                    _drag.compId = comp.id;
                    _drag.handle = dir;
                    _drag.startX = e.clientX;
                    _drag.startY = e.clientY;
                    _drag.startCompX = comp.x;
                    _drag.startCompY = comp.y;
                    _drag.startW = comp.width;
                    _drag.startH = comp.height;
                });
                el.appendChild(h);
            }
        }

        canvasEl.appendChild(el);
    }

    setupLiveData();
}

function renderComponentContent(el, comp) {
    const p = comp.props;
    switch (comp.type) {
        case 'text':
            el.style.fontFamily = p.fontFamily;
            el.style.fontSize = p.fontSize + 'px';
            el.style.color = p.color;
            el.style.fontWeight = p.fontWeight;
            el.style.textAlign = p.textAlign;
            el.style.letterSpacing = p.letterSpacing + 'px';
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.textContent = p.content;
            break;
        case 'metric':
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
            el.style.justifyContent = 'center';
            el.innerHTML = `
                ${p.label ? `<div style="font-size:10px;color:#888;font-family:monospace;">${escHtml(p.label)}</div>` : ''}
                <div style="font-size:${p.fontSize}px;color:${p.color};font-family:${p.fontFamily};font-weight:bold;">
                    <span class="live-value" data-source="${p.source}">--</span>${escHtml(p.suffix)}
                </div>`;
            break;
        case 'progressbar':
            el.style.background = p.bgColor;
            el.style.borderRadius = p.borderRadius + 'px';
            el.innerHTML = `<div class="pb-fill" data-source="${p.source}" style="
                height:100%; width:0%; background:${p.fgColor};
                border-radius:${p.borderRadius}px; transition:width 0.3s;
            "></div>`;
            break;
        case 'linegraph':
            el.innerHTML = `<canvas class="lg-canvas" data-source="${p.source}" width="${comp.width}" height="${comp.height}"></canvas>`;
            break;
        case 'circlemeter':
            el.innerHTML = `<canvas class="cm-canvas" data-source="${p.source}" width="${comp.width}" height="${comp.height}"></canvas>`;
            break;
        case 'clock':
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.justifyContent = 'center';
            el.style.fontFamily = p.fontFamily;
            el.style.fontSize = p.fontSize + 'px';
            el.style.color = p.color;
            el.innerHTML = `<span class="clock-display" data-format="${escHtml(p.format)}" data-tz="${escHtml(p.timezone)}">--:--</span>`;
            break;
        case 'divider':
            if (p.orientation === 'horizontal') {
                el.style.borderTop = `${p.thickness}px solid ${p.color}`;
                el.style.margin = `${p.margin}px 0`;
            } else {
                el.style.borderLeft = `${p.thickness}px solid ${p.color}`;
                el.style.margin = `0 ${p.margin}px`;
            }
            break;
    }
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function selectComponent(id) {
    activeId = id;
    renderCanvas();
    renderProperties();
    renderLayers();
}

// ── Components panel ──────────────────────────────────────────────────────────

function renderComponentsPanel() {
    const list = document.getElementById('components-list');
    list.innerHTML = '';
    for (const { type, label, icon } of COMPONENT_TYPES) {
        const item = document.createElement('div');
        item.className = 'comp-type-item';
        item.innerHTML = `<span class="comp-icon">${icon}</span><span class="comp-label">${label}</span>`;
        item.title = `Add ${label}`;
        item.addEventListener('click', () => {
            // Add at canvas center
            const canvasEl = document.getElementById('canvas');
            const cx = Math.max(0, Math.floor((parseInt(canvasEl.style.width) || 400) / 2) - 60);
            const cy = Math.max(0, Math.floor((parseInt(canvasEl.style.height) || 300) / 2) - 20);
            const comp = store.add(type);
            store.update(comp.id, { x: cx, y: cy });
            selectComponent(comp.id);
            pushHistory();
            renderCanvas();
            renderLayers();
        });
        list.appendChild(item);
    }
}

// ── Live data ─────────────────────────────────────────────────────────────────

function teardownLiveData() {
    for (const unsub of _liveUnsubs) { try { unsub(); } catch(e) {} }
    _liveUnsubs = [];
}

function setupLiveData() {
    teardownLiveData();
    if (!window.WidgetAPI) return;

    // Collect all unique events needed by current components
    const neededEvents = new Set();
    for (const comp of store.getAll()) {
        const src = comp.props && comp.props.source;
        if (src && SOURCE_EVENTS[src]) neededEvents.add(SOURCE_EVENTS[src]);
        if (comp.type === 'clock') neededEvents.add('clock-tick');
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
    }, 1000);
    _liveUnsubs.push(() => clearInterval(clockInterval));
}

function updateLiveElements(data) {
    // Update .live-value spans
    document.querySelectorAll('.live-value[data-source]').forEach(el => {
        const src = el.dataset.source;
        if (data[src] !== undefined) {
            const compEl = el.closest('.comp');
            const compId = compEl && compEl.dataset.id;
            const comp = compId ? store.getById(compId) : null;
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
    const comp = compId ? store.getById(compId) : null;
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

    ctx.strokeStyle = comp.props.lineColor || '#00bfff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();

    if (comp.props.fillColor) {
        ctx.fillStyle = comp.props.fillColor;
        ctx.beginPath();
        pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        ctx.fill();
    }
}

function drawCircleMeter(canvasEl, value) {
    const compEl = canvasEl.closest('.comp');
    const compId = compEl && compEl.dataset.id;
    const comp = compId ? store.getById(compId) : null;
    if (!comp) return;

    const ctx = canvasEl.getContext('2d');
    const w = canvasEl.width, h = canvasEl.height;
    const cx = w / 2, cy = h / 2;
    const r = Math.min(cx, cy) - (comp.props.strokeWidth || 6) / 2 - 2;
    const startDeg = (comp.props.startAngle || -90) * Math.PI / 180;
    const pct = Math.min(100, Math.max(0, value)) / 100;

    ctx.clearRect(0, 0, w, h);

    // Track
    ctx.strokeStyle = comp.props.trackColor || '#1e1e1e';
    ctx.lineWidth = comp.props.strokeWidth || 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();

    // Fill
    ctx.strokeStyle = comp.props.color || '#00bfff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, startDeg, startDeg + pct * 2 * Math.PI);
    ctx.stroke();

    // Value label
    if (comp.props.showValue) {
        ctx.fillStyle = comp.props.valueColor || '#fff';
        ctx.font = `${comp.props.fontSize || 14}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(value) + '%', cx, cy);
    }
}

// ── Property field builders ───────────────────────────────────────────────────

function propRow(label, inputHtml) {
    return `<div class="prop-row"><label class="prop-label">${escHtml(label)}</label>${inputHtml}</div>`;
}
function propNumber(label, key, val, min = undefined, max = undefined) {
    const minAttr = min !== undefined ? `min="${min}"` : '';
    const maxAttr = max !== undefined ? `max="${max}"` : '';
    return propRow(label, `<input class="prop-input" type="number" data-prop="${escHtml(key)}" value="${escHtml(String(val))}" ${minAttr} ${maxAttr}>`);
}
function propText(label, key, val) {
    return propRow(label, `<input class="prop-input" type="text" data-prop="${escHtml(key)}" value="${escHtml(String(val))}">`);
}
function propColor(label, key, val) {
    return propRow(label, `<input class="prop-input" type="color" data-prop="${escHtml(key)}" value="${escHtml(String(val))}">`);
}
function propRange(label, key, val, min = 0, max = 100) {
    return propRow(label, `<input class="prop-input" type="range" data-prop="${escHtml(key)}" value="${escHtml(String(val))}" min="${min}" max="${max}">`);
}
function propSelect(label, key, val, options) {
    const opts = options.map(o => `<option value="${escHtml(o)}" ${o === val ? 'selected' : ''}>${escHtml(o)}</option>`).join('');
    return propRow(label, `<select class="prop-input" data-prop="${escHtml(key)}">${opts}</select>`);
}
function propCheck(label, key, val) {
    return propRow(label, `<input class="prop-input" type="checkbox" data-prop="${escHtml(key)}" ${val ? 'checked' : ''}>`);
}
function propSource(label, key, val) {
    const opts = DATA_SOURCES.map(s => `<option value="${escHtml(s.key)}" ${s.key === val ? 'selected' : ''}>${escHtml(s.label)}</option>`).join('');
    return propRow(label, `<select class="prop-input" data-prop="${escHtml(key)}">${opts}</select>`);
}

// ── Apply property changes ────────────────────────────────────────────────────

function applyPropChange(comp, propPath, rawValue) {
    // propPath is like 'x', 'width', 'opacity', 'props.color', 'props.fontSize'
    let value = rawValue;
    // Coerce types based on input
    if (typeof rawValue === 'string' && rawValue !== '' && !isNaN(rawValue)) {
        value = parseFloat(rawValue);
    }
    if (propPath.startsWith('props.')) {
        const key = propPath.slice(6);
        store.updateProps(comp.id, { [key]: value });
    } else {
        store.update(comp.id, { [propPath]: value });
    }
    renderCanvas();
    pushHistory();
}

// ── Stubs for later tasks ─────────────────────────────────────────────────────

function renderProperties() {
    const container = document.getElementById('properties-content');
    if (!activeId) {
        container.innerHTML = '<p class="empty-state">Select a component to edit.</p>';
        return;
    }
    const comp = store.getById(activeId);
    if (!comp) {
        container.innerHTML = '<p class="empty-state">Select a component to edit.</p>';
        return;
    }

    const fields = [];

    // Common fields
    fields.push(
        propNumber('X',       'x',       comp.x),
        propNumber('Y',       'y',       comp.y),
        propNumber('W',       'width',   comp.width,  20),
        propNumber('H',       'height',  comp.height, 10),
        propRange( 'Opacity', 'opacity', comp.opacity, 0, 100),
    );

    // Per-type fields
    switch (comp.type) {
        case 'text':
            fields.push(
                propText(    'Content',        'props.content',      comp.props.content),
                propNumber(  'Font Size',      'props.fontSize',     comp.props.fontSize, 6),
                propColor(   'Color',          'props.color',        comp.props.color),
                propSelect(  'Font Family',    'props.fontFamily',   comp.props.fontFamily, ['monospace','sans-serif','serif','cursive']),
                propSelect(  'Font Weight',    'props.fontWeight',   comp.props.fontWeight, ['normal','bold']),
                propSelect(  'Text Align',     'props.textAlign',    comp.props.textAlign,  ['left','center','right']),
                propNumber(  'Letter Spacing', 'props.letterSpacing',comp.props.letterSpacing, 0),
            );
            break;
        case 'metric':
            fields.push(
                propSource(  'Source',         'props.source',       comp.props.source),
                propText(    'Label',          'props.label',        comp.props.label),
                propText(    'Suffix',         'props.suffix',       comp.props.suffix),
                propNumber(  'Font Size',      'props.fontSize',     comp.props.fontSize, 6),
                propColor(   'Color',          'props.color',        comp.props.color),
                propSelect(  'Font Family',    'props.fontFamily',   comp.props.fontFamily, ['monospace','sans-serif','serif']),
                propNumber(  'Decimal Places', 'props.decimalPlaces',comp.props.decimalPlaces, 0, 3),
            );
            break;
        case 'progressbar':
            fields.push(
                propSource(  'Source',        'props.source',      comp.props.source),
                propSelect(  'Orientation',   'props.orientation', comp.props.orientation, ['horizontal','vertical']),
                propColor(   'Bar Color',     'props.fgColor',     comp.props.fgColor),
                propColor(   'Background',    'props.bgColor',     comp.props.bgColor),
                propNumber(  'Border Radius', 'props.borderRadius',comp.props.borderRadius, 0),
            );
            break;
        case 'linegraph':
            fields.push(
                propSource(  'Source',       'props.source',     comp.props.source),
                propColor(   'Line Color',   'props.lineColor',  comp.props.lineColor),
                propText(    'Fill Color',   'props.fillColor',  comp.props.fillColor),
                propNumber(  'Max Points',   'props.maxPoints',  comp.props.maxPoints, 10, 120),
                propCheck(   'Baseline',     'props.showBaseline',comp.props.showBaseline),
            );
            break;
        case 'circlemeter':
            fields.push(
                propSource(  'Source',       'props.source',     comp.props.source),
                propColor(   'Arc Color',    'props.color',      comp.props.color),
                propColor(   'Track Color',  'props.trackColor', comp.props.trackColor),
                propNumber(  'Stroke Width', 'props.strokeWidth',comp.props.strokeWidth, 1),
                propNumber(  'Start Angle',  'props.startAngle', comp.props.startAngle),
                propCheck(   'Show Value',   'props.showValue',  comp.props.showValue),
                propNumber(  'Font Size',    'props.fontSize',   comp.props.fontSize, 6),
                propColor(   'Value Color',  'props.valueColor', comp.props.valueColor),
            );
            break;
        case 'clock':
            fields.push(
                propSelect(  'Format',      'props.format',     comp.props.format,   ['HH:mm:ss','HH:mm','hh:mm A']),
                propText(    'Timezone',    'props.timezone',   comp.props.timezone),
                propNumber(  'Font Size',   'props.fontSize',   comp.props.fontSize, 6),
                propColor(   'Color',       'props.color',      comp.props.color),
                propSelect(  'Font Family', 'props.fontFamily', comp.props.fontFamily,['monospace','sans-serif','serif']),
            );
            break;
        case 'divider':
            fields.push(
                propSelect(  'Orientation', 'props.orientation', comp.props.orientation, ['horizontal','vertical']),
                propColor(   'Color',       'props.color',       comp.props.color),
                propNumber(  'Thickness',   'props.thickness',   comp.props.thickness, 1),
                propNumber(  'Margin',      'props.margin',      comp.props.margin, 0),
            );
            break;
    }

    container.innerHTML = fields.join('');

    // Wire up change events
    container.querySelectorAll('[data-prop]').forEach(input => {
        const event = input.type === 'range' ? 'input' : 'change';
        input.addEventListener(event, () => {
            applyPropChange(comp, input.dataset.prop, input.type === 'checkbox' ? input.checked : input.value);
        });
    });
}

function reorderLayer(draggedId, targetId) {
    const dragged = store.getById(draggedId);
    const target  = store.getById(targetId);
    if (!dragged || !target) return;
    const tmp = dragged.zIndex;
    store.update(draggedId, { zIndex: target.zIndex });
    store.update(targetId,  { zIndex: tmp });
    pushHistory();
    renderCanvas();
    renderLayers();
}

function renderLayers() {
    const list = document.getElementById('layers-list');
    list.innerHTML = '';

    // Reverse order: top of list = highest z-index
    const comps = store.getAll().reverse();

    comps.forEach((comp, listIndex) => {
        const row = document.createElement('div');
        row.className = 'layer-row' + (comp.id === activeId ? ' active' : '');
        row.dataset.id = comp.id;
        row.draggable = true;

        const typeIcons = { text:'T', metric:'#', progressbar:'▬', linegraph:'📈', circlemeter:'○', clock:'🕐', divider:'—' };
        const icon = typeIcons[comp.type] || '?';
        const label = comp.props.label || comp.props.content || comp.type;

        row.innerHTML = `
            <span class="layer-icon">${escHtml(String(icon))}</span>
            <span class="layer-name">${escHtml(String(label))}</span>
            <span class="layer-vis" data-id="${escHtml(comp.id)}" title="${comp.visible ? 'Hide' : 'Show'}">${comp.visible ? '👁' : '○'}</span>
        `;

        // Click row to select
        row.addEventListener('click', e => {
            if (e.target.classList.contains('layer-vis')) return;
            selectComponent(comp.id);
        });

        // Visibility toggle
        row.querySelector('.layer-vis').addEventListener('click', () => {
            store.update(comp.id, { visible: !comp.visible });
            pushHistory();
            renderCanvas();
            renderLayers();
        });

        // Drag-to-reorder
        row.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', comp.id);
            e.dataTransfer.effectAllowed = 'move';
        });

        row.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.classList.add('drag-over');
        });

        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over');
        });

        row.addEventListener('drop', e => {
            e.preventDefault();
            row.classList.remove('drag-over');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId === comp.id) return;
            reorderLayer(draggedId, comp.id);
        });

        list.appendChild(row);
    });
}

// ── Canvas size ───────────────────────────────────────────────────────────────

function updateCanvasSize() {
    canvas.style.width = canvasWidth.value + 'px';
    canvas.style.height = canvasHeight.value + 'px';
    renderCanvas();
}
canvasWidth.addEventListener('input', updateCanvasSize);
canvasHeight.addEventListener('input', updateCanvasSize);
updateCanvasSize();

// ── Deselect on canvas background click ──────────────────────────────────────

document.getElementById('canvas').addEventListener('mousedown', () => {
    activeId = null;
    renderCanvas();
    renderProperties();
    renderLayers();
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    // Don't fire when typing in an input
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    // Redo: Ctrl+Shift+Z
    if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        const snap = history.redo();
        if (snap) {
            store.deserialize(snap);
            activeId = null;
            renderCanvas();
            renderLayers();
        }
        return;
    }

    // Undo: Ctrl+Z
    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        const snap = history.undo();
        if (snap) {
            store.deserialize(snap);
            activeId = null;
            renderCanvas();
            renderLayers();
        }
        return;
    }

    // Delete: Delete or Backspace
    if ((e.key === 'Delete' || e.key === 'Backspace') && activeId) {
        store.remove(activeId);
        activeId = null;
        pushHistory();
        renderCanvas();
        renderLayers();
    }
});

// ── Grid toggle ───────────────────────────────────────────────────────────────

document.getElementById('btn-grid').addEventListener('click', function() {
    this.classList.toggle('active');
    canvas.classList.toggle('show-grid');
});

// ── Snap toggle ───────────────────────────────────────────────────────────────

document.getElementById('btn-snap').addEventListener('click', function() {
    this.classList.toggle('active');
});

// ── Refresh ───────────────────────────────────────────────────────────────────

document.getElementById('btn-refresh').addEventListener('click', () => location.reload());

// ── File operations — implemented in Task 11 ──────────────────────────────────

document.getElementById('btn-new').addEventListener('click', () => console.log('new'));
document.getElementById('btn-open').addEventListener('click', () => console.log('open'));
document.getElementById('btn-save').addEventListener('click', () => console.log('save'));
document.getElementById('btn-save-as').addEventListener('click', () => console.log('save-as'));
document.getElementById('btn-export').addEventListener('click', () => console.log('export'));

// ── Presets — implemented in Task 10 ─────────────────────────────────────────

document.getElementById('preset-ds').addEventListener('click', () => console.log('preset-ds'));
document.getElementById('preset-md').addEventListener('click', () => console.log('preset-md'));
document.getElementById('preset-ml').addEventListener('click', () => console.log('preset-ml'));

// ── Panel dragging and persistence ───────────────────────────────────────────

const PANEL_IDS = ['panel-components', 'panel-properties', 'panel-layers'];

function savePanelPositions() {
    const positions = {};
    for (const id of PANEL_IDS) {
        const el = document.getElementById(id);
        positions[id] = { left: el.style.left, top: el.style.top };
    }
    localStorage.setItem('flux-editor-panel-positions', JSON.stringify(positions));
}

function loadPanelPositions() {
    try {
        const saved = JSON.parse(localStorage.getItem('flux-editor-panel-positions') || '{}');
        for (const id of PANEL_IDS) {
            if (saved[id]) {
                const el = document.getElementById(id);
                if (saved[id].left) { el.style.left = saved[id].left; el.style.right = ''; }
                if (saved[id].top)  { el.style.top  = saved[id].top;  el.style.bottom = ''; }
            }
        }
    } catch (e) {
        // ignore corrupt storage
    }
}

function makePanelDraggable(panel) {
    const header = panel.querySelector('.panel-header');
    let dragging = false, ox = 0, oy = 0;

    header.addEventListener('mousedown', e => {
        dragging = true;
        ox = e.clientX - panel.offsetLeft;
        oy = e.clientY - panel.offsetTop;
        panel.style.right = '';
        panel.style.bottom = '';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        panel.style.left = (e.clientX - ox) + 'px';
        panel.style.top  = (e.clientY - oy) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        savePanelPositions();
    });
}

// Initialize panel dragging and load saved positions
loadPanelPositions();
for (const id of PANEL_IDS) {
    const panel = document.getElementById(id);
    if (panel) {
        makePanelDraggable(panel);
    }
}

// ── Initial render ────────────────────────────────────────────────────────────

document.addEventListener('mousemove', onDragMove);
document.addEventListener('mouseup',   onDragEnd);

renderComponentsPanel();
renderCanvas();

// Push initial state to history so undo from state 1 works
pushHistory();

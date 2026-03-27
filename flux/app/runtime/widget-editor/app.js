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

// ── State ─────────────────────────────────────────────────────────────────────

const store = new ComponentStore();
let activeId = null;

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
    renderProperties(); // will be implemented in Task 8
    renderLayers();     // will be implemented in Task 9
}

// ── Stubs for later tasks ─────────────────────────────────────────────────────

function renderProperties() {
    // Implemented in Task 8
}

function renderLayers() {
    // Implemented in Task 9
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

// ── Delete selected component ─────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && activeId) {
        // Don't fire when typing in an input
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        store.remove(activeId);
        activeId = null;
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

renderCanvas();

// ── store.js — Pure data: ComponentStore, HistoryStack, constants ─────────────

// ── Presets and theming ───────────────────────────────────────────────────────

export const PRESETS = {
    'preset-ds': { bg: '#0A0F1A', primary: '#00BFFF', name: 'Death Stranding HUD' },
    'preset-md': { bg: '#111111', primary: '#EEEEEE', name: 'Minimal Dark' },
    'preset-ml': { bg: '#F5F5F5', primary: '#222222', name: 'Minimal Light' },
};

// ── ComponentStore ────────────────────────────────────────────────────────────

export class ComponentStore {
    constructor() {
        this._components = []; // [{id, type, x, y, width, height, opacity, visible, zIndex, props}]
        this._nextZ = 0;
    }

    _genId() {
        return 'c_' + Math.random().toString(36).slice(2, 10);
    }

    add(type, props = {}, defaultColor = '#00bfff') {
        const defaults = {
            text:         { content: 'Text', fontSize: 16, color: defaultColor, fontFamily: 'monospace', fontWeight: 'normal', textAlign: 'left', letterSpacing: 0, cssEffects: [] },
            metric:       { source: 'cpu_avg', label: '', suffix: '%', fontSize: 28, color: defaultColor, fontFamily: 'monospace', decimalPlaces: 1, cssEffects: [] },
            progressbar:  { source: 'cpu_avg', orientation: 'horizontal', fgColor: defaultColor, bgColor: '#1e1e1e', borderRadius: 2, cssEffects: [] },
            linegraph:    { source: 'cpu_avg', lineColor: defaultColor, fillColor: 'rgba(0,191,255,0.15)', maxPoints: 60, showBaseline: false, cssEffects: [] },
            circlemeter:  { source: 'cpu_avg', color: defaultColor, trackColor: '#1e1e1e', strokeWidth: 6, startAngle: -90, showValue: true, fontSize: 14, valueColor: '#ffffff', cssEffects: [] },
            clock:        { format: 'HH:mm:ss', timezone: 'local', fontSize: 24, color: defaultColor, fontFamily: 'monospace', cssEffects: [] },
            divider:      { orientation: 'horizontal', color: '#333333', thickness: 1, margin: 4, cssEffects: [] },
            rawhtml:      { html: '<div style="color:#00bfff;font-family:monospace;font-size:14px;">Hello World</div>', css: '', cssEffects: [] },
        };
        const component = {
            id: this._genId(),
            type,
            x: 20, y: 20,
            width:  type === 'divider' ? 200 : (type === 'progressbar' ? 180 : (type === 'rawhtml' ? 200 : (type === 'linegraph' || type === 'circlemeter' ? 120 : 120))),
            height: type === 'divider' ? 2   : (type === 'progressbar' ? 16  : (type === 'rawhtml' ? 120 : (type === 'linegraph' || type === 'circlemeter' ? 80  : 40))),
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

    deserialize(json, updateCanvasSizeFn) {
        const data = JSON.parse(json);
        this._components = data.components || [];
        this._nextZ = this._components.reduce((m, c) => Math.max(m, c.zIndex + 1), 0);
        if (data.canvas) {
            document.getElementById('canvas-width').value = data.canvas.width;
            document.getElementById('canvas-height').value = data.canvas.height;
            document.getElementById('canvas').style.backgroundColor = data.canvas.background;
            if (updateCanvasSizeFn) updateCanvasSizeFn();
        }
    }
}

// ── HistoryStack ──────────────────────────────────────────────────────────────

export class HistoryStack {
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

export const COMPONENT_TYPES = [
    { type: 'text',        label: 'Text',         icon: 'T'  },
    { type: 'metric',      label: 'Metric',        icon: '#'  },
    { type: 'progressbar', label: 'Progress Bar',  icon: '▬'  },
    { type: 'linegraph',   label: 'Line Graph',    icon: '📈' },
    { type: 'circlemeter', label: 'Circle Meter',  icon: '○'  },
    { type: 'clock',       label: 'Clock',         icon: '🕐' },
    { type: 'divider',     label: 'Divider',       icon: '—'  },
    { type: 'rawhtml',     label: 'Raw HTML',      icon: '</>' },
];

// ── Live data source → event mapping ─────────────────────────────────────────

export const SOURCE_EVENTS = {
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

export const DATA_SOURCES = [
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

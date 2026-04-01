import { generatePaletteCSS } from './palette.js';

let _ctx = null;
export function setContext(ctx) { _ctx = ctx; }

function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-widget';
}

async function cmdNew() {
    // TODO: could prompt to save if dirty — for now just clear
    _ctx.setAppState(JSON.stringify({ version: 1, meta: { name: '', moduleId: '' }, canvas: { width: 400, height: 300, background: '#0A0F1A' }, components: [] }));
    _ctx.currentFilePath = null;
    _ctx.selectedIds.clear(); _ctx.primaryId = null;
    _ctx.history._stack = [];
    _ctx.history._ptr = -1;
    _ctx.pushHistory();
    _ctx.renderCanvas();
    _ctx.renderLayers();
}

async function cmdOpen() {
    try {
        const { open } = window.__TAURI__.dialog;
        const selected = await open({
            filters: [{ name: 'Flux Widget', extensions: ['fluxwidget'] }],
            multiple: false,
        });
        if (!selected) return;
        const json = await _ctx.invoke('load_fluxwidget', { path: selected });
        _ctx.setAppState(json);
        _ctx.currentFilePath = selected;
        _ctx.selectedIds.clear(); _ctx.primaryId = null;
        _ctx.history._stack = [];
        _ctx.history._ptr = -1;
        _ctx.pushHistory();
        _ctx.renderCanvas();
        _ctx.renderLayers();
    } catch (e) {
        console.error('Open failed:', e);
        _ctx.showToast('Failed to open file: ' + e, 'error');
    }
}

async function cmdSave() {
    if (!_ctx.currentFilePath) return cmdSaveAs();
    try {
        await _ctx.invoke('save_fluxwidget', { path: _ctx.currentFilePath, json: _ctx.getAppState() });
        _ctx.showToast('Saved.');
    } catch (e) {
        console.error('Save failed:', e);
        _ctx.showToast('Save failed: ' + e, 'error');
    }
}

async function cmdSaveAs() {
    try {
        const { save } = window.__TAURI__.dialog;
        const path = await save({
            filters: [{ name: 'Flux Widget', extensions: ['fluxwidget'] }],
            defaultPath: 'my-widget.fluxwidget',
        });
        if (!path) return;
        await _ctx.invoke('save_fluxwidget', { path, json: _ctx.getAppState() });
        _ctx.currentFilePath = path;
        _ctx.showToast('Saved.');
    } catch (e) {
        console.error('Save As failed:', e);
        _ctx.showToast('Save As failed: ' + e, 'error');
    }
}

function cmdExport() {
    let modal = document.getElementById('export-modal');
    if (modal) modal.remove();

    const data = JSON.parse(_ctx.getAppState());
    const defaultName = data.meta.name || 'My Widget';
    const defaultId   = slugify(defaultName);

    modal = document.createElement('div');
    modal.id = 'export-modal';
    modal.innerHTML = `
        <div class="export-dialog">
            <h3>Export Widget</h3>
            <div class="prop-row"><label class="prop-label">Name</label>
                <input class="prop-input" id="exp-name" type="text" value="${_ctx.escHtml(defaultName)}"></div>
            <div class="prop-row"><label class="prop-label">Module ID</label>
                <input class="prop-input" id="exp-id" type="text" value="${_ctx.escHtml(defaultId)}"></div>
            <div class="prop-row"><label class="prop-label">Width</label>
                <input class="prop-input" id="exp-w" type="number" value="${data.canvas.width}" min="100"></div>
            <div class="prop-row"><label class="prop-label">Height</label>
                <input class="prop-input" id="exp-h" type="number" value="${data.canvas.height}" min="100"></div>
            <div class="export-buttons">
                <button id="exp-cancel" class="btn-secondary">Cancel</button>
                <button id="exp-confirm" class="btn-primary">Export &amp; Install</button>
            </div>
            <div id="exp-status" style="display:none"></div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('exp-name').addEventListener('input', function() {
        document.getElementById('exp-id').value = slugify(this.value);
    });

    document.getElementById('exp-cancel').addEventListener('click', () => modal.remove());
    document.getElementById('exp-confirm').addEventListener('click', () => runExport(modal));
}

async function runExport(modal) {
    const name     = document.getElementById('exp-name').value.trim();
    const moduleId = document.getElementById('exp-id').value.trim();
    const width    = parseInt(document.getElementById('exp-w').value) || 400;
    const height   = parseInt(document.getElementById('exp-h').value) || 300;

    if (!name || !moduleId) {
        const statusEl = document.getElementById('exp-status');
        statusEl.textContent = 'Name and Module ID are required.';
        statusEl.style.display = 'block';
        return;
    }

    const statusEl = document.getElementById('exp-status');
    statusEl.textContent = 'Generating\u2026';
    statusEl.style.display = 'block';

    const files = generateWidgetFiles(name, moduleId, width, height);

    try {
        await _ctx.invoke('export_widget_package', {
            name,
            moduleId,
            filesJson: JSON.stringify(files),
        });
        modal.remove();
        _ctx.showToast('Widget installed \u2014 activate from Command Center', 'info');
    } catch (e) {
        statusEl.textContent = 'Export failed: ' + e;
        console.error('Export failed:', e);
    }
}

function generateWidgetFiles(name, moduleId, width, height) {
    const comps = _ctx.store.getAll().filter(c => c.visible);
    const sources = [...new Set(comps.filter(c => c.props && c.props.source).map(c => c.props.source))];

    const sourceEventMap = {
        cpu_avg: 'system:cpu', cpu_temp: 'system:cpu',
        ram_pct: 'system:memory', ram_used_gb: 'system:memory',
        gpu_pct: 'system:gpu', gpu_temp: 'system:gpu', vram_pct: 'system:gpu',
        net_in_kbps: 'system:network', net_out_kbps: 'system:network',
        disk_read_mbps: 'system:disk-io', disk_write_mbps: 'system:disk-io',
        battery_pct: 'system:battery',
    };
    const events = [...new Set(sources.map(s => sourceEventMap[s]).filter(Boolean))];
    const permissions = [...events.map(e => 'flux:event:' + e)];

    // module.json
    const moduleJson = JSON.stringify({
        id: moduleId,
        name,
        entry: 'index.html',
        window: { width, height, transparent: true, decorations: false, resizable: true },
        permissions,
    }, null, 2);

    const cssVar = v => (v && v.paletteVar) ? `var(--${v.paletteVar})` : v;

    // style.css
    const cssRules = comps.map(c => {
        const p = c.props;
        let css = `#comp-${c.id} { position:absolute; left:${c.x}px; top:${c.y}px; width:${c.width}px; height:${c.height}px; opacity:${c.opacity/100}; z-index:${c.zIndex}; box-sizing:border-box; overflow:hidden; `;
        switch (c.type) {
            case 'text':
                css += `font-size:${p.fontSize}px; color:${cssVar(p.color)}; font-family:${p.fontFamily}; font-weight:${p.fontWeight}; text-align:${p.textAlign}; letter-spacing:${p.letterSpacing}px; display:flex; align-items:center;`;
                break;
            case 'metric':
                css += `display:flex; flex-direction:column; justify-content:center;`;
                break;
            case 'progressbar':
                css += `background:${cssVar(p.bgColor)}; border-radius:${p.borderRadius}px;`;
                break;
            case 'clock':
                css += `display:flex; align-items:center; justify-content:center; font-family:${p.fontFamily}; font-size:${p.fontSize}px; color:${cssVar(p.color)};`;
                break;
        }
        css += ' }';
        return css;
    }).join('\n');

    const rawCssRules = comps
        .filter(c => c.type === 'rawhtml' && c.props.css && c.props.css.trim())
        .map(c => c.props.css.replace(/([^{}]+)\{/g, `#comp-${c.id} $1 {`))
        .join('\n');
    const fullCss = generatePaletteCSS() + '\n\n' + cssRules + (rawCssRules ? '\n\n/* Raw HTML component styles */\n' + rawCssRules : '');

    // index.html
    const compsHtml = comps.map(c => {
        const p = c.props;
        let inner = '';
        switch (c.type) {
            case 'text':
                inner = _ctx.escHtml(p.content);
                break;
            case 'metric':
                inner = `${p.label ? `<div style="font-size:10px;color:var(--muted,#888);">${_ctx.escHtml(p.label)}</div>` : ''}<div id="val-${c.id}" style="font-size:${p.fontSize}px;color:${cssVar(p.color)};font-family:${p.fontFamily};font-weight:bold;">--${_ctx.escHtml(p.suffix)}</div>`;
                break;
            case 'progressbar':
                inner = `<div id="pb-${c.id}" style="height:100%;width:0%;background:${cssVar(p.fgColor)};border-radius:${p.borderRadius}px;"></div>`;
                break;
            case 'linegraph':
                inner = `<canvas id="lg-${c.id}" width="${c.width}" height="${c.height}"></canvas>`;
                break;
            case 'circlemeter':
                inner = `<canvas id="cm-${c.id}" width="${c.width}" height="${c.height}"></canvas>`;
                break;
            case 'clock':
                inner = `<span id="clk-${c.id}" data-format="${_ctx.escHtml(p.format)}" data-tz="${_ctx.escHtml(p.timezone)}">--:--</span>`;
                break;
            case 'rawhtml':
                inner = c.props.html || '';
                break;
            case 'divider':
                inner = '';
                break;
        }
        return `<div id="comp-${c.id}">${inner}</div>`;
    }).join('\n');

    const canvasData = JSON.parse(_ctx.getAppState()).canvas;
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="style.css">
</head>
<body style="margin:0;background:${canvasData.background};width:${width}px;height:${height}px;position:relative;">
${compsHtml}
<script src="widget-api.js"></script>
<script src="logic.js"></script>
</body>
</html>`;

    // logic.js
    const logicLines = [];
    logicLines.push(`const api = window.WidgetAPI;`);
    logicLines.push(`const _latestData = {};`);

    const textCompsWithTemplate = comps.filter(c => c.type === 'text' && c.props.content && c.props.content.includes('{{'));
    const clockComps = comps.filter(c => c.type === 'clock');
    const clockTextComps = [];

    if (textCompsWithTemplate.length > 0 || clockComps.length > 0) {
        logicLines.push(`function fmt(f, tz) { const n = tz==='local'?new Date():new Date(new Date().toLocaleString('en-US',{timeZone:tz})); const h24=n.getHours(),m=n.getMinutes(),s=n.getSeconds(),h12=h24%12||12,ap=h24<12?'AM':'PM',p=x=>String(x).padStart(2,'0'); return f.replace('HH',p(h24)).replace('mm',p(m)).replace('ss',p(s)).replace('hh',p(h12)).replace('A',ap); }`);
    }

    if (textCompsWithTemplate.length > 0) {
        logicLines.push(`function renderTemplate(tpl) {
    return tpl.replace(/{{(.*?)}}/g, (match, key) => {
        key = key.trim();
        if (key === 'time') return fmt('HH:mm:ss', 'local');
        if (key === 'date') return new Date().toLocaleDateString();
        if (_latestData[key] !== undefined) {
            const val = parseFloat(_latestData[key]);
            if (!isNaN(val)) return val.toFixed(1);
            return _latestData[key];
        }
        return '--';
    });
}`);
    }

    const eventToComps = {};
    for (const comp of comps) {
        if (comp.props && comp.props.source) {
            const ev = sourceEventMap[comp.props.source];
            if (ev) {
                if (!eventToComps[ev]) eventToComps[ev] = [];
                eventToComps[ev].push(comp);
            }
        }

        if (comp.type === 'text' && comp.props.content) {
            const matches = comp.props.content.match(/{{(.*?)}}/g);
            if (matches) {
                for (const m of matches) {
                    const key = m.slice(2, -2).trim();
                    const ev = sourceEventMap[key];
                    if (ev) {
                        if (!eventToComps[ev]) eventToComps[ev] = [];
                        if (!eventToComps[ev].includes(comp)) eventToComps[ev].push(comp);
                    }
                    if (key === 'time' || key === 'date') {
                        if (!clockTextComps.includes(comp)) clockTextComps.push(comp);
                    }
                }
            }
        }
    }

    for (const [ev, evComps] of Object.entries(eventToComps)) {
        const body = evComps.map(comp => {
            if (comp.type === 'metric') {
                return `  const el${comp.id} = document.getElementById('val-${comp.id}'); if (el${comp.id} && d['${comp.props.source}'] !== undefined) el${comp.id}.textContent = parseFloat(d['${comp.props.source}']).toFixed(${comp.props.decimalPlaces || 1}) + '${comp.props.suffix || ''}';`;
            } else if (comp.type === 'progressbar') {
                return `  const pb${comp.id} = document.getElementById('pb-${comp.id}'); if (pb${comp.id} && d['${comp.props.source}'] !== undefined) pb${comp.id}.style.width = Math.min(100,Math.max(0,parseFloat(d['${comp.props.source}']))).toFixed(1) + '%';`;
            } else if (comp.type === 'text') {
                return `  const txt${comp.id} = document.getElementById('comp-${comp.id}'); if (txt${comp.id}) txt${comp.id}.textContent = renderTemplate(\`${comp.props.content.replace(/`/g, '\\`')}\`);`;
            }
            return '';
        }).filter(Boolean).join('\n');

        if (body) {
            logicLines.push(`api.system.subscribe('${ev}', d => {\n  Object.assign(_latestData, d);\n${body}\n});`);
        }
    }

    if (clockComps.length > 0 || clockTextComps.length > 0) {
        let clockBody = clockComps.map(c => `  const ck${c.id} = document.getElementById('clk-${c.id}'); if (ck${c.id}) ck${c.id}.textContent = fmt(ck${c.id}.dataset.format, ck${c.id}.dataset.tz);`).join('\n');
        if (clockTextComps.length > 0) {
            clockBody += (clockBody ? '\n' : '') + clockTextComps.map(c => `  const txt${c.id} = document.getElementById('comp-${c.id}'); if (txt${c.id}) txt${c.id}.textContent = renderTemplate(\`${c.props.content.replace(/`/g, '\\`')}\`);`).join('\n');
        }
        logicLines.push(`setInterval(()=>{\n${clockBody}\n}, 1000);`);
    }

    logicLines.push(`api.widget.enableDrag();`);
    logicLines.push(`api.widget.enableResize();`);

    const logicJs = logicLines.join('\n\n');

    return {
        'module.json': moduleJson,
        'style.css': fullCss,
        'index.html': indexHtml,
        'logic.js': logicJs,
    };
}

export { cmdNew, cmdOpen, cmdSave, cmdSaveAs, cmdExport };

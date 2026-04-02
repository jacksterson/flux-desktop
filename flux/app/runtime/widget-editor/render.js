import { COMPONENT_TYPES, DATA_SOURCES } from './store.js';
import { resolveColor, paletteSwatchesHtml } from './palette.js';
import { applyEffects, effectsPropsHtml } from './effects.js';
import { startShaderLoop, resolveShaderGlsl, SHADER_PRESETS, SHADER_PRESET_KEYS } from './shader.js';

let _ctx = null;
export function setContext(ctx) { _ctx = ctx; }

// ── Snap helper ───────────────────────────────────────────────────────────────

function snapVal(v) {
    if (!document.getElementById('btn-snap').classList.contains('active')) return Math.round(v);
    return Math.round(v / 8) * 8;
}

// ── Canvas renderer ───────────────────────────────────────────────────────────

function renderCanvas() {
    const canvasEl = document.getElementById('canvas');
    // Remove all component elements (preserve non-component children if any)
    canvasEl.querySelectorAll('.comp').forEach(el => el.remove());

    for (const comp of _ctx.store.getAll()) {
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
        if (_ctx.selectedIds.has(comp.id)) {
            el.style.outline = _ctx.primaryId === comp.id ? '2px solid #00bfff' : '2px dashed #00bfff';
            el.style.outlineOffset = '1px';
            el.style.overflow = 'visible';
        }
        renderComponentContent(el, comp);

        // Component drag (move)
        el.addEventListener('mousedown', e => {
            if (e.target.classList.contains('resize-handle')) return;
            if (!_ctx.selectedIds.has(comp.id)) {
                selectComponent(comp.id, e.ctrlKey || e.metaKey);
            } else if (e.ctrlKey || e.metaKey) {
                selectComponent(comp.id, true);
                e.stopPropagation(); e.preventDefault();
                return;
            }
            _ctx._drag.type = 'move';
            _ctx._drag.startX = e.clientX;
            _ctx._drag.startY = e.clientY;
            _ctx._drag.originals = {};
            for (const id of _ctx.selectedIds) {
                const c = _ctx.store.getById(id);
                if (c) _ctx._drag.originals[id] = { x: c.x, y: c.y, w: c.width, h: c.height };
            }
            e.stopPropagation();
            e.preventDefault();
        });

        // Resize handles (single active component)
        if (_ctx.selectedIds.size === 1 && comp.id === _ctx.primaryId) {
            const handleDirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
            for (const dir of handleDirs) {
                const h = document.createElement('div');
                h.className = 'resize-handle rh-' + dir;
                h.dataset.dir = dir;
                h.addEventListener('mousedown', e => {
                    e.stopPropagation();
                    e.preventDefault();
                    _ctx._drag.type = 'resize';
                    _ctx._drag.compId = comp.id;
                    _ctx._drag.handle = dir;
                    _ctx._drag.startX = e.clientX;
                    _ctx._drag.startY = e.clientY;
                    _ctx._drag.startCompX = comp.x;
                    _ctx._drag.startCompY = comp.y;
                    _ctx._drag.startW = comp.width;
                    _ctx._drag.startH = comp.height;
                });
                el.appendChild(h);
            }
        }

        canvasEl.appendChild(el);
    }

    // Group resize overlay
    const existingOverlay = canvasEl.querySelector('#group-resize-overlay');
    if (existingOverlay) existingOverlay.remove();
    if (_ctx.selectedIds.size > 1) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of _ctx.selectedIds) {
            const c = _ctx.store.getById(id);
            if (!c) continue;
            minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
            maxX = Math.max(maxX, c.x + c.width); maxY = Math.max(maxY, c.y + c.height);
        }
        const overlay = document.createElement('div');
        overlay.id = 'group-resize-overlay';
        overlay.style.left = minX + 'px';
        overlay.style.top = minY + 'px';
        overlay.style.width = (maxX - minX) + 'px';
        overlay.style.height = (maxY - minY) + 'px';
        const handleDirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
        for (const dir of handleDirs) {
            const h = document.createElement('div');
            h.className = 'resize-handle rh-' + dir;
            h.style.pointerEvents = 'auto';
            h.addEventListener('mousedown', e => {
                e.stopPropagation();
                e.preventDefault();
                _ctx._drag.type = 'group-resize';
                _ctx._drag.handle = dir;
                _ctx._drag.startX = e.clientX;
                _ctx._drag.startY = e.clientY;
                _ctx._drag.startCompX = minX;
                _ctx._drag.startCompY = minY;
                _ctx._drag.startW = maxX - minX;
                _ctx._drag.startH = maxY - minY;
                _ctx._drag.originals = {};
                for (const id of _ctx.selectedIds) {
                    const c = _ctx.store.getById(id);
                    if (c) _ctx._drag.originals[id] = { x: c.x, y: c.y, w: c.width, h: c.height };
                }
            });
            overlay.appendChild(h);
        }
        canvasEl.appendChild(overlay);
    }

    _ctx.setupLiveData().catch(e => console.error('[live-data] setupLiveData failed:', e));
}

function renderComponentContent(el, comp) {
    const p = comp.props;
    switch (comp.type) {
        case 'text':
            el.style.fontFamily = p.fontFamily;
            el.style.fontSize = p.fontSize + 'px';
            el.style.color = resolveColor(p.color);
            el.style.fontWeight = p.fontWeight;
            el.style.textAlign = p.textAlign;
            el.style.letterSpacing = p.letterSpacing + 'px';
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            if (p.content && p.content.includes('{{')) {
                el.dataset.template = p.content;
                el.textContent = _ctx.renderTemplate(p.content);
            } else {
                delete el.dataset.template;
                el.textContent = p.content;
            }
            break;
        case 'metric':
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
            el.style.justifyContent = 'center';
            el.innerHTML = `
                ${p.label ? `<div style="font-size:10px;color:#888;font-family:monospace;">${escHtml(p.label)}</div>` : ''}
                <div style="font-size:${p.fontSize}px;color:${resolveColor(p.color)};font-family:${p.fontFamily};font-weight:bold;">
                    <span class="live-value" data-source="${escHtml(String(p.source))}">--</span>${escHtml(p.suffix)}
                </div>`;
            break;
        case 'progressbar':
            el.style.background = resolveColor(p.bgColor);
            el.style.borderRadius = p.borderRadius + 'px';
            el.innerHTML = `<div class="pb-fill" data-source="${escHtml(String(p.source))}" style="
                height:100%; width:0%; background:${resolveColor(p.fgColor)};
                border-radius:${p.borderRadius}px; transition:width 0.3s;
            "></div>`;
            break;
        case 'linegraph':
            el.innerHTML = `<canvas class="lg-canvas" data-source="${escHtml(String(p.source))}" width="${comp.width}" height="${comp.height}"></canvas>`;
            break;
        case 'circlemeter':
            el.innerHTML = `<canvas class="cm-canvas" data-source="${escHtml(String(p.source))}" width="${comp.width}" height="${comp.height}"></canvas>`;
            break;
        case 'clock':
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.justifyContent = 'center';
            el.style.fontFamily = p.fontFamily;
            el.style.fontSize = p.fontSize + 'px';
            el.style.color = resolveColor(p.color);
            el.innerHTML = `<span class="clock-display" data-format="${escHtml(p.format)}" data-tz="${escHtml(p.timezone)}">--:--</span>`;
            break;
        case 'divider':
            if (p.orientation === 'horizontal') {
                el.style.borderTop = `${p.thickness}px solid ${resolveColor(p.color)}`;
                el.style.margin = `${p.margin}px 0`;
            } else {
                el.style.borderLeft = `${p.thickness}px solid ${resolveColor(p.color)}`;
                el.style.margin = `0 ${p.margin}px`;
            }
            break;
        case 'rawhtml': {
            // Inject scoped CSS if provided
            if (p.css && p.css.trim()) {
                const styleId = `rawhtml-style-${comp.id}`;
                let styleEl = document.getElementById(styleId);
                if (!styleEl) {
                    styleEl = document.createElement('style');
                    styleEl.id = styleId;
                    document.head.appendChild(styleEl);
                }
                // Scope all rules under the component's element
                styleEl.textContent = p.css.replace(/([^{}]+)\{/g, `#comp-preview-${comp.id} $1 {`);
            }
            el.id = `comp-preview-${comp.id}`;
            el.innerHTML = p.html || '';
            break;
        }
        case 'shader': {
            el.innerHTML = `<canvas class="shader-canvas" width="${comp.width}" height="${comp.height}" style="width:100%;height:100%;display:block;"></canvas>`;
            break;
        }
        case 'image': {
            const src = comp.props.src || '';
            let resolvedSrc = src;
            if (src.startsWith('flux://asset/')) {
                const filename = src.replace('flux://asset/', '');
                const localAssets = window._assetManagerGetLocal ? window._assetManagerGetLocal() : {};
                if (localAssets[filename]) resolvedSrc = localAssets[filename].dataUrl;
            }
            el.innerHTML = resolvedSrc
                ? `<img src="${escHtml(resolvedSrc)}" style="width:100%;height:100%;object-fit:${escHtml(comp.props.objectFit || 'contain')};display:block;">`
                : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#555;font-size:11px;">No image</div>`;
            break;
        }
    }
    // Apply CSS effect presets
    applyEffects(el, comp);
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function selectComponent(id, keepExisting = false) {
    if (id) {
        if (!keepExisting) _ctx.selectedIds.clear();
        if (_ctx.selectedIds.has(id) && keepExisting) {
            _ctx.selectedIds.delete(id);
            if (_ctx.primaryId === id) _ctx.primaryId = [..._ctx.selectedIds][0] || null;
        } else {
            _ctx.selectedIds.add(id);
            _ctx.primaryId = id;
        }
    } else {
        _ctx.selectedIds.clear();
        _ctx.primaryId = null;
    }
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
            const comp = _ctx.store.add(type, {}, _ctx.defaultColor);
            _ctx.store.update(comp.id, { x: cx, y: cy });
            selectComponent(comp.id);
            _ctx.pushHistory();
            renderCanvas();
            renderLayers();
        });
        list.appendChild(item);
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
    const resolved = resolveColor(val);
    const swatches = paletteSwatchesHtml(val);
    return propRow(label, `${swatches}<input class="prop-input" type="color" data-prop="${escHtml(key)}" value="${escHtml(String(resolved))}">`);
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
    let opts = DATA_SOURCES.map(s => `<option value="${escHtml(s.key)}" ${s.key === val ? 'selected' : ''}>${escHtml(s.label)}</option>`).join('');
    const customSrcs = _ctx && _ctx.getSources ? _ctx.getSources() : [];
    if (customSrcs.length > 0) {
        opts += `<optgroup label="Custom Sources">`;
        customSrcs.forEach(s => {
            opts += `<option value="${escHtml(s.name)}" ${s.name === val ? 'selected' : ''}>${escHtml(s.name)}</option>`;
        });
        opts += `</optgroup>`;
    }
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
        _ctx.store.updateProps(comp.id, { [key]: value });
    } else {
        _ctx.store.update(comp.id, { [propPath]: value });
    }
    renderCanvas();
    _ctx.pushHistory();
}

// ── Properties panel ──────────────────────────────────────────────────────────

function renderProperties() {
    const container = document.getElementById('properties-content');
    if (_ctx.selectedIds.size === 0) {
        container.innerHTML = '<p class="empty-state">Select a component to edit.</p>';
        return;
    }

    const fields = [];
    if (_ctx.selectedIds.size > 1) {
        const opacs = [..._ctx.selectedIds].map(id => _ctx.store.getById(id)).filter(Boolean).map(c => c.opacity);
        const avgO = opacs.length ? Math.round(opacs.reduce((a,b)=>a+b)/opacs.length) : 100;
        fields.push(
            `<div style="padding:12px 8px; font-weight:bold; color:#00bfff;">${_ctx.selectedIds.size} components selected</div>`,
            propRange('Group Opacity', 'opacity', avgO, 0, 100)
        );
        container.innerHTML = fields.join('');
        container.querySelectorAll('.prop-input').forEach(input => {
            input.addEventListener('input', e => {
                if (e.target.dataset.path === 'opacity') {
                    for (const id of _ctx.selectedIds) _ctx.store.update(id, { opacity: parseInt(e.target.value) });
                    renderCanvas();
                }
            });
            input.addEventListener('change', () => _ctx.pushHistory());
        });
        return;
    }

    const comp = _ctx.store.getById(_ctx.primaryId);
    if (!comp) return;

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
            const availableKeys = DATA_SOURCES.map(d => `{{${d.key}}}`).join(', ') + ', {{time}}, {{date}}';
            fields.push(
                propText(    'Content',        'props.content',      comp.props.content),
                `<div style="font-size:10px; color:#888; padding:0 8px 8px; line-height:1.3;">Available keys:<br><span style="font-family:monospace;">${availableKeys}</span></div>`,
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
        case 'rawhtml':
            fields.push(
                `<div class="prop-label" style="padding:4px 8px 2px;">HTML</div>`,
                `<div class="prop-row"><textarea class="prop-textarea" data-prop="props.html" rows="6">${escHtml(String(comp.props.html || ''))}</textarea></div>`,
                `<div class="prop-label" style="padding:4px 8px 2px;">CSS (scoped to component)</div>`,
                `<div class="prop-row"><textarea class="prop-textarea" data-prop="props.css" rows="4">${escHtml(String(comp.props.css || ''))}</textarea></div>`,
            );
            break;
        case 'shader': {
            const presetOpts = SHADER_PRESET_KEYS.map(k =>
                `<option value="${escHtml(k)}" ${k === comp.props.preset ? 'selected' : ''}>${escHtml(SHADER_PRESETS[k].label)}</option>`
            ).join('');
            fields.push(
                propRow('Preset', `<select class="prop-input" data-prop="props.preset">
                    ${presetOpts}
                    <option value="custom" ${'custom' === comp.props.preset ? 'selected' : ''}>Custom GLSL</option>
                </select>`),
            );
            if (comp.props.preset === 'custom') {
                fields.push(
                    `<div class="prop-label" style="padding:4px 8px 2px;">Fragment Shader (GLSL)</div>`,
                    `<div class="prop-row"><textarea class="prop-textarea" data-prop="props.fragmentShader" rows="10">${escHtml(String(comp.props.fragmentShader || ''))}</textarea></div>`,
                );
            }
            break;
        }
        case 'image':
            fields.push(
                propRow('Image', `<div style="display:flex;gap:4px;"><input class="prop-input" id="prop-img-src" type="text" value="${escHtml(comp.props.src || '')}" placeholder="flux://asset/filename.png" style="flex:1;"><button id="prop-img-pick" class="btn-secondary" style="padding:3px 7px;">Pick</button></div>`),
                propSelect('Fit', 'props.objectFit', comp.props.objectFit, ['contain','cover','fill','none']),
            );
            break;
    }

    // Effects section — shown for all single-component selections
    fields.push(effectsPropsHtml(comp));

    container.innerHTML = fields.join('');

    // Wire image-specific handlers
    document.getElementById('prop-img-src')?.addEventListener('change', function() {
        _ctx.store.updateProps(_ctx.primaryId, { src: this.value });
        _ctx.pushHistory();
        _ctx.renderCanvas();
    });
    document.getElementById('prop-img-pick')?.addEventListener('click', () => {
        import('./asset-manager.js').then(({ openAssetManager }) => openAssetManager()).catch(err => console.error('[image pick]', err));
    });

    // Wire up change events
    container.querySelectorAll('[data-prop]').forEach(input => {
        const event = input.type === 'range' ? 'input' : 'change';
        input.addEventListener(event, () => {
            applyPropChange(comp, input.dataset.prop, input.type === 'checkbox' ? input.checked : input.value);
        });
    });

    // Wire CSS effect toggles
    container.querySelectorAll('.effect-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            const current = new Set(comp.props.cssEffects || []);
            if (cb.checked) current.add(cb.dataset.effect);
            else current.delete(cb.dataset.effect);
            _ctx.store.updateProps(comp.id, { cssEffects: [...current] });
            _ctx.renderCanvas();
            _ctx.pushHistory();
            renderProperties(); // re-render to update chip active state
        });
    });

    // Wire palette swatch clicks (sets property to a palette variable reference)
    container.querySelectorAll('.prop-palette-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            const varName = swatch.dataset.paletteVar;
            const propInput = swatch.closest('.prop-row').querySelector('[data-prop]');
            if (propInput) {
                applyPropChange(comp, propInput.dataset.prop, { paletteVar: varName });
                renderProperties();
            }
        });
    });
}

function reorderLayer(draggedId, targetId) {
    const dragged = _ctx.store.getById(draggedId);
    const target  = _ctx.store.getById(targetId);
    if (!dragged || !target) return;
    const tmp = dragged.zIndex;
    _ctx.store.update(draggedId, { zIndex: target.zIndex });
    _ctx.store.update(targetId,  { zIndex: tmp });
    _ctx.pushHistory();
    renderCanvas();
    renderLayers();
}

function renderLayers() {
    const list = document.getElementById('layers-list');
    list.innerHTML = '';

    // Reverse order: top of list = highest z-index
    const comps = _ctx.store.getAll().reverse();

    comps.forEach((comp, listIndex) => {
        const row = document.createElement('div');
        row.className = 'layer-row' + (_ctx.selectedIds.has(comp.id) ? ' active' : '');
        row.dataset.id = comp.id;
        row.draggable = true;

        const typeIcons = { text:'T', metric:'#', progressbar:'▬', linegraph:'📈', circlemeter:'○', clock:'🕐', divider:'—', rawhtml:'</>', shader:'◈' };
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
            _ctx.store.update(comp.id, { visible: !comp.visible });
            _ctx.pushHistory();
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
    document.getElementById('canvas').style.width = _ctx.canvasWidth.value + 'px';
    document.getElementById('canvas').style.height = _ctx.canvasHeight.value + 'px';
    renderCanvas();
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
    let toast = document.getElementById('editor-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'editor-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast toast-' + type;
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

export {
    snapVal, renderCanvas, renderComponentContent, escHtml, selectComponent,
    renderComponentsPanel, propRow, propNumber, propText, propColor, propRange,
    propSelect, propCheck, propSource, applyPropChange, renderProperties,
    reorderLayer, renderLayers, updateCanvasSize, showToast,
};

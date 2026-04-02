import { ComponentStore, HistoryStack, COMPONENT_TYPES, SOURCE_EVENTS, DATA_SOURCES, PRESETS } from './store.js';
import { renderPalettePanel, setPaletteChangeCallback, resolveColor, paletteSwatchesHtml, serializePalette, deserializePalette, generatePaletteCSS } from './palette.js';
import { renderCanvas, renderComponentContent, escHtml, selectComponent,
         renderComponentsPanel, renderProperties, renderLayers, updateCanvasSize,
         showToast, snapVal, setContext as setRenderContext } from './render.js';
import { renderTemplate, setupLiveData, teardownLiveData, setContext as setLiveDataContext } from './live-data.js';
import { cmdNew, cmdOpen, cmdSave, cmdSaveAs, cmdExport, setContext as setFileOpsContext } from './file-ops.js';
import { setContext as setEffectsContext } from './effects.js';
import { setContext as setShaderContext } from './shader.js';
import {
    renderSourcesPanel, serializeSources, deserializeSources,
    startSourceListeners, stopSourceListeners, registerSources,
    getSources, setContext as setDataSourcesContext
} from './data-sources.js';
import {
    openAssetManager, serializeLocalAssets, deserializeLocalAssets,
    getLocalAssets, setContext as setAssetManagerContext
} from './asset-manager.js';

if (!window.__TAURI__) {
  document.getElementById('canvas').innerHTML =
    '<p style="padding:20px;color:#c00">Tauri IPC not available.</p>';
  throw new Error('[WidgetEditor] window.__TAURI__ not available');
}

const { invoke } = window.__TAURI__.core;

const canvas = document.getElementById('canvas');
const canvasWidth = document.getElementById('canvas-width');
const canvasHeight = document.getElementById('canvas-height');

let defaultColor = '#00bfff'; // Updated by preset system; used as default for NEW components

// ── State ─────────────────────────────────────────────────────────────────────

const store = new ComponentStore();
let selectedIds = new Set();
let primaryId = null;
let _selRect = null;
const history = new HistoryStack();
let currentFilePath = null; // null means unsaved

function getAppState() {
    const data = JSON.parse(store.serialize());
    data.palette = serializePalette();
    data.dataSources = serializeSources();
    data.localAssets = serializeLocalAssets();
    return JSON.stringify(data);
}

function setAppState(json) {
    const data = JSON.parse(json);
    store.deserialize(json, updateCanvasSize);
    if (data.palette) {
        deserializePalette(data.palette);
        renderPalettePanel();
    }
    deserializeSources(data.dataSources || []);
    deserializeLocalAssets(data.localAssets || {});
}

function pushHistory() {
    history.push(getAppState());
}

// Single drag/resize state object
const _drag = { type: null, compId: null, ox: 0, oy: 0, startX: 0, startY: 0, startCompX: 0, startCompY: 0, startW: 0, startH: 0, handle: null };

// ── Context object ────────────────────────────────────────────────────────────

const ctx = {
    get store()          { return store; },
    get selectedIds()    { return selectedIds; },
    get primaryId()      { return primaryId; },
    set primaryId(v)     { primaryId = v; },
    get defaultColor()   { return defaultColor; },
    set defaultColor(v)  { defaultColor = v; },
    get _drag()          { return _drag; },
    get _selRect()       { return _selRect; },
    set _selRect(v)      { _selRect = v; },
    get currentFilePath(){ return currentFilePath; },
    set currentFilePath(v){ currentFilePath = v; },
    get history()        { return history; },
    get invoke()         { return invoke; },
    get canvas()         { return canvas; },
    get canvasWidth()    { return canvasWidth; },
    get canvasHeight()   { return canvasHeight; },
    getAppState, setAppState, pushHistory,
    resolveColor:          (...a) => resolveColor(...a),
    renderCanvas:          (...a) => renderCanvas(...a),
    renderProperties:      (...a) => renderProperties(...a),
    renderLayers:          (...a) => renderLayers(...a),
    renderComponentsPanel: (...a) => renderComponentsPanel(...a),
    setupLiveData:         (...a) => setupLiveData(...a),
    teardownLiveData:      (...a) => teardownLiveData(...a),
    renderTemplate:        (...a) => renderTemplate(...a),
    escHtml:               (...a) => escHtml(...a),
    showToast:             (...a) => showToast(...a),
    renderSourcesPanel:    (...a) => renderSourcesPanel(...a),
    serializeSources:      (...a) => serializeSources(...a),
    getSources:            (...a) => getSources(...a),
};

setRenderContext(ctx);
setLiveDataContext(ctx);
setFileOpsContext(ctx);
setEffectsContext(ctx);
setShaderContext(ctx);
setDataSourcesContext(ctx);
setAssetManagerContext(ctx);
window._assetManagerGetLocal = getLocalAssets;

// ── Drag/resize handlers ──────────────────────────────────────────────────────

function onDragMove(e) {
    if (_selRect) {
        const canvas = document.getElementById('canvas');
        const canvasRect = canvas.getBoundingClientRect();
        const x = Math.min(e.clientX, _selRect.startX) - canvasRect.left;
        const y = Math.min(e.clientY, _selRect.startY) - canvasRect.top;
        const w = Math.abs(e.clientX - _selRect.startX);
        const h = Math.abs(e.clientY - _selRect.startY);
        const div = canvas.querySelector('.selection-rect');
        if (div) {
            div.style.left = x + 'px';
            div.style.top = y + 'px';
            div.style.width = w + 'px';
            div.style.height = h + 'px';
        }
        return;
    }
    if (!_drag.type) return;
    const c = store.getById(_drag.compId);
    if (!c) { _drag.type = null; return; }

    if (_drag.type === 'move') {
        const dx = e.clientX - _drag.startX;
        const dy = e.clientY - _drag.startY;
        for (const [id, orig] of Object.entries(_drag.originals)) {
            let tx = orig.x + dx, ty = orig.y + dy;
            if (document.getElementById('btn-snap').classList.contains('active')) {
                tx = Math.round(tx / 8) * 8; ty = Math.round(ty / 8) * 8;
            }
            store.update(id, { x: tx, y: ty });
        }
        renderCanvas();
    } else if (_drag.type === 'resize' || _drag.type === 'group-resize') {
        const dx = e.clientX - _drag.startX;
        const dy = e.clientY - _drag.startY;
        let nx = _drag.startCompX, ny = _drag.startCompY, nw = _drag.startW, nh = _drag.startH;
        const h = _drag.handle;
        if (h.includes('e')) nw = Math.max(20, snapVal(_drag.startW + dx));
        if (h.includes('s')) nh = Math.max(10, snapVal(_drag.startH + dy));
        if (h.includes('w')) { nw = Math.max(20, snapVal(_drag.startW - dx)); nx = snapVal(_drag.startCompX + dx); }
        if (h.includes('n')) { nh = Math.max(10, snapVal(_drag.startH - dy)); ny = snapVal(_drag.startCompY + dy); }

        if (_drag.type === 'resize') {
            store.update(_drag.compId, { x: nx, y: ny, width: nw, height: nh });
        } else {
            const scaleX = nw / _drag.startW;
            const scaleY = nh / _drag.startH;
            for (const [id, orig] of Object.entries(_drag.originals)) {
                const ox = orig.x - _drag.startCompX;
                const oy = orig.y - _drag.startCompY;
                store.update(id, {
                    x: Math.round(nx + ox * scaleX),
                    y: Math.round(ny + oy * scaleY),
                    width: Math.max(10, Math.round(orig.w * scaleX)),
                    height: Math.max(10, Math.round(orig.h * scaleY))
                });
            }
        }
        renderCanvas();
    }
}

function onDragEnd() {
    if (_selRect) {
        const canvas = document.getElementById('canvas');
        const selDiv = canvas.querySelector('.selection-rect');
        if (selDiv) {
            const selBounds = selDiv.getBoundingClientRect();
            const comps = canvas.querySelectorAll('.comp');
            let first = true;
            comps.forEach(el => {
                const compBounds = el.getBoundingClientRect();
                const intersects = !(
                    compBounds.right  < selBounds.left  ||
                    compBounds.left   > selBounds.right ||
                    compBounds.bottom < selBounds.top   ||
                    compBounds.top    > selBounds.bottom
                );
                if (intersects && el.dataset.id) {
                    selectedIds.add(el.dataset.id);
                    if (first) { primaryId = el.dataset.id; first = false; }
                }
            });
            selDiv.remove();
        }
        _selRect = null;
        renderCanvas();
        renderProperties();
        renderLayers();
        return;
    }
    if (_drag.type) {
        pushHistory();
    }
    _drag.type = null;
}

// ── Canvas size ───────────────────────────────────────────────────────────────

canvasWidth.addEventListener('input', updateCanvasSize);
canvasHeight.addEventListener('input', updateCanvasSize);
updateCanvasSize();

// ── Deselect on canvas background click ──────────────────────────────────────

document.getElementById('canvas').addEventListener('mousedown', e => {
    // If clicking on a component or its child, let the component's own handler fire
    if (e.target.closest('.comp')) return;

    selectedIds.clear(); primaryId = null;

    // Start rubber-band selection
    const canvas = document.getElementById('canvas');
    const div = document.createElement('div');
    div.className = 'selection-rect';
    div.style.left = '0px'; div.style.top = '0px';
    div.style.width = '0px'; div.style.height = '0px';
    canvas.appendChild(div);
    _selRect = { startX: e.clientX, startY: e.clientY };
    e.stopPropagation();

    renderCanvas();
    renderProperties();
    renderLayers();
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    // Don't fire when typing in an input
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    // Escape: clear selection
    if (e.key === 'Escape') {
        selectedIds.clear();
        primaryId = null;
        renderCanvas();
        renderProperties();
        renderLayers();
        return;
    }

    // Redo: Ctrl+Shift+Z
    if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        const snap = history.redo();
        if (snap) {
            setAppState(snap);
            /* obsolete clear activeId */
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
            setAppState(snap);
            /* obsolete clear activeId */
            renderCanvas();
            renderLayers();
        }
        return;
    }

    // Delete: Delete or Backspace
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        for (const id of selectedIds) store.remove(id);
        selectedIds.clear();
        primaryId = null;
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

// ── Assets button ─────────────────────────────────────────────────────────────

document.getElementById('btn-assets')?.addEventListener('click', openAssetManager);

// ── Refresh ───────────────────────────────────────────────────────────────────

document.getElementById('btn-refresh').addEventListener('click', () => location.reload());

// ── File buttons ──────────────────────────────────────────────────────────────

document.getElementById('btn-new').addEventListener('click', cmdNew);
document.getElementById('btn-open').addEventListener('click', cmdOpen);
document.getElementById('btn-save').addEventListener('click', cmdSave);
document.getElementById('btn-save-as').addEventListener('click', cmdSaveAs);
document.getElementById('btn-export').addEventListener('click', cmdExport);

// ── Presets ───────────────────────────────────────────────────────────────────

function applyPreset(presetId) {
    const preset = PRESETS[presetId];
    if (!preset) return;
    document.getElementById('canvas').style.backgroundColor = preset.bg;
    defaultColor = preset.primary;
    pushHistory();
    // Visual feedback: briefly highlight the active swatch
    document.querySelectorAll('.preset-swatch').forEach(el => el.classList.remove('preset-active'));
    document.getElementById(presetId).classList.add('preset-active');
}

document.getElementById('preset-ds').addEventListener('click', () => applyPreset('preset-ds'));
document.getElementById('preset-md').addEventListener('click', () => applyPreset('preset-md'));
document.getElementById('preset-ml').addEventListener('click', () => applyPreset('preset-ml'));

// ── Panel dragging and persistence ───────────────────────────────────────────

const PANEL_IDS = ['panel-components', 'panel-properties', 'panel-layers', 'panel-palette', 'panel-sources'];

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
renderPalettePanel();
renderSourcesPanel();
renderCanvas();

// Wire palette changes to re-render canvas
setPaletteChangeCallback(() => {
    renderCanvas();
    renderProperties();
});

// Push initial state to history so undo from state 1 works
pushHistory();

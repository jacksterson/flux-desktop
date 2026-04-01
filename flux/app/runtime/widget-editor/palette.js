// ── palette.js — CSS Variable Palette System ─────────────────────────────────
import { CURATED_LUTS, lutState, parseCubeAndExtract, applyCuratedLut, toggleLock, getExtractedColors } from './lut.js';

// ── Palette State ─────────────────────────────────────────────────────────────

const DEFAULT_SLOTS = [
    { name: 'Accent',     varName: 'accent',     value: '#00BFFF', isDefault: true },
    { name: 'Background', varName: 'background', value: '#0A0F1A', isDefault: true },
    { name: 'Text',       varName: 'text',       value: '#FFFFFF', isDefault: true },
    { name: 'Muted',      varName: 'muted',      value: '#888888', isDefault: true },
    { name: 'Border',     varName: 'border',     value: '#30363D', isDefault: true },
];

let _palette = DEFAULT_SLOTS.map(s => ({ ...s }));
let _onPaletteChange = null; // callback set by app.js

export function getPalette() {
    return _palette;
}

export function setPaletteChangeCallback(fn) {
    _onPaletteChange = fn;
}

function _notifyChange() {
    if (_onPaletteChange) _onPaletteChange();
}

// ── HSL Helpers ───────────────────────────────────────────────────────────────

function hexToHSL(hex) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

export function getShade(hex, delta) {
    const hsl = hexToHSL(hex);
    return hslToHex(hsl.h, hsl.s, Math.max(0, Math.min(100, hsl.l + delta)));
}

// ── Contrast Check (WCAG AA) ─────────────────────────────────────────────────

function luminance(hex) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const adjust = c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * adjust(r) + 0.7152 * adjust(g) + 0.0722 * adjust(b);
}

export function contrastRatio(hex1, hex2) {
    const l1 = luminance(hex1);
    const l2 = luminance(hex2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

// ── Palette CRUD ──────────────────────────────────────────────────────────────

export function addSlot(name, value = '#AAAAAA') {
    const varName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    _palette.push({ name, varName, value, isDefault: false });
    _notifyChange();
}

export function removeSlot(varName) {
    const idx = _palette.findIndex(s => s.varName === varName);
    if (idx !== -1 && !_palette[idx].isDefault) {
        _palette.splice(idx, 1);
        _notifyChange();
    }
}

export function updateSlotColor(varName, newColor) {
    const slot = _palette.find(s => s.varName === varName);
    if (slot) {
        slot.value = newColor;
        _notifyChange();
    }
}

export function renameSlot(varName, newName) {
    const slot = _palette.find(s => s.varName === varName);
    if (slot) {
        slot.name = newName;
        _notifyChange();
    }
}

export function resolveColor(propValue) {
    // If it's a palette reference like { paletteVar: "accent" }, resolve to hex
    if (propValue && typeof propValue === 'object' && propValue.paletteVar) {
        const slot = _palette.find(s => s.varName === propValue.paletteVar);
        return slot ? slot.value : '#FFFFFF';
    }
    return propValue;
}

// ── Palette Panel Rendering ──────────────────────────────────────────────────

export function renderPalettePanel() {
    const body = document.getElementById('palette-body');
    if (!body) return;

    const textSlot = _palette.find(s => s.varName === 'text');
    const bgSlot = _palette.find(s => s.varName === 'background');
    const contrastOk = textSlot && bgSlot ? contrastRatio(textSlot.value, bgSlot.value) >= 4.5 : true;

    let html = '';

    // Contrast warning
    if (!contrastOk) {
        html += `<div class="palette-warning">⚠️ Low contrast between Text and Background (ratio: ${contrastRatio(textSlot.value, bgSlot.value).toFixed(1)}:1). WCAG AA requires at least 4.5:1.</div>`;
    }

    // Slots
    for (const slot of _palette) {
        const lightHex = getShade(slot.value, 15);
        const darkHex = getShade(slot.value, -15);
        const isContrast = !contrastOk && (slot.varName === 'text' || slot.varName === 'background');

        html += `
        <div class="palette-slot${isContrast ? ' palette-slot-warn' : ''}" data-var="${slot.varName}">
            <div class="palette-swatch-row">
                <input type="color" class="palette-swatch" value="${slot.value}" data-var="${slot.varName}" title="${slot.name}">
                <span class="palette-name" data-var="${slot.varName}" title="Double-click to rename">${slot.name}</span>
                <span class="palette-hex">${slot.value}</span>
                ${!slot.isDefault ? `<button class="palette-del" data-var="${slot.varName}" title="Delete">×</button>` : ''}
            </div>
            <div class="palette-shades">
                <span class="shade-chip" style="background:${lightHex}" title="Light: ${lightHex}">${lightHex}</span>
                <span class="shade-chip" style="background:${darkHex}; color:#fff;" title="Dark: ${darkHex}">${darkHex}</span>
            </div>
        </div>`;
    }

    html += `<button id="palette-add" class="palette-add-btn">+ Add Color</button>`;

    // --- LUT Generator Section ---
    html += `
        <div class="palette-lut-section" style="margin-top:12px; border-top:1px solid #30363d; padding-top:12px;">
            <div style="font-size:10px; color:#888; text-transform:uppercase; margin-bottom:6px;">LUT Generator</div>
            <select id="lut-select" class="prop-input" style="width:100%; margin-bottom:6px;">
                ${Object.keys(CURATED_LUTS).map(k => `<option value="${k}" ${lutState.selectedLut === k ? 'selected' : ''}>${CURATED_LUTS[k].name}</option>`).join('')}
            </select>
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                ${lutState.extractedColors.map((color, i) => `
                    <div class="lut-swatch-wrapper" data-index="${i}" style="display:flex; flex-direction:column; align-items:center; gap:2px; cursor:pointer;" title="Click to lock">
                        <span style="display:block; width:24px; height:24px; border-radius:3px; background:${color}; border:1px solid #444;"></span>
                        <span style="font-size:10px; opacity:${lutState.locks[i] ? 1 : 0.4};">${lutState.locks[i] ? '🔒' : '🔓'}</span>
                    </div>
                `).join('')}
            </div>
            <div style="display:flex; gap:4px;">
                <button id="lut-import" class="btn-secondary" style="flex:1; padding:4px;">Import .cube</button>
                <button id="lut-apply" class="btn-primary" style="flex:2; padding:4px;">Apply</button>
            </div>
        </div>
    `;

    body.innerHTML = html;

    // Wire events
    body.querySelectorAll('.palette-swatch').forEach(input => {
        input.addEventListener('input', () => {
            updateSlotColor(input.dataset.var, input.value);
            renderPalettePanel();
        });
    });

    body.querySelectorAll('.palette-del').forEach(btn => {
        btn.addEventListener('click', () => {
            removeSlot(btn.dataset.var);
            renderPalettePanel();
        });
    });

    body.querySelectorAll('.palette-name').forEach(span => {
        span.addEventListener('dblclick', () => {
            const varName = span.dataset.var;
            const slot = _palette.find(s => s.varName === varName);
            if (!slot) return;
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'palette-name-edit';
            input.value = slot.name;
            span.replaceWith(input);
            input.focus();
            input.select();
            const finish = () => {
                const newName = input.value.trim() || slot.name;
                renameSlot(varName, newName);
                renderPalettePanel();
            };
            input.addEventListener('blur', finish);
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') finish();
                if (e.key === 'Escape') renderPalettePanel();
            });
        });
    });

    const addBtn = document.getElementById('palette-add');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const name = 'Custom ' + (_palette.length + 1);
            addSlot(name);
            renderPalettePanel();
        });
    }

    // LUT Select
    const lutSelect = document.getElementById('lut-select');
    if (lutSelect) {
        lutSelect.addEventListener('change', () => {
            applyCuratedLut(lutSelect.value);
            renderPalettePanel();
        });
    }

    // LUT Locks
    body.querySelectorAll('.lut-swatch-wrapper').forEach(wrapper => {
        wrapper.addEventListener('click', () => {
            toggleLock(parseInt(wrapper.dataset.index));
            renderPalettePanel();
        });
    });

    // LUT Import
    const lutImport = document.getElementById('lut-import');
    if (lutImport) {
        lutImport.addEventListener('click', async () => {
            try {
                if (!window.__TAURI__) return;
                const { open } = window.__TAURI__.dialog;
                const { readTextFile } = window.__TAURI__.fs;
                const selected = await open({ filters: [{ name: 'LUT', extensions: ['cube'] }], multiple: false });
                if (!selected) return;
                const text = await readTextFile(selected);
                const colors = parseCubeAndExtract(text);
                if (colors) renderPalettePanel();
                else alert('Invalid or un-parseable .cube file');
            } catch (e) {
                console.error(e);
            }
        });
    }

    // LUT Apply
    const lutApply = document.getElementById('lut-apply');
    if (lutApply) {
        lutApply.addEventListener('click', () => {
            const colors = getExtractedColors();
            for (let i = 0; i < 5 && i < _palette.length; i++) {
                if (colors[i]) updateSlotColor(_palette[i].varName, colors[i]);
            }
            renderPalettePanel();
        });
    }
}

// ── Palette Swatches for Properties Panel ────────────────────────────────────

export function paletteSwatchesHtml(currentValue) {
    // Returns a row of tiny swatches for embedding in the properties panel color pickers
    let html = '<div class="prop-palette-swatches">';
    for (const slot of _palette) {
        const active = currentValue && typeof currentValue === 'object' && currentValue.paletteVar === slot.varName;
        html += `<span class="prop-palette-swatch${active ? ' active' : ''}" data-palette-var="${slot.varName}" style="background:${slot.value}" title="${slot.name} (${slot.value})"></span>`;
    }
    html += '</div>';
    return html;
}

// ── Serialization (for .fluxwidget save/load) ────────────────────────────────

export function serializePalette() {
    return _palette.map(s => ({ name: s.name, varName: s.varName, value: s.value, isDefault: s.isDefault }));
}

export function deserializePalette(data) {
    if (Array.isArray(data) && data.length > 0) {
        _palette = data.map(s => ({ ...s }));
    }
}

// ── CSS Export ────────────────────────────────────────────────────────────────

export function generatePaletteCSS() {
    let css = ':root {\n';
    for (const slot of _palette) {
        css += `  --${slot.varName}: ${slot.value};\n`;
        css += `  --${slot.varName}-light: ${getShade(slot.value, 15)};\n`;
        css += `  --${slot.varName}-dark: ${getShade(slot.value, -15)};\n`;
    }
    css += '}\n';
    return css;
}

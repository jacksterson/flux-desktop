// ── effects.js — CSS Effect Preset definitions and application ────────────────

let _ctx = null;
export function setContext(ctx) { _ctx = ctx; }

export const EFFECTS = {
    glow: {
        label: 'Glow',
        apply: (el, comp) => {
            const color = (_ctx ? _ctx.resolveColor(comp.props.color || comp.props.lineColor || comp.props.fgColor) : null) || '#00bfff';
            el.style.filter = `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 14px ${color})`;
        },
        exportCss: (comp) => {
            const color = comp.props.color || comp.props.lineColor || comp.props.fgColor || '#00bfff';
            return `filter: drop-shadow(0 0 6px ${color}) drop-shadow(0 0 14px ${color});`;
        },
    },
    shadow: {
        label: 'Drop Shadow',
        apply: (el) => { el.style.filter = 'drop-shadow(2px 4px 8px rgba(0,0,0,0.9))'; },
        exportCss: () => 'filter: drop-shadow(2px 4px 8px rgba(0,0,0,0.9));',
    },
    blur: {
        label: 'Blur',
        apply: (el) => { el.style.filter = 'blur(2px)'; },
        exportCss: () => 'filter: blur(2px);',
    },
    neon_border: {
        label: 'Neon Border',
        apply: (el, comp) => {
            const color = (_ctx ? _ctx.resolveColor(comp.props.color || comp.props.lineColor || comp.props.fgColor) : null) || '#00bfff';
            el.style.boxShadow = `0 0 8px ${color}, inset 0 0 8px rgba(0,191,255,0.08)`;
            el.style.border = `1px solid ${color}`;
        },
        exportCss: (comp) => {
            const color = comp.props.color || comp.props.lineColor || comp.props.fgColor || '#00bfff';
            return `box-shadow: 0 0 8px ${color}, inset 0 0 8px rgba(0,191,255,0.08); border: 1px solid ${color};`;
        },
    },
    scanlines: {
        label: 'Scanlines',
        apply: (el) => {
            el.style.backgroundImage = 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.25) 2px, rgba(0,0,0,0.25) 4px)';
        },
        exportCss: () => 'background-image: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.25) 2px, rgba(0,0,0,0.25) 4px);',
    },
    vignette: {
        label: 'Vignette',
        apply: (el) => { el.style.boxShadow = 'inset 0 0 40px rgba(0,0,0,0.85)'; },
        exportCss: () => 'box-shadow: inset 0 0 40px rgba(0,0,0,0.85);',
    },
};

export const EFFECT_KEYS = Object.keys(EFFECTS);

/**
 * Apply all active effects from comp.props.cssEffects to el.
 * Called from renderComponentContent after the component's own styles are set.
 */
export function applyEffects(el, comp) {
    if (!comp.props.cssEffects || comp.props.cssEffects.length === 0) return;
    for (const key of comp.props.cssEffects) {
        const effect = EFFECTS[key];
        if (effect) effect.apply(el, comp);
    }
}

/**
 * Returns HTML string for the effects section in the Properties panel.
 * Shows checkboxes for each effect preset.
 */
export function effectsPropsHtml(comp) {
    const active = new Set(comp.props.cssEffects || []);
    let html = '<div class="effects-section">';
    html += '<div class="effects-label">CSS Effects</div>';
    html += '<div class="effects-grid">';
    for (const [key, def] of Object.entries(EFFECTS)) {
        const checked = active.has(key) ? 'checked' : '';
        html += `<label class="effect-chip${active.has(key) ? ' active' : ''}">
            <input type="checkbox" class="effect-toggle" data-effect="${key}" ${checked}>
            ${def.label}
        </label>`;
    }
    html += '</div></div>';
    return html;
}

/**
 * Returns additional CSS lines for a component's export rule, based on active effects.
 */
export function exportEffectsCss(comp) {
    if (!comp.props.cssEffects || comp.props.cssEffects.length === 0) return '';
    return comp.props.cssEffects
        .map(key => EFFECTS[key] ? EFFECTS[key].exportCss(comp) : '')
        .filter(Boolean)
        .join(' ');
}

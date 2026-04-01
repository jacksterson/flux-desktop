// ── lut.js — LUT processing and color extraction ────────────────────────────

export const CURATED_LUTS = {
    'cinematic': { name: 'Cinematic Teal & Orange', colors: ['#ff9933', '#cc6600', '#1a334d', '#004d66', '#002233'] },
    'cyberpunk': { name: 'Cyberpunk Neon', colors: ['#ff0055', '#cc00ff', '#00ffff', '#003366', '#0f0f1a'] },
    'film-noir': { name: 'Film Noir', colors: ['#e6e6e6', '#b3b3b3', '#808080', '#4d4d4d', '#1a1a1a'] },
    'vintage':   { name: 'Vintage Sepia', colors: ['#f2e6d9', '#d9c3a6', '#bf9f73', '#8c6b40', '#402a13'] },
    'arctic':    { name: 'Arctic Cool', colors: ['#e6f2ff', '#b3d9ff', '#66b3ff', '#0066cc', '#003366'] },
    'sunset':    { name: 'Sunset Warm', colors: ['#ffcc99', '#ff9966', '#ff6666', '#cc3333', '#660000'] },
    'br2049':    { name: 'Blade Runner 2049', colors: ['#ffaa00', '#ff5500', '#aa2200', '#112233', '#050a0f'] },
    'lofi':      { name: 'Lo-Fi Pastel', colors: ['#ffd9e6', '#d9b3ff', '#b3d9ff', '#b3ffb3', '#ffffb3'] },
    'forest':    { name: 'Moody Forest', colors: ['#8fbc8f', '#556b2f', '#2e8b57', '#006400', '#1a3300'] },
    'desert':    { name: 'Desert Sand', colors: ['#eeddcc', '#d2b48c', '#cd853f', '#8b4513', '#a0522d'] },
    'ocean':     { name: 'Ocean Deep', colors: ['#00bfff', '#1e90ff', '#0000cd', '#000080', '#000033'] },
    'tokyo':     { name: 'Neon Tokyo', colors: ['#ff1493', '#00ffff', '#8a2be2', '#4b0082', '#000022'] },
    'monochrome':{ name: 'Monochrome', colors: ['#ffffff', '#cccccc', '#999999', '#444444', '#000000'] },
    'portra':    { name: 'Kodak Portra 400', colors: ['#f9e5ce', '#e6c8a6', '#b38b6d', '#805544', '#33221a'] },
    'velvia':    { name: 'Fuji Velvia 50', colors: ['#e6f9e6', '#99e699', '#33cc33', '#008000', '#003300'] }
};

// State for the LUT generator
export const lutState = {
    selectedLut: 'cyberpunk',
    extractedColors: [...CURATED_LUTS['cyberpunk'].colors],
    locks: [false, false, false, false, false]
};

// ── .cube parsing and color extraction ────────────────────────────────────────

function rgbToHex(r, g, b) {
    const toHex = c => {
        const hex = Math.max(0, Math.min(255, Math.round(c * 255))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255
    };
}

export function parseCubeAndExtract(cubeText) {
    const lines = cubeText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const dataPoints = [];
    
    for (const line of lines) {
        // Skip metadata lines (TITLE, LUT_1D_SIZE, LUT_3D_SIZE, DOMAIN_*)
        if (/^[a-zA-Z_]+/.test(line)) continue;
        
        const parts = line.split(/\s+/).map(Number);
        if (parts.length === 3 && !parts.some(isNaN)) {
            dataPoints.push({ r: parts[0], g: parts[1], b: parts[2] });
        }
    }

    if (dataPoints.length === 0) return null;

    // Simple clustering/selection: sort by luminance and take 5 distinct representative points
    dataPoints.sort((a, b) => {
        const lumA = 0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b;
        const lumB = 0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b;
        return lumB - lumA; // bright to dark
    });

    // Take 5 samples evenly spaced across the luminance range
    const newColors = [];
    const step = Math.max(1, Math.floor(dataPoints.length / 5));
    for (let i = 0; i < 5; i++) {
        const idx = Math.min(dataPoints.length - 1, i * step + Math.floor(step / 2));
        const p = dataPoints[idx];
        newColors.push(rgbToHex(p.r, p.g, p.b));
    }

    applyExtractedColors(newColors);
    return newColors;
}

export function applyCuratedLut(lutId) {
    const lut = CURATED_LUTS[lutId];
    if (lut) {
        lutState.selectedLut = lutId;
        applyExtractedColors(lut.colors);
    }
}

function applyExtractedColors(newColors) {
    for (let i = 0; i < 5; i++) {
        if (!lutState.locks[i] && newColors[i]) {
            lutState.extractedColors[i] = newColors[i];
        }
    }
}

export function toggleLock(index) {
    if (index >= 0 && index < 5) {
        lutState.locks[index] = !lutState.locks[index];
    }
}

export function getExtractedColors() {
    return lutState.extractedColors;
}

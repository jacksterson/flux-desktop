if (!window.__TAURI__) {
  document.getElementById('canvas').innerHTML =
    '<p style="padding:20px;color:#c00">Tauri IPC not available.</p>';
  throw new Error('[WidgetEditor] window.__TAURI__ not available');
}

const { invoke } = window.__TAURI__.core;

const canvas = document.getElementById('canvas');
const canvasWidth = document.getElementById('canvas-width');
const canvasHeight = document.getElementById('canvas-height');

function updateCanvasSize() {
    canvas.style.width = canvasWidth.value + 'px';
    canvas.style.height = canvasHeight.value + 'px';
}
canvasWidth.addEventListener('input', updateCanvasSize);
canvasHeight.addEventListener('input', updateCanvasSize);
updateCanvasSize();

// Grid toggle
document.getElementById('btn-grid').addEventListener('click', function() {
    this.classList.toggle('active');
    canvas.classList.toggle('show-grid');
});

// Snap toggle
document.getElementById('btn-snap').addEventListener('click', function() {
    this.classList.toggle('active');
});

// Refresh
document.getElementById('btn-refresh').addEventListener('click', () => location.reload());

// File operations — implemented in Task 11
document.getElementById('btn-new').addEventListener('click', () => console.log('new'));
document.getElementById('btn-open').addEventListener('click', () => console.log('open'));
document.getElementById('btn-save').addEventListener('click', () => console.log('save'));
document.getElementById('btn-save-as').addEventListener('click', () => console.log('save-as'));
document.getElementById('btn-export').addEventListener('click', () => console.log('export'));

// Presets — implemented in Task 10
document.getElementById('preset-ds').addEventListener('click', () => console.log('preset-ds'));
document.getElementById('preset-md').addEventListener('click', () => console.log('preset-md'));
document.getElementById('preset-ml').addEventListener('click', () => console.log('preset-ml'));

// Panel dragging and persistence
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

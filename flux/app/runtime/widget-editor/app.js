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

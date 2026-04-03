const { invoke } = window.__TAURI__.core;

async function loadMonitors() {
    const el = document.getElementById('monitor-list');
    try {
        const monitors = await invoke('get_monitors');
        if (monitors.length === 0) {
            el.innerHTML = '<p class="empty-state">No monitors detected.</p>';
            return;
        }
        el.innerHTML = monitors.map((m) =>
            `<div class="monitor-row">
                <span class="monitor-name">${escHtml(m.name)}</span>
                <span class="monitor-res">${escHtml(String(m.width))}×${escHtml(String(m.height))}</span>
                ${m.x === 0 && m.y === 0 ? '<span class="monitor-badge">Primary</span>' : ''}
            </div>`
        ).join('');
    } catch (e) {
        el.innerHTML = '<p class="empty-state">Failed to load monitors.</p>';
        console.error('get_monitors failed:', e);
    }
}

async function loadOffscreenWidgets() {
    const el = document.getElementById('offscreen-list');
    try {
        const ids = await invoke('get_offscreen_widgets');
        if (ids.length === 0) {
            el.innerHTML = '<p class="empty-state">All widgets are on-screen.</p>';
            return;
        }
        el.innerHTML = '<div class="offscreen-table">' +
            ids.map(id =>
                `<div class="offscreen-row">
                    <span class="offscreen-id">${escHtml(id)}</span>
                    <button class="btn-recover btn-secondary" data-id="${escHtml(id)}">Move to primary</button>
                </div>`
            ).join('') +
            '</div>';

        el.querySelectorAll('.btn-recover').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await invoke('recover_widget', { id: btn.dataset.id });
                    await loadOffscreenWidgets();
                } catch (e) {
                    console.error('recover_widget failed:', e);
                }
            });
        });
    } catch (e) {
        el.innerHTML = '<p class="empty-state">Failed to load widget list.</p>';
        console.error('get_offscreen_widgets failed:', e);
    }
}

document.getElementById('btn-bring-all').addEventListener('click', async () => {
    const resultEl = document.getElementById('bring-result');
    try {
        const count = await invoke('bring_all_to_screen');
        resultEl.textContent = count === 0
            ? 'All widgets are already on-screen.'
            : `${count} widget${count === 1 ? ' was' : ' were'} moved to your primary monitor.`;
        resultEl.style.display = 'block';
        await loadOffscreenWidgets();
        setTimeout(() => { resultEl.style.display = 'none'; }, 4000);
    } catch (e) {
        resultEl.textContent = 'Error: ' + e;
        resultEl.style.display = 'block';
    }
});

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadPerformanceConfig() {
    try {
        const cfg = await invoke('get_performance_config');
        const check = document.getElementById('battery-saver-check');
        const intervalInput = document.getElementById('battery-interval-input');
        const intervalRow = document.getElementById('battery-interval-row');
        const normalLabel = document.getElementById('normal-interval-label');
        check.checked = cfg.battery_saver;
        intervalInput.value = cfg.battery_interval_ms;
        normalLabel.textContent = `Normal interval: ${cfg.broadcast_interval_ms} ms`;
        intervalRow.style.opacity = cfg.battery_saver ? '1' : '0.5';
        intervalInput.disabled = !cfg.battery_saver;
    } catch (e) {
        console.error('get_performance_config failed:', e);
    }
}

document.getElementById('battery-saver-check').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const intervalInput = document.getElementById('battery-interval-input');
    const intervalRow = document.getElementById('battery-interval-row');
    const resultEl = document.getElementById('perf-result');
    intervalRow.style.opacity = enabled ? '1' : '0.5';
    intervalInput.disabled = !enabled;
    try {
        await invoke('set_battery_saver', { enabled });
    } catch (err) {
        resultEl.textContent = 'Error: ' + err;
        resultEl.style.display = 'block';
        setTimeout(() => { resultEl.style.display = 'none'; }, 3000);
    }
});

document.getElementById('battery-interval-input').addEventListener('change', async (e) => {
    const ms = parseInt(e.target.value, 10);
    if (isNaN(ms) || ms < 500) { e.target.value = 500; return; }
    const resultEl = document.getElementById('perf-result');
    try {
        await invoke('set_battery_interval', { ms });
    } catch (err) {
        resultEl.textContent = 'Error: ' + err;
        resultEl.style.display = 'block';
        setTimeout(() => { resultEl.style.display = 'none'; }, 3000);
    }
});

loadMonitors();
loadOffscreenWidgets();
loadPerformanceConfig();

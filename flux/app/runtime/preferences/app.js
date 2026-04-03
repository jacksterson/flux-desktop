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
        document.getElementById('history-depth-input').value = cfg.history_depth ?? 60;
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

// ── History Depth ─────────────────────────────────────────────────────────────
document.getElementById('history-depth-input').addEventListener('change', async (e) => {
    const depth = parseInt(e.target.value, 10);
    if (isNaN(depth) || depth < 30) { e.target.value = 30; return; }
    if (depth > 300) { e.target.value = 300; return; }
    const resultEl = document.getElementById('perf-result');
    try {
        await invoke('set_history_depth', { depth });
    } catch (err) {
        resultEl.textContent = 'Error: ' + err;
        resultEl.style.display = 'block';
        setTimeout(() => { resultEl.style.display = 'none'; }, 3000);
    }
});

// ── Alerts ────────────────────────────────────────────────────────────────────
const ALERT_FIELDS = {
    cpu:      { avg_usage: 'Avg Usage (%)', cpu_temp: 'CPU Temp (°C)' },
    memory:   { used: 'Used (bytes)', available: 'Available (bytes)', swap_used: 'Swap Used (bytes)' },
    network:  { received: 'Received (B/s)', transmitted: 'Transmitted (B/s)' },
    gpu:      { usage: 'Usage (%)', vram_percentage: 'VRAM (%)', temp: 'Temp (°C)' },
    'disk-io': { read: 'Read (B/s)', write: 'Write (B/s)' },
};

const OP_LABELS = { gt: '>', lt: '<', gte: '≥', lte: '≤' };

function populateFieldSelect(metric) {
    const fieldSel = document.getElementById('alert-field');
    fieldSel.innerHTML = '';
    const fields = ALERT_FIELDS[metric] ?? {};
    for (const [val, label] of Object.entries(fields)) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        fieldSel.appendChild(opt);
    }
}

async function loadAlerts() {
    const listEl = document.getElementById('alert-list');
    try {
        const alerts = await invoke('get_alerts');
        if (!alerts || alerts.length === 0) {
            listEl.innerHTML = '<p class="empty-state">No alerts configured.</p>';
            return;
        }
        listEl.innerHTML = '';
        for (const alert of alerts) {
            const row = document.createElement('div');
            row.className = 'pref-row';
            row.style.alignItems = 'center';
            const fieldLabel = (ALERT_FIELDS[alert.metric] ?? {})[alert.field] ?? alert.field;
            const opLabel = OP_LABELS[alert.op] ?? alert.op;
            const summary = `${alert.metric} › ${fieldLabel} ${opLabel} ${alert.value} for ${alert.duration_secs}s`;
            row.innerHTML = `
                <span class="pref-label" style="flex:1;">${escHtml(alert.label || '(unlabeled)')}</span>
                <span class="pref-hint" style="flex:2;">${escHtml(summary)}</span>
                <button class="btn-secondary" data-id="${escHtml(alert.id)}" style="margin-left:8px;">Delete</button>
            `;
            row.querySelector('button[data-id]').addEventListener('click', async (e) => {
                try {
                    await invoke('unregister_alert', { id: e.target.getAttribute('data-id') });
                    await loadAlerts();
                } catch (err) {
                    const resultEl = document.getElementById('alert-result');
                    resultEl.textContent = 'Error: ' + err;
                    resultEl.style.display = 'block';
                    setTimeout(() => { resultEl.style.display = 'none'; }, 3000);
                }
            });
            listEl.appendChild(row);
        }
    } catch (err) {
        listEl.innerHTML = `<p class="empty-state">Failed to load alerts.</p>`;
        console.error('get_alerts failed:', err);
    }
}

document.getElementById('alert-metric').addEventListener('change', (e) => {
    populateFieldSelect(e.target.value);
});

document.getElementById('btn-add-alert').addEventListener('click', () => {
    const form = document.getElementById('alert-form');
    form.style.display = 'block';
    populateFieldSelect(document.getElementById('alert-metric').value);
});

document.getElementById('btn-alert-cancel').addEventListener('click', () => {
    document.getElementById('alert-form').style.display = 'none';
    document.getElementById('alert-result').style.display = 'none';
});

document.getElementById('alert-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultEl = document.getElementById('alert-result');
    const metric   = document.getElementById('alert-metric').value;
    const field    = document.getElementById('alert-field').value;
    const op       = document.getElementById('alert-op').value;
    const value    = parseFloat(document.getElementById('alert-value').value);
    const duration = parseInt(document.getElementById('alert-duration').value, 10);
    const label    = document.getElementById('alert-label').value.trim();
    const n = document.getElementById('alert-delivery-notification').checked;
    const c = document.getElementById('alert-delivery-callback').checked;
    const delivery = n && c ? 'both' : c ? 'callback' : 'notification';

    if (isNaN(value)) {
        resultEl.textContent = 'Value is required.';
        resultEl.style.display = 'block';
        return;
    }
    if (isNaN(duration) || duration < 1) {
        resultEl.textContent = 'Duration must be at least 1 second.';
        resultEl.style.display = 'block';
        return;
    }
    try {
        await invoke('register_alert', {
            metric, field, op, value,
            duration_secs: duration,
            delivery,
            label: label || '',
            window_id: null,
        });
        document.getElementById('alert-form').style.display = 'none';
        document.getElementById('alert-form').reset();
        resultEl.style.display = 'none';
        await loadAlerts();
    } catch (err) {
        resultEl.textContent = 'Error: ' + err;
        resultEl.style.display = 'block';
    }
});

loadAlerts();

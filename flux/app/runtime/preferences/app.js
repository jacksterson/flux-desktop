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

loadMonitors();
loadOffscreenWidgets();

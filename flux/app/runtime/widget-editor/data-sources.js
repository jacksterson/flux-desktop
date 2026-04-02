// ── data-sources.js — Custom data source state and panel ─────────────────────

let _ctx = null;
export function setContext(ctx) { _ctx = ctx; }

// ── State ─────────────────────────────────────────────────────────────────────

let _sources = []; // Array of CustomSourceDef objects
let _liveValues = {}; // { [name]: string }
let _unsubs = [];   // Tauri event unsubscribe functions

export function getSources() { return _sources; }

export function serializeSources() {
    return _sources;
}

export function deserializeSources(data) {
    _sources = Array.isArray(data) ? data.map(s => ({ ...s })) : [];
}

// ── Live preview subscriptions ────────────────────────────────────────────────

export function startSourceListeners() {
    stopSourceListeners();
    const { listen } = window.__TAURI__.event;
    _sources.forEach(s => {
        let cancel = null;
        listen(`custom-data:${s.name}`, e => {
            _liveValues[s.name] = String(e.payload);
            renderSourcesPanel();
        }).then(fn => { cancel = fn; });
        _unsubs.push(() => { if (cancel) cancel(); });
    });
}

export function stopSourceListeners() {
    _unsubs.forEach(fn => fn());
    _unsubs = [];
}

export function getLiveValues() { return _liveValues; }

// ── Register sources with Rust broker ─────────────────────────────────────────

export async function registerSources() {
    if (!_ctx) return;
    try {
        await _ctx.invoke('register_custom_sources', { sources: _sources });
    } catch (e) {
        console.error('[data-sources] register failed:', e);
    }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function addSource(def) {
    _sources.push({ ...def });
    await registerSources();
    startSourceListeners();
    _ctx.pushHistory();
    renderSourcesPanel();
}

export async function updateSource(name, def) {
    const idx = _sources.findIndex(s => s.name === name);
    if (idx !== -1) {
        _sources[idx] = { ...def };
        await registerSources();
        startSourceListeners();
        _ctx.pushHistory();
        renderSourcesPanel();
    }
}

export async function removeSource(name) {
    _sources = _sources.filter(s => s.name !== name);
    delete _liveValues[name];
    await registerSources();
    startSourceListeners();
    _ctx.pushHistory();
    renderSourcesPanel();
}

export async function testSource(def) {
    return _ctx.invoke('test_custom_source', { def });
}

// ── Panel rendering ───────────────────────────────────────────────────────────

export function renderSourcesPanel() {
    const body = document.getElementById('sources-body');
    if (!body) return;

    if (_sources.length === 0) {
        body.innerHTML = `
            <p class="empty-state">No custom sources yet.</p>
            <button id="btn-add-source" class="btn-primary" style="width:100%;margin-top:6px;">+ Add Source</button>
        `;
    } else {
        let html = '<div class="sources-list">';
        for (const s of _sources) {
            const val = _liveValues[s.name];
            const badge = s.type === 'http' ? 'HTTP' : 'SHELL';
            const badgeClass = s.type === 'http' ? 'badge-http' : 'badge-shell';
            html += `
                <div class="source-row" data-name="${s.name}">
                    <div class="source-row-main">
                        <span class="source-badge ${badgeClass}">${badge}</span>
                        <span class="source-name">${s.name}</span>
                        <span class="source-live-val">${val !== undefined ? val : '…'}</span>
                    </div>
                    <div class="source-row-actions">
                        <button class="source-edit-btn btn-icon" data-name="${s.name}" title="Edit">✎</button>
                        <button class="source-del-btn btn-icon" data-name="${s.name}" title="Delete">×</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        html += `<button id="btn-add-source" class="btn-primary" style="width:100%;margin-top:6px;">+ Add Source</button>`;
        body.innerHTML = html;
    }

    body.querySelector('#btn-add-source')?.addEventListener('click', () => showSourceForm(body, null));

    body.querySelectorAll('.source-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const src = _sources.find(s => s.name === btn.dataset.name);
            if (src) showSourceForm(body, src);
        });
    });

    body.querySelectorAll('.source-del-btn').forEach(btn => {
        btn.addEventListener('click', () => removeSource(btn.dataset.name));
    });
}

// ── Add/Edit form ─────────────────────────────────────────────────────────────

const INTERVAL_OPTIONS = [
    { value: 1,   label: '1 second' },
    { value: 5,   label: '5 seconds' },
    { value: 10,  label: '10 seconds' },
    { value: 30,  label: '30 seconds' },
    { value: 60,  label: '1 minute' },
    { value: 300, label: '5 minutes' },
    { value: 900, label: '15 minutes' },
];

function showSourceForm(container, existing) {
    const editing = !!existing;
    const def = existing ? { ...existing } : {
        name: '', type: 'shell', command: '', platformOverrides: {}, url: '', jsonPath: '', intervalSecs: 5,
    };

    container.innerHTML = `
        <div class="source-form">
            <div class="prop-row">
                <label class="prop-label">Name</label>
                <input id="sf-name" class="prop-input" type="text" value="${def.name}" placeholder="my_source">
            </div>
            <div class="prop-row">
                <label class="prop-label">Type</label>
                <select id="sf-type" class="prop-input">
                    <option value="shell" ${def.type === 'shell' ? 'selected' : ''}>Shell Command</option>
                    <option value="http"  ${def.type === 'http'  ? 'selected' : ''}>HTTP</option>
                </select>
            </div>
            <div class="prop-row">
                <label class="prop-label">Interval</label>
                <select id="sf-interval" class="prop-input">
                    ${INTERVAL_OPTIONS.map(o => `<option value="${o.value}" ${def.intervalSecs === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </div>

            <div id="sf-shell-fields" style="display:${def.type === 'shell' ? 'block' : 'none'}">
                <div class="prop-row">
                    <label class="prop-label">Command</label>
                    <input id="sf-command" class="prop-input" type="text" value="${def.command || ''}" placeholder="echo hello">
                </div>
                <details style="margin-bottom:6px;">
                    <summary style="font-size:10px;color:#888;cursor:pointer;">Per-platform overrides (optional)</summary>
                    <div class="prop-row"><label class="prop-label">Linux</label><input id="sf-linux" class="prop-input" type="text" value="${def.platformOverrides?.linux || ''}"></div>
                    <div class="prop-row"><label class="prop-label">macOS</label><input id="sf-macos" class="prop-input" type="text" value="${def.platformOverrides?.macos || ''}"></div>
                    <div class="prop-row"><label class="prop-label">Windows</label><input id="sf-windows" class="prop-input" type="text" value="${def.platformOverrides?.windows || ''}"></div>
                </details>
            </div>

            <div id="sf-http-fields" style="display:${def.type === 'http' ? 'block' : 'none'}">
                <div class="prop-row">
                    <label class="prop-label">URL</label>
                    <input id="sf-url" class="prop-input" type="text" value="${def.url || ''}" placeholder="https://api.example.com/data">
                </div>
                <div class="prop-row">
                    <label class="prop-label">JSON Path</label>
                    <input id="sf-jsonpath" class="prop-input" type="text" value="${def.jsonPath || ''}" placeholder="current.temperature_2m">
                </div>
                <div style="margin-bottom:6px;">
                    <a id="sf-preset-link" href="#" style="font-size:10px;color:#00bfff;">Use a preset...</a>
                </div>
            </div>

            <div id="sf-test-result" style="display:none; font-size:11px; padding:4px 6px; border-radius:3px; margin-bottom:6px;"></div>

            <div style="display:flex; gap:6px;">
                <button id="sf-test" class="btn-secondary" style="flex:1;">Test</button>
                <button id="sf-cancel" class="btn-secondary" style="flex:1;">Cancel</button>
                <button id="sf-save" class="btn-primary" style="flex:2;">${editing ? 'Update' : 'Add'}</button>
            </div>
        </div>
    `;

    // Show/hide fields by type
    container.querySelector('#sf-type').addEventListener('change', function() {
        container.querySelector('#sf-shell-fields').style.display = this.value === 'shell' ? 'block' : 'none';
        container.querySelector('#sf-http-fields').style.display  = this.value === 'http'  ? 'block' : 'none';
    });

    // Test button
    container.querySelector('#sf-test').addEventListener('click', async () => {
        const resultEl = container.querySelector('#sf-test-result');
        resultEl.style.display = 'block';
        resultEl.style.background = '#1a1a2e';
        resultEl.textContent = 'Running…';
        try {
            const d = readForm(container, def.name);
            const val = await testSource(d);
            resultEl.style.background = '#0a2a0a';
            resultEl.textContent = '✓ ' + val;
        } catch (e) {
            resultEl.style.background = '#2a0a0a';
            resultEl.textContent = '✗ ' + e;
        }
    });

    // Preset link
    container.querySelector('#sf-preset-link')?.addEventListener('click', e => {
        e.preventDefault();
        showPresetPicker(container, def);
    });

    // Cancel
    container.querySelector('#sf-cancel').addEventListener('click', () => renderSourcesPanel());

    // Save
    container.querySelector('#sf-save').addEventListener('click', () => {
        const d = readForm(container, def.name);
        if (!d.name) { alert('Source name is required.'); return; }
        if (editing) {
            updateSource(existing.name, d);
        } else {
            if (_sources.find(s => s.name === d.name)) { alert('A source with that name already exists.'); return; }
            addSource(d);
        }
    });
}

function readForm(container, originalName) {
    const type = container.querySelector('#sf-type').value;
    return {
        name: container.querySelector('#sf-name').value.trim().replace(/[^a-z0-9_]/gi, '_') || originalName,
        type,
        command: container.querySelector('#sf-command')?.value.trim() || '',
        platformOverrides: {
            linux:   container.querySelector('#sf-linux')?.value.trim()   || undefined,
            macos:   container.querySelector('#sf-macos')?.value.trim()   || undefined,
            windows: container.querySelector('#sf-windows')?.value.trim() || undefined,
        },
        url:          container.querySelector('#sf-url')?.value.trim()      || '',
        jsonPath:     container.querySelector('#sf-jsonpath')?.value.trim() || '',
        intervalSecs: parseInt(container.querySelector('#sf-interval').value) || 5,
    };
}

// ── Smart Presets ─────────────────────────────────────────────────────────────

const HTTP_PRESETS = [
    {
        id: 'open-meteo',
        name: 'Open-Meteo (Weather — no key required)',
        fields: [
            { key: 'lat',      label: 'Latitude',  type: 'number', default: '51.5' },
            { key: 'lon',      label: 'Longitude', type: 'number', default: '-0.1' },
            { key: 'variable', label: 'Metric',    type: 'select',
              options: ['temperature_2m','relative_humidity_2m','wind_speed_10m','precipitation','surface_pressure'] },
        ],
        buildUrl: c => `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=${c.variable}`,
        buildPath: c => `current.${c.variable}`,
    },
    {
        id: 'coingecko',
        name: 'CoinGecko (Crypto — free key required)',
        keyLink: 'https://www.coingecko.com/en/api',
        fields: [
            { key: 'coin',     label: 'Coin ID',   type: 'text',   default: 'bitcoin', placeholder: 'bitcoin, ethereum…' },
            { key: 'currency', label: 'Currency',  type: 'select', options: ['usd','eur','gbp','jpy'] },
            { key: 'apiKey',   label: 'API Key',   type: 'text',   default: '', placeholder: 'Paste your CoinGecko Demo key' },
        ],
        buildUrl: c => `https://api.coingecko.com/api/v3/simple/price?ids=${c.coin}&vs_currencies=${c.currency}&x_cg_demo_api_key=${c.apiKey}`,
        buildPath: c => `${c.coin}.${c.currency}`,
    },
    {
        id: 'thesportsdb',
        name: 'TheSportsDB (Sports — no key required)',
        fields: [
            { key: 'team', label: 'Team Name', type: 'text', default: 'Arsenal' },
        ],
        buildUrl: c => `https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=${encodeURIComponent(c.team)}`,
        buildPath: () => 'teams.0.strTeam',
    },
    {
        id: 'homeassistant',
        name: 'Home Assistant (local)',
        fields: [
            { key: 'url',    label: 'HA URL',     type: 'text', default: 'http://homeassistant.local:8123', placeholder: 'http://homeassistant.local:8123' },
            { key: 'token',  label: 'Long-Lived Token', type: 'text', default: '', placeholder: 'Paste your HA long-lived access token' },
            { key: 'entity', label: 'Entity ID',  type: 'text', default: 'sensor.temperature', placeholder: 'sensor.living_room_temp' },
        ],
        buildUrl: c => `${c.url}/api/states/${c.entity}`,
        buildPath: () => 'state',
    },
];

function showPresetPicker(container, currentDef) {
    const nameEl = container.querySelector('#sf-name');
    const urlEl  = container.querySelector('#sf-url');
    const pathEl = container.querySelector('#sf-jsonpath');

    let html = '<div class="preset-picker"><div style="font-size:11px;color:#888;margin-bottom:8px;">Choose a preset:</div>';
    HTTP_PRESETS.forEach(p => {
        html += `<div class="preset-option" data-id="${p.id}" style="cursor:pointer;padding:5px 6px;border-radius:3px;margin-bottom:3px;background:#1a1a2e;">${p.name}</div>`;
    });
    html += `<button id="preset-cancel" class="btn-secondary" style="width:100%;margin-top:6px;">Cancel</button></div>`;

    // Insert picker above the URL field
    const httpFields = container.querySelector('#sf-http-fields');
    const existingPicker = httpFields.querySelector('.preset-picker');
    if (existingPicker) existingPicker.remove();
    httpFields.insertAdjacentHTML('afterbegin', html);

    httpFields.querySelector('#preset-cancel').addEventListener('click', () => {
        httpFields.querySelector('.preset-picker').remove();
    });

    httpFields.querySelectorAll('.preset-option').forEach(el => {
        el.addEventListener('click', () => {
            const preset = HTTP_PRESETS.find(p => p.id === el.dataset.id);
            if (!preset) return;
            showPresetConfig(httpFields, preset, nameEl, urlEl, pathEl);
        });
    });
}

function showPresetConfig(httpFields, preset, nameEl, urlEl, pathEl) {
    const picker = httpFields.querySelector('.preset-picker');
    const config = {};
    preset.fields.forEach(f => { config[f.key] = f.default || ''; });

    let formHtml = `<div class="preset-config"><div style="font-size:11px;font-weight:bold;color:#00bfff;margin-bottom:6px;">${preset.name}</div>`;
    preset.fields.forEach(f => {
        formHtml += `<div class="prop-row"><label class="prop-label">${f.label}</label>`;
        if (f.type === 'select') {
            formHtml += `<select class="prop-input preset-field" data-key="${f.key}">${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}</select>`;
        } else {
            formHtml += `<input class="prop-input preset-field" type="${f.type === 'number' ? 'number' : 'text'}" data-key="${f.key}" value="${f.default || ''}" placeholder="${f.placeholder || ''}">`;
        }
        formHtml += `</div>`;
        if (f.type === 'text' && preset.keyLink && f.key === 'apiKey') {
            formHtml += `<div style="font-size:10px;margin-bottom:4px;"><a href="#" onclick="window.__TAURI__.opener.open('${preset.keyLink}');return false;" style="color:#00bfff;">Register for a free key →</a></div>`;
        }
    });
    formHtml += `<div style="display:flex;gap:6px;margin-top:6px;">
        <button id="preset-apply" class="btn-primary" style="flex:1;">Apply</button>
        <button id="preset-back" class="btn-secondary" style="flex:1;">Back</button>
    </div></div>`;

    picker.innerHTML = formHtml;

    picker.querySelectorAll('.preset-field').forEach(el => {
        config[el.dataset.key] = el.value;
        el.addEventListener('input', () => { config[el.dataset.key] = el.value; });
    });

    picker.querySelector('#preset-apply').addEventListener('click', () => {
        const url = preset.buildUrl(config);
        const path = preset.buildPath(config);
        urlEl.value = url;
        pathEl.value = path;
        if (!nameEl.value) nameEl.value = preset.id.replace('-', '_');
        picker.remove();
    });

    picker.querySelector('#preset-back').addEventListener('click', () => showPresetPicker(httpFields.parentElement, {}));
}

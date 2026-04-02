// ── asset-manager.js — Global asset library + per-widget asset bundle ─────────

let _ctx = null;
export function setContext(ctx) { _ctx = ctx; }

// ── Per-widget local assets ────────────────────────────────────────────────────

let _localAssets = {}; // { [filename]: { dataUrl, category, sizeBytes } }

export function getLocalAssets() { return _localAssets; }

export function serializeLocalAssets() {
    const result = {};
    for (const [name, asset] of Object.entries(_localAssets)) {
        result[name] = asset.dataUrl;
    }
    return result;
}

export function deserializeLocalAssets(data) {
    _localAssets = {};
    if (data && typeof data === 'object') {
        for (const [filename, dataUrl] of Object.entries(data)) {
            const category = categoryFromFilename(filename);
            const sizeBytes = Math.round((dataUrl.length * 3) / 4);
            _localAssets[filename] = { dataUrl, category, sizeBytes };
        }
    }
}

export function resolveAssetUrl(filename) {
    if (_localAssets[filename]) return _localAssets[filename].dataUrl;
    return null;
}

function categoryFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['ttf','otf','woff','woff2'].includes(ext)) return 'fonts';
    if (['png','jpg','jpeg','svg','gif','webp'].includes(ext)) return 'images';
    return 'other';
}

// ── Library font names (for font picker) ─────────────────────────────────────

export async function getLibraryFontNames() {
    if (!_ctx) return [];
    try {
        const fonts = await _ctx.invoke('list_assets', { category: 'fonts' });
        return fonts.map(f => f.filename.replace(/\.[^.]+$/, ''));
    } catch { return []; }
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function openAssetManager() {
    let modal = document.getElementById('asset-modal');
    if (modal) { modal.remove(); return; }

    modal = document.createElement('div');
    modal.id = 'asset-modal';
    modal.className = 'asset-modal-overlay';
    modal.innerHTML = `
        <div class="asset-modal">
            <div class="asset-modal-header">
                <div class="asset-modal-tabs">
                    <button class="asset-tab active" data-tab="library">Library</button>
                    <button class="asset-tab" data-tab="widget">This Widget</button>
                </div>
                <button id="asset-modal-close" class="btn-icon" style="font-size:16px;">×</button>
            </div>
            <div id="asset-tab-content" class="asset-tab-content"></div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('asset-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    modal.querySelectorAll('.asset-tab').forEach(btn => {
        btn.addEventListener('click', function() {
            modal.querySelectorAll('.asset-tab').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            renderTab(this.dataset.tab);
        });
    });

    renderTab('library');
}

async function renderTab(tab) {
    const content = document.getElementById('asset-tab-content');
    if (!content) return;
    if (tab === 'library') {
        await renderLibraryTab(content);
    } else {
        renderWidgetTab(content);
    }
}

async function renderLibraryTab(content) {
    content.innerHTML = '<p style="color:#888;font-size:12px;padding:8px;">Loading…</p>';
    try {
        const [fonts, images, other] = await Promise.all([
            _ctx.invoke('list_assets', { category: 'fonts' }),
            _ctx.invoke('list_assets', { category: 'images' }),
            _ctx.invoke('list_assets', { category: 'other' }),
        ]);
        content.innerHTML = '';
        content.appendChild(buildCategorySection('Fonts',  fonts,  'library', 'fonts'));
        content.appendChild(buildCategorySection('Images', images, 'library', 'images'));
        content.appendChild(buildCategorySection('Other',  other,  'library', 'other'));
        wireImportButton(content, 'library');
    } catch (e) {
        content.innerHTML = `<p style="color:#ff4444;padding:8px;">Error loading library: ${e}</p>`;
    }
}

function renderWidgetTab(content) {
    const entries = Object.entries(_localAssets);
    content.innerHTML = '';
    const categories = { fonts: [], images: [], other: [] };
    entries.forEach(([filename, asset]) => {
        categories[asset.category]?.push({ filename, ...asset });
    });
    content.appendChild(buildCategorySection('Fonts',  categories.fonts,  'widget', 'fonts'));
    content.appendChild(buildCategorySection('Images', categories.images, 'widget', 'images'));
    content.appendChild(buildCategorySection('Other',  categories.other,  'widget', 'other'));
    wireImportButton(content, 'widget');
}

function buildCategorySection(label, items, source, category) {
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const section = document.createElement('div');
    section.className = 'asset-category';
    let html = `<div class="asset-category-label">${label}</div>`;
    if (items.length === 0) {
        html += `<p class="empty-state" style="font-size:11px;">No ${label.toLowerCase()} yet.</p>`;
    } else {
        html += '<div class="asset-grid">';
        items.forEach(item => {
            const filename = item.filename;
            const sizeKb = Math.round((item.size_bytes || item.sizeBytes || 0) / 1024);
            html += `
                <div class="asset-item" data-filename="${esc(filename)}" data-category="${esc(category)}" data-source="${esc(source)}">
                    <div class="asset-preview">${previewHtml(filename, category)}</div>
                    <div class="asset-item-name" title="${esc(filename)}">${esc(filename)}</div>
                    <div class="asset-item-size">${sizeKb} KB</div>
                    <button class="asset-del-btn btn-icon" data-filename="${esc(filename)}" data-category="${esc(category)}" data-source="${esc(source)}" title="Remove">×</button>
                    ${source === 'library' ? `<button class="asset-embed-btn btn-icon" data-filename="${esc(filename)}" data-category="${esc(category)}" title="Add to this widget">📦</button>` : ''}
                </div>
            `;
        });
        html += '</div>';
    }
    section.innerHTML = html;

    section.querySelectorAll('.asset-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm(`Remove ${btn.dataset.filename}?`)) return;
            if (btn.dataset.source === 'library') {
                await _ctx.invoke('delete_asset', { category: btn.dataset.category, filename: btn.dataset.filename });
            } else {
                delete _localAssets[btn.dataset.filename];
                _ctx?.pushHistory();
            }
            renderTab(btn.dataset.source === 'library' ? 'library' : 'widget');
        });
    });

    section.querySelectorAll('.asset-embed-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                const dataUrl = await _ctx.invoke('get_asset_data_url', { category: btn.dataset.category, filename: btn.dataset.filename });
                const sizeBytes = Math.round((dataUrl.length * 3) / 4);
                _localAssets[btn.dataset.filename] = { dataUrl, category: btn.dataset.category, sizeBytes };
                _ctx?.pushHistory();
                _ctx?.showToast(`${btn.dataset.filename} added to widget`);
            } catch (e) {
                _ctx?.showToast('Failed to embed asset: ' + e, 'error');
            }
        });
    });

    return section;
}

function previewHtml(filename, category) {
    const safeName = String(filename).replace(/['"]/g, '');
    if (category === 'images') {
        return `<span style="font-size:20px;">🖼</span>`;
    } else if (category === 'fonts') {
        return `<span style="font-size:14px;font-family:'${safeName.replace(/\.[^.]+$/, '')}',monospace;">Aa</span>`;
    }
    return `<span style="font-size:14px;color:#888;">📄</span>`;
}

function wireImportButton(content, source) {
    const btn = document.createElement('button');
    btn.className = 'btn-secondary';
    btn.style.cssText = 'width:100%;margin-top:8px;';
    btn.textContent = source === 'library' ? '+ Import to Library' : '+ Import to Widget';
    btn.addEventListener('click', () => handleImport(source));
    content.appendChild(btn);
}

async function handleImport(destination) {
    if (!_ctx) return;
    try {
        const { open } = window.__TAURI__.dialog;
        const paths = await open({
            filters: [
                { name: 'Fonts',     extensions: ['ttf','otf','woff','woff2'] },
                { name: 'Images',    extensions: ['png','jpg','jpeg','svg','gif','webp'] },
                { name: 'All Files', extensions: ['*'] },
            ],
            multiple: true,
        });
        if (!paths) return;
        const list = Array.isArray(paths) ? paths : [paths];
        for (const p of list) {
            if (destination === 'library') {
                await _ctx.invoke('import_asset', { srcPath: p });
            } else {
                const { readFile } = window.__TAURI__.fs;
                const bytes = await readFile(p);
                const filename = p.split(/[/\\]/).pop();
                const category = categoryFromFilename(filename);
                const mime = mimeFromFilename(filename);
                const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
                const dataUrl = `data:${mime};base64,${b64}`;
                const sizeBytes = bytes.byteLength;
                _localAssets[filename] = { dataUrl, category, sizeBytes };
                _ctx?.pushHistory();
            }
        }
        renderTab(destination === 'library' ? 'library' : 'widget');
    } catch (e) {
        _ctx?.showToast('Import failed: ' + e, 'error');
    }
}

function mimeFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        svg: 'image/svg+xml', gif: 'image/gif', webp: 'image/webp',
    };
    return map[ext] || 'application/octet-stream';
}

if (!window.__TAURI__) {
  document.getElementById('themes-container').innerHTML =
    '<p class="status-text">Tauri IPC not available.</p>';
  throw new Error('[CommandCenter] window.__TAURI__ not available');
}

const { invoke } = window.__TAURI__.core;

// ── State ──
let openSettingsModuleId = null;

// ── Theme loading ──
async function loadThemes() {
  try {
    const themes = await invoke('list_themes');
    renderThemes(themes);
  } catch (e) {
    document.getElementById('themes-container').innerHTML =
      `<p class="status-text">Failed to load themes: ${escHtml(String(e))}</p>`;
  }
}

function renderThemes(themes) {
  const container = document.getElementById('themes-container');
  if (!themes.length) {
    container.innerHTML =
      '<p class="status-text">No themes found. Use "Install Theme…" to add one.</p>';
    return;
  }
  container.innerHTML = themes.map(theme => `
    <div class="theme-card">
      <div class="theme-preview">
        ${theme.preview_url
          ? `<img src="${escAttr(theme.preview_url)}" alt="${escAttr(theme.name)} preview" onerror="this.parentElement.textContent='No Preview'">`
          : 'No Preview'}
      </div>
      <div class="theme-body">
        <div class="theme-header">
          <span class="theme-name">${escHtml(theme.name)}</span>
          <span class="source-badge">${escHtml(theme.source)}</span>
        </div>
        ${theme.description ? `<p class="theme-desc">${escHtml(theme.description)}</p>` : ''}
        <div class="theme-actions">
          <button class="btn-primary" onclick="activateTheme('${escAttr(theme.id)}')">Activate All</button>
          <button class="btn-danger" onclick="deactivateTheme('${escAttr(theme.id)}')">Deactivate All</button>
        </div>
        ${theme.modules.length ? `
        <div class="theme-modules">
          ${theme.modules.map(m => `
            <div class="module-row">
              <span class="module-name">${escHtml(m.name)}</span>
              <div style="display:flex;align-items:center;gap:6px">
                ${m.has_settings ? `<button class="module-settings-btn ${openSettingsModuleId === m.id ? 'active' : ''}"
                  onclick="openSettingsPanel('${escAttr(m.id)}','${escAttr(m.name)}')"
                  title="Settings for ${escAttr(m.name)}">⚙</button>` : ''}
                <label class="toggle" title="${m.active ? 'Deactivate' : 'Activate'} ${escAttr(m.name)}">
                  <input type="checkbox" ${m.active ? 'checked' : ''}
                    onchange="toggleModule('${escAttr(m.id)}')">
                  <span class="toggle-track"></span>
                </label>
              </div>
            </div>
          `).join('')}
        </div>` : ''}
      </div>
    </div>
  `).join('');
}

// ── Module actions ──
async function toggleModule(id) {
  try { await invoke('toggle_module', { id }); } catch (e) { console.error('[CC] toggleModule:', e); }
  await loadThemes();
}

async function activateTheme(id) {
  try { await invoke('activate_theme', { id }); } catch (e) { console.error('[CC] activateTheme:', e); }
  await loadThemes();
}

async function deactivateTheme(id) {
  try { await invoke('deactivate_theme', { id }); } catch (e) { console.error('[CC] deactivateTheme:', e); }
  await loadThemes();
}

// ── Settings panel ──
async function openSettingsPanel(moduleId, moduleName) {
  if (openSettingsModuleId === moduleId) {
    closeSettingsPanel();
    return;
  }
  openSettingsModuleId = moduleId;
  const panel = document.getElementById('settings-panel');
  const title = document.getElementById('settings-panel-title');
  const body = document.getElementById('settings-panel-body');
  title.textContent = moduleName;
  body.innerHTML = '<p style="color:var(--text-dim);font-size:12px">Loading…</p>';
  panel.hidden = false;

  try {
    const [schema, values] = await Promise.all([
      invoke('get_module_settings_schema', { moduleId }),
      invoke('get_module_settings', { moduleId }),
    ]);
    renderSettingsFields(body, moduleId, schema, values);
  } catch (e) {
    body.innerHTML = `<p style="color:var(--danger);font-size:12px">Could not load settings: ${escHtml(String(e))}</p>`;
  }
  await loadThemes(); // re-render to highlight active gear icon
}

function closeSettingsPanel() {
  openSettingsModuleId = null;
  document.getElementById('settings-panel').hidden = true;
  loadThemes();
}

function renderSettingsFields(container, moduleId, schema, values) {
  if (!schema.length) {
    container.innerHTML = '<p style="color:var(--text-dim);font-size:12px">No configurable settings.</p>';
    return;
  }
  container.innerHTML = schema.map(field => {
    const val = values[field.key] !== undefined ? values[field.key] : field.default;
    switch (field.type) {
      case 'range': {
        const min = field.min ?? 0;
        const max = field.max ?? 100;
        const step = field.step ?? 1;
        return `<div class="setting-field">
          <span class="setting-label">${escHtml(field.label)}</span>
          <div class="setting-range-row">
            <input type="range" min="${escAttr(String(min))}" max="${escAttr(String(max))}"
              step="${escAttr(String(step))}" value="${escAttr(String(val))}"
              oninput="this.nextElementSibling.textContent=this.value; saveSetting('${escAttr(moduleId)}','${escAttr(field.key)}',+this.value)"
              >
            <span class="setting-value-label">${escHtml(String(val))}</span>
          </div>
        </div>`;
      }
      case 'select': {
        const opts = (field.options || []).map(o =>
          `<option value="${escAttr(o)}" ${o === val ? 'selected' : ''}>${escHtml(o)}</option>`
        ).join('');
        return `<div class="setting-field">
          <span class="setting-label">${escHtml(field.label)}</span>
          <select class="setting-select"
            onchange="saveSetting('${escAttr(moduleId)}','${escAttr(field.key)}',this.value)">
            ${opts}
          </select>
        </div>`;
      }
      case 'toggle': {
        return `<div class="setting-field">
          <div class="setting-toggle-row">
            <span class="setting-label">${escHtml(field.label)}</span>
            <label class="toggle">
              <input type="checkbox" ${val ? 'checked' : ''}
                onchange="saveSetting('${escAttr(moduleId)}','${escAttr(field.key)}',this.checked)">
              <span class="toggle-track"></span>
            </label>
          </div>
        </div>`;
      }
      case 'text': {
        return `<div class="setting-field">
          <span class="setting-label">${escHtml(field.label)}</span>
          <input type="text" class="setting-text-input" value="${escAttr(String(val))}"
            onchange="saveSetting('${escAttr(moduleId)}','${escAttr(field.key)}',this.value)">
        </div>`;
      }
      default:
        return '';
    }
  }).join('');
}

async function saveSetting(moduleId, key, value) {
  try {
    await invoke('set_module_setting', { moduleId, key, value });
  } catch (e) {
    console.error('[CC] saveSetting failed:', e);
  }
}

document.getElementById('settings-close-btn').addEventListener('click', closeSettingsPanel);

// Close settings panel when clicking outside it
document.getElementById('themes-container').addEventListener('click', () => {
  if (openSettingsModuleId) closeSettingsPanel();
});

// ── Archive install ──
function showInstallStatus(msg, type) {
  const el = document.getElementById('install-status');
  el.textContent = msg;
  el.className = 'install-status ' + type;
  el.hidden = false;
  if (type !== 'installing') {
    setTimeout(() => { el.hidden = true; }, 5000);
  }
}

async function installThemeFromPath(path) {
  showInstallStatus('Installing…', 'installing');
  try {
    const info = await invoke('install_theme_archive', { path });
    showInstallStatus(`Theme '${escHtml(info.name)}' installed successfully`, 'success');
    await loadThemes();
  } catch (e) {
    const msg = String(e);
    if (msg !== 'cancelled') {
      showInstallStatus(msg, 'error');
    } else {
      document.getElementById('install-status').hidden = true;
    }
  }
}

document.getElementById('install-btn').addEventListener('click', async () => {
  showInstallStatus('Opening file picker…', 'installing');
  try {
    const info = await invoke('pick_and_install_theme');
    showInstallStatus(`Theme '${escHtml(info.name)}' installed successfully`, 'success');
    await loadThemes();
  } catch (e) {
    const msg = String(e);
    if (msg !== 'cancelled') {
      showInstallStatus(msg, 'error');
    } else {
      document.getElementById('install-status').hidden = true;
    }
  }
});

// ── Drag-and-drop ──
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  document.getElementById('drop-overlay').hidden = false;
});
document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    document.getElementById('drop-overlay').hidden = true;
  }
});
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  document.getElementById('drop-overlay').hidden = true;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  // Tauri webview File objects have a .path property with the OS path
  const filePath = file.path || (file.name ? null : null);
  if (!filePath) {
    showInstallStatus('Could not determine file path from dropped file', 'error');
    return;
  }
  await installThemeFromPath(filePath);
});

// ── Misc ──
async function openThemesFolder() {
  try { await invoke('open_themes_folder'); } catch (e) { console.error('[CC] openThemesFolder:', e); }
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.getElementById('btn-open-widget-editor').addEventListener('click', () => {
  invoke('open_widget_editor').catch(console.error);
});

document.getElementById('browse-btn').addEventListener('click', openThemesFolder);
document.getElementById('close-btn').addEventListener('click', () => {
  window.__TAURI__.window.getCurrentWindow().close();
});

loadThemes();

// Show startup notification if Flux moved any off-screen widgets
(async () => {
    try {
        const toast = await invoke('get_and_clear_startup_toast');
        if (toast) {
            const banner = document.createElement('div');
            banner.style.cssText = [
                'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
                'background:#1a3a4a', 'color:#00bfff', 'border:1px solid #00bfff',
                'border-radius:6px', 'padding:8px 16px', 'font-size:12px',
                'font-family:monospace', 'z-index:9999', 'max-width:360px', 'text-align:center',
            ].join(';');
            banner.textContent = toast;
            document.body.appendChild(banner);
            setTimeout(() => banner.remove(), 5000);
        }
    } catch (e) {
        // Silently ignore if command not available
    }
})();

// Listen for live toast events (e.g. from tray "Bring all to screen")
try {
    const { listen } = window.__TAURI__.event;
    listen('flux:toast', (event) => {
        const banner = document.createElement('div');
        banner.style.cssText = [
            'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
            'background:#1a3a4a', 'color:#00bfff', 'border:1px solid #00bfff',
            'border-radius:6px', 'padding:8px 16px', 'font-size:12px',
            'font-family:monospace', 'z-index:9999', 'max-width:360px', 'text-align:center',
        ].join(';');
        banner.textContent = event.payload;
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 5000);
    });
} catch (e) {
    // Silently ignore if event system not available
}

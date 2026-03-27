if (!window.__TAURI__) {
  document.getElementById('themes-container').innerHTML =
    '<p class="status-text">Tauri IPC not available. Ensure withGlobalTauri is enabled.</p>';
  throw new Error('[CommandCenter] window.__TAURI__ not available');
}

const { invoke } = window.__TAURI__.core;

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
      '<p class="status-text">No themes found. Drop a theme folder into your themes directory.</p>';
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
              <label class="toggle" title="${m.active ? 'Deactivate' : 'Activate'} ${escAttr(m.name)}">
                <input type="checkbox" ${m.active ? 'checked' : ''}
                  onchange="toggleModule('${escAttr(m.id)}')">
                <span class="toggle-track"></span>
              </label>
            </div>
          `).join('')}
        </div>` : ''}
      </div>
    </div>
  `).join('');
}

async function toggleModule(id) {
  try {
    await invoke('toggle_module', { id });
  } catch (e) {
    console.error('[CommandCenter] toggleModule failed:', e);
  }
  await loadThemes();
}

async function activateTheme(id) {
  try {
    await invoke('activate_theme', { id });
  } catch (e) {
    console.error('[CommandCenter] activateTheme failed:', e);
  }
  await loadThemes();
}

async function deactivateTheme(id) {
  try {
    await invoke('deactivate_theme', { id });
  } catch (e) {
    console.error('[CommandCenter] deactivateTheme failed:', e);
  }
  await loadThemes();
}

async function openThemesFolder() {
  try {
    await invoke('open_themes_folder');
  } catch (e) {
    console.error('[CommandCenter] openThemesFolder failed:', e);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.getElementById('browse-btn').addEventListener('click', openThemesFolder);

loadThemes();

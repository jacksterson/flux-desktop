if (!window.__TAURI__) {
  document.body.textContent = 'Tauri IPC not available';
  throw new Error('[Wizard] window.__TAURI__ not available');
}

const { invoke } = window.__TAURI__.core;
const appWindow = window.__TAURI__.window.getCurrentWindow();

// ── State ──
let currentStep = 1;
let selectedThemeId = null;       // null = skipped
let allThemes = [];
let selectedModules = new Set();  // module id strings

// ── Close interception ──
(async () => {
  await appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    await runEscapePath();
  });
})();

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') await runEscapePath();
});

async function runEscapePath() {
  try {
    await invoke('wizard_escape', { activeModules: [...selectedModules] });
  } catch (err) {
    console.error('[Wizard] wizard_escape failed:', err);
  }
}

// ── Step navigation ──
function goToStep(n) {
  document.querySelectorAll('.step-pane').forEach(el => el.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');
  document.querySelectorAll('.progress-step').forEach(el => {
    const sn = parseInt(el.dataset.step);
    el.classList.remove('active', 'done');
    if (sn === n) el.classList.add('active');
    else if (sn < n) el.classList.add('done');
  });
  currentStep = n;
}

// ── Step 1: Welcome ──
document.getElementById('btn-start').addEventListener('click', () => {
  goToStep(2);
  loadThemes();
});

// ── Step 2: Choose theme ──
async function loadThemes() {
  const grid = document.getElementById('theme-grid');
  grid.innerHTML = '<p class="loading">Loading themes…</p>';
  try {
    allThemes = await invoke('list_themes');
    renderThemeGrid();
  } catch (e) {
    grid.innerHTML = `<p class="loading">Could not load themes: ${escHtml(String(e))}</p>`;
  }
}

function renderThemeGrid() {
  const grid = document.getElementById('theme-grid');
  if (!allThemes.length) {
    grid.innerHTML = '<p class="empty">No themes found.</p>';
    return;
  }
  grid.innerHTML = `<div class="theme-grid">${allThemes.map(t => `
    <div class="theme-card ${t.id === selectedThemeId ? 'selected' : ''}"
         onclick="selectTheme('${escAttr(t.id)}')">
      <div class="theme-preview">
        ${t.preview_url
          ? `<img src="${escAttr(t.preview_url)}" alt="${escAttr(t.name)}" onerror="this.parentElement.textContent='No Preview'">`
          : 'No Preview'}
      </div>
      <div class="theme-info">
        <h3>${escHtml(t.name)}</h3>
        ${t.description ? `<p>${escHtml(t.description)}</p>` : ''}
      </div>
    </div>
  `).join('')}</div>`;
}

function selectTheme(id) {
  selectedThemeId = id;
  document.getElementById('btn-next-2').disabled = false;
  renderThemeGrid();
}

document.getElementById('btn-skip-theme').addEventListener('click', () => {
  selectedThemeId = null;
  goToStep(3);
  loadModuleList();
});

document.getElementById('btn-next-2').addEventListener('click', () => {
  goToStep(3);
  loadModuleList();
});

// ── Step 3: Pick modules ──
function loadModuleList() {
  const list = document.getElementById('module-list');
  let modules = [];
  if (selectedThemeId) {
    const theme = allThemes.find(t => t.id === selectedThemeId);
    modules = theme ? theme.modules : [];
  } else {
    const seen = new Set();
    for (const t of allThemes) {
      for (const m of t.modules) {
        if (!seen.has(m.id)) { seen.add(m.id); modules.push(m); }
      }
    }
  }

  selectedModules = new Set(modules.map(m => m.id));
  updateStep3Button();

  if (!modules.length) {
    list.innerHTML = '<p class="empty">No modules found for this theme.</p>';
    return;
  }

  list.innerHTML = modules.map(m => `
    <div class="module-toggle-row">
      <span class="module-label">${escHtml(m.name || m.id)}</span>
      <label class="toggle">
        <input type="checkbox" checked onchange="toggleModuleCheck('${escAttr(m.id)}', this.checked)">
        <span class="toggle-track"></span>
      </label>
    </div>
  `).join('');
}

function toggleModuleCheck(id, checked) {
  if (checked) selectedModules.add(id);
  else selectedModules.delete(id);
  updateStep3Button();
}

function updateStep3Button() {
  document.getElementById('btn-next-3').disabled = selectedModules.size === 0;
}

document.getElementById('btn-all').addEventListener('click', () => {
  selectedModules.clear();
  document.querySelectorAll('#module-list .module-toggle-row input[type=checkbox]').forEach(cb => {
    cb.checked = true;
    const match = cb.getAttribute('onchange').match(/'([^']+)'/);
    if (match) selectedModules.add(match[1]);
  });
  updateStep3Button();
});

document.getElementById('btn-none').addEventListener('click', () => {
  document.querySelectorAll('#module-list input[type=checkbox]').forEach(cb => {
    cb.checked = false;
  });
  selectedModules.clear();
  updateStep3Button();
});

document.getElementById('btn-back-3').addEventListener('click', () => goToStep(2));

document.getElementById('btn-next-3').addEventListener('click', () => {
  goToStep(4);
  updateLaunchSummary();
});

// ── Step 4: Launch ──
function updateLaunchSummary() {
  const count = selectedModules.size;
  const theme = selectedThemeId ? allThemes.find(t => t.id === selectedThemeId) : null;
  const summary = theme
    ? `Starting ${count} module${count !== 1 ? 's' : ''} from ${escHtml(theme.name)}`
    : `Starting ${count} module${count !== 1 ? 's' : ''}`;
  document.getElementById('launch-summary').textContent = summary;
}

document.getElementById('btn-back-4').addEventListener('click', () => goToStep(3));

document.getElementById('btn-launch').addEventListener('click', async () => {
  document.getElementById('btn-launch').disabled = true;
  try {
    await invoke('wizard_launch', { activeModules: [...selectedModules] });
  } catch (e) {
    console.error('[Wizard] wizard_launch failed:', e);
    document.getElementById('btn-launch').disabled = false;
  }
});

// ── Helpers ──
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

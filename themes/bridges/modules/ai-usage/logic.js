// Koji Pro // AI.OPS Logic
// Claude: reads ~/.claude/projects/ JSONL files via Tauri invoke (falls back gracefully).
// Gemini: localStorage counter.

const REFRESH_MS = 60000;

const GEMINI_LIMITS = {
  free:  { rpm: 15,   rpd: 1500 },
  flash: { rpm: 1000, rpd: 0    },
  pro:   { rpm: 360,  rpd: 0    },
};

// Default soft limits for bar scaling when no hard limit configured
const CLAUDE_SOFT_LIMITS = {
  free: { in: 20000,  out: 80000  },
  pro:  { in: 50000,  out: 200000 },
  api:  { in: 100000, out: 400000 },
};

let cfg = JSON.parse(localStorage.getItem('koji_aiops_cfg') || '{}');
window.addEventListener('storage', () => {
  cfg = JSON.parse(localStorage.getItem('koji_aiops_cfg') || '{}');
  refresh();
});

// --- Helpers ---
function fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function barColor(pct) {
  if (pct >= 80) return 'var(--color-hud-danger)';
  if (pct >= 50) return 'var(--color-hud-caution)';
  return 'var(--color-hud-primary)';
}

function setBar(fillId, valId, value, limit, labelText) {
  const fill = document.getElementById(fillId);
  const val  = document.getElementById(valId);
  const pct  = limit > 0 ? Math.min(100, (value / limit) * 100) : Math.min(100, value / 1000 * 10);
  const color = barColor(pct);
  if (fill) {
    fill.style.setProperty('--fill', pct.toFixed(1) + '%');
    fill.style.setProperty('--bar-color', color);
  }
  if (val) val.textContent = labelText;
}

function renderSpark(containerId, weekData) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const max = Math.max(...weekData, 1);
  const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0 … Sun=6
  el.innerHTML = weekData.map((v, i) => {
    const h = Math.max(2, Math.round((v / max) * 20));
    return `<div class="spark-bar${i === todayIdx ? ' today' : ''}" style="height:${h}px"></div>`;
  }).join('');
}

// --- Claude JSONL Parser ---
async function parseClaudeUsage() {
  const today   = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  let todayIn = 0, todayOut = 0, todayMsgs = 0;
  const dailyTokens = new Array(7).fill(0); // Mon–Sun index

  try {
    // Try Tauri invoke to list JSONL files under ~/.claude/projects/
    let filePaths = [];
    try {
      filePaths = await WidgetAPI.invoke('list_claude_session_files');
    } catch {
      // Tauri invoke not available or not implemented — fall back to empty
    }

    for (const path of filePaths) {
      let text = '';
      try {
        text = await WidgetAPI.invoke('read_text_file', { path });
      } catch { continue; }

      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const ts = entry.timestamp || '';
          if (!ts || ts.slice(0, 10) < weekAgo) continue;
          const usage = entry?.message?.usage;
          if (!usage) continue;
          const date    = ts.slice(0, 10);
          const dayIdx  = (new Date(date + 'T12:00:00').getDay() + 6) % 7;
          const inToks  = usage.input_tokens  || 0;
          const outToks = usage.output_tokens || 0;
          if (date === today) { todayIn += inToks; todayOut += outToks; todayMsgs++; }
          dailyTokens[dayIdx] += inToks + outToks;
        } catch { /* skip */ }
      }
    }
  } catch { /* silent */ }

  return { todayIn, todayOut, todayMsgs, dailyTokens };
}

// --- Gemini Counter ---
function getGeminiUsage() {
  const todayKey   = `koji_gemini_today_${new Date().toISOString().slice(0, 10)}`;
  const todayCount = parseInt(localStorage.getItem(todayKey) || '0');
  let history = [];
  try { history = JSON.parse(localStorage.getItem('koji_gemini_req_history') || '[]'); } catch {}
  while (history.length < 7) history.unshift(0);
  return { todayCount, history: history.slice(-7) };
}

// --- Render ---
async function refresh() {
  const claudeTier  = cfg.claudeTier  || 'pro';
  const geminiTier  = cfg.geminiTier  || 'free';
  const claudeLimit = cfg.claudeLimit || 0;

  // Block visibility
  const cb = document.getElementById('claude-block');
  const gb = document.getElementById('gemini-block');
  if (cb) cb.style.display = cfg.claudeEnabled === false ? 'none' : '';
  if (gb) gb.style.display = cfg.geminiEnabled === false ? 'none' : '';

  // Tier badges
  const ctb = document.getElementById('claude-tier-badge');
  if (ctb) { ctb.textContent = claudeTier.toUpperCase(); ctb.className = `tier-badge ${claudeTier}`; }
  const gtb = document.getElementById('gemini-tier-badge');
  if (gtb) {
    const tierLabel = geminiTier === 'free' ? 'FREE' : geminiTier === 'flash' ? 'FLASH' : 'PRO';
    gtb.textContent = tierLabel;
    gtb.className = `tier-badge ${geminiTier === 'free' ? 'free' : 'pro'}`;
  }

  // Claude data
  const { todayIn, todayOut, todayMsgs, dailyTokens } = await parseClaudeUsage();
  const softLimits = CLAUDE_SOFT_LIMITS[claudeTier] || CLAUDE_SOFT_LIMITS.pro;
  const inLimit    = claudeLimit > 0 ? claudeLimit : softLimits.in;
  const outLimit   = claudeLimit > 0 ? claudeLimit : softLimits.out;

  setBar('claude-in-fill',  'claude-in-val',  todayIn,  inLimit,  `${fmtTokens(todayIn)} in`);
  setBar('claude-out-fill', 'claude-out-val', todayOut, outLimit, `${fmtTokens(todayOut)} out`);

  const hoursElapsed = Math.max(1, new Date().getHours() + 1);
  const claudeRateEl = document.getElementById('claude-rate');
  if (claudeRateEl) claudeRateEl.textContent = `${Math.round(todayMsgs / hoursElapsed)} req/hr`;
  renderSpark('claude-spark', dailyTokens);

  // Gemini data
  const { todayCount, history: geminiHist } = getGeminiUsage();
  const gLimits = GEMINI_LIMITS[geminiTier] || GEMINI_LIMITS.free;

  setBar('gemini-rpm-fill', 'gemini-rpm-val', 0, gLimits.rpm, `-- / ${gLimits.rpm}`);
  setBar('gemini-day-fill', 'gemini-day-val', todayCount, gLimits.rpd || 99999,
    `${todayCount} / ${gLimits.rpd > 0 ? gLimits.rpd : '∞'}`);

  const geminiRateEl = document.getElementById('gemini-rate');
  if (geminiRateEl) geminiRateEl.textContent = `${Math.round(todayCount / hoursElapsed)} req/hr`;
  renderSpark('gemini-spark', geminiHist);

  // Summary
  const totalEl = document.getElementById('total-tokens');
  if (totalEl) totalEl.textContent = fmtTokens(todayIn + todayOut);
  const luEl = document.getElementById('last-updated');
  if (luEl) {
    const now = new Date();
    luEl.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }
}

// --- Mouse glow + drag ---
const container = document.getElementById('main-container');
window.addEventListener('mousemove', (e) => {
  const r = container.getBoundingClientRect();
  container.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
  container.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
  const inBounds = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  container.style.setProperty('--pattern-opacity', inBounds ? '1' : '0');
});
container.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-no-drag]')) return;
  WidgetAPI.widget.drag(e);
});
document.querySelectorAll('[data-open-settings]').forEach(el =>
  el.addEventListener('click', () => WidgetAPI.widget.openSettings())
);

// --- Init ---
refresh();
const _refreshInterval = setInterval(refresh, REFRESH_MS);
window._fluxCleanup = () => clearInterval(_refreshInterval);

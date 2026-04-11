// Koji Pro // Chronometry Logic
// Optimized for shared-hud.css and high-fidelity tactical HUD.

let uptimeSecs = 0;
WidgetAPI.system.uptime().then(s => { uptimeSecs = s; });

function update() {
    const now = new Date();

    // 1. Primary Clock
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById("clock").textContent = `${h}:${m}:${s}`;

    // 2. Tactical Date
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    document.getElementById("date").innerHTML = `${year}.${month}.${date}<span class="date-sep"> // </span>${days[now.getDay()]}`;

    // 3. Mission Time
    uptimeSecs++;
    const uh = Math.floor(uptimeSecs / 3600);
    const um = Math.floor((uptimeSecs % 3600) / 60);
    const us = uptimeSecs % 60;
    document.getElementById("uptime").textContent =
        `${String(uh).padStart(2, '0')}:${String(um).padStart(2, '0')}:${String(us).padStart(2, '0')}`;
}

// --- Sunrise / Sunset ---
async function fetchSunTimes() {
  const loc = localStorage.getItem('koji_weather_location');
  if (!loc) return;
  let lat, lon;
  if (loc.includes(',')) {
    [lat, lon] = loc.split(',').map(s => parseFloat(s.trim()));
  } else {
    try {
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1`);
      const gd = await geo.json();
      if (!gd.results?.length) return;
      lat = gd.results[0].latitude;
      lon = gd.results[0].longitude;
    } catch { return; }
  }
  try {
    const today = new Date().toISOString().slice(0,10);
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=auto&start_date=${today}&end_date=${today}`);
    const d = await r.json();
    if (!d.daily?.sunrise?.[0]) return;
    const rise = d.daily.sunrise[0].slice(11,16);
    const set  = d.daily.sunset[0].slice(11,16);
    const el = document.getElementById('sun-times');
    if (el) { el.innerHTML = `<span class="sol-icon"></span> ${rise} / ${set}`; el.classList.add('loaded'); }
  } catch { /* silent */ }
}
fetchSunTimes();
const _msToMidnight = () => { const n = new Date(); return (86400 - n.getHours()*3600 - n.getMinutes()*60 - n.getSeconds()) * 1000; };
setTimeout(() => { fetchSunTimes(); setInterval(fetchSunTimes, 86400000); }, _msToMidnight());

// --- Interactive Glow & Drag ---
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
document.getElementById('open-settings')?.addEventListener('click', () => WidgetAPI.widget.openSettings());

// --- Lifecycle ---
update();
const _int = setInterval(update, 1000);

function _cleanup() {
    clearInterval(_int);
}
window._fluxCleanup = _cleanup;

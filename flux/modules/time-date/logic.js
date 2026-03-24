// Time & Date Module Logic
const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const appWindow = getCurrentWindow();

// --- Config State ---
const DEFAULT_STATE = {
    format: "12h",
    timezone: "local",
    bgAlpha: 90,
    showUTC: true,
    showMissionTime: true
};

let state = JSON.parse(localStorage.getItem("flux_time_state")) || DEFAULT_STATE;
const missionStart = Date.now();

function applyState() {
    const root = document.documentElement;
    const r = 10, g = 15, b = 26; 
    root.style.setProperty("--color-bg-base", `rgba(${r}, ${g}, ${b}, ${state.bgAlpha / 100})`);
    
    document.getElementById("utc-time").style.display = state.showUTC ? "block" : "none";
    document.getElementById("mission-timer").style.display = state.showMissionTime ? "block" : "none";
}

window.addEventListener('storage', () => {
    state = JSON.parse(localStorage.getItem("flux_time_state")) || DEFAULT_STATE;
    applyState();
});

function updateClock() {
    const now = new Date();
    
    // 1. Main Clock
    const options = { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: state.format === "12h" 
    };
    let timeStr = now.toLocaleTimeString('en-US', options);
    // Remove AM/PM for the main large display if in 12h
    if (state.format === "12h") timeStr = timeStr.replace(/\s[AP]M/, '');
    document.getElementById("clock-main").textContent = timeStr;
    document.getElementById("clock-seconds").textContent = now.getSeconds().toString().padStart(2, '0');

    // 2. Date
    const day = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const month = now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
    const date = now.getDate();
    const year = now.getFullYear();
    document.getElementById("date-main").textContent = `${day} // ${month} ${date} ${year}`;

    // 3. UTC
    if (state.showUTC) {
        const utcStr = now.getUTCHours().toString().padStart(2, '0') + ":" + 
                       now.getUTCMinutes().toString().padStart(2, '0') + ":" + 
                       now.getUTCSeconds().toString().padStart(2, '0');
        document.getElementById("utc-time").textContent = `UTC // ${utcStr}`;
    }

    // 4. Mission Timer (Time since module load)
    if (state.showMissionTime) {
        const diff = Math.floor((Date.now() - missionStart) / 1000);
        const h = Math.floor(diff / 3600).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');
        document.getElementById("mission-timer").textContent = `MISSION // ${h}:${m}:${s}`;
    }

    // 5. Day Progress (Solar Cycle)
    const totalSeconds = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();
    const percent = (totalSeconds / 86400) * 100;
    document.getElementById("progress-bar").style.width = `${percent}%`;

    // 6. Timezone Label
    const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/')[1] || "LOCAL";
    const tzAbbr = now.toLocaleTimeString('en-us',{timeZoneName:'short'}).split(' ').pop();
    document.getElementById("timezone-label").textContent = `${tzName.replace('_', ' ')} // ${tzAbbr}`;
}

// --- Interactions ---
const container = document.getElementById("main-container");
window.addEventListener("mousemove", (e) => {
  const rect = container.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  container.style.setProperty("--mouse-x", `${x}px`);
  container.style.setProperty("--mouse-y", `${y}px`);
  const isInside = (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);
  container.style.setProperty("--pattern-opacity", isInside ? "1" : "0");
});

container.addEventListener("mousedown", (e) => {
  const target = e.target;
  if ((target.id === "main-container" || target.id === "spotlight" || target.closest("header")) && !target.classList.contains("resizer") && target.id !== "open-settings") {
    invoke("drag_window");
  }
});

document.querySelectorAll(".resizer").forEach(r => {
  r.onmousedown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const dir = r.dataset.direction;
    if (dir) appWindow.startResizing(dir);
  };
});

const settingsBtn = document.getElementById("open-settings");
if (settingsBtn) {
    settingsBtn.onclick = () => invoke("open_module_settings", { id: "time-date" });
}

applyState();
updateClock();
setInterval(updateClock, 1000);

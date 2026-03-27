// Weather Module Logic (Vanilla JS for Protocol Compatibility)

// --- Config State ---
const DEFAULT_STATE = {
    city: "Alamosa, CO",
    station: "KCOALAM056",
    provider: "openweather",
    units: "Imperial",
    bgAlpha: 90
};

let state = JSON.parse(localStorage.getItem("flux_weather_state")) || DEFAULT_STATE;

// --- Icon Pools for Environmental Grid Cycling ---
const ICON_POOLS = {
    wind: ["wind-01.svg", "wind-02.svg", "wind-03.svg", "waves.svg"],
    humidity: ["droplets-01.svg", "droplets-02.svg", "droplets-03.svg", "cloudy.svg"],
    uv: ["sun.svg", "sunrise.svg", "sun-setting-01.svg", "thermometer-warm.svg"],
    precip: ["umbrella-01.svg", "umbrella-02.svg", "umbrella-03.svg", "rain.svg"],
    visibility: ["thermometer-01.svg", "fog.svg", "stars-02.svg", "clear.svg"]
};

let poolIndices = { wind: 0, humidity: 0, uv: 0, precip: 0, visibility: 0 };

// --- Stable Mock Data ---
const MOCK_ENV = {
    wind_val: 18,
    wind_dir: "WSW",
    humidity: "18%",
    uv: "0",
    precip_val: 0.0,
    visibility_val: 9,
    condition: "Sunny"
};

// Generate 24 hours of data once
const MOCK_HOURLY_24 = Array.from({ length: 24 }, (_, i) => {
    const hour = i;
    const ampm = hour >= 12 ? 'p' : 'a';
    const displayHour = hour % 12 || 12;
    const temp = Math.round(50 + 20 * Math.sin((hour - 8) * Math.PI / 12));
    let icon = "sun.svg";
    if (hour < 6 || hour > 20) icon = "moon-01.svg";
    else if (temp > 65) icon = "sun.svg";
    else icon = "cloud-sun-01.svg";
    return { time: `${displayHour}${ampm}`, temp, icon, hour };
});

const MOCK_FORECAST = [
    { day: "Today", low: 29, high: 72, icon: "sun.svg" },
    { day: "Tue", low: 36, high: 77, icon: "cloud-01.svg" },
    { day: "Wed", low: 37, high: 80, icon: "cloud-01.svg" },
    { day: "Thu", low: 52, high: 74, icon: "sun.svg" },
    { day: "Fri", low: 42, high: 68, icon: "cloud-01.svg" },
    { day: "Sat", low: 39, high: 67, icon: "cloud-01.svg" },
    { day: "Sun", low: 44, high: 68, icon: "cloud-01.svg" }
];

// --- Helpers ---
const fToC = (f) => Math.round((f - 32) * 5 / 9);
const miToKm = (mi) => Math.round(mi * 1.60934);
const inToMm = (inVal) => (inVal * 25.4).toFixed(1);

function getInterpolatedTemp(now) {
    const hour = now.getHours();
    const min = now.getMinutes();
    const nextHour = (hour + 1) % 24;
    const t1 = MOCK_HOURLY_24[hour].temp;
    const t2 = MOCK_HOURLY_24[nextHour].temp;
    return t1 + (t2 - t1) * (min / 60);
}

function applyState() {
    const root = document.documentElement;
    const isMetric = state.units === "Metric";
    const now = new Date();
    
    const r = 10, g = 15, b = 26; 
    root.style.setProperty("--color-bg-base", `rgba(${r}, ${g}, ${b}, ${state.bgAlpha / 100})`);
    root.style.setProperty("--unit-temp", isMetric ? "'C'" : "'F'");
    
    const cityEl = document.querySelector(".location-tag");
    if (cityEl) cityEl.textContent = state.city.toUpperCase();
    const stationEl = document.querySelector(".weather-footer span:last-child");
    if (stationEl) stationEl.textContent = `STATION // ${state.station.toUpperCase()}`;

    const rawTemp = getInterpolatedTemp(now);
    const displayTemp = isMetric ? fToC(rawTemp) : Math.round(rawTemp);
    document.getElementById("main-temp").textContent = displayTemp;

    const today = MOCK_FORECAST[0];
    document.getElementById("stat-hi").textContent = `${isMetric ? fToC(today.high) : today.high}°`;
    document.getElementById("stat-lo").textContent = `${isMetric ? fToC(today.low) : today.low}°`;
    document.getElementById("stat-fl").textContent = `${displayTemp}°`;

    document.getElementById("env-wind").textContent = `${isMetric ? Math.round(MOCK_ENV.wind_val * 1.609) : MOCK_ENV.wind_val} ${isMetric ? 'KPH' : MOCK_ENV.wind_dir}`;
    document.getElementById("env-humidity").textContent = MOCK_ENV.humidity;
    document.getElementById("env-uv").textContent = MOCK_ENV.uv;
    document.getElementById("env-precip").textContent = isMetric ? `${inToMm(MOCK_ENV.precip_val)} mm` : `${MOCK_ENV.precip_val.toFixed(1)} in`;
    document.getElementById("env-visibility").textContent = isMetric ? `${miToKm(MOCK_ENV.visibility_val)} km` : `${MOCK_ENV.visibility_val} mi`;
}

// --- Glitch Cycling ---
const _cycleIntervals = [];
const _cycleTimeouts = [];

function cycleSingleIcon(cat) {
    const iconEl = document.getElementById(`icon-${cat}`);
    if (!iconEl) return;
    iconEl.classList.remove('glitching');
    void iconEl.offsetWidth;
    iconEl.classList.add('glitching');
    poolIndices[cat] = (poolIndices[cat] + 1) % ICON_POOLS[cat].length;
    const tid = setTimeout(() => {
        iconEl.src = `assets/icons/${ICON_POOLS[cat][poolIndices[cat]]}`;
    }, 120);
    _cycleTimeouts.push(tid);
}

function startStaggeredCycling() {
    const categories = ['wind', 'humidity', 'uv', 'precip', 'visibility'];
    categories.forEach((cat, index) => {
        const tid = setTimeout(() => {
            cycleSingleIcon(cat);
            const iid = setInterval(() => cycleSingleIcon(cat), 15000);
            _cycleIntervals.push(iid);
        }, index * 3000 + (Math.random() * 1000));
        _cycleTimeouts.push(tid);
    });
}

function initCarousel() {
    const hourlyGrid = document.getElementById("hourly-grid");
    const isMetric = state.units === "Metric";
    const maxTemp = Math.max(...MOCK_HOURLY_24.map(th => th.temp));
    
    hourlyGrid.innerHTML = "";
    // Create 3 sets of 24 hours
    for (let set = -1; set <= 1; set++) {
        MOCK_HOURLY_24.forEach((h, i) => {
            const item = document.createElement("div");
            item.className = "hourly-item";
            const barHeight = Math.max(10, (h.temp / maxTemp) * 50);
            let barColor = "var(--color-hud-primary)";
            if (h.temp > 80) barColor = "var(--color-hud-danger)";
            else if (h.temp > 70) barColor = "var(--color-hud-caution)";

            const displayTemp = isMetric ? fToC(h.temp) : h.temp;
            item.innerHTML = `
                <span class="hourly-temp">${displayTemp}°</span>
                <img src="assets/icons/${h.icon}" class="hourly-icon weather-icon">
                <div class="hourly-bar" style="height:${barHeight}px; background: ${barColor}"></div>
                <span class="hourly-time">${h.time}</span>
            `;
            hourlyGrid.appendChild(item);
        });
    }
    hourlyGrid.dataset.units = state.units;
}

function updateCarouselMove() {
    const hourlyGrid = document.getElementById("hourly-grid");
    const now = new Date();
    const nowHour = now.getHours();
    const nowMin = now.getMinutes();
    const nowSec = now.getSeconds();
    const itemWidth = 50;

    const fractionalHour = nowHour + (nowMin / 60) + (nowSec / 3600);
    // Base Today set starts at index 24. 
    // To center index 24 + fractionalHour:
    // Offset = - ( (24 + fractionalHour) * itemWidth + itemWidth / 2 )
    const totalOffset = -((24 + fractionalHour) * itemWidth + (itemWidth / 2));
    hourlyGrid.style.transform = `translateX(${totalOffset}px)`;

    // Highlight active hour in the middle set
    Array.from(hourlyGrid.children).forEach((item, i) => {
        if (i === 24 + nowHour) item.classList.add("active");
        else item.classList.remove("active");
    });
}

function _handleStorage() {
    state = JSON.parse(localStorage.getItem("flux_weather_state")) || DEFAULT_STATE;
    applyState();
    initCarousel(); // Re-render for unit change
    initUI();
}
window.addEventListener('storage', _handleStorage);

function updateClock() {
    const now = new Date();
    const headerTime = document.getElementById("header-time");
    if (headerTime) {
        headerTime.textContent = now.toLocaleString('en-US', { 
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true 
        });
    }
    applyState();
    updateCarouselMove();
}

function initUI() {
    const isMetric = state.units === "Metric";
    document.getElementById("main-cond").textContent = MOCK_ENV.condition;
    const isRaining = MOCK_ENV.condition.toLowerCase().includes("rain") || MOCK_ENV.condition.toLowerCase().includes("thunderstorm");
    const warningEl = document.getElementById("timefall-warning");
    if (warningEl) warningEl.style.display = isRaining ? "block" : "none";

    const forecastGrid = document.getElementById("forecast-grid");
    if (forecastGrid) {
        forecastGrid.innerHTML = "";
        MOCK_FORECAST.forEach(f => {
            const day = document.createElement("div");
            day.className = "forecast-day";
            day.innerHTML = `
                <span class="day-name">${f.day}</span>
                <img src="assets/icons/${f.icon}" class="day-icon weather-icon">
                <div class="day-temps">
                    <span>${isMetric ? fToC(f.high) : f.high}°</span>
                    <span class="temp-min">${isMetric ? fToC(f.low) : f.low}°</span>
                </div>
            `;
            forecastGrid.appendChild(day);
        });
    }

    const mainIcon = document.getElementById("main-icon");
    if (mainIcon) {
        const mainCondIcon = MOCK_ENV.condition.toLowerCase().includes('sunny') ? 'sun.svg' : 
                             MOCK_ENV.condition.toLowerCase().includes('cloud') ? 'cloud-01.svg' : 
                             MOCK_ENV.condition.toLowerCase().includes('rain') ? 'rain.svg' : 'sun.svg';
        mainIcon.src = `assets/icons/${mainCondIcon}`;
    }
    applyState();
}

// --- Interactions ---
const container = document.getElementById("main-container");
function _handleMouseMove(e) {
  const rect = container.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  container.style.setProperty("--mouse-x", `${x}px`);
  container.style.setProperty("--mouse-y", `${y}px`);
  const isInside = (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);
  container.style.setProperty("--pattern-opacity", isInside ? "1" : "0");
}
window.addEventListener("mousemove", _handleMouseMove);

container.addEventListener("mousedown", (e) => {
  const target = e.target;
  if ((target.id === "main-container" || target.id === "spotlight" || target.closest("header")) && !target.classList.contains("resizer") && target.id !== "open-settings") {
    WidgetAPI.widget.drag(e);
  }
});

document.querySelectorAll(".resizer").forEach(r => {
  r.onmousedown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const dir = r.dataset.direction;
    if (dir) WidgetAPI.widget.resize(dir);
  };
});

const settingsBtn = document.getElementById("open-settings");
if (settingsBtn) settingsBtn.onclick = () => WidgetAPI.widget.openSettings();

initCarousel();
initUI();
updateClock();
const _clockInterval = setInterval(updateClock, 1000);
startStaggeredCycling();

function _cleanup() {
  clearInterval(_clockInterval);
  _cycleIntervals.forEach(id => clearInterval(id));
  _cycleTimeouts.forEach(id => clearTimeout(id));
  window.removeEventListener('storage', _handleStorage);
  window.removeEventListener('mousemove', _handleMouseMove);
}
window._fluxCleanup = _cleanup;

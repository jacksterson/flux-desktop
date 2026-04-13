const mockFullHourly = Array.from({ length: 168 }).map((_, i) => {
  const dayOffset = Math.floor(i / 24);
  const hourOfDay = i % 24;
  const baseTemp = 20 + Math.sin(dayOffset) * 5;
  return {
    temp: baseTemp - Math.cos((hourOfDay - 14) * Math.PI / 12) * 8,
    humidity: 40 + Math.sin(i * 0.1) * 20,
    precip: Math.random() > 0.9 ? Math.random() * 5 : 0,
    wind: 10 + Math.sin(i * 0.2) * 10
  };
});

const MOCK_DATA = {
  temperature: 22,
  feelsLike: 24,
  condition: 0,
  location: 'SIMULATION MODE',
  humidity: 45,
  windSpeed: 12.5,
  precipitation: 0,
  uvIndex: 6.2,
  high: 26,
  low: 18,
  hourly: [
    { time: '10:00', temp: 22, code: 0 },
    { time: '11:00', temp: 23, code: 1 },
    { time: '12:00', temp: 25, code: 2 },
    { time: '13:00', temp: 26, code: 3 },
    { time: '14:00', temp: 26, code: 3 },
    { time: '15:00', temp: 25, code: 2 },
    { time: '16:00', temp: 23, code: 1 },
  ],
  daily: [
    { date: 'Today', max: 24, min: 16, code: 3, precip: 0, wind: 12 },
    { date: 'Wed', max: 20, min: 14, code: 61, precip: 5, wind: 18 },
    { date: 'Thu', max: 18, min: 12, code: 71, precip: 10, wind: 25 },
    { date: 'Fri', max: 22, min: 15, code: 1, precip: 0, wind: 15 },
    { date: 'Sat', max: 25, min: 18, code: 0, precip: 0, wind: 10 },
    { date: 'Sun', max: 27, min: 20, code: 0, precip: 0, wind: 8 },
    { date: 'Mon', max: 26, min: 19, code: 2, precip: 0, wind: 14 },
  ],
  fullHourly: mockFullHourly
};

// --- Config ---
const DEFAULT_CFG = {
  location: '',
  updateInterval: 10,
  unit: 'C',
  windUnit: 'km/h',
  precipUnit: 'mm',
  timeFormat: '24h',
  hourlyCount: 5,
  forecastDays: 7,
  defaultTab: 'temp',
  metrics: ['wind', 'humidity', 'precipitation', 'uv'],
  glitchIntensity: 2,
  glitchFrequency: 1,
  simulation: false,
  showSunriseSunset: true,
};

function loadCfg() {
  const raw = localStorage.getItem('koji_weather_cfg');
  if (raw) {
    try { return { ...DEFAULT_CFG, ...JSON.parse(raw) }; } catch (_) {
      console.warn('[koji/weather] Corrupt cfg — resetting to defaults.');
    }
  }
  // Migrate old individual keys
  const oldLoc = localStorage.getItem('koji_weather_location');
  const oldSim = localStorage.getItem('koji_weather_simulation') === 'true';
  const oldH7  = localStorage.getItem('koji_weather_hourly7') === 'true';
  return {
    ...DEFAULT_CFG,
    location: oldLoc || '',
    simulation: oldSim,
    hourlyCount: oldH7 ? 7 : 5,
  };
}

let cfg = loadCfg();

// --- Icon system ---
const ICON_BASE = 'flux-module://icons/weather/';

const ICON_MAP = {
  0: 'sun.svg',
  1: 'cloud-sun-01.svg', 2: 'cloud-sun-02.svg',
  3: 'cloudy.svg',
  45: 'fog.svg', 48: 'fog.svg',
  51: 'cloud-raining-01.svg', 53: 'cloud-raining-01.svg', 55: 'cloud-raining-02.svg',
  56: 'sleet.svg', 57: 'sleet.svg',
  61: 'rain.svg', 63: 'rain.svg', 65: 'cloud-raining-03.svg',
  66: 'sleet.svg', 67: 'sleet.svg',
  71: 'snow.svg', 73: 'snow.svg', 75: 'cloud-snowing-01.svg', 77: 'snow.svg',
  80: 'cloud-raining-04.svg', 81: 'cloud-raining-04.svg', 82: 'cloud-raining-05.svg',
  85: 'cloud-snowing-01.svg', 86: 'cloud-snowing-02.svg',
  95: 'thunderstorm.svg', 96: 'cloud-lightning.svg', 99: 'cloud-lightning.svg',
};

const GLITCH_NEIGHBORS = {
  'sun.svg':              ['cloud-sun-01.svg'],
  'cloud-sun-01.svg':     ['sun.svg', 'cloud-sun-02.svg'],
  'cloud-sun-02.svg':     ['cloud-sun-01.svg', 'cloudy.svg'],
  'cloudy.svg':           ['cloud-sun-02.svg', 'cloud-01.svg'],
  'fog.svg':              ['cloud-01.svg', 'cloud-02.svg'],
  'cloud-raining-01.svg': ['cloud-raining-02.svg', 'droplets-01.svg'],
  'cloud-raining-02.svg': ['cloud-raining-01.svg', 'droplets-01.svg'],
  'sleet.svg':            ['cloud-snowing-01.svg', 'cloud-raining-01.svg'],
  'rain.svg':             ['cloud-raining-03.svg', 'cloud-raining-04.svg'],
  'cloud-raining-03.svg': ['rain.svg', 'cloud-raining-04.svg'],
  'cloud-raining-04.svg': ['rain.svg', 'cloud-raining-03.svg'],
  'cloud-raining-05.svg': ['cloud-raining-04.svg', 'cloud-raining-03.svg'],
  'snow.svg':             ['cloud-snowing-01.svg', 'sleet.svg'],
  'cloud-snowing-01.svg': ['snow.svg', 'cloud-snowing-02.svg'],
  'cloud-snowing-02.svg': ['cloud-snowing-01.svg', 'sleet.svg'],
  'thunderstorm.svg':     ['cloud-lightning.svg', 'lightning-01.svg'],
  'cloud-lightning.svg':  ['thunderstorm.svg', 'lightning-01.svg'],
  'lightning-01.svg':     ['cloud-lightning.svg', 'thunderstorm.svg'],
};

function getIconSrc(wmoCode) {
  return ICON_BASE + (ICON_MAP[wmoCode] || 'cloudy.svg');
}

// --- Glitch system ---
// Frequency ranges (ms): 0=slow, 1=normal, 2=fast
const GLITCH_FREQ = [
  [10000, 20000],
  [4000,  12000],
  [2000,   6000],
];
// Intensity CSS class suffix: 0=off, 1=subtle, 2=normal(default), 3=wild
const GLITCH_CLASS = ['', 'intensity-subtle', '', 'intensity-wild'];
// Animation duration (ms) per intensity
const GLITCH_DUR = [0, 350, 400, 500];

class GlitchManager {
  constructor(intensity, frequency) {
    this._intensity = intensity;
    this._frequency = frequency;
    this._slots = new Map();     // wrapEl → timeoutId
    this._registered = new Set(); // all registered wrapEls
  }

  register(wrapEl) {
    this._registered.add(wrapEl);
    if (this._intensity === 0) return;
    this._schedule(wrapEl);
  }

  unregister(wrapEl) {
    this._registered.delete(wrapEl);
    const id = this._slots.get(wrapEl);
    if (id != null) clearTimeout(id);
    this._slots.delete(wrapEl);
  }

  setIntensity(n) {
    this._intensity = n;
    if (n === 0) {
      for (const [, id] of this._slots) clearTimeout(id);
      this._slots.clear();
    } else if (this._slots.size === 0 && this._registered.size > 0) {
      // Re-schedule all registered elements when re-enabling
      for (const el of this._registered) {
        if (!this._slots.has(el)) this._schedule(el);
      }
    }
  }

  setFrequency(n) { this._frequency = n; }

  _schedule(wrapEl) {
    if (this._intensity === 0) return;
    const [min, max] = GLITCH_FREQ[this._frequency] || GLITCH_FREQ[1];
    const delay = min + Math.random() * (max - min);
    const id = setTimeout(() => this._glitch(wrapEl), delay);
    this._slots.set(wrapEl, id);
  }

  _glitch(wrapEl) {
    const current = wrapEl.querySelector('.icon-current');
    const neighbor = wrapEl.querySelector('.icon-neighbor');
    if (!current || !neighbor) { this._schedule(wrapEl); return; }

    const currentFile = (current.src || '').split('/').pop();
    const targets = GLITCH_NEIGHBORS[currentFile];
    if (!targets || targets.length === 0) { this._schedule(wrapEl); return; }

    const targetFile = targets[Math.floor(Math.random() * targets.length)];
    neighbor.src = ICON_BASE + targetFile;

    const cls = GLITCH_CLASS[this._intensity];
    if (cls) wrapEl.classList.add('glitching', cls);
    else wrapEl.classList.add('glitching');

    const dur = GLITCH_DUR[this._intensity];
    setTimeout(() => {
      wrapEl.classList.remove('glitching', 'intensity-subtle', 'intensity-wild');
      // Promote neighbor to current
      current.src = ICON_BASE + targetFile;
      neighbor.src = '';
      this._schedule(wrapEl);
    }, dur);
  }

  destroy() {
    for (const [, id] of this._slots) clearTimeout(id);
    this._slots.clear();
    this._registered.clear();
  }
}

let glitchManager = null;

let _scanBarsInitialized = false;

let state = {
  weather: MOCK_DATA,
  loading: false,
  isSimulation: cfg.simulation,
  graphMode: cfg.defaultTab || 'temp',
};

function setState(newState) {
  state = { ...state, ...newState };
  render();
}

const getGlowColor = (temp) => {
  if (temp < 15) return 'var(--color-hud-primary)';
  if (temp >= 15 && temp < 28) return 'var(--color-hud-alert)';
  return 'var(--color-hud-danger)';
};

const displayTemp = (tempC) => cfg.unit === 'C' ? tempC : (tempC * 9/5) + 32;

const getWeatherText = (code) => {
  if (code === 0) return 'CLEAR SKY';
  if (code >= 1 && code <= 3) return 'PARTLY CLOUDY';
  if (code >= 51 && code <= 67) return 'PRECIPITATION';
  if (code >= 71 && code <= 77) return 'SNOWFALL';
  if (code >= 95) return 'THUNDERSTORM';
  return 'UNKNOWN ANOMALY';
};

const fetchRealWeather = async (customLocation) => {
  setState({ loading: true, isSimulation: false });
  try {
    let latitude, longitude, locName;

    if (customLocation && customLocation.trim() !== '') {
      const coordMatch = customLocation.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
      if (coordMatch) {
        latitude = parseFloat(coordMatch[1]);
        longitude = parseFloat(coordMatch[2]);
        locName = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
      } else {
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(customLocation)}&count=1`);
        const geoData = await geoRes.json();
        if (geoData.results && geoData.results.length > 0) {
          latitude = geoData.results[0].latitude;
          longitude = geoData.results[0].longitude;
          locName = `${geoData.results[0].name}, ${geoData.results[0].country_code}`;
        } else {
          throw new Error('Location not found');
        }
      }
    } else {
      if (!navigator.geolocation) throw new Error('Geolocation not supported');
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
      locName = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
    }

    const days = cfg.forecastDays || 7;
    const windParam = { 'km/h': 'kmh', 'mph': 'mph', 'm/s': 'ms', 'knots': 'kn' }[cfg.windUnit] || 'kmh';
    const precipParam = cfg.precipUnit === 'inch' ? 'inch' : 'mm';

    const url = [
      `https://api.open-meteo.com/v1/forecast`,
      `?latitude=${latitude}&longitude=${longitude}`,
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,surface_pressure,visibility,cloud_cover`,
      `&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code,dew_point_2m`,
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset`,
      `&forecast_days=${days}`,
      `&wind_speed_unit=${windParam}`,
      `&precipitation_unit=${precipParam}`,
      `&timezone=auto`,
    ].join('');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();

    const currentIndex = data.hourly.time.findIndex(t => new Date(t).getTime() >= Date.now());
    const startIndex = currentIndex > -1 ? currentIndex : 0;

    const timeFmt = cfg.timeFormat === '12h'
      ? { hour: 'numeric', minute: '2-digit', hour12: true }
      : { hour: '2-digit', minute: '2-digit', hour12: false };

    const hourly = data.hourly.time.slice(startIndex, startIndex + 7).map((t, i) => ({
      time: new Date(t).toLocaleTimeString([], timeFmt),
      temp: data.hourly.temperature_2m[startIndex + i],
      code: data.hourly.weather_code[startIndex + i],
    }));

    const daily = data.daily.time.slice(0, days).map((t, i) => ({
      date: i === 0 ? 'TODAY' : new Date(t).toLocaleDateString([], { weekday: 'short' }).toUpperCase(),
      max: data.daily.temperature_2m_max[i],
      min: data.daily.temperature_2m_min[i],
      code: data.daily.weather_code[i],
      precip: data.daily.precipitation_sum[i],
      wind: data.daily.wind_speed_10m_max[i],
    }));

    const totalHours = days * 24;
    const fullHourly = Array.from({ length: totalHours }).map((_, i) => ({
      temp: data.hourly.temperature_2m[i] || 0,
      humidity: data.hourly.relative_humidity_2m[i] || 0,
      precip: data.hourly.precipitation[i] || 0,
      wind: data.hourly.wind_speed_10m[i] || 0,
    }));

    const precipSuffix = cfg.precipUnit === 'inch' ? ' in' : ' mm';
    const windSuffix = { 'km/h': ' km/h', 'mph': ' mph', 'm/s': ' m/s', 'knots': ' kn' }[cfg.windUnit] || ' km/h';

    setState({
      weather: {
        temperature: data.current.temperature_2m,
        feelsLike: data.current.apparent_temperature,
        condition: data.current.weather_code,
        location: locName,
        humidity: data.current.relative_humidity_2m,
        windSpeed: data.current.wind_speed_10m,
        windSuffix,
        precipitation: data.current.precipitation,
        precipSuffix,
        uvIndex: data.daily.uv_index_max[0],
        high: data.daily.temperature_2m_max[0],
        low: data.daily.temperature_2m_min[0],
        pressure: data.current.surface_pressure,
        visibility: data.current.visibility,
        cloudCover: data.current.cloud_cover,
        dewPoint: data.hourly.dew_point_2m[startIndex],
        sunrise: data.daily.sunrise?.[0],
        sunset: data.daily.sunset?.[0],
        hourly,
        daily,
        fullHourly,
      },
      loading: false,
    });
    scheduleRefresh();
  } catch (err) {
    console.error('[koji/weather] fetch error:', err);
    setState({
      weather: { ...state.weather, location: 'ERROR / NOT FOUND' },
      loading: false,
    });
  }
};

function renderHourlyForecast() {
  const grid = document.getElementById('hourly-grid');
  if (!grid) return;

  // Unregister old hourly slots from GlitchManager
  grid.querySelectorAll('.icon-glitch-wrap').forEach(el => glitchManager?.unregister(el));

  const count = cfg.hourlyCount || 5;

  grid.innerHTML = state.weather.hourly.slice(0, count).map((hour, i) => {
    const src = getIconSrc(hour.code);
    return `<div class="hourly-item">
      <span class="hourly-time">${hour.time}</span>
      <div class="hourly-icon">
        <div class="icon-glitch-wrap icon-glitch-wrap--sm" data-hourly="${i}">
          <img class="icon-layer icon-current wx-icon" src="${src}" alt="">
          <img class="icon-layer icon-neighbor wx-icon" src="" alt="" style="opacity:0">
        </div>
      </div>
      <span class="hourly-temp">${displayTemp(hour.temp).toFixed(0)}°</span>
    </div>`;
  }).join('');

  // Register new slots
  grid.querySelectorAll('.icon-glitch-wrap').forEach(el => glitchManager?.register(el));
}

function renderScanBars() {
  const container = document.getElementById('scan-bars');
  const labelsEl = document.getElementById('scan-day-labels');
  if (!container) return;

  const { fullHourly, daily } = state.weather;
  if (!fullHourly || fullHourly.length === 0) return;

  const minT = Math.min(...fullHourly.map(h => h.temp), 0);
  const maxT = Math.max(...fullHourly.map(h => h.temp), 1);
  const rangeT = maxT - minT || 1;
  const maxP = Math.max(...fullHourly.map(h => h.precip), 0.1);
  const maxW = Math.max(...fullHourly.map(h => h.wind), 0.1);

  const bars = fullHourly.map((h, idx) => {
    let heightPct = 0;
    let barColor = 'var(--color-hud-primary)';
    if (state.graphMode === 'temp') {
      heightPct = Math.max(5, ((h.temp - minT) / rangeT) * 100);
      barColor = getGlowColor(h.temp);
    } else if (state.graphMode === 'humidity') {
      heightPct = Math.max(2, (h.humidity / 100) * 100);
    } else if (state.graphMode === 'precip') {
      heightPct = Math.max(2, (h.precip / maxP) * 100);
    } else if (state.graphMode === 'wind') {
      heightPct = Math.max(5, (h.wind / maxW) * 100);
      barColor = 'var(--color-hud-alert)';
    }
    const gap = idx % 24 === 23 ? 'margin-right:2px;' : '';
    return `<div class="scan-bar" style="height:${heightPct}%;--bar-color:${barColor};${gap}"></div>`;
  });

  container.innerHTML = bars.join('');

  if (!_scanBarsInitialized) {
    const barEls = container.querySelectorAll('.scan-bar');
    barEls.forEach((bar, i) => {
      const targetH = bar.style.height;
      bar.style.height = '0';
      setTimeout(() => { bar.style.height = targetH; }, i * 40);
    });
    _scanBarsInitialized = true;
  }

  if (labelsEl && daily) {
    labelsEl.innerHTML = daily.map(d =>
      `<span class="scan-day-label">${d.date}</span>`
    ).join('');
  }
}

const METRIC_DEFS = {
  wind:         { label: 'WIND',       icon: '↗', getValue: (w) => `${w.windSpeed}${w.windSuffix || ' km/h'}` },
  humidity:     { label: 'HUMIDITY',   icon: '≋', getValue: (w) => `${w.humidity}%` },
  precipitation:{ label: 'PRECIP',     icon: '↓', getValue: (w) => `${w.precipitation}${w.precipSuffix || ' mm'}` },
  uv:           { label: 'UV INDEX',   icon: '◉', getValue: (w) => `${w.uvIndex ?? '--'}` },
  feelsLike:    { label: 'FEELS LIKE', icon: '~', getValue: (w) => `${displayTemp(w.feelsLike).toFixed(1)}°` },
  pressure:     { label: 'PRESSURE',   icon: '⊙', getValue: (w) => `${w.pressure != null ? Math.round(w.pressure) + ' hPa' : '--'}` },
  visibility:   { label: 'VISIBILITY', icon: '◎', getValue: (w) => `${w.visibility != null ? (w.visibility / 1000).toFixed(1) + ' km' : '--'}` },
  dewPoint:     { label: 'DEW POINT',  icon: '·', getValue: (w) => `${w.dewPoint != null ? displayTemp(w.dewPoint).toFixed(1) + '°' : '--'}` },
  cloudCover:   { label: 'CLOUD CVR',  icon: '☁', getValue: (w) => `${w.cloudCover != null ? w.cloudCover + '%' : '--'}` },
};

function renderMetrics() {
  const grid = document.querySelector('.metrics-grid');
  if (!grid) return;
  const w = state.weather;
  const metrics = cfg.metrics || DEFAULT_CFG.metrics;

  grid.innerHTML = metrics.slice(0, 4).map(key => {
    const def = METRIC_DEFS[key];
    if (!def) return '';
    return `<div class="metric-item">
      <div class="metric-label">${def.label}</div>
      <div class="metric-value"><span class="metric-icon">${def.icon}</span><span class="metric-val">${def.getValue(w)}</span></div>
    </div>`;
  }).join('');
}

function render() {
  const w = state.weather;
  const glowColor = getGlowColor(w.temperature);

  // Update CSS custom property for glow
  const container = document.getElementById('main-container');
  if (container) {
    container.style.setProperty('--current-glow', glowColor);
  }

  // Temperature hero
  const tempValueEl = document.getElementById('temp-value');
  if (tempValueEl) tempValueEl.textContent = displayTemp(w.temperature).toFixed(1);

  const tempUnitEl = document.getElementById('temp-unit');
  if (tempUnitEl) tempUnitEl.textContent = `°${cfg.unit}`;

  const unitToggleEl = document.getElementById('unit-toggle');
  if (unitToggleEl) unitToggleEl.textContent = `°${cfg.unit === 'C' ? 'F' : 'C'}`;

  // Condition text (underscores replaced with spaces)
  const conditionEl = document.getElementById('condition');
  if (conditionEl) conditionEl.textContent = getWeatherText(w.condition);

  // Hero icon
  const heroCurrentEl = document.getElementById('hero-icon-current');
  if (heroCurrentEl) heroCurrentEl.src = getIconSrc(w.condition);

  // Sunrise/sunset
  const srssEl = document.getElementById('sunrise-sunset');
  if (srssEl) {
    if (cfg.showSunriseSunset && w.sunrise && w.sunset) {
      const fmt = cfg.timeFormat === '12h'
        ? { hour: 'numeric', minute: '2-digit', hour12: true }
        : { hour: '2-digit', minute: '2-digit', hour12: false };
      const sr = new Date(w.sunrise).toLocaleTimeString([], fmt);
      const ss = new Date(w.sunset).toLocaleTimeString([], fmt);
      srssEl.textContent = `↑ ${sr}  ·  ↓ ${ss}`;
      srssEl.style.display = '';
    } else {
      srssEl.style.display = 'none';
    }
  }

  // Location
  const locationEl = document.getElementById('location');
  if (locationEl) locationEl.textContent = w.location;

  // Feels like
  const feelsEl = document.getElementById('feels-like');
  if (feelsEl) feelsEl.textContent = `FEELS LIKE ${displayTemp(w.feelsLike).toFixed(1)}°  ·  H:${displayTemp(w.high).toFixed(0)}°  L:${displayTemp(w.low).toFixed(0)}°`;

  // Update temp glow color on the value element
  const tempValDiv = document.querySelector('.temp-value');
  if (tempValDiv) {
    tempValDiv.style.color = glowColor;
    tempValDiv.style.textShadow = `0 0 30px ${glowColor}, 0 0 60px rgba(0,191,255,0.3)`;
  }

  // Scan tabs active state
  document.querySelectorAll('.scan-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === state.graphMode);
  });

  renderHourlyForecast();
  renderScanBars();
  renderMetrics();
}

function attachEventListeners() {
  // Unit toggle
  const unitToggleBtn = document.getElementById('unit-toggle');
  unitToggleBtn?.addEventListener('click', () => {
    cfg.unit = cfg.unit === 'C' ? 'F' : 'C';
    localStorage.setItem('koji_weather_cfg', JSON.stringify(cfg));
    setState({ unit: cfg.unit });
  });

  // Settings open
  document.querySelectorAll('[data-open-settings]').forEach(el => {
    el.addEventListener('click', () => {
      if (window.WidgetAPI?.widget?.openSettings) {
        window.WidgetAPI.widget.openSettings();
      }
    });
  });

  // Scan tabs
  document.getElementById('scan-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.scan-tab');
    if (tab && tab.dataset.mode) {
      _scanBarsInitialized = false;
      setState({ graphMode: tab.dataset.mode });
    }
  });

  // Drag support
  const container = document.getElementById('main-container');
  container?.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, [data-open-settings]')) return;
    if (window.WidgetAPI?.widget?.drag) {
      window.WidgetAPI.widget.drag(e);
    }
  });

  // Mouse glow effect
  container?.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    container.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    container.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  });

  // Resizer
  const resizer = container?.querySelector('.resizer-rb');
  resizer?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (window.WidgetAPI?.widget?.resize) {
      window.WidgetAPI.widget.resize(e, 'SouthEast');
    }
  });
}

// Listen for settings changes (location saved from settings.html)
window.addEventListener('storage', () => {
  cfg = loadCfg();
  glitchManager?.setIntensity(cfg.glitchIntensity);
  glitchManager?.setFrequency(cfg.glitchFrequency);
  if (cfg.simulation) {
    setState({ isSimulation: true, weather: MOCK_DATA, unit: cfg.unit, graphMode: cfg.defaultTab || 'temp' });
  } else {
    fetchRealWeather(cfg.location || undefined);
  }
  scheduleRefresh();
});

attachEventListeners();

glitchManager = new GlitchManager(cfg.glitchIntensity, cfg.glitchFrequency);
const heroWrap = document.getElementById('hero-icon');
if (heroWrap) glitchManager.register(heroWrap);

render();

if (!cfg.simulation) {
  fetchRealWeather(cfg.location || undefined);
}

// Refresh timer
let _refreshTimer = null;
function scheduleRefresh() {
  clearInterval(_refreshTimer);
  if (!cfg.simulation) {
    _refreshTimer = setInterval(() => fetchRealWeather(cfg.location || undefined), cfg.updateInterval * 60 * 1000);
  }
}
scheduleRefresh();

window._fluxCleanup = function() {
  glitchManager?.destroy();
  clearInterval(_refreshTimer);
};

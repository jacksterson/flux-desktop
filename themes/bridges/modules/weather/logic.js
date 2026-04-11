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

let _scanBarsInitialized = false;

let state = {
  weather: MOCK_DATA,
  loading: false,
  isSimulation: true,
  unit: 'C',
  graphMode: 'temp',
  windUnit: 'km/h',
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

const displayTemp = (tempC) => state.unit === 'C' ? tempC : (tempC * 9/5) + 32;

const getWeatherIconId = (code) => {
  if (code === 0) return '#icon-clear';
  if (code >= 1 && code <= 2) return '#icon-cloudy';
  if (code === 3) return '#icon-cloudy';
  if (code >= 51 && code <= 67) return '#icon-rain';
  if (code >= 71 && code <= 77) return '#icon-cloudy';
  if (code >= 80 && code <= 82) return '#icon-rain';
  if (code >= 95 && code <= 99) return '#icon-storm';
  return '#icon-cloudy';
};

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
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(customLocation)}&count=1`);
      const geoData = await geoRes.json();
      if (geoData.results && geoData.results.length > 0) {
        latitude = geoData.results[0].latitude;
        longitude = geoData.results[0].longitude;
        locName = `${geoData.results[0].name}, ${geoData.results[0].country_code}`;
      } else {
        throw new Error("Location not found");
      }
    } else {
      if (!navigator.geolocation) throw new Error("Geolocation not supported");
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
      locName = `LAT:${latitude.toFixed(2)} LON:${longitude.toFixed(2)}`;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum,wind_speed_10m_max&timezone=auto`;

    const res = await fetch(url);
    const data = await res.json();

    const currentIndex = data.hourly.time.findIndex(t => new Date(t).getTime() >= Date.now());
    const startIndex = currentIndex > -1 ? currentIndex : 0;

    const hourly = data.hourly.time.slice(startIndex, startIndex + 7).map((t, i) => ({
      time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      temp: data.hourly.temperature_2m[startIndex + i],
      code: data.hourly.weather_code[startIndex + i]
    }));

    const daily = data.daily.time.slice(0, 7).map((t, i) => ({
      date: i === 0 ? 'Today' : new Date(t).toLocaleDateString([], { weekday: 'short' }),
      max: data.daily.temperature_2m_max[i],
      min: data.daily.temperature_2m_min[i],
      code: data.daily.weather_code[i],
      precip: data.daily.precipitation_sum[i],
      wind: data.daily.wind_speed_10m_max[i]
    }));

    const fullHourly = Array.from({ length: 168 }).map((_, i) => ({
      temp: data.hourly.temperature_2m[i] || 0,
      humidity: data.hourly.relative_humidity_2m[i] || 0,
      precip: data.hourly.precipitation[i] || 0,
      wind: data.hourly.wind_speed_10m[i] || 0
    }));

    setState({
      weather: {
        temperature: data.current.temperature_2m,
        feelsLike: data.current.apparent_temperature,
        condition: data.current.weather_code,
        location: locName,
        humidity: data.current.relative_humidity_2m,
        windSpeed: data.current.wind_speed_10m,
        precipitation: data.current.precipitation,
        uvIndex: data.daily.uv_index_max[0],
        high: data.daily.temperature_2m_max[0],
        low: data.daily.temperature_2m_min[0],
        hourly,
        daily,
        fullHourly
      },
      loading: false
    });
  } catch (err) {
    setState({
      weather: { ...state.weather, location: 'ERROR/NOT_FOUND' },
      loading: false
    });
  }
};

function renderHourlyForecast() {
  const grid = document.getElementById('hourly-grid');
  if (!grid) return;

  grid.innerHTML = state.weather.hourly.slice(0, 7).map(hour => {
    const iconId = getWeatherIconId(hour.code);
    return `<div class="hourly-item">
      <span class="hourly-time">${hour.time}</span>
      <div class="hourly-icon"><svg class="wx-icon"><use href="${iconId}"/></svg></div>
      <span class="hourly-temp">${displayTemp(hour.temp).toFixed(0)}°</span>
    </div>`;
  }).join('');
}

function renderScanBars() {
  const container = document.getElementById('scan-bars');
  const labelsEl = document.getElementById('scan-day-labels');
  if (!container) return;

  const { fullHourly, daily } = state.weather;

  const minT = Math.min(...fullHourly.map(h => h.temp), 0);
  const maxT = Math.max(...fullHourly.map(h => h.temp), 1);
  const rangeT = maxT - minT || 1;
  const maxP = Math.max(...fullHourly.map(h => h.precip), 0.1);
  const maxW = Math.max(...fullHourly.map(h => h.wind), 0.1);

  // Build bars grouped by day (7 days * 24 hours = 168)
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
    const marginRight = idx % 24 === 23 ? '2px' : '0px';
    return `<div class="scan-bar" style="height:${heightPct}%;background:${barColor};margin-right:${marginRight}"></div>`;
  });

  container.innerHTML = bars.join('');

  // Scan bar shimmer — JS-driven stagger on first render
  if (!_scanBarsInitialized) {
    const barEls = container.querySelectorAll('.scan-bar');
    barEls.forEach((bar, i) => {
      const targetH = bar.style.height;
      bar.style.height = '0';
      bar.style.transition = 'none';
      setTimeout(() => {
        bar.style.transition = 'height 0.3s ease';
        bar.style.height = targetH;
      }, i * 40);
    });
    _scanBarsInitialized = true;
  }

  // Day labels
  if (labelsEl && daily) {
    labelsEl.innerHTML = daily.map(d =>
      `<span class="scan-day-label">${d.date}</span>`
    ).join('');
  }
}

function renderMetrics() {
  const w = state.weather;
  const windVal = state.windUnit === 'km/h'
    ? `${w.windSpeed} km/h`
    : `${(w.windSpeed * 0.621371).toFixed(1)} mph`;

  const setVal = (id, text) => {
    const valEl = document.querySelector(`#${id} .metric-val`);
    if (valEl) valEl.textContent = text;
  };

  setVal('metric-wind', windVal);
  setVal('metric-humidity', `${w.humidity}%`);
  setVal('metric-precip', `${w.precipitation} mm`);
  setVal('metric-uv', `${w.uvIndex}`);
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
  if (tempUnitEl) tempUnitEl.textContent = `°${state.unit}`;

  const unitToggleEl = document.getElementById('unit-toggle');
  if (unitToggleEl) unitToggleEl.textContent = `°${state.unit === 'C' ? 'F' : 'C'}`;

  // Condition text (underscores replaced with spaces)
  const conditionEl = document.getElementById('condition');
  if (conditionEl) conditionEl.textContent = getWeatherText(w.condition);

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
    setState({ unit: state.unit === 'C' ? 'F' : 'C' });
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
  const loc = localStorage.getItem('koji_weather_location');
  const sim = localStorage.getItem('koji_weather_simulation') === 'true';
  if (sim) {
    setState({ isSimulation: true, weather: MOCK_DATA });
  } else if (loc !== null) {
    fetchRealWeather(loc || undefined);
  }
});

// Initialize
attachEventListeners();
render();

const savedSim = localStorage.getItem('koji_weather_simulation') === 'true';
const savedLoc = localStorage.getItem('koji_weather_location');
if (!savedSim) {
  fetchRealWeather(savedLoc || undefined);
}

window._fluxCleanup = function() {
  // No intervals or timers to clear in this widget
};

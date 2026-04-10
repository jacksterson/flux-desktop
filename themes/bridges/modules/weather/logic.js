const icons = {
  MapPin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
  RefreshCw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
  Clock: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  Calendar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`,
  Activity: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  Wind: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>`,
  Droplets: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7 2.9 7 2.9s-2.29 6.16-2.29 6.16C3.57 10 3 11.09 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 1 14 8.5c.85.93 1.5 2.03 1.5 3.25 0 2.22-1.8 4.05-4 4.05-1.1 0-2.1-.45-2.83-1.18"/></svg>`,
  Umbrella: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12a10.06 10.06 0 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/></svg>`,
  SunDim: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 4h.01"/><path d="M20 12h.01"/><path d="M12 20h.01"/><path d="M4 12h.01"/><path d="M17.657 6.343h.01"/><path d="M17.657 17.657h.01"/><path d="M6.343 17.657h.01"/><path d="M6.343 6.343h.01"/></svg>`,
  Sun: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,
  Cloud: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
  CloudRain: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg>`,
  CloudSnow: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M8 15h.01"/><path d="M8 19h.01"/><path d="M12 17h.01"/><path d="M12 21h.01"/><path d="M16 15h.01"/><path d="M16 19h.01"/></svg>`,
  CloudLightning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/></svg>`
};

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

let state = {
  weather: MOCK_DATA,
  loading: false,
  isSimulation: true,
  unit: 'C',
  graphMode: 'temp',
  hourlyCount: 5,
  windUnit: 'km/h',
  showSettings: false,
  settingsForm: { location: '', service: 'simulation' }
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

const getWeatherIcon = (code) => {
  if (code === 0) return icons.Sun;
  if (code >= 1 && code <= 3) return icons.Cloud;
  if (code >= 51 && code <= 67) return icons.CloudRain;
  if (code >= 71 && code <= 77) return icons.CloudSnow;
  if (code >= 95) return icons.CloudLightning;
  return icons.Cloud;
};

const getWeatherText = (code) => {
  if (code === 0) return 'CLEAR_SKY';
  if (code >= 1 && code <= 3) return 'PARTLY_CLOUDY';
  if (code >= 51 && code <= 67) return 'PRECIPITATION';
  if (code >= 71 && code <= 77) return 'SNOWFALL';
  if (code >= 95) return 'THUNDERSTORM';
  return 'UNKNOWN_ANOMALY';
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

function renderGraphBars() {
  const minT = Math.min(...state.weather.fullHourly.map(h => h.temp), 0);
  const maxT = Math.max(...state.weather.fullHourly.map(h => h.temp), 1);
  const rangeT = maxT - minT || 1;
  const maxP = Math.max(...state.weather.fullHourly.map(h => h.precip), 0.1);
  const maxW = Math.max(...state.weather.fullHourly.map(h => h.wind), 0.1);

  return state.weather.fullHourly.map((h, idx) => {
    let heightPct = 0;
    let barColor = getGlowColor(state.weather.temperature);
    if (state.graphMode === 'temp') {
      heightPct = Math.max(5, ((h.temp - minT) / rangeT) * 100);
      barColor = getGlowColor(h.temp);
    } else if (state.graphMode === 'humidity') {
      heightPct = Math.max(2, (h.humidity / 100) * 100);
      barColor = 'var(--color-hud-primary)';
    } else if (state.graphMode === 'precip') {
      heightPct = Math.max(2, (h.precip / maxP) * 100);
      barColor = 'var(--color-hud-primary)';
    } else if (state.graphMode === 'wind') {
      heightPct = Math.max(5, (h.wind / maxW) * 100);
      barColor = 'var(--color-hud-alert)';
    }
    return `<div class="dot-matrix-bar" style="height: ${heightPct}%; color: ${barColor}; margin-right: ${idx % 24 === 23 ? '2px' : '0px'}"></div>`;
  }).join('');
}

function render() {
  const app = document.getElementById('app');
  const glowColor = getGlowColor(state.weather.temperature);

  app.innerHTML = `
    <div class="widget-container flicker-on-mount" id="widget" style="color: ${glowColor}; --current-glow: ${glowColor}">
      <div class="background-layers">
        <div class="widget-background"></div>
        <div class="scanlines"></div>
        <div class="pattern-layer" id="pattern-layer"></div>
        <div class="dot-matrix-pattern"></div>
      </div>

      <div class="content-wrapper">
        <!-- Header -->
        <div class="flex justify-between items-start">
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2 header-location" id="btn-open-settings" title="Open Settings">
              <div class="w-6" style="color: ${glowColor}">${icons.MapPin}</div>
              <span class="font-orbitron">${state.weather.location}</span>
            </div>
            <span class="header-status font-orbitron" style="color: ${glowColor}">STATUS: ${getWeatherText(state.weather.condition)}</span>
          </div>
          <button class="btn-icon w-6" id="btn-refresh" style="color: ${glowColor}">
            <div class="${state.loading ? 'animate-spin' : ''}">${icons.RefreshCw}</div>
          </button>
        </div>

        <!-- Main Display -->
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-between">
            <div class="flex flex-col w-full">
              <div class="flex items-center justify-center gap-2 mb-1 w-full">
                <span class="section-title font-rajdhani flex items-center gap-2" id="btn-toggle-unit" title="Toggle Unit">
                  Local_Temp <span class="section-title-small" style="color: ${glowColor}">[°${state.unit}]</span>
                </span>
              </div>
              <div class="flex items-start justify-center temp-display" id="btn-toggle-unit-large" style="color: ${glowColor}; text-shadow: 0 0 20px ${glowColor}80">
                <span class="font-tech">${displayTemp(state.weather.temperature).toFixed(1)}</span>
                <span class="font-tech temp-unit">°${state.unit}</span>
              </div>
            </div>
            <div class="main-icon-container w-24" style="color: ${glowColor}; box-shadow: inset 0 0 30px ${glowColor}20">
              ${getWeatherIcon(state.weather.condition)}
            </div>
          </div>

          <div class="flex items-center justify-between feels-like-row font-rajdhani">
            <span>FEELS LIKE: <span class="text-gray-200">${displayTemp(state.weather.feelsLike).toFixed(1)}°</span></span>
            <div class="flex gap-4">
              <span>H: <span class="text-gray-200">${displayTemp(state.weather.high).toFixed(1)}°</span></span>
              <span>L: <span class="text-gray-200">${displayTemp(state.weather.low).toFixed(1)}°</span></span>
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Hourly Forecast -->
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-center gap-2 mb-2 w-full">
            <div class="w-5 text-gray-500">${icons.Clock}</div>
            <span class="section-title section-title-small font-orbitron flex items-center gap-2" id="btn-toggle-hourly">
              Hourly_Log <span style="color: ${glowColor}">[${state.hourlyCount}H]</span>
            </span>
          </div>
          <div class="hourly-container">
            ${state.weather.hourly.slice(0, state.hourlyCount).map(hour => `
              <div class="hourly-item">
                <span class="hourly-time font-tech">${hour.time}</span>
                <div class="w-10" style="color: ${getGlowColor(hour.temp)}; opacity: 0.8">${getWeatherIcon(hour.code)}</div>
                <span class="hourly-temp font-tech">${displayTemp(hour.temp).toFixed(0)}°</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="divider"></div>

        <!-- Extended Scan Graph -->
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-center mb-2 w-full">
            <div class="flex items-center gap-2">
              <div class="w-5 text-gray-500">${icons.Calendar}</div>
              <span class="section-title section-title-small font-orbitron flex items-center gap-2" id="btn-toggle-graph">
                Extended_Scan <span style="color: ${glowColor}">[${state.graphMode.toUpperCase()}]</span>
              </span>
            </div>
          </div>

          <div class="graph-container">
            <div class="graph-bars">
              ${renderGraphBars()}
            </div>
            <div class="graph-info">
              ${state.weather.daily.map(day => `
                <div class="graph-day">
                  <span class="graph-day-label font-rajdhani">${day.date}</span>
                  <div class="graph-day-icon w-6" style="color: ${getGlowColor(day.max)}">${getWeatherIcon(day.code)}</div>
                  ${state.graphMode === 'temp' ? `
                    <div class="graph-day-temps font-tech">
                      <span class="text-white" style="font-size: 0.875rem">${displayTemp(day.max).toFixed(0)}°</span>
                      <span class="text-gray-400" style="font-size: 0.75rem">${displayTemp(day.min).toFixed(0)}°</span>
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Metrics Grid -->
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-center gap-2 mb-2 w-full">
            <div class="w-5 text-gray-500">${icons.Activity}</div>
            <span class="section-title section-title-small font-orbitron flex items-center gap-2" id="btn-toggle-wind">
              System_Metrics <span style="color: ${glowColor}">[${state.windUnit.toUpperCase()}]</span>
            </span>
          </div>
          <div class="metrics-grid">
            <div class="metric-item">
              <div class="w-10" style="color: ${glowColor}">${icons.Wind}</div>
              <div class="flex flex-col">
                <span class="metric-label font-rajdhani">Wind</span>
                <span class="metric-value font-tech">${state.windUnit === 'km/h' ? state.weather.windSpeed : (state.weather.windSpeed * 0.621371).toFixed(1)} ${state.windUnit}</span>
              </div>
            </div>
            <div class="metric-item">
              <div class="w-10" style="color: ${glowColor}">${icons.Droplets}</div>
              <div class="flex flex-col">
                <span class="metric-label font-rajdhani">Humidity</span>
                <span class="metric-value font-tech">${state.weather.humidity}%</span>
              </div>
            </div>
            <div class="metric-item">
              <div class="w-10" style="color: ${glowColor}">${icons.Umbrella}</div>
              <div class="flex flex-col">
                <span class="metric-label font-rajdhani">Precip</span>
                <span class="metric-value font-tech">${state.weather.precipitation} mm</span>
              </div>
            </div>
            <div class="metric-item">
              <div class="w-10" style="color: ${glowColor}">${icons.SunDim}</div>
              <div class="flex flex-col">
                <span class="metric-label font-rajdhani">UV Index</span>
                <span class="metric-value font-tech">${state.weather.uvIndex}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    ${state.isSimulation ? `
      <div class="simulation-controls mt-4">
        <span class="font-rajdhani text-gray-400" style="font-size: 0.875rem; letter-spacing: 0.1em; text-transform: uppercase">Simulation Override</span>
        <input type="range" min="-10" max="40" value="${state.weather.temperature}" id="sim-slider">
        <div class="flex justify-between w-full font-tech text-gray-500" style="font-size: 0.75rem; width: 16rem">
          <span>-10°C (Cold)</span>
          <span>40°C (Hot)</span>
        </div>
      </div>
    ` : ''}
  `;

  attachEventListeners();
}

function attachEventListeners() {
  const el = (id) => document.getElementById(id);

  // Toggles
  const toggleUnit = () => setState({ unit: state.unit === 'C' ? 'F' : 'C' });
  el('btn-toggle-unit')?.addEventListener('click', toggleUnit);
  el('btn-toggle-unit-large')?.addEventListener('click', toggleUnit);

  el('btn-toggle-hourly')?.addEventListener('click', () => {
    setState({ hourlyCount: state.hourlyCount === 5 ? 7 : 5 });
  });

  el('btn-toggle-graph')?.addEventListener('click', () => {
    const modes = ['temp', 'humidity', 'precip', 'wind'];
    const nextMode = modes[(modes.indexOf(state.graphMode) + 1) % modes.length];
    setState({ graphMode: nextMode });
  });

  el('btn-toggle-wind')?.addEventListener('click', () => {
    setState({ windUnit: state.windUnit === 'km/h' ? 'mph' : 'km/h' });
  });

  // Settings — delegate to WidgetAPI
  el('btn-open-settings')?.addEventListener('click', () => {
    WidgetAPI.widget.openSettings();
  });

  // Refresh
  el('btn-refresh')?.addEventListener('click', () => {
    if (!state.isSimulation) fetchRealWeather();
  });

  // Simulation Slider
  el('sim-slider')?.addEventListener('input', (e) => {
    const t = parseFloat(e.target.value);
    setState({
      weather: {
        ...state.weather,
        temperature: t,
        feelsLike: t + 2,
        high: t + 4,
        low: t - 4
      }
    });
  });

  // Mouse Glow Effect
  const widget = el('widget');
  widget?.addEventListener('mousemove', (e) => {
    const rect = widget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    widget.style.setProperty('--mouse-x', `${x}px`);
    widget.style.setProperty('--mouse-y', `${y}px`);
  });

  // Flux Drag Support
  const container = document.getElementById('main-container');
  container?.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, .cursor-pointer, .section-title, .header-location, .temp-display')) return;
    if (window.WidgetAPI?.widget?.drag) {
      window.WidgetAPI.widget.drag(e);
    }
  });
}

// Listen for settings changes (location saved from settings.html)
window.addEventListener('storage', (e) => {
  const loc = localStorage.getItem('koji_weather_location');
  const sim = localStorage.getItem('koji_weather_simulation') === 'true';
  if (sim) {
    setState({ isSimulation: true, weather: MOCK_DATA });
  } else if (loc !== null) {
    fetchRealWeather(loc || undefined);
  }
});

// Initialize
render();
const savedSim = localStorage.getItem('koji_weather_simulation') === 'true';
const savedLoc = localStorage.getItem('koji_weather_location');
if (!savedSim) {
  fetchRealWeather(savedLoc || undefined);
}

window._fluxCleanup = function() {
  // No intervals or timers to clear in this widget
};

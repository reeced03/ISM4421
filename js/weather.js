// Open-Meteo client. Data is fetched in metric units and converted for display.
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const CACHE_TTL_MS = 15 * 60 * 1000;

const CURRENT_VARS = [
  "temperature_2m", "apparent_temperature", "relative_humidity_2m", "is_day",
  "precipitation", "weather_code", "cloud_cover", "pressure_msl",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
];
const DAILY_VARS = [
  "weather_code", "temperature_2m_max", "temperature_2m_min",
  "precipitation_sum", "precipitation_probability_max", "snowfall_sum",
  "wind_speed_10m_max", "uv_index_max", "sunrise", "sunset",
];
const HOURLY_VARS = [
  "temperature_2m", "precipitation_probability", "precipitation",
  "weather_code", "wind_speed_10m", "visibility",
];

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < CACHE_TTL_MS ? v : null;
  } catch {
    return null;
  }
}

function cacheSet(key, v) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* storage full or unavailable — caching is optional */
  }
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let reason = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.reason) reason = body.reason;
    } catch { /* ignore */ }
    throw new Error(`Open-Meteo request failed: ${reason}`);
  }
  return res.json();
}

/** Current conditions + 7-day daily forecast for every park in one request. */
export async function fetchOverview(parks, { force = false } = {}) {
  const key = "overview:v1";
  if (!force) {
    const hit = cacheGet(key);
    if (hit) return hit;
  }
  const params = new URLSearchParams({
    latitude: parks.map((p) => p.lat).join(","),
    longitude: parks.map((p) => p.lon).join(","),
    current: CURRENT_VARS.join(","),
    daily: DAILY_VARS.join(","),
    timezone: "auto",
    forecast_days: "7",
  });
  const data = await getJSON(`${FORECAST_URL}?${params}`);
  const list = Array.isArray(data) ? data : [data];
  const result = { fetchedAt: Date.now(), byId: {} };
  parks.forEach((p, i) => { result.byId[p.id] = list[i]; });
  cacheSet(key, result);
  return result;
}

/** Hourly forecast (next 48h) and air quality for a single park. */
export async function fetchParkDetail(park) {
  const key = `detail:v1:${park.id}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const fParams = new URLSearchParams({
    latitude: park.lat, longitude: park.lon,
    hourly: HOURLY_VARS.join(","),
    timezone: "auto", forecast_days: "3",
  });
  const aParams = new URLSearchParams({
    latitude: park.lat, longitude: park.lon,
    current: "us_aqi,pm2_5,ozone",
    timezone: "auto",
  });
  const [forecast, air] = await Promise.all([
    getJSON(`${FORECAST_URL}?${fParams}`),
    // Air quality isn't available everywhere; don't fail the panel over it.
    getJSON(`${AIR_URL}?${aParams}`).catch(() => null),
  ]);
  const result = { forecast, air };
  cacheSet(key, result);
  return result;
}

// ---------- Weather codes (WMO) ----------
const WMO = {
  0: ["Clear sky", "sun"], 1: ["Mainly clear", "sun"], 2: ["Partly cloudy", "partly"], 3: ["Overcast", "cloud"],
  45: ["Fog", "fog"], 48: ["Rime fog", "fog"],
  51: ["Light drizzle", "drizzle"], 53: ["Drizzle", "drizzle"], 55: ["Dense drizzle", "drizzle"],
  56: ["Freezing drizzle", "sleet"], 57: ["Freezing drizzle", "sleet"],
  61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain"],
  66: ["Freezing rain", "sleet"], 67: ["Freezing rain", "sleet"],
  71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 77: ["Snow grains", "snow"],
  80: ["Rain showers", "rain"], 81: ["Rain showers", "rain"], 82: ["Violent showers", "rain"],
  85: ["Snow showers", "snow"], 86: ["Heavy snow showers", "snow"],
  95: ["Thunderstorm", "storm"], 96: ["Thunderstorm, hail", "storm"], 99: ["Severe thunderstorm", "storm"],
};

export function describeCode(code) {
  const [label, kind] = WMO[code] ?? ["Unknown", "cloud"];
  return { label, kind };
}

const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.5" fill="var(--sun)"/><g stroke="var(--sun)" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g>',
  moon: '<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.7A7 7 0 0 1 15.5 3.5z" fill="var(--moon)"/>',
  partly: '<circle cx="9" cy="9" r="4" fill="var(--sun)"/><path d="M8 19h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.5A2.8 2.8 0 0 0 8 19z" fill="var(--cloud)"/>',
  cloud: '<path d="M7 19h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.8A3.2 3.2 0 0 0 7 19z" fill="var(--cloud)"/>',
  fog: '<path d="M7 13h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.8A3.2 3.2 0 0 0 7 13z" fill="var(--cloud)"/><g stroke="var(--cloud)" stroke-width="1.8" stroke-linecap="round"><path d="M4 16.5h16M6 20h12"/></g>',
  drizzle: '<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.8A3.2 3.2 0 0 0 7 15z" fill="var(--cloud)"/><g fill="var(--rain)"><circle cx="9" cy="19" r="1"/><circle cx="13" cy="20" r="1"/><circle cx="16.5" cy="18.5" r="1"/></g>',
  rain: '<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.8A3.2 3.2 0 0 0 7 15z" fill="var(--cloud)"/><g stroke="var(--rain)" stroke-width="1.8" stroke-linecap="round"><path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3"/></g>',
  sleet: '<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.8A3.2 3.2 0 0 0 7 15z" fill="var(--cloud)"/><g stroke="var(--rain)" stroke-width="1.8" stroke-linecap="round"><path d="M9 17.5l-1 3M15 17.5l-1 3"/></g><circle cx="12" cy="19.5" r="1.2" fill="var(--snow)"/>',
  snow: '<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.8A3.2 3.2 0 0 0 7 15z" fill="var(--cloud)"/><g fill="var(--snow)"><circle cx="8.5" cy="19" r="1.3"/><circle cx="12.5" cy="20.5" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/></g>',
  storm: '<path d="M7 14h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.8A3.2 3.2 0 0 0 7 14z" fill="var(--cloud-dark)"/><path d="M12.5 14l-2.5 4h3l-2 4.5 5-6h-3l1.5-2.5z" fill="var(--sun)"/>',
};

export function weatherIcon(code, isDay = 1, size = 32) {
  let { kind } = describeCode(code);
  if (kind === "sun" && !isDay) kind = "moon";
  return `<svg class="wx-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind]}</svg>`;
}

// ---------- Units ----------
export const units = {
  imperial: true,
  temp(c) { return c == null ? "–" : `${Math.round(this.imperial ? c * 9 / 5 + 32 : c)}°`; },
  tempNum(c) { return this.imperial ? c * 9 / 5 + 32 : c; },
  speed(kmh) { return kmh == null ? "–" : this.imperial ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`; },
  precip(mm) {
    if (mm == null) return "–";
    return this.imperial ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`;
  },
  snow(cm) {
    if (cm == null) return "–";
    return this.imperial ? `${(cm / 2.54).toFixed(1)} in` : `${cm.toFixed(1)} cm`;
  },
  distance(m) {
    if (m == null) return "–";
    return this.imperial ? `${(m / 1609.34).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;
  },
  pressure(hpa) {
    if (hpa == null) return "–";
    return this.imperial ? `${(hpa * 0.02953).toFixed(2)} inHg` : `${Math.round(hpa)} hPa`;
  },
};

export function compass(deg) {
  if (deg == null) return "";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

export function aqiLevel(aqi) {
  if (aqi == null) return { label: "Unavailable", cls: "aqi-na" };
  if (aqi <= 50) return { label: "Good", cls: "aqi-good" };
  if (aqi <= 100) return { label: "Moderate", cls: "aqi-mod" };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", cls: "aqi-usg" };
  if (aqi <= 200) return { label: "Unhealthy", cls: "aqi-bad" };
  return { label: "Very unhealthy", cls: "aqi-vbad" };
}

export function uvLevel(uv) {
  if (uv == null) return "–";
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very high";
  return "Extreme";
}

/** Derived advisories from current + today's forecast (metric inputs). */
export function advisories(w) {
  const out = [];
  if (!w?.current) return out;
  const c = w.current, d = w.daily;
  const code = c.weather_code;
  if (code >= 95) out.push({ kind: "storm", label: "Thunderstorms" });
  if (d?.temperature_2m_max?.[0] >= 38) out.push({ kind: "heat", label: "Extreme heat" });
  else if (d?.temperature_2m_max?.[0] >= 32) out.push({ kind: "heat", label: "Heat" });
  if (d?.temperature_2m_min?.[0] <= -18) out.push({ kind: "cold", label: "Extreme cold" });
  else if (c.temperature_2m <= 0) out.push({ kind: "cold", label: "Freezing" });
  if (c.wind_gusts_10m >= 65) out.push({ kind: "wind", label: "High wind" });
  if ((d?.snowfall_sum?.[0] ?? 0) >= 5) out.push({ kind: "snow", label: "Heavy snow" });
  if ((d?.precipitation_sum?.[0] ?? 0) >= 25) out.push({ kind: "rain", label: "Heavy rain" });
  if ((d?.uv_index_max?.[0] ?? 0) >= 8) out.push({ kind: "uv", label: "High UV" });
  return out;
}

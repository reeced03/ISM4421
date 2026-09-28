import { PARKS, REGIONS, STATE_NAMES } from "./parks.js";
import {
  fetchOverview, fetchParkDetail, describeCode, weatherIcon, units,
  compass, aqiLevel, uvLevel, advisories,
} from "./weather.js";

const $ = (sel) => document.querySelector(sel);

const state = {
  data: null,
  view: "cards",
  search: "",
  region: "",
  sort: "name",
  favOnly: false,
  advOnly: false,
  favorites: new Set(),
  map: null,
  markers: null,
  openId: null,
};

// ---------- Preferences (per-viewer, best effort) ----------
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem("prefs") || "{}");
    if (typeof p.imperial === "boolean") units.imperial = p.imperial;
    if (["cards", "map", "table"].includes(p.view)) state.view = p.view;
    if (Array.isArray(p.favorites)) state.favorites = new Set(p.favorites);
  } catch { /* ignore */ }
}
function savePrefs() {
  try {
    localStorage.setItem("prefs", JSON.stringify({
      imperial: units.imperial, view: state.view, favorites: [...state.favorites],
    }));
  } catch { /* ignore */ }
}

// ---------- Helpers ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const TEMP_STOPS = [
  [-20, [63, 95, 110]], [0, [94, 127, 143]], [10, [107, 127, 58]],
  [20, [160, 122, 44]], [30, [181, 97, 58]], [40, [140, 59, 36]],
];
function tempColor(c) {
  if (c == null) return "var(--sage)";
  if (c <= TEMP_STOPS[0][0]) return rgb(TEMP_STOPS[0][1]);
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    const [t0, c0] = TEMP_STOPS[i - 1];
    if (c <= t1) {
      const f = (c - t0) / (t1 - t0);
      return rgb(c0.map((v, j) => Math.round(v + (c1[j] - v) * f)));
    }
  }
  return rgb(TEMP_STOPS[TEMP_STOPS.length - 1][1]);
}
function rgb([r, g, b]) { return `rgb(${r}, ${g}, ${b})`; }

function hhmm(iso) {
  if (!iso) return "–";
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  if (!units.imperial) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function hourLabel(iso) {
  const h = Number(iso.slice(11, 13));
  if (!units.imperial) return `${String(h).padStart(2, "0")}:00`;
  return `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
}
function dayName(dateStr, i) {
  if (i === 0) return "Today";
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}
function daylight(rise, set) {
  if (!rise || !set) return null;
  const mins = (Date.parse(`${set}:00Z`) - Date.parse(`${rise}:00Z`)) / 60000;
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}
function localTime(w) {
  if (w?.utc_offset_seconds == null) return "";
  const d = new Date(Date.now() + w.utc_offset_seconds * 1000);
  const iso = d.toISOString();
  return `${hhmm(iso)} ${w.timezone_abbreviation ?? ""}`.trim();
}
function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  return `${mins} minutes ago`;
}

function weatherFor(id) { return state.data?.byId?.[id]; }

function chipsHTML(list) {
  if (!list.length) return "";
  return `<div class="chips">${list.map((a) => `<span class="chip chip-${a.kind}">${esc(a.label)}</span>`).join("")}</div>`;
}

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/></svg>';
const STAR_O = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

// ---------- Filtering & sorting ----------
function sortKey(p) {
  const w = weatherFor(p.id);
  const c = w?.current, d = w?.daily;
  switch (state.sort) {
    case "temp-desc": case "temp-asc": return c?.temperature_2m;
    case "wind-desc": return c?.wind_speed_10m;
    case "precip-desc": return d?.precipitation_probability_max?.[0];
    case "uv-desc": return d?.uv_index_max?.[0];
    case "est-asc": return p.est;
    default: return null;
  }
}

function matchesSearch(p, q) {
  const codes = p.states.split(", ");
  // A two-letter query is treated as a state code (so "UT" doesn't match "Southwest").
  if (q.length === 2 && STATE_NAMES[q.toUpperCase()]) return codes.includes(q.toUpperCase());
  const names = codes.map((c) => STATE_NAMES[c] ?? "").join(" ");
  return `${p.name} ${names} ${p.region}`.toLowerCase().includes(q);
}

function visibleParks() {
  const q = state.search.trim().toLowerCase();
  let list = PARKS.filter((p) => {
    if (state.region && p.region !== state.region) return false;
    if (state.favOnly && !state.favorites.has(p.id)) return false;
    if (state.advOnly && !advisories(weatherFor(p.id)).length) return false;
    if (q && !matchesSearch(p, q)) return false;
    return true;
  });
  if (state.sort !== "name") {
    const asc = state.sort.endsWith("-asc");
    list = [...list].sort((a, b) => {
      const ka = sortKey(a), kb = sortKey(b);
      if (ka == null && kb == null) return a.name.localeCompare(b.name);
      if (ka == null) return 1;
      if (kb == null) return -1;
      return asc ? ka - kb : kb - ka;
    });
  }
  return list;
}

// ---------- Summary stats ----------
function renderStats() {
  const el = $("#stats");
  if (!state.data) {
    el.innerHTML = Array.from({ length: 6 }, () => '<div class="stat skeleton" style="min-height:96px"></div>').join("");
    return;
  }
  const rows = PARKS.map((p) => ({ p, w: weatherFor(p.id) })).filter((r) => r.w?.current);
  const pick = (fn, dir = 1) => rows.reduce((best, r) => {
    const v = fn(r.w);
    if (v == null) return best;
    return !best || (v - best.v) * dir > 0 ? { ...r, v } : best;
  }, null);

  const warm = pick((w) => w.current.temperature_2m, 1);
  const cold = pick((w) => w.current.temperature_2m, -1);
  const wind = pick((w) => w.current.wind_gusts_10m, 1);
  const wet = pick((w) => w.daily?.precipitation_sum?.[0], 1);
  const withAdv = rows.filter((r) => advisories(r.w).length).length;
  const wetNow = rows.filter((r) => r.w.current.precipitation > 0).length;

  const tile = (label, value, sub, accent, id) => `
    <button type="button" class="stat" style="--accent:${accent}" ${id ? `data-open="${id}"` : `data-adv="1"`}>
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub">${esc(sub)}</div>
    </button>`;

  el.innerHTML = [
    warm && tile("Warmest now", units.temp(warm.v), warm.p.name, "var(--clay)", warm.p.id),
    cold && tile("Coldest now", units.temp(cold.v), cold.p.name, "var(--slate)", cold.p.id),
    wind && tile("Strongest gusts", units.speed(wind.v), wind.p.name, "var(--bark)", wind.p.id),
    wet && tile("Wettest today", units.precip(wet.v), wet.p.name, "var(--moss)", wet.p.id),
    tile("Parks with advisories", `${withAdv}<small style="font-size:15px;color:var(--muted)"> / ${rows.length}</small>`, "Heat, cold, wind, storms, UV", "var(--ochre)"),
    tile("Rain or snow now", `${wetNow}`, wetNow === 1 ? "park reporting precipitation" : "parks reporting precipitation", "var(--forest)"),
  ].filter(Boolean).join("");
}

// ---------- Cards ----------
function cardHTML(p) {
  const w = weatherFor(p.id);
  const fav = state.favorites.has(p.id);
  const favBtn = `<button type="button" class="fav-btn" data-fav="${p.id}" aria-pressed="${fav}" aria-label="${fav ? "Remove" : "Add"} ${esc(p.name)} ${fav ? "from" : "to"} favorites">${fav ? STAR : STAR_O}</button>`;
  if (!w?.current) {
    return `<article class="card">${favBtn}<div class="card-band"></div><button type="button" class="card-open" data-open="${p.id}">
      <div class="card-head"><div><div class="card-name">${esc(p.name)}</div><div class="card-meta">${esc(p.states)} · ${esc(p.region)}</div></div></div>
      <p class="card-cond" style="margin-top:14px">Weather unavailable</p></button></article>`;
  }
  const c = w.current, d = w.daily;
  const { label } = describeCode(c.weather_code);
  const week = d.time.slice(0, 5).map((t, i) => `
    <div class="mini-day">${i === 0 ? "Today" : dayName(t, i)}${weatherIcon(d.weather_code[i], 1, 20)}
      <b>${units.temp(d.temperature_2m_max[i])}</b>${units.temp(d.temperature_2m_min[i])}</div>`).join("");
  return `<article class="card" style="--temp:${tempColor(c.temperature_2m)}">
    ${favBtn}
    <div class="card-band"></div>
    <button type="button" class="card-open" data-open="${p.id}" aria-label="${esc(p.name)}: ${units.temp(c.temperature_2m)}, ${esc(label)}. Open details">
      <div class="card-head">
        <div>
          <div class="card-name">${esc(p.name)}</div>
          <div class="card-meta">${esc(p.states)} · ${esc(p.region)} · ${localTime(w)}</div>
        </div>
      </div>
      <div class="card-now">
        ${weatherIcon(c.weather_code, c.is_day, 44)}
        <div class="card-temp">${units.temp(c.temperature_2m)}</div>
        <div class="card-cond">${esc(label)}<small>Feels ${units.temp(c.apparent_temperature)} · H ${units.temp(d.temperature_2m_max[0])} L ${units.temp(d.temperature_2m_min[0])}</small></div>
      </div>
      ${chipsHTML(advisories(w))}
      <div class="mini-week">${week}</div>
      <div class="card-facts">
        <div>Wind<b>${units.speed(c.wind_speed_10m)} ${compass(c.wind_direction_10m)}</b></div>
        <div>Precip<b>${d.precipitation_probability_max?.[0] ?? "–"}%</b></div>
        <div>Humidity<b>${c.relative_humidity_2m ?? "–"}%</b></div>
      </div>
    </button>
  </article>`;
}

function renderCards(list) {
  const el = $("#view-cards");
  if (!state.data) {
    el.innerHTML = Array.from({ length: 12 }, () => '<div class="card skeleton"></div>').join("");
    return;
  }
  el.innerHTML = list.length ? list.map(cardHTML).join("") : '<p class="empty">No parks match those filters.</p>';
}

// ---------- Table ----------
function renderTable(list) {
  const body = $("#table-body");
  if (!state.data) { body.innerHTML = ""; return; }
  body.innerHTML = list.map((p) => {
    const w = weatherFor(p.id);
    if (!w?.current) {
      return `<tr tabindex="0" data-open="${p.id}"><td class="t-name">${esc(p.name)}<small>${esc(p.states)}</small></td><td>${esc(p.region)}</td><td colspan="8">Unavailable</td></tr>`;
    }
    const c = w.current, d = w.daily;
    return `<tr tabindex="0" data-open="${p.id}" style="--temp:${tempColor(c.temperature_2m)}">
      <td class="t-name">${esc(p.name)}<small>${esc(p.states)}</small></td>
      <td>${esc(p.region)}</td>
      <td class="num"><span class="temp-dot"></span>${units.temp(c.temperature_2m)}</td>
      <td class="num">${units.temp(c.apparent_temperature)}</td>
      <td class="num">${units.temp(d.temperature_2m_max[0])} / ${units.temp(d.temperature_2m_min[0])}</td>
      <td><span class="t-cond">${weatherIcon(c.weather_code, c.is_day, 20)}${esc(describeCode(c.weather_code).label)}</span></td>
      <td class="num">${units.speed(c.wind_speed_10m)} ${compass(c.wind_direction_10m)}</td>
      <td class="num">${d.precipitation_probability_max?.[0] ?? "–"}%</td>
      <td class="num">${d.uv_index_max?.[0]?.toFixed(1) ?? "–"}</td>
      <td>${chipsHTML(advisories(w))}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="10" class="empty">No parks match those filters.</td></tr>';
}

// ---------- Map ----------
function ensureMap() {
  if (state.map || !window.L) return;
  const L = window.L;
  state.map = L.map("map", { worldCopyJump: true, zoomSnap: 0.25 });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 12,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(state.map);
  state.markers = L.layerGroup().addTo(state.map);
  // Frame Alaska through the lower 48 and the Caribbean; Hawaiʻi and Samoa are a pan away.
  state.map.fitBounds([[24, -165], [69, -64]], { padding: [10, 10] });
}

function renderMap(list) {
  if (state.view !== "map") return;
  ensureMap();
  if (!state.map) {
    $("#map").innerHTML = '<p class="empty">The map library could not be loaded.</p>';
    return;
  }
  const L = window.L;
  state.map.invalidateSize();
  state.markers.clearLayers();
  list.forEach((p) => {
    const w = weatherFor(p.id);
    const t = w?.current?.temperature_2m;
    const icon = L.divIcon({
      className: "",
      html: `<span class="temp-pin" style="--temp:${tempColor(t)}">${units.temp(t)}</span>`,
      iconSize: [0, 0],
    });
    L.marker([p.lat, p.lon], { icon, title: p.name, keyboard: true, alt: p.name })
      .bindTooltip(`<b>${esc(p.name)}</b><br>${w?.current ? esc(describeCode(w.current.weather_code).label) : "Unavailable"}`, { direction: "top", offset: [0, -10] })
      .on("click", () => openPark(p.id))
      .addTo(state.markers);
  });
  renderLegend();
}

function renderLegend() {
  const stops = [-20, -10, 0, 10, 20, 30, 40];
  const grad = stops.map((t, i) => `${tempColor(t)} ${(i / (stops.length - 1)) * 100}%`).join(", ");
  $("#legend").innerHTML = `<span>${units.temp(-20)}</span><span class="legend-bar" style="background:linear-gradient(90deg, ${grad})"></span><span>${units.temp(40)}+</span>`;
}

// ---------- Master render ----------
function render() {
  const list = visibleParks();
  $("#result-count").textContent = state.data
    ? `Showing ${list.length} of ${PARKS.length} national parks`
    : "";
  renderStats();
  $("#view-cards").hidden = state.view !== "cards";
  $("#view-map").hidden = state.view !== "map";
  $("#view-table").hidden = state.view !== "table";
  if (state.view === "cards") renderCards(list);
  if (state.view === "table") renderTable(list);
  if (state.view === "map") renderMap(list);
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === state.view));
  document.querySelectorAll("[data-units]").forEach((b) => b.setAttribute("aria-pressed", (b.dataset.units === "imperial") === units.imperial));
  if (state.data) $("#updated").textContent = `Updated ${timeAgo(state.data.fetchedAt)} · Open-Meteo forecast models`;
}

// ---------- Data loading ----------
async function load(force = false) {
  const btn = $("#refresh-btn");
  btn.classList.add("spinning");
  btn.disabled = true;
  $("#error").hidden = true;
  try {
    state.data = await fetchOverview(PARKS, { force });
    render();
    if (state.openId) renderDetail(state.openId);
  } catch (err) {
    console.error(err);
    const box = $("#error");
    box.innerHTML = `<span>Couldn't load weather from Open-Meteo. ${esc(err.message)}</span><button type="button" id="retry">Try again</button>`;
    box.hidden = false;
    $("#retry").addEventListener("click", () => load(true));
    if (!state.data) $("#updated").textContent = "Weather data unavailable.";
  } finally {
    btn.classList.remove("spinning");
    btn.disabled = false;
  }
}

// ---------- Detail dialog ----------
function openPark(id) {
  const p = PARKS.find((x) => x.id === id);
  if (!p) return;
  state.openId = id;
  renderDetail(id);
  const dlg = $("#detail");
  if (!dlg.open) dlg.showModal();
  if (location.hash !== `#park=${id}`) history.replaceState(null, "", `#park=${id}`);
}

function closePark() {
  state.openId = null;
  const dlg = $("#detail");
  if (dlg.open) dlg.close();
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function renderDetail(id) {
  const p = PARKS.find((x) => x.id === id);
  const w = weatherFor(id);
  const body = $("#detail-body");
  const fav = state.favorites.has(p.id);

  let hero = `<div class="detail-hero">
    <button type="button" class="close" data-close aria-label="Close">×</button>
    <h2 id="detail-title">${esc(p.name)} National Park</h2>
    <p>${esc(p.states)} · ${esc(p.region)} · Established ${p.est}${w ? ` · Local time ${localTime(w)}` : ""}</p>
    <p>${esc(p.blurb)}</p>`;
  if (w?.current) {
    const c = w.current;
    hero += `<div class="detail-now">
      ${weatherIcon(c.weather_code, c.is_day, 56)}
      <div class="big">${units.temp(c.temperature_2m)}</div>
      <div class="cond">${esc(describeCode(c.weather_code).label)}<small>Feels like ${units.temp(c.apparent_temperature)} · High ${units.temp(w.daily.temperature_2m_max[0])} · Low ${units.temp(w.daily.temperature_2m_min[0])}</small></div>
    </div>${chipsHTML(advisories(w))}`;
  }
  hero += `</div>`;

  if (!w?.current) {
    body.innerHTML = `${hero}<div class="detail-section"><p class="loading-line">Weather is unavailable for this park right now.</p></div>`;
    return;
  }

  const c = w.current, d = w.daily;
  const facts = [
    ["Wind", `${units.speed(c.wind_speed_10m)} ${compass(c.wind_direction_10m)}`, `Gusts ${units.speed(c.wind_gusts_10m)}`],
    ["Humidity", `${c.relative_humidity_2m}%`, `Cloud cover ${c.cloud_cover}%`],
    ["Pressure", units.pressure(c.pressure_msl), "Sea level"],
    ["UV index", d.uv_index_max?.[0]?.toFixed(1) ?? "–", uvLevel(d.uv_index_max?.[0])],
    ["Precip today", units.precip(d.precipitation_sum?.[0]), `${d.precipitation_probability_max?.[0] ?? "–"}% chance`],
    ["Snow today", units.snow(d.snowfall_sum?.[0]), "Accumulation"],
    ["Sunrise", hhmm(d.sunrise?.[0]), "Local time"],
    ["Sunset", hhmm(d.sunset?.[0]), daylight(d.sunrise?.[0], d.sunset?.[0]) ? `${daylight(d.sunrise[0], d.sunset[0])} of daylight` : "Polar day/night"],
  ];

  const allMax = Math.max(...d.temperature_2m_max), allMin = Math.min(...d.temperature_2m_min);
  const span = Math.max(1, allMax - allMin);
  const week = d.time.map((t, i) => {
    const left = ((d.temperature_2m_min[i] - allMin) / span) * 100;
    const width = ((d.temperature_2m_max[i] - d.temperature_2m_min[i]) / span) * 100;
    return `<div class="day">
      <div class="dname">${dayName(t, i)}</div>
      ${weatherIcon(d.weather_code[i], 1, 30)}
      <div class="hi">${units.temp(d.temperature_2m_max[i])}</div>
      <div class="lo">${units.temp(d.temperature_2m_min[i])}</div>
      <div class="range-bar"><i style="left:${left}%;width:${Math.max(width, 4)}%;background:linear-gradient(90deg, ${tempColor(d.temperature_2m_min[i])}, ${tempColor(d.temperature_2m_max[i])})"></i></div>
      <div class="pp">${d.precipitation_probability_max?.[i] ?? 0}% · ${units.speed(d.wind_speed_10m_max?.[i])}</div>
    </div>`;
  }).join("");

  body.innerHTML = `${hero}
    <div class="detail-section">
      <h3>Right now</h3>
      <div class="facts" id="facts">
        ${facts.map(([k, v, s]) => `<div class="fact"><span>${k}</span><b>${v}</b><small>${esc(s)}</small></div>`).join("")}
        <div class="fact" id="aqi-fact"><span>Air quality</span><b class="aqi-na">…</b><small>US AQI</small></div>
      </div>
    </div>
    <div class="detail-section">
      <h3>Next 48 hours</h3>
      <div class="chart-wrap" id="hourly"><p class="loading-line" style="padding:8px">Loading hourly forecast…</p></div>
    </div>
    <div class="detail-section">
      <h3>7-day forecast</h3>
      <div class="week">${week}</div>
    </div>
    <div class="detail-section detail-links">
      <button type="button" class="seg-btn" data-fav="${p.id}" aria-pressed="${fav}" style="border:1px solid var(--line)">${fav ? "★ Favorited" : "☆ Add to favorites"}</button>
      <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=9/${p.lat}/${p.lon}" target="_blank" rel="noopener">View on map ↗</a>
      <a href="https://www.nps.gov/findapark/index.htm" target="_blank" rel="noopener">NPS alerts &amp; closures ↗</a>
    </div>`;

  fetchParkDetail(p).then((det) => {
    if (state.openId !== id) return;
    renderAqi(det.air);
    renderHourly(det.forecast);
  }).catch((err) => {
    if (state.openId !== id) return;
    const h = $("#hourly");
    if (h) h.innerHTML = `<p class="loading-line" style="padding:8px">Hourly forecast unavailable: ${esc(err.message)}</p>`;
    renderAqi(null);
  });
}

function renderAqi(air) {
  const el = $("#aqi-fact");
  if (!el) return;
  const aqi = air?.current?.us_aqi;
  const lvl = aqiLevel(aqi);
  el.innerHTML = `<span>Air quality</span><b class="${lvl.cls}">${aqi ?? "–"}</b><small>${esc(lvl.label)}${air?.current?.pm2_5 != null ? ` · PM2.5 ${air.current.pm2_5.toFixed(0)} µg/m³` : ""}</small>`;
}

function renderHourly(f) {
  const wrap = $("#hourly");
  if (!wrap) return;
  const h = f.hourly;
  const nowKey = new Date(Date.now() + f.utc_offset_seconds * 1000).toISOString().slice(0, 13);
  let start = h.time.findIndex((t) => t.slice(0, 13) === nowKey);
  if (start < 0) start = 0;
  const n = Math.min(48, h.time.length - start);
  const idx = Array.from({ length: n }, (_, i) => start + i);
  const temps = idx.map((i) => units.tempNum(h.temperature_2m[i]));
  const probs = idx.map((i) => h.precipitation_probability?.[i] ?? 0);

  // Draw at the container's real width so labels stay legible on phones.
  const W = Math.max(300, Math.round(wrap.clientWidth - 12) || 800);
  const H = 230, L = 36, R = 10, T = 16, TB = 150, BT = 168, BB = 204;
  const labelEvery = W < 560 ? 12 : 6;
  const tMin = Math.floor(Math.min(...temps) - 2), tMax = Math.ceil(Math.max(...temps) + 2);
  const x = (i) => L + (i / Math.max(1, n - 1)) * (W - L - R);
  const y = (t) => TB - ((t - tMin) / Math.max(1, tMax - tMin)) * (TB - T);
  const line = temps.map((t, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(t).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)},${TB}L${x(0).toFixed(1)},${TB}Z`;
  const bw = Math.max(2, (W - L - R) / n - 2);
  const bars = probs.map((pp, i) => {
    const bh = (pp / 100) * (BB - BT);
    return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(BB - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="var(--slate)" opacity=".75"/>`;
  }).join("");

  const ticks = [];
  const step = (tMax - tMin) > 20 ? 10 : 5;
  for (let t = Math.ceil(tMin / step) * step; t <= tMax; t += step) {
    ticks.push(`<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(t)}°</text>`);
  }
  const xLabels = idx.map((hi, i) => {
    const hr = Number(h.time[hi].slice(11, 13));
    if (hr === 0) {
      return `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${BB}" stroke="var(--line)"/><text x="${x(i) + 4}" y="${T + 10}" font-size="11" font-weight="600" fill="var(--ink-2)">${new Date(`${h.time[hi].slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</text>`;
    }
    if (hr % labelEvery === 0) return `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${hourLabel(h.time[hi])}</text>`;
    return "";
  }).join("");

  wrap.innerHTML = `
    <div class="chart-legend"><span><i style="background:var(--clay)"></i>Temperature</span><span><i style="background:var(--slate)"></i>Precipitation chance</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly temperature and precipitation chance for the next ${n} hours">
      <defs><linearGradient id="tg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--clay)" stop-opacity=".28"/><stop offset="1" stop-color="var(--clay)" stop-opacity="0"/></linearGradient></defs>
      ${ticks.join("")}
      ${xLabels}
      <text x="${L - 6}" y="${BT + 8}" text-anchor="end" font-size="10" fill="var(--muted)">100%</text>
      <line x1="${L}" x2="${W - R}" y1="${BB}" y2="${BB}" stroke="var(--line)"/>
      ${bars}
      <path d="${area}" fill="url(#tg)"/>
      <path d="${line}" fill="none" stroke="var(--clay)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <g id="cursor" visibility="hidden">
        <line id="cur-line" y1="${T}" y2="${BB}" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 3"/>
        <circle id="cur-dot" r="4.5" fill="var(--surface)" stroke="var(--clay)" stroke-width="2.5"/>
      </g>
      <rect id="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>
    </svg>
    <div class="chart-readout" id="readout">Hover or tap the chart for hourly details.</div>`;

  const svg = wrap.querySelector("svg");
  const cursor = svg.querySelector("#cursor");
  const readout = wrap.querySelector("#readout");
  const show = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    const hi = idx[i];
    cursor.setAttribute("visibility", "visible");
    svg.querySelector("#cur-line").setAttribute("x1", x(i));
    svg.querySelector("#cur-line").setAttribute("x2", x(i));
    svg.querySelector("#cur-dot").setAttribute("cx", x(i));
    svg.querySelector("#cur-dot").setAttribute("cy", y(temps[i]));
    const when = new Date(`${h.time[hi].slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    readout.textContent = `${when} ${hourLabel(h.time[hi])} · ${units.temp(h.temperature_2m[hi])} · ${describeCode(h.weather_code[hi]).label} · ${probs[i]}% precip · Wind ${units.speed(h.wind_speed_10m[hi])}${h.visibility?.[hi] != null ? ` · Visibility ${units.distance(h.visibility[hi])}` : ""}`;
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", () => cursor.setAttribute("visibility", "hidden"));
}

// ---------- Events ----------
function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  savePrefs();
  render();
  if (state.openId) renderDetail(state.openId);
}

function bind() {
  const regionSel = $("#region");
  REGIONS.forEach((r) => regionSel.insertAdjacentHTML("beforeend", `<option value="${esc(r)}">${esc(r)}</option>`));

  $("#search").addEventListener("input", (e) => { state.search = e.target.value; render(); });
  regionSel.addEventListener("change", (e) => { state.region = e.target.value; render(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("#fav-only").addEventListener("change", (e) => { state.favOnly = e.target.checked; render(); });
  $("#adv-only").addEventListener("change", (e) => { state.advOnly = e.target.checked; render(); });
  $("#refresh-btn").addEventListener("click", () => load(true));

  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    state.view = b.dataset.view; savePrefs(); render();
  }));
  document.querySelectorAll("[data-units]").forEach((b) => b.addEventListener("click", () => {
    units.imperial = b.dataset.units === "imperial"; savePrefs(); render();
    if (state.openId) renderDetail(state.openId);
  }));

  $("#theme-btn").addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme")
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch { /* ignore */ }
  });

  // Delegated clicks: open park, toggle favorite, stat tiles, close dialog.
  document.addEventListener("click", (e) => {
    const fav = e.target.closest("[data-fav]");
    if (fav) { e.preventDefault(); toggleFavorite(fav.dataset.fav); return; }
    if (e.target.closest("[data-close]")) { closePark(); return; }
    const adv = e.target.closest("[data-adv]");
    if (adv) {
      state.advOnly = true; $("#adv-only").checked = true; render();
      $("#result-count").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) openPark(open.dataset.open);
  });
  $("#table-body").addEventListener("keydown", (e) => {
    const row = e.target.closest("tr[data-open]");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPark(row.dataset.open); }
  });

  const dlg = $("#detail");
  dlg.addEventListener("close", () => { if (state.openId) closePark(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closePark(); });

  window.addEventListener("hashchange", openFromHash);
  // Keep "Updated N minutes ago" fresh; refetch once the cache is stale.
  setInterval(() => {
    if (!state.data) return;
    if (Date.now() - state.data.fetchedAt > 15 * 60 * 1000) load(true);
    else $("#updated").textContent = `Updated ${timeAgo(state.data.fetchedAt)} · Open-Meteo forecast models`;
  }, 60 * 1000);
}

function openFromHash() {
  const m = location.hash.match(/^#park=([\w-]+)$/);
  if (m && PARKS.some((p) => p.id === m[1])) openPark(m[1]);
}

loadPrefs();
bind();
render();
load().then(openFromHash);

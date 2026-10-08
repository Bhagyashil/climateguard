const { assess: assessRisk } = window.RiskEngine;
 
const $ = (id) => document.getElementById(id);
const HISTORY_KEY = "climateguard:history";
 
/* ---------- Data ---------- */
 
// Set in config.js. When empty, the dashboard fetches weather directly (local mode).
const API = (window.CLIMATEGUARD_API || "").replace(/\/$/, "");
 
async function fetchFromApi(city) {
  let res;
  try {
    res = await fetch(`${API}/risk?city=${encodeURIComponent(city)}`);
  } catch {
    throw new Error("Could not reach the ClimateGuard service. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}
 
async function geocode(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not look up that city. Try again in a moment.");
  const data = await res.json();
  if (!data.results || !data.results.length) {
    throw new Error(`No city found for "${city}". Check the spelling or add the state, for example "Nashik, Maharashtra".`);
  }
  const p = data.results[0];
  return { name: p.name, region: p.admin1 || "", country: p.country || "", lat: p.latitude, lon: p.longitude };
}
 
async function fetchWeather(lat, lon) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature" +
    "&hourly=precipitation&past_days=1&forecast_days=2&timezone=auto";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather service is not responding. Try again in a moment.");
  const d = await res.json();
 
  // Find the current hour inside the hourly series, then sum 24 h either side.
  const nowKey = d.current.time.slice(0, 13) + ":00";
  let i = d.hourly.time.indexOf(nowKey);
  if (i < 0) i = 24;
  const sum = (a, b) => d.hourly.precipitation.slice(a, b).reduce((s, v) => s + (v || 0), 0);
 
  return {
    temperature: d.current.temperature_2m,
    apparentTemperature: d.current.apparent_temperature,
    humidity: d.current.relative_humidity_2m,
    rainPast24: Math.round(sum(Math.max(0, i - 24), i) * 10) / 10,
    rainNext24: Math.round(sum(i, i + 24) * 10) / 10,
  };
}
 
/* ---------- Rendering ---------- */
 
function setMessage(text) {
  const el = $("message");
  el.textContent = text || "";
  el.hidden = !text;
}
 
function render(place, w, r) {
  const label = [place.name, place.region].filter(Boolean).join(", ");
  $("where").textContent = label;
  $("overall").dataset.level = r.overall;
  $("overallLevel").textContent = r.overall;
 
  for (const [key, risk] of [["heat", r.heat], ["flood", r.flood]]) {
    $(`${key}Meter`).dataset.level = risk.level;
    $(`${key}Level`).textContent = risk.level;
    $(`${key}Score`).textContent = risk.score;
    $(`${key}Marker`).style.left = `${risk.score}%`;
  }
 
  $("temp").textContent = `${Math.round(w.temperature)}°C`;
  $("feels").textContent = `${Math.round(w.apparentTemperature)}°C`;
  $("humidity").textContent = `${Math.round(w.humidity)}%`;
  $("rainPast").textContent = `${w.rainPast24} mm`;
  $("rainNext").textContent = `${w.rainNext24} mm`;
 
  $("tips").innerHTML = "";
  for (const t of r.tips) {
    const li = document.createElement("li");
    li.textContent = t;
    $("tips").appendChild(li);
  }
  document.querySelector(".advice").dataset.level = r.overall;
  $("result").hidden = false;
}
 
/* ---------- History (localStorage now, DynamoDB in Phase 6) ---------- */
 
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function saveHistory(entry) {
  const list = loadHistory().filter((h) => h.city !== entry.city);
  list.unshift(entry);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* storage unavailable */ }
  renderHistory();
}
function renderHistory() {
  const list = loadHistory();
  $("historyBox").hidden = list.length === 0;
  const ul = $("history");
  ul.innerHTML = "";
  for (const h of list) {
    const li = document.createElement("li");
    li.dataset.level = h.overall;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = h.city;
    btn.addEventListener("click", () => { $("city").value = h.city; check(h.city); });
    const right = document.createElement("span");
    right.innerHTML = `<span class="tag">${h.overall}</span> <span class="when">${new Date(h.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>`;
    li.append(btn, right);
    ul.appendChild(li);
  }
}
 
/* ---------- Flow ---------- */
 
async function check(city) {
  setMessage("");
  $("go").disabled = true;
  $("go").textContent = "Checking…";
  try {
    let place, weather, result;
    if (API) {
      ({ place, weather, risk: result } = await fetchFromApi(city));
    } else {
      place = await geocode(city);
      weather = await fetchWeather(place.lat, place.lon);
      result = assessRisk(weather);
    }
    render(place, weather, result);
    saveHistory({ city: place.name, overall: result.overall, time: Date.now() });
  } catch (err) {
    $("result").hidden = true;
    setMessage(err.message || "Something went wrong. Try again.");
  } finally {
    $("go").disabled = false;
    $("go").textContent = "Check risk";
  }
}
 
$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const city = $("city").value.trim();
  if (city) check(city);
});
 
renderHistory();
/**
 * AWS Lambda entry point for ClimateGuard.
 * Route: GET /risk?city=Nagpur
 * Runtime: Node.js 20.x (has global fetch, no dependencies needed).
 */
const { assess } = require("./risk-engine");
const history = require("./history");

const HEADERS = {
  "Content-Type": "application/json",
  // Lock this down to your CloudFront domain once the frontend is deployed.
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
};

function respond(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getJson(url, failMessage) {
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(502, failMessage);
  return res.json();
}

async function geocode(city) {
  const data = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`,
    "City lookup service is not responding."
  );
  if (!data.results || !data.results.length) {
    throw new HttpError(404, `No city found for "${city}". Check the spelling or add the state.`);
  }
  const p = data.results[0];
  return { name: p.name, region: p.admin1 || "", country: p.country || "", lat: p.latitude, lon: p.longitude };
}

async function fetchWeather(lat, lon) {
  const d = await getJson(
    "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lat}&longitude=${lon}` +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature" +
      "&hourly=precipitation&past_days=1&forecast_days=2&timezone=auto",
    "Weather service is not responding."
  );

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

exports.handler = async (event) => {
  const city = (event && event.queryStringParameters && event.queryStringParameters.city || "").trim();

  if (!city) return respond(400, { error: "Add a city, for example ?city=Nagpur." });
  if (city.length > 80) return respond(400, { error: "City name is too long." });

  try {
    const place = await geocode(city);
    const weather = await fetchWeather(place.lat, place.lon);
    const risk = assess(weather);
    const checkedAt = new Date().toISOString();

    console.log(JSON.stringify({ event: "risk_checked", city: place.name, overall: risk.overall }));

    // History is a bonus: if DynamoDB fails, the person still gets their risk result.
    let recent = [];
    try {
      await history.save(place, {
        checkedAt,
        overall: risk.overall,
        heatScore: risk.heat.score,
        heatLevel: risk.heat.level,
        floodScore: risk.flood.score,
        floodLevel: risk.flood.level,
        temperature: weather.temperature,
        rainPast24: weather.rainPast24,
      });
      recent = await history.list(place, 10);
    } catch (err) {
      console.error(JSON.stringify({ event: "history_error", city: place.name, message: err.message }));
    }

    return respond(200, { place, weather, risk, checkedAt, history: recent });
  } catch (err) {
    const status = err.status || 500;
    console.error(JSON.stringify({ event: "risk_error", city, status, message: err.message }));
    return respond(status, { error: status === 500 ? "Something went wrong. Try again." : err.message });
  }
};
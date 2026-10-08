/**
 * ClimateGuard risk engine.
 * Pure functions, no network calls, so it runs in the browser now
 * and inside AWS Lambda later without changes.
 */

const LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function clamp(n, min = 0, max = 100) {
  return Math.min(max, Math.max(min, n));
}

function levelFor(score) {
  if (score < 25) return "LOW";
  if (score < 50) return "MEDIUM";
  if (score < 75) return "HIGH";
  return "CRITICAL";
}

/**
 * Heat score from "feels like" temperature (°C), which already
 * accounts for humidity. 28°C feels-like = 0, 50°C = 100.
 */
function heatScore(apparentTempC) {
  return Math.round(clamp(((apparentTempC - 28) / (50 - 28)) * 100));
}

/**
 * Flood score from rain that already fell (last 24h) plus half the
 * rain forecast for the next 24h, in mm. 150 mm effective = 100.
 */
function floodScore(rainPast24mm, rainNext24mm) {
  const effective = rainPast24mm + 0.5 * rainNext24mm;
  return Math.round(clamp((effective / 150) * 100));
}

function overallLevel(heatLevel, floodLevel) {
  return LEVELS[Math.max(LEVELS.indexOf(heatLevel), LEVELS.indexOf(floodLevel))];
}

function recommendations(heat, flood, overall) {
  const tips = [];

  if (heat.level === "CRITICAL") {
    tips.push("Stay indoors between 11 AM and 5 PM. Heatstroke risk is severe.");
    tips.push("Drink water every 20–30 minutes, even if you are not thirsty.");
    tips.push("Check on elderly neighbours, children and outdoor workers.");
  } else if (heat.level === "HIGH") {
    tips.push("Avoid outdoor activity between 12 PM and 4 PM.");
    tips.push("Stay hydrated and wear light, loose cotton clothing.");
  } else if (heat.level === "MEDIUM") {
    tips.push("Carry water and take breaks in the shade if you work outdoors.");
  }

  if (flood.level === "CRITICAL") {
    tips.push("Avoid low-lying roads and underpasses. Do not drive through flowing water.");
    tips.push("Move vehicles and valuables to higher ground.");
    tips.push("Follow local emergency advisories and keep a charged phone and torch ready.");
  } else if (flood.level === "HIGH") {
    tips.push("Expect waterlogging. Avoid low-lying roads and plan a longer commute.");
    tips.push("Keep important documents and electronics off the floor.");
  } else if (flood.level === "MEDIUM") {
    tips.push("Check the forecast before travelling. Some roads may collect water.");
  }

  if (tips.length === 0) {
    tips.push("No major heat or flood risk right now. Check back if conditions change.");
  }
  return tips;
}

/**
 * @param {{temperature:number, apparentTemperature:number, humidity:number,
 *          rainPast24:number, rainNext24:number}} w
 */
function assess(w) {
  const heat = { score: heatScore(w.apparentTemperature) };
  heat.level = levelFor(heat.score);

  const flood = { score: floodScore(w.rainPast24, w.rainNext24) };
  flood.level = levelFor(flood.score);

  const overall = overallLevel(heat.level, flood.level);
  return { heat, flood, overall, tips: recommendations(heat, flood, overall) };
}

const RiskEngine = { assess, heatScore, floodScore, levelFor, overallLevel };

if (typeof module !== "undefined" && module.exports) {
  module.exports = RiskEngine; // Node / Lambda
} else {
  window.RiskEngine = RiskEngine; // Browser
}

const assert = require("node:assert");
const { assess } = require("./risk-engine");

// Hot, dry day (your Nagpur example)
let r = assess({ temperature: 43, apparentTemperature: 43, humidity: 31, rainPast24: 2, rainNext24: 0 });
assert.strictEqual(r.heat.level, "HIGH");
assert.strictEqual(r.flood.level, "LOW");
assert.strictEqual(r.overall, "HIGH");

// Heavy rain (your 145 mm example)
r = assess({ temperature: 26, apparentTemperature: 28, humidity: 95, rainPast24: 145, rainNext24: 40 });
assert.strictEqual(r.heat.level, "LOW");
assert.strictEqual(r.flood.level, "CRITICAL");
assert.strictEqual(r.overall, "CRITICAL");

// Calm day
r = assess({ temperature: 24, apparentTemperature: 24, humidity: 50, rainPast24: 0, rainNext24: 0 });
assert.strictEqual(r.overall, "LOW");

// Scores stay inside 0-100
r = assess({ temperature: 60, apparentTemperature: 70, humidity: 10, rainPast24: 900, rainNext24: 500 });
assert.ok(r.heat.score <= 100 && r.flood.score <= 100);

console.log("All risk-engine tests passed");

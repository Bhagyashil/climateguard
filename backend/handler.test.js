const assert = require("node:assert");

// Mock the network so the test is fast, offline and repeatable in CI.
const hours = Array.from({ length: 72 }, (_, h) => {
  const d = new Date(Date.UTC(2026, 9, 7, 0, 0) + h * 3600 * 1000);
  return d.toISOString().slice(0, 16);
});

global.fetch = async (url) => {
  const ok = (json) => ({ ok: true, json: async () => json });
  if (url.includes("geocoding-api")) {
    if (url.includes("Nowhereville")) return ok({});
    return ok({ results: [{ name: "Nagpur", admin1: "Maharashtra", country: "India", latitude: 21.15, longitude: 79.09 }] });
  }
  return ok({
    current: { time: hours[30], temperature_2m: 43, relative_humidity_2m: 31, apparent_temperature: 43 },
    hourly: { time: hours, precipitation: hours.map(() => 0) },
  });
};

const { handler } = require("./handler");

(async () => {
  // Happy path
  let res = await handler({ queryStringParameters: { city: "Nagpur" } });
  assert.strictEqual(res.statusCode, 200);
  let body = JSON.parse(res.body);
  assert.strictEqual(body.place.name, "Nagpur");
  assert.strictEqual(body.risk.heat.level, "HIGH");
  assert.strictEqual(body.risk.overall, "HIGH");
  assert.strictEqual(res.headers["Access-Control-Allow-Origin"], "*");

  // Missing city
  res = await handler({ queryStringParameters: {} });
  assert.strictEqual(res.statusCode, 400);

  // No query string at all
  res = await handler({});
  assert.strictEqual(res.statusCode, 400);

  // Unknown city
  res = await handler({ queryStringParameters: { city: "Nowhereville" } });
  assert.strictEqual(res.statusCode, 404);

  // History is saved and returned
  const store = require("./history");
  const saved = [];
  store.save = async (place, entry) => saved.push({ place, entry });
  store.list = async () => [{ checkedAt: "2026-10-09T10:00:00.000Z", overall: "HIGH" }];
  res = await handler({ queryStringParameters: { city: "Nagpur" } });
  body = JSON.parse(res.body);
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].entry.overall, "HIGH");
  assert.strictEqual(body.history.length, 1);

  // A DynamoDB failure must not break the risk result
  store.save = async () => { throw new Error("dynamo down"); };
  res = await handler({ queryStringParameters: { city: "Nagpur" } });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(res.body).history, []);

  console.log("All handler tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
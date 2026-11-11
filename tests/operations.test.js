const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../app/scripts/operations");
const now = Date.now(), source = "esp32-wifi";
const reading = overrides => ({ value: 0, status: "info", source, timestamp: new Date(now).toISOString(), ...overrides });

test("operator UI never substitutes demo, stale or invalid readings", () => {
  assert.equal(O.visibleReading(reading(), source, now).value, 0);
  for (const entry of [reading({ source: "mock-backend" }), reading({ timestamp: new Date(now - 16000).toISOString() }),
    reading({ timestamp: new Date(now + 6000).toISOString() }), reading({ value: 27.96, status: "error" })]) {
    assert.equal(O.visibleReading(entry, source, now).value, null);
  }
  assert.equal(O.visibleReading(reading(), "mock-backend", now).value, null);
  assert.ok(Object.values(O.offlinePayload().snapshot).every(r => r.value === null));
  assert.equal(O.offlinePayload().actuators.length, 0);
});

test("estimated EC and uncalibrated TDS remain qualified measurements", () => {
  assert.equal(O.visibleReading(reading({ status: "estimated" }), source, now).value, 0);
  assert.equal(O.readingState({ status: "estimated" }).label, "Estimada");
  assert.equal(O.readingState({ status: "uncalibrated-reading" }).label, "Sin calibrar");
  assert.notEqual(O.readingState({ status: "uncalibrated" }).tone, "ok");
});

test("summary deduplicates current issues and unknown pump state never becomes off", () => {
  const sensors = O.SENSORS;
  const snapshot = Object.fromEntries(sensors.map(s => [s.id, reading({ status: "ok", value: 23 })]));
  snapshot["water-ph"] = reading({ value: 27.96, status: "error" });
  snapshot["water-ec"] = reading({ value: 2, status: "estimated" });
  snapshot["air-humidity"] = reading({ value: 45, status: "critical" });
  const pump = { id: "relay-39", active: false, timestamp: new Date(now).toISOString() };
  const result = O.summarize(sensors, snapshot, source, [pump], now);
  assert.equal(result.total, 15); assert.equal(result.available, 14);
  assert.equal(result.outside.length, 1); assert.equal(result.quality.length, 2);
  assert.equal(result.issues.length, 3); assert.equal(result.pumpCount, 0);
  const levelFaults = { ...snapshot, "distance-5": reading({ value: null, status: "error" }), "water-level": reading({ value: null, status: "uncalibrated" }) };
  const all = O.summarize(sensors, levelFaults, source, [pump], now);
  assert.equal(all.quality.length, 4); assert.equal(all.issues.length, 5);
  for (const pumps of [[], [{ ...pump, active: null }], [{ ...pump, stale: true }], [{ ...pump, timestamp: null }]]) {
    assert.equal(O.summarize(sensors, snapshot, source, pumps, now).pumpCount, null);
  }
});

test("history statistics preserve zero and ignore foreign sources and invalid pH", () => {
  const points = [reading({ value: 8 }), reading({ value: 27.96, status: "error" }),
    reading({ value: 100, source: "mock-backend" }), reading({ value: 0 })];
  assert.deepEqual(O.historyStats(points, source), { count: 2, last: 0, min: 0, max: 8, mean: 4 });
  assert.equal(O.historyStats([], source).last, null);
});

test("tablet laboratory results never appear as a real crop diagnosis", () => {
  assert.equal(O.isPlantAnalysis({ captureTarget: "screen" }), false);
  assert.equal(O.isPlantAnalysis({ captureTarget: "plant", metrics: { detectorProfile: "tablet-leaf-v1" } }), false);
  assert.equal(O.isPlantAnalysis({ captureTarget: "plant", metrics: { detectorProfile: "plant" } }), true);
  assert.equal(O.isPlantAnalysis(null), false);
  assert.equal(O.pumpName({ id: "relay-39" }), "Bomba 01");
  assert.equal(O.pumpName({ id: "relay-41" }), "Bomba 04");
});

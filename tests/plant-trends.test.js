const test = require("node:test");
const assert = require("node:assert/strict");
const { compareHistory, MIN_INTERVAL_MS, MAX_INTERVAL_MS } = require("../app/scripts/plant-trends");
const now = Date.parse("2026-09-07T15:00:00Z");
function entry(age = 0, area = 20) {
  return {
    capturedAt: new Date(now - age).toISOString(), imageUrl: `/capture-${age}.jpg`,
    lighting: { protocol: "settled-burst-v1", intensity: 24, mode: "flash" },
    metrics: { usable: true, analysisVersion: "test-v1", roi: null,
      plantAreaPercent: area, areaMeasurement: { min: area - 0.1, max: area + 0.1, samples: 3 },
      boundingBox: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
      averageBrightness: 48, sampleWidth: 1024, sampleHeight: 768 }
  };
}
test("area increase and decrease require a change beyond burst variation", () => {
  const result = compareHistory(entry(0, 22), [entry(MIN_INTERVAL_MS)]);
  assert.equal(result.deltaPercent, 2);
  assert.equal(result.reason, "change");
  assert.equal(result.elapsedMs, MIN_INTERVAL_MS);
  assert.equal(compareHistory(entry(0, 18), [entry(MIN_INTERVAL_MS)]).deltaPercent, -2);
});
test("small differences and overlapping burst ranges are inconclusive, never zero growth", () => {
  assert.equal(compareHistory(entry(0, 20.3), [entry(MIN_INTERVAL_MS)]).reason, "within-variation");
  const current = entry(0, 22);
  current.metrics.areaMeasurement.min = 19.8;
  const result = compareHistory(current, [entry(MIN_INTERVAL_MS)]);
  assert.equal(result.deltaPercent, null);
  assert.equal(result.observedDeltaPercent, 2);
  assert.equal(result.reason, "within-variation");
});
test("finds newest compatible baseline, skipping failed and recent entries", () => {
  const bad = entry(MIN_INTERVAL_MS * 1.2); bad.metrics.usable = false;
  const base = entry(MIN_INTERVAL_MS * 2);
  const history = [entry(MIN_INTERVAL_MS * 4, 17), entry(1000), bad, base];
  const before = JSON.stringify(history);
  assert.equal(compareHistory(entry(0, 22), history).baseline.imageUrl, base.imageUrl);
  assert.equal(JSON.stringify(history), before);
});
test("requires one hour, ignores future and expired captures", () => {
  assert.equal(compareHistory(entry(), [entry(MIN_INTERVAL_MS - 1)]).reason, "too-recent");
  for (const age of [-MIN_INTERVAL_MS, MAX_INTERVAL_MS + 1]) {
    assert.equal(compareHistory(entry(), [entry(age)]).reason, "no-baseline");
  }
  assert.ok(compareHistory(entry(), [entry(MAX_INTERVAL_MS)]).baseline);
});
test("same burst or shared images cannot become an independent reference", () => {
  for (const identify of [
    (a, b) => { b.imageUrl = a.imageUrl; },
    (a, b) => { a.burstId = b.burstId = "burst-1"; },
    (a, b) => { a.frames = [{ imageUrl: b.imageUrl }]; }
  ]) {
    const a = entry(), b = entry(MIN_INTERVAL_MS);
    identify(a, b);
    assert.equal(compareHistory(a, [b]).reason, "no-baseline");
  }
});
test("rejects changes to lighting, selection, algorithm, dimensions, framing or quality", () => {
  const mutations = [
    (b) => { b.lighting.intensity = 0; }, (b) => { delete b.lighting; },
    (b) => { b.lighting.protocol = "old"; }, (b) => { b.lighting.mode = "ambient"; },
    (b) => { b.metrics.roi = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }; },
    (b) => { b.metrics.analysisVersion = "old"; }, (b) => { b.metrics.sampleWidth = 800; },
    (b) => { b.metrics.boundingBox.x += 0.02; }, (b) => { b.metrics.boundingBox.width += 0.05; },
    (b) => { b.metrics.averageBrightness += 11; }, (b) => { b.metrics.usable = false; },
    (b) => { delete b.metrics.areaMeasurement; }
  ];
  for (const mutate of mutations) {
    const old = entry(MIN_INTERVAL_MS); mutate(old);
    assert.equal(compareHistory(entry(), [old]).reason, "no-baseline", String(mutate));
  }
});
test("ROI comparison is numeric, independent of property order", () => {
  const a = entry(), b = entry(MIN_INTERVAL_MS);
  a.metrics.roi = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  b.metrics.roi = { height: 0.8, width: 0.8, y: 0.1, x: 0.1 };
  assert.ok(compareHistory(a, [b]).baseline);
});
test("clipped leaves cannot support area comparison", () => {
  const a = entry(), b = entry(MIN_INTERVAL_MS);
  a.metrics.boundingBox.x = 0;
  assert.equal(compareHistory(a, [b]).reason, "clipped-leaf");
  b.metrics.boundingBox.x = 0;
  assert.equal(compareHistory(entry(), [b]).reason, "no-baseline");
  const selected = entry();
  selected.metrics.roi = { x: 0.2, y: 0.1, width: 0.7, height: 0.8 };
  assert.equal(compareHistory(selected, [entry(MIN_INTERVAL_MS)]).reason, "clipped-leaf");
});
test("missing, non-finite or inconsistent metrics do not produce numerical conclusions", () => {
  const mutations = [
    (a) => { a.metrics.areaMeasurement = null; }, (a) => { a.metrics.plantAreaPercent = null; },
    (a) => { a.metrics.areaMeasurement.min = NaN; }, (a) => { a.metrics.areaMeasurement.max = 0; },
    (a) => { a.metrics.areaMeasurement.samples = 1; }, (a) => { a.capturedAt = "invalid"; },
    (a) => { a.metrics.averageBrightness = null; }, (a) => { a.metrics.boundingBox.width = -1; },
    (a) => { a.metrics.roi = { x: -0.1, y: 0, width: 1, height: 1 }; }
  ];
  for (const mutate of mutations) {
    const a = entry(); mutate(a);
    assert.equal(compareHistory(a, [entry(MIN_INTERVAL_MS)]).reason, "invalid-measurement");
  }
  assert.equal(compareHistory(null).deltaPercent, null);
});
test("no historical reference stays explicitly unavailable", () => {
  assert.equal(compareHistory(entry(), [null, {}, entry()]).reason, "no-baseline");
});

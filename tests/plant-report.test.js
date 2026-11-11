const test = require("node:test");
const assert = require("node:assert/strict");
const { classify } = require("../app/scripts/plant-report");
const { trialRows } = require("../app/scripts/plant-report");
const frame = patch => ({ quality: { usable: true, issues: [] }, stable: true, yellowPixels: 0,
  yellowOutsidePixels: 0, repeatedPixels: 0, tentativePixels: 0, yellowTentativePixels: 0, ...patch });
test("visual conclusions report measured yellow and repeated spots", () => {
  assert.equal(classify(frame({ yellowPixels: 100 })).label, "Amarillamiento visible");
  assert.equal(classify(frame({ yellowPixels: 100, repeatedPixels: 20 })).label, "Manchas y amarillamiento");
  assert.equal(classify(frame({ repeatedPixels: 20 })).label, "Manchas posibles");
  assert.equal(classify(frame({ tentativePixels: 20 })).label, "Marcas por revisar");
});
test("bad quality and unstable captures cannot produce healthy or disease conclusions", () => {
  assert.equal(classify(frame({ quality: { usable: false, issues: ["blurred"] }, yellowPixels: 200 })).label, "Foto no evaluable");
  assert.equal(classify(frame({ stable: false, repeatedPixels: 20 })).label, "Repetir captura");
  assert.equal(classify(frame({ quality: { usable: false, issues: ["insufficient-leaf"] } })).label, "Sin lectura");
});
test("requested simulated pests never become detected pests without visual evidence", () => {
  const result = classify(frame({ simulator: { config: { yellow: 100, aphids: 100, miners: 100 } } }));
  assert.equal(result.label, "Sin manchas visibles");
  assert.match(result.detail, /no descarta plagas/);
  assert.doesNotMatch(result.label, /Pulgones|Minadores/);
});

test("trial summaries separate requested conditions from measured evidence and reject unsafe photo links", () => {
  const entry = { captureTarget: "screen", label: "Sin lectura", simulator: { revision: 2, config: { yellow: 60, miners: 90, name: "Ensayo" } },
    metrics: { usable: false, yellowPercent: 0, suspectSpotPercent: 0 }, imageUrl: "javascript:alert(1)" };
  const row = trialRows([entry])[0];
  assert.equal(row.requestedYellow, 60); assert.equal(row.activePests, 1);
  assert.equal(row.yellow, null); assert.equal(row.spots, null); assert.equal(row.imageUrl, null);
  entry.metrics = { usable: true, yellowPercent: 1.2, suspectSpotPercent: 0.4 };
  entry.imageUrl = "/api/plant-vision/images/plant-test-1.jpg";
  assert.equal(trialRows([entry])[0].yellow, 1.2);
  assert.equal(trialRows([entry])[0].imageUrl, entry.imageUrl);
  assert.equal(trialRows([{ ...entry, captureTarget: "plant" }]).length, 0);
});

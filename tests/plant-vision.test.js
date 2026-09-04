const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, combine } = require("../app/scripts/plant-vision");

function scene({ spot = false, hole = false, shadow = false, exposure = 1, tint = [1, 1, 1], shift = 0, smooth = false, empty = false } = {}) {
  const width = 320, height = 240, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lx = x - shift;
      const leaf = !empty && ((lx - 145) / 66) ** 2 + ((y - 117) / 90) ** 2 < 1;
      const texture = smooth ? 0 : 1 + 0.045 * Math.sin(x * 0.4) * Math.cos(y * 0.3);
      let rgb = [220, 220, 220];
      if (leaf) rgb = [74, 130, 72].map((v) => v * (smooth ? 1 : texture));
      if (leaf && shadow && lx < 145) rgb = rgb.map((v) => v * 0.56);
      if (leaf && spot && Math.hypot(lx - 140, y - 140) < 10) rgb = [115, 88, 51];
      if (leaf && hole && Math.hypot(lx - 140, y - 90) < 12) rgb = [220, 220, 220];
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = rgb[c] * exposure * tint[c];
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}
function run(options, roi) {
  const { data, width, height } = scene(options);
  return analyze(data, width, height, { roi });
}

test("healthy green texture does not become a spot", () => {
  assert.equal(run({}).suspectPixels, 0);
});
test("brown patch is measured within the leaf", () => {
  const result = run({ spot: true });
  assert.ok(result.suspectPixels > 200 && result.suspectPixels < 400);
  assert.ok(result.suspectSpotPercent > 1);
});
test("green shadow and white holes are excluded", () => {
  assert.equal(run({ shadow: true, hole: true }).suspectPixels, 0);
});
test("moderate exposure and white balance changes retain the patch", () => {
  const base = run({ spot: true });
  for (const exposure of [0.7, 0.85, 1, 1.12]) {
    for (const tint of [[1, 1, 1], [0.91, 1.02, 1.06], [1.08, 1, 0.94]]) {
      const result = run({ spot: true, exposure, tint });
      assert.ok(result.suspectPixels > base.suspectPixels * 0.8, JSON.stringify({ exposure, tint }));
      assert.ok(result.suspectPixels < base.suspectPixels * 1.2);
    }
  }
});
test("manual ROI excludes a mark outside the selected leaf area", () => {
  assert.equal(run({ spot: true }, { x: 0.22, y: 0.1, width: 0.5, height: 0.35 }).suspectPixels, 0);
});
test("no leaves and dark frames cannot report a healthy result", () => {
  assert.equal(run({ empty: true }).quality.usable, false);
  assert.equal(run({ exposure: 0.18 }).quality.usable, false);
});
test("textureless leaf receives a focus warning", () => {
  assert.ok(run({ smooth: true }).quality.issues.includes("blurred"));
});
test("stable patches repeat across the burst", () => {
  const result = combine([run({ spot: true }), run({ spot: true, exposure: 0.98 }), run({ spot: true, exposure: 1.02 })]);
  assert.equal(result.stable, true);
  assert.ok(result.repeatedPixels > 200);
});
test("a single-frame artifact is tentative", () => {
  const result = combine([run({ spot: true }), run({}), run({})]);
  assert.equal(result.repeatedPixels, 0);
});
test("a mark visible in two frames survives a cleaner third frame", () => {
  const clean = run({}); clean.quality.score = 95;
  const result = combine([clean, run({ spot: true }), run({ spot: true })]);
  assert.ok(result.repeatedPixels > 200);
});
test("two stable frames remain usable with a third moved frame", () => {
  const moved = run({ spot: true, shift: 25 }); moved.quality.score = 95;
  const result = combine([moved, run({ spot: true }), run({ spot: true })]);
  assert.equal(result.usable, true);
  assert.equal(result.comparableFrames, 2);
});
test("movement prevents a quantitative conclusion", () => {
  const result = combine([run({ spot: true }), run({ spot: true, shift: 25 }), run({ spot: true, shift: -25 })]);
  assert.equal(result.usable, false);
  assert.equal(result.suspectSpotPercent, null);
});
test("single capture has no repeatability claim", () => {
  const result = combine([run({ spot: true })]);
  assert.equal(result.usable, false);
  assert.equal(result.repeatedPixels, 0);
});
test("rejects malformed images and ROI", () => {
  assert.throws(() => analyze([], 320, 240));
  assert.throws(() => run({}, { x: NaN, y: 0, width: 1, height: 1 }));
});

module.exports = { scene };

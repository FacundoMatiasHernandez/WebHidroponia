const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, combine } = require("../app/scripts/plant-vision");

function scene({ spot = false, hole = false, shadow = false, exposure = 1, tint = [1, 1, 1], shift = 0, smooth = false, empty = false,
  yellowLeaf = false, yellowRectangle = false, yellowHole = false, yellowClipped = false } = {}) {
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
      const yellow = yellowLeaf && ((lx - 235) / 34) ** 2 + ((y - 130) / 65) ** 2 < 1;
      if (yellow || (yellowRectangle && lx > 215 && lx < 270 && y > 60 && y < 190)) {
        rgb = yellowClipped ? [255, 220, 130] : [205, 177, 87];
      }
      if (yellow && yellowHole && Math.hypot(lx - 235, y - 115) < 13) rgb = [220, 220, 220];
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
  assert.throws(() => run({}, { x: -0.1, y: 0, width: 1, height: 1 }));
  assert.throws(() => run({}, { x: 0.5, y: 0, width: 0.6, height: 1 }));
});
test("burst area range uses only stable usable peers", () => {
  const frames = [run({ spot: true }), run({ spot: true, exposure: 0.98 }), run({ shift: 25 })];
  const result = combine(frames);
  assert.deepEqual(result.areaMeasurement, { min: Math.min(...frames.slice(0, 2).map((f) => f.plantAreaPercent)),
    max: Math.max(...frames.slice(0, 2).map((f) => f.plantAreaPercent)), samples: 2 });
  assert.equal(combine([frames[0]]).areaMeasurement, null);
  assert.equal(combine([run({ empty: true }), run({ empty: true })]).areaMeasurement, null);
});
test("lesion cut by the manual selection stays tentative", () => {
  const roi = { x: 140 / 320, y: 0.1, width: 0.3, height: 0.8 };
  const result = combine([run({ spot: true }, roi), run({ spot: true }, roi), run({ spot: true }, roi)]);
  assert.ok(result.tentativePixels > 30);
  assert.equal(result.repeatedPixels, 0);
  const full = combine([run({ spot: true }), run({ spot: true }), run({ spot: true })]);
  assert.ok(full.repeatedPixels > 200);
});
test("yellow leaf repeats separately from brown tip without changing growth segmentation", () => {
  const result = combine([run({ spot: true, yellowLeaf: true }), run({ spot: true, yellowLeaf: true }), run({ spot: true, yellowLeaf: true })]);
  assert.ok(result.yellowPixels > 5000);
  assert.ok(result.yellowPercent > 15 && result.yellowPercent < 40);
  assert.ok(result.repeatedPixels > 200);
  assert.equal(result.overlay[140 * 320 + 140], 2);
  assert.equal(result.overlay[130 * 320 + 235], 3);
  assert.equal(result.overlay[80 * 320 + 145], 0);
});
test("green texture, shadows, brown spot, white holes and yellow rectangle do not become yellow leaves", () => {
  for (const options of [{}, { shadow: true }, { spot: true, hole: true }, { yellowRectangle: true }]) {
    assert.equal(run(options).yellowRegions.length, 0, JSON.stringify(options));
  }
});
test("yellow surface excludes holes and respects the selected area", () => {
  const f = run({ yellowLeaf: true, yellowHole: true });
  assert.equal(f.yellowCandidates[115 * 320 + 235], 0);
  assert.ok(f.yellowRegions.length);
  assert.equal(run({ yellowLeaf: true }, { x: 0.1, y: 0.1, width: 0.5, height: 0.8 }).yellowRegions.length, 0);
});
test("single-frame yellow artifact or saturated yellow surface cannot be quantified", () => {
  const artifact = combine([run({ yellowLeaf: true }), run({}), run({})]);
  assert.equal(artifact.yellowPixels, 0);
  const clipped = combine([run({ yellowLeaf: true, yellowClipped: true }), run({ yellowLeaf: true, yellowClipped: true })]);
  assert.equal(clipped.yellowPixels, 0);
  assert.ok(clipped.yellowTentativePixels > 100);
});
test("yellow present in two frames survives a clean third frame", () => {
  const result = combine([run({}), run({ yellowLeaf: true }), run({ yellowLeaf: true })]);
  assert.ok(result.yellowPixels > 5000);
});
test("moderate brightness changes retain yellow surface; darkness gives no reading", () => {
  const result = combine([run({ yellowLeaf: true, exposure: 0.9 }), run({ yellowLeaf: true }), run({ yellowLeaf: true, exposure: 1.05 })]);
  assert.ok(result.yellowPixels > 5000);
  assert.equal(combine([run({ yellowLeaf: true, exposure: 0.15 }), run({ yellowLeaf: true, exposure: 0.15 })]).yellowPercent, null);
});
test("yellow cut by manual region remains tentative", () => {
  const roi = { x: 0.1, y: 0.1, width: 0.65, height: 0.8 };
  const result = combine([run({ yellowLeaf: true }, roi), run({ yellowLeaf: true }, roi)]);
  assert.equal(result.yellowPixels, 0);
  assert.ok(result.yellowTentativePixels > 100);
});

module.exports = { scene };

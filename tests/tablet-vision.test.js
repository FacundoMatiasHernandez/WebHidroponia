const test = require("node:test");
const assert = require("node:assert/strict");
const profile = require("../app/scripts/tablet-profile");
const vision = require("../app/scripts/plant-vision");
const report = require("../app/scripts/plant-report");

function scene({ yellow = 0, pests = [], strip = true, shift = 0, tint = [1, 1, 1], exposure = 1, rectangle = false, panelGain = 1, soft = false } = {}) {
  const width = 440, height = 330, data = new Uint8ClampedArray(width * height * 4);
  const put = (x, y, color) => {
    const i = (y * width + x) * 4;
    color.forEach((v, c) => { data[i + c] = v * exposure * tint[c] * (y < 260 ? panelGain : 1); }); data[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x - shift, leaf = rectangle ? u > 110 && u < 330 && y > 55 && y < 235
      : ((u - 220) / 125) ** 2 + ((y - 140) / 95) ** 2 < 1;
    let color = [96, 96, 96];
    if (leaf) {
      color = profile.PALETTE[u < 95 + 250 * yellow / 100 ? 1 : 0].rgb;
      for (const [j, id] of pests.entries()) {
        const cx = 165 + j % 3 * 55, cy = 115 + Math.floor(j / 3) * 55;
        const d = Math.hypot(u - cx, y - cy), signature = profile.PALETTE.find(item => item.id === id).rgb;
        if (d < 9) color = signature;
        else if (soft && d < 12) color = color.map((v, c) => v * 0.55 + signature[c] * 0.45);
      }
    }
    put(x, y, color);
  }
  if (strip) [profile.MARKER, ...profile.PALETTE.map(item => item.rgb), profile.MARKER].forEach((color, slot) => {
    for (let y = 280; y < 300; y++) for (let x = 55 + slot * 30; x < 79 + slot * 30; x++) put(x, y, color);
  });
  return vision.analyze(data, width, height, { profile: profile.VERSION });
}
const burst = options => vision.combine([scene(options), scene(options), scene(options)]);

test("tablet requires photographed references, never falls back to a real-plant detector", () => {
  const result = burst({ strip: false, yellow: 75, pests: ["aphids"] });
  assert.equal(result.usable, false);
  assert.equal(result.yellowPercent, null);
  assert.equal(report.classify(result).label, "Foto no evaluable");
});
test("reference swatches do not become yellow tissue or simulated pests", () => {
  const result = burst({});
  assert.equal(result.usable, true);
  assert.equal(result.yellowPixels, 0);
  assert.equal(result.repeatedPixels, 0);
  assert.deepEqual(result.simulatedPatterns, []);
});
test("yellow blade stays measurable even with no remaining green tissue", () => {
  const a = burst({ yellow: 40 }), b = burst({ yellow: 100 });
  assert.equal(a.usable, true); assert.ok(a.yellowPercent > 25 && a.yellowPercent < 45);
  assert.equal(b.usable, true); assert.ok(b.yellowPercent > 90);
  assert.ok(Math.abs(a.plantAreaPercent - b.plantAreaPercent) < 0.2);
});
test("six independent visible signatures repeat and retain their actual palette classes", () => {
  const pests = profile.PALETTE.slice(2, 8).map(item => item.id), result = burst({ pests, yellow: 40 });
  assert.equal(result.usable, true);
  assert.deepEqual(result.simulatedPatterns.map(item => item.id), pests);
  assert.ok(result.simulatedPatterns.every(item => item.percent > 0));
  assert.match(report.classify(result).label, /Amarillamiento y danos/);
});
for (const item of profile.PALETTE.slice(2, 8)) test(`isolated ${item.id} signature does not imply the other five simulated pests`, () => {
  const result = burst({ pests: [item.id], soft: true });
  assert.equal(result.usable, true);
  assert.deepEqual(result.simulatedPatterns.map(pattern => pattern.id), [item.id]);
});
test("photographed calibration tolerates common exposure and color-cast changes", () => {
  for (const exposure of [0.7, 1, 1.08]) {
    const result = burst({ yellow: 40, pests: ["miners", "thrips"], exposure, tint: [1.07, 0.97, 1.02] });
    assert.equal(result.usable, true, String(exposure));
    assert.equal(result.simulatedPatterns.length, 2);
  }
});
test("single-frame signature is not a confirmed simulated pest", () => {
  const result = vision.combine([scene({ pests: ["mites"] }), scene(), scene()]);
  assert.deepEqual(result.simulatedPatterns, []);
});
test("leaf brightness can differ from the calibration strip without becoming a different signature", () => {
  const result = burst({ yellow: 40, pests: ["aphids", "caterpillars"], panelGain: 1.15 });
  assert.equal(result.usable, true);
  assert.ok(result.yellowPercent > 25 && result.yellowPercent < 45);
  assert.deepEqual(result.simulatedPatterns.map(item => item.id), ["aphids", "caterpillars"]);
});
test("uncertain yellow or damage does not become a healthy tablet conclusion", () => {
  const result = vision.combine([scene({ yellow: 40 }), scene(), scene()]);
  assert.notEqual(report.classify(result).status, "ok");
});
test("rectangular objects and moving leaves do not produce a usable lab reading", () => {
  assert.equal(burst({ rectangle: true }).usable, false);
  assert.equal(vision.combine([scene({ shift: -30 }), scene(), scene({ shift: 30 })]).usable, false);
});
test("spatial yellow renderer colors the requested blade area and removes the narrow stem", () => {
  const width = 100, height = 130, source = new Uint8ClampedArray(width * height * 4);
  for (let y = 10; y < 125; y++) for (let x = 0; x < width; x++) {
    if ((y < 100 && ((x - 50) / 40) ** 2 + ((y - 55) / 45) ** 2 < 1) || (y >= 100 && x >= 48 && x <= 52)) {
      source.set([55, 100, 40, 255], (y * width + x) * 4);
    }
  }
  const template = profile.prepare(source, width, height), data = profile.tissue(template, 60);
  const visible = template.ranked.length, yellow = template.ranked.filter(({ i }) => data[i * 4] > data[i * 4 + 1]).length;
  assert.ok(Math.abs(yellow / visible - 0.6) < 0.001);
  assert.equal(data[(115 * width + 50) * 4 + 3], 0);
});

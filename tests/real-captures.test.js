const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vision = require("../app/scripts/plant-vision");
let sharp;
try { sharp = require("sharp"); } catch { /* Camera corpus tests are optional on machines without the local images. */ }
const dir = path.resolve("data/plant-captures");
const names = ["plant-light-24-1788495226046-0.jpg", "plant-light-24-1788495226047-1.jpg", "plant-light-24-1788495226048-2.jpg"];
const available = sharp && names.every((name) => fs.existsSync(path.join(dir, name)));
test("user reference: yellow leaf is a candidate, green leaf and holes are excluded", {
  skip: !sharp || !fs.existsSync(path.join(dir, "yellow-leaf-reference.png"))
}, async () => {
  const { data, info } = await sharp(path.join(dir, "yellow-leaf-reference.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = vision.analyze(data, info.width, info.height);
  assert.ok(result.yellowRegions.some((r) => r.x < 0.2 && r.width > 0.25 && r.height > 0.4));
  const pixel = (x, y) => Math.floor(y * info.height) * info.width + Math.floor(x * info.width);
  assert.equal(result.yellowCandidates[pixel(0.65, 0.45)], 0, "Green leaf counted as yellow");
  assert.equal(result.yellowCandidates[pixel(0.30, 0.34)], 0, "Hole counted as yellow");
  assert.ok(result.yellowCandidates[pixel(0.25, 0.43)]);
});
test("real September 7 burst: yellow leaf repeats and the brown tip remains visible", {
  skip: !sharp || ![1, 2, 3].every((i) => fs.existsSync(path.join(dir, `plant-mtrckfe1-${i}.jpg`)))
}, async () => {
  const frames = await Promise.all([1, 2, 3].map((i) => read(`plant-mtrckfe1-${i}.jpg`)));
  const result = vision.combine(frames);
  assert.ok(result.yellowPercent > 15 && result.yellowPercent < 40);
  assert.ok(result.yellowRegions.some((r) => r.repeated && r.x > 0.5 && r.x < 0.6 && r.height > 0.3));
  assert.ok(result.regions.some((r) => r.repeated && r.x > 0.73 && r.y > 0.65 && r.y < 0.72));
});
async function read(name, transform = (image) => image) {
  const { data, info } = await transform(sharp(path.join(dir, name)).resize(1024)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return vision.analyze(data, info.width, info.height);
}

const afternoonBursts = ["mtrlfx6w", "mtrlgf79", "mtrlgwmd", "mtrm2ncc", "mtrm3h43", "mtrm3r37", "mtrm43v3"];
const afternoonAvailable = sharp && afternoonBursts.every((id) => [1, 2, 3].every((i) => fs.existsSync(path.join(dir, `plant-${id}-${i}.jpg`))));
test("afternoon failures: complete yellow leaf persists across seven independent bursts", { skip: !afternoonAvailable }, async () => {
  for (const id of afternoonBursts) {
    const frames = await Promise.all([1, 2, 3].map((i) => read(`plant-${id}-${i}.jpg`)));
    const result = vision.combine(frames);
    assert.ok(result.yellowPixels > 10000, id + " lost the broad yellow leaf");
    assert.ok(result.yellowRegions.some((r) => r.repeated && r.x > 0.45 && r.x < 0.65), id);
    assert.ok(!result.yellowRegions.some((r) => r.repeated && r.y > 0.7), id + " marked the jar or desk");
  }
});
test("real leaf detail declines with progressive blur", { skip: !afternoonAvailable }, async () => {
  let previous = Infinity;
  for (const sigma of [0, 1, 2, 4, 12]) {
    const frame = await read("plant-mtrm43v3-2.jpg", (image) => sigma ? image.blur(sigma) : image);
    assert.ok(frame.quality.detail.value < previous, `Blur ${sigma} should reduce detail`);
    previous = frame.quality.detail.value;
  }
});
test("afternoon yellow under moderate exposure stays a candidate", { skip: !afternoonAvailable }, async () => {
  for (const brightness of [0.8, 0.9, 1, 1.05]) {
    const frame = await read("plant-mtrm43v3-2.jpg", (image) => image.modulate({ brightness }));
    assert.ok(frame.yellowRegions.some((r) => r.x > 0.45 && r.x < 0.65 && r.pixels > 10000), String(brightness));
  }
});
test("afternoon yellow under mild channel drift stays a candidate", { skip: !afternoonAvailable }, async () => {
  for (const gains of [[0.98, 1, 1.02], [1.02, 1, 0.98]]) {
    const frame = await read("plant-mtrm43v3-2.jpg", (image) => image.linear(gains, [0, 0, 0]));
    assert.ok(frame.yellowRegions.some((r) => r.x > 0.45 && r.x < 0.65 && r.pixels > 10000), JSON.stringify(gains));
  }
});
test("new white-background burst retains yellow tissue and the brown tip", {
  skip: !sharp || ![1, 2, 3].every((i) => fs.existsSync(path.join(dir, `plant-mtrmp176-${i}.jpg`)))
}, async () => {
  const result = vision.combine(await Promise.all([1, 2, 3].map((i) => read(`plant-mtrmp176-${i}.jpg`))));
  assert.ok(result.usable);
  assert.ok(result.yellowRegions.some((r) => r.repeated && r.x > 0.3 && r.x < 0.45 && r.pixels > 20000));
  assert.ok(result.regions.some((r) => r.repeated && r.x > 0.67 && r.x < 0.75 && r.y > 0.65));
});

test("real camera: brown tip repeats, holes and bottle do not become repeated spots", { skip: !available }, async () => {
  const frames = await Promise.all(names.map((name) => read(name)));
  const result = vision.combine(frames);
  assert.equal(result.usable, true);
  const repeated = result.regions.filter((region) => region.repeated);
  assert.ok(repeated.some((r) => r.x > 0.36 && r.x < 0.48 && r.y > 0.75 && r.y < 0.84), "Visible tip was missed");
  assert.ok(!repeated.some((r) => r.x > 0.68 && r.y > 0.60), "Bottle marked as a spot");
  const holes = [{ x: 0.46, y: 0.095, width: 0.08, height: 0.12 }, { x: 0.5, y: 0.41, width: 0.045, height: 0.06 },
    { x: 0.39, y: 0.54, width: 0.065, height: 0.17 }];
  for (const hole of holes) assert.ok(!repeated.some((r) => r.x > hole.x && r.x < hole.x + hole.width
    && r.y > hole.y && r.y < hole.y + hole.height), "Background through a hole marked as a lesion");
});
test("real camera: exposure perturbations retain tip candidates", { skip: !available }, async () => {
  for (const brightness of [0.8, 1, 1.08]) {
    const result = await read(names[0], (image) => image.modulate({ brightness }));
    assert.ok(result.regions.some((r) => r.x > 0.36 && r.x < 0.48 && r.y > 0.75 && r.y < 0.84));
  }
});
test("real camera: irregular tip remains detectable in a separate later burst", {
  skip: !available || !fs.existsSync(path.join(dir, "plant-mtmgaj1i-1.jpg"))
}, async () => {
  for (const burst of ["mtmgaj1i", "mtmgp1gg"]) {
    if (!fs.existsSync(path.join(dir, `plant-${burst}-1.jpg`))) continue;
    const frames = await Promise.all([1, 2, 3].map((i) => read(`plant-${burst}-${i}.jpg`)));
    const result = vision.combine(frames);
    assert.ok(result.regions.some((r) => r.repeated && r.x > 0.36 && r.x < 0.48 && r.y > 0.75 && r.y < 0.84));
    assert.ok(!result.regions.some((r) => r.repeated && r.x > 0.62 && r.x < 0.68 && r.y > 0.25 && r.y < 0.4), "Contour halo classified as a repeated spot");
  }
});
test("real camera: severe blur must be rejected", { skip: !available }, async () => {
  const result = await read(names[0], (image) => image.blur(12));
  assert.equal(result.quality.usable, false);
});
test("real camera: starting from a bright video still detects the tip", {
  skip: !available || !fs.existsSync(path.join(dir, "plant-mtmgkun1-1.jpg"))
}, async () => {
  const frames = await Promise.all([1, 2, 3].map((i) => read(`plant-mtmgkun1-${i}.jpg`)));
  const result = vision.combine(frames);
  assert.ok(result.regions.some((r) => r.repeated && r.x > 0.36 && r.x < 0.48 && r.y > 0.75 && r.y < 0.84));
});
test("real camera: overexposed capture is not evaluable", { skip: !available }, async () => {
  const result = await read("plant-light-96-1788495236116-0.jpg");
  assert.equal(result.quality.usable, false);
});

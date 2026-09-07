// Local image evaluation; sharp is only needed for this optional camera regression runner.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const vision = require("../app/scripts/plant-vision");

async function inspect() {
  const dir = path.resolve("data/plant-captures");
  const names = process.argv.slice(2);
  const files = names.length ? names : fs.readdirSync(dir).filter((name) => name.endsWith(".jpg"));
  const results = [];
  fs.mkdirSync("data/vision-validation", { recursive: true });
  for (const name of files) {
    const { data, info } = await sharp(path.join(dir, name)).resize({ width: 1024, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const result = vision.analyze(data, info.width, info.height);
    const { mask, candidates, signature, yellowCandidates, yellowLabels, ...metrics } = result;
    results.push({ name, ...metrics });
    const overlay = Buffer.from(data);
    for (let i = 0; i < mask.length; i++) {
      if (!candidates[i]) continue;
      overlay[i * 4] = 230; overlay[i * 4 + 1] = 65; overlay[i * 4 + 2] = 80;
    }
    await sharp(overlay, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png().toFile(path.join("data/vision-validation", name.replace(".jpg", "-overlay.png")));
    console.log(JSON.stringify({ name, area: result.plantAreaPercent.toFixed(2), spots: result.suspectSpotPercent?.toFixed(2), regions: result.regions.length, quality: result.quality }));
  }
  fs.writeFileSync("data/vision-validation/results.json", JSON.stringify(results, null, 2));
}
inspect().catch((error) => { console.error(error); process.exitCode = 1; });

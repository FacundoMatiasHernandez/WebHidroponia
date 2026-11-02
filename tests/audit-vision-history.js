// Read-only reproduction of saved analyses; never rewrites the user's history or captures.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const vision = require("../app/scripts/plant-vision");
async function main() {
  const history = JSON.parse(fs.readFileSync("data/runtime-state.json", "utf8")).plantVision.history;
  const limit = Number(process.argv[2]) || 12;
  for (const entry of history.slice(-limit)) {
    const frames = [];
    for (const capture of entry.frames || [entry]) {
      const file = path.join("data/plant-captures", path.basename(capture.imageUrl));
      const { data, info } = await sharp(file).resize({ width: 1024, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      frames.push(vision.analyze(data, info.width, info.height, { roi: entry.metrics.roi }));
    }
    const result = vision.combine(frames);
    console.log(JSON.stringify({ image: entry.imageUrl, roi: entry.metrics.roi, before: entry.metrics.yellowPercent,
      yellow: result.yellowPercent, outside: result.yellowOutsidePixels, selected: result.selectedIndex, usable: result.usable,
      reasons: result.yellowRegions.map((r) => r.reason),
      frames: frames.map((f) => ({ detail: f.quality.detail, diagnostics: f.yellowDiagnostics })) }));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

// Manual hardware experiment: restore every setting and persist photos locally, never publish them.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { collectCameraBurst, withRestoredSettings } = require("../app/camera-burst");
const base = process.env.CAMERA_TEST_URL;
if (!base) throw new Error("Set CAMERA_TEST_URL to the ESP32-CAM HTTP origin");
const get = (url) => new Promise((resolve, reject) => {
  const request = http.get(url, { headers: { Connection: "close" }, timeout: 5000 }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => response.statusCode === 200 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error(`HTTP ${response.statusCode}`)));
    response.on("error", reject);
  });
  request.on("timeout", () => request.destroy(new Error("timeout")));
  request.on("error", reject);
});
const read = async () => {
  return JSON.parse(await get(`${base}/status`));
};
const control = async (key, value) => {
  await get(`${base}/control?var=${key}&val=${value}`);
};
async function main() {
  const before = await read();
  const url = new URL(base); url.port = "81"; url.pathname = "/stream";
  const summary = [];
  for (const intensity of [24, 48, 96]) {
    const frames = await withRestoredSettings(read, control, { framesize: 19, quality: 8, brightness: 0, contrast: 1, saturation: 0, ae_level: -1, led_intensity: intensity }, async () => {
      console.log(`Capturing ${intensity} at ${url.href}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      try { return await collectCameraBurst(url, { warmupMs: 2500, discardFrames: 6 }); }
      finally { await new Promise((resolve) => setTimeout(resolve, 500)); }
    });
    for (const [i, frame] of frames.entries()) {
      const name = `plant-light-${intensity}-${Date.now()}-${i}.jpg`;
      fs.writeFileSync(path.join("data/plant-captures", name), frame.buffer);
      console.log(name);
      summary.push({ name, intensity, capturedAt: frame.capturedAt });
    }
  }
  const after = await read();
  console.log(JSON.stringify({ restored: ["framesize", "quality", "led_intensity"].every((key) => before[key] === after[key]), led: after.led_intensity }));
  fs.writeFileSync("data/vision-validation/lighting.json", JSON.stringify(summary, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

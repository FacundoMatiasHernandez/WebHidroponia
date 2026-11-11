const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net");
const { spawn } = require("node:child_process"), { once } = require("node:events");
test("isolated live server preserves null/error states, rejects invalid pH and hides stale data", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydrovision-usb-test-"));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ["server.js"], { cwd: path.resolve(__dirname, ".."), windowsHide: true,
    env: { ...process.env, PORT: String(port), DATA_MODE: "esp32-usb", HYDROVISION_DATA_DIR: dir, INGEST_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const base = `http://127.0.0.1:${port}`;
  const post = body => fetch(base + "/api/ingest/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = async () => (await fetch(base + "/api/bootstrap")).json();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Test server did not start")), 10000);
      child.stdout.on("data", bytes => { if (bytes.toString().includes("HydroVision running")) { clearTimeout(timer); resolve(); } });
      child.on("error", error => { clearTimeout(timer); reject(error); });
    });
    const initial = await get(); assert.equal(initial.sensors.length, 15);
    assert.ok(Object.values(initial.snapshot).every(r => r.value === null));
    assert.equal((await post({ source: "esp32-usb", fullSnapshot: true, readings: [
      { sensorId: "air-temperature", value: 23.9 }, { sensorId: "water-ph", value: 27.96 }, { sensorId: "water-tds", value: 0 }
    ], actuators: [] })).status, 200);
    const live = await get(); assert.equal(live.snapshot["air-temperature"].value, 23.9);
    assert.equal(live.snapshot["water-ph"].value, null); assert.equal(live.snapshot["water-ph"].status, "error");
    assert.equal(live.snapshot["water-tds"].value, 0); assert.equal(live.snapshot["water-ec"].value, null);
    assert.equal(live.actuators.length, 0);
    await post({ source: "esp32-usb", firmwareProfile: "tesis-huerta-j17", readings: [
      { sensorId: "water-ec", value: 1, quality: "estimated", note: "TDS / 500" }
    ] });
    const estimated = await get(); assert.equal(estimated.snapshot["water-ec"].status, "estimated");
    assert.equal(estimated.snapshot["water-ec"].value, 1); assert.equal(estimated.meta.firmwareProfile, "tesis-huerta-j17");
    await post({ source: "esp32-usb", readings: [{ sensorId: "air-temperature", value: null, status: "error" }] });
    assert.equal((await get()).snapshot["air-temperature"].value, null);
    await post({ source: "esp32-usb", timestamp: new Date(Date.now() - 20000).toISOString(), readings: [{ sensorId: "air-temperature", value: 23.9 }] });
    assert.equal((await get()).snapshot["air-temperature"].status, "stale");
    assert.equal((await get()).snapshot["air-temperature"].value, null);
    await post({ source: "another-board", readings: [{ sensorId: "air-humidity", value: 50 }] });
    const other = await get(); assert.equal(other.snapshot["air-temperature"].value, null);
    assert.equal(other.snapshot["air-humidity"].value, 50);
  } finally {
    const exited = once(child, "exit"); child.kill(); await exited;
    if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith("hydrovision-usb-test-")) throw new Error("Unsafe test cleanup path");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

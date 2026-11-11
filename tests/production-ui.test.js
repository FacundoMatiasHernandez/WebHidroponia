const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net");
const { spawn } = require("node:child_process"), { once } = require("node:events");

test("production starts without generated values and discards persisted demonstration data", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydrovision-production-test-"));
  const entry = { value: 24, source: "mock-backend", status: "ok", timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "runtime-state.json"), JSON.stringify({
    meta: { dataMode: "mock-backend", running: true }, snapshot: { "air-temperature": entry },
    history: { "air-temperature": [entry] }, remoteActuators: [{ id: "fake-pump", active: true }],
    plantVision: { latest: { captureTarget: "screen", timestamp: entry.timestamp }, history: [{ captureTarget: "screen", timestamp: entry.timestamp }] }
  }));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ["server.js"], { cwd: path.resolve(__dirname, ".."), windowsHide: true,
    env: { ...process.env, PORT: String(port), DATA_MODE: "", HYDROVISION_DATA_DIR: dir, INGEST_TOKEN: "", RELAY_CONTROL_TOKEN: "",
      CAMERA_MODE: "", CAMERA_MJPEG_URL: "", CAMERA_EMBED_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const base = "http://127.0.0.1:" + port;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Production test did not start")), 10000);
      child.stdout.on("data", bytes => { if (bytes.toString().includes("HydroVision running")) { clearTimeout(timer); resolve(); } });
      child.on("error", error => { clearTimeout(timer); reject(error); });
    });
    const state = await (await fetch(base + "/api/bootstrap")).json();
    assert.equal(state.meta.dataMode, "esp32-wifi"); assert.equal(state.meta.running, false);
    assert.equal(state.sensors.length, 15); assert.ok(state.sensors.every(s => !("base" in s) && !("step" in s)));
    assert.ok(Object.values(state.snapshot).every(r => r.value === null));
    assert.ok(Object.values(state.history).every(h => h.length === 0));
    assert.ok(state.actuators.every(a => a.active === null)); assert.equal(state.alarms.length, 0);
    assert.ok(state.services.every(s => !/mock|simula/i.test(JSON.stringify(s))));
    assert.equal(state.camera.mode, "unavailable"); assert.equal(state.plantVision.latest, null);
    const lab = await (await fetch(base + "/api/simulator/history")).json();
    assert.equal(lab.plantVision.latest.captureTarget, "screen");
    assert.equal(lab.plantVision.history.length, 1);
    assert.equal((await fetch(base + "/api/simulator/history", { headers: { Origin: "http://evil.example" } })).status, 403);
    for (const endpoint of ["toggle-simulation", "inject-critical"]) {
      assert.equal((await fetch(base + "/api/control/" + endpoint, { method: "POST" })).status, 410);
    }
    const font = await fetch(base + "/app/styles/fonts/manrope-regular.ttf");
    assert.equal(font.status, 200); assert.equal(font.headers.get("content-type"), "font/ttf");
    for (const route of ["/.env.wifi.local", "/firmware/tesis_huerta_j17_wifi/secrets.h"]) assert.equal((await fetch(base + route)).status, 403);
    const html = await (await fetch(base)).text();
    assert.equal(/toggleSimulation|injectAlert|mock-backend|Payload esperado|plantTrialResults|tablet-profile/.test(html), false);
    assert.equal((html.match(/data-view="/g) || []).length, 5);
    const post = body => fetch(base + "/api/ingest/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ source: "mock-backend", readings: [{ sensorId: "air-temperature", value: 24 }] })).status, 400);
    for (let i = 0; i < 3; i++) {
      assert.equal((await post({ source: "esp32-usb", readings: [{ sensorId: "air-temperature", value: 34 }] })).status, 200);
    }
    const live = await (await fetch(base + "/api/bootstrap")).json();
    assert.equal(live.alarms.length, 1);
    assert.equal(live.alarms[0].sensorId, "air-temperature");
    await post({ source: "esp32-usb", timestamp: new Date(Date.now() - 20000).toISOString(), readings: [{ sensorId: "air-temperature", value: 34 }] });
    const expired = await (await fetch(base + "/api/bootstrap")).json();
    assert.equal(expired.alarms.length, 0);
  } finally {
    const exited = once(child, "exit"); child.kill(); await exited;
    if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith("hydrovision-production-test-")) throw new Error("Unsafe cleanup path");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

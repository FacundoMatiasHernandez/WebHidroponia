const test = require("node:test"), assert = require("node:assert/strict");
const { validateCalibration, levelReading, projectLevelState } = require("../app/water-level-calibration");
const O = require("../app/scripts/operations");
const now = Date.now(), completedAt = new Date(now - 60000).toISOString();
const record = () => ({ schemaVersion: 1, sensorId: "water-level-raw", outputSensorId: "water-level", source: "esp32-wifi",
  deviceId: "huerta-j17", firmwareBuild: "tesis-huerta-j17-wifi-v2", pin: 3, status: "calibrated",
  method: "two-point-linear-reference", meaning: "relative-sensor-response-not-tank-volume", completedAt,
  dry: { referenceRaw: 0, minimumRaw: 0, maximumRaw: 53, sampleCount: 14 },
  wet: { referenceRaw: 2649, minimumRaw: 2635, maximumRaw: 2661, sampleCount: 14 } });
const meta = { dataMode: "esp32-wifi", transport: { deviceId: "huerta-j17" }, firmwareBuild: "tesis-huerta-j17-wifi-v2" };
const raw = (value, extra = {}) => ({ sensorId: "water-level-raw", value, status: "info", source: "esp32-wifi", timestamp: new Date(now).toISOString(), ...extra });

test("resistive reference maps measured dry and wet endpoints, not ADC full scale or tank volume", () => {
  const c = validateCalibration(record()); assert.ok(c);
  assert.equal(levelReading(raw(0), c, now).value, 0);
  assert.equal(levelReading(raw(2649), c, now).value, 100);
  assert.equal(levelReading(raw(1325), c, now).value, 50);
  assert.match(levelReading(raw(0), c, now).note, /No mide litros/);
  assert.equal(O.readingState(levelReading(raw(0), c, now)).label, "Referencia calibrada");
});
test("incomplete, noisy, wrong-pin and indistinguishable calibration references fail closed", () => {
  for (const mutate of [
    r => { r.dry = null; }, r => { r.status = "awaiting-dry-reference"; }, r => { r.pin = 1; },
    r => { r.dry.sampleCount = 1; }, r => { r.wet = { ...r.dry }; },
    r => { r.dry.maximumRaw = 1000; }, r => { r.dry.referenceRaw = -1; }, r => { r.completedAt = "invalid"; }
  ]) { const r = record(); mutate(r); assert.equal(validateCalibration(r), null); }
});
test("below-reference signals never display 100 percent merely because of integer rounding", () => {
  const c = validateCalibration(record());
  for (const value of [2636, 2640, 2648]) assert.equal(levelReading(raw(value), c, now).value, 99);
  assert.equal(levelReading(raw(2649), c, now).value, 100);
  const reversed = record(); [reversed.dry, reversed.wet] = [reversed.wet, reversed.dry];
  const reverseCalibration = validateCalibration(reversed);
  assert.equal(levelReading(raw(1), reverseCalibration, now).value, 99);
  assert.equal(levelReading(raw(0), reverseCalibration, now).value, 100);
});
test("missing, stale, future, foreign and failed RAW readings never become a retained level", () => {
  const c = validateCalibration(record());
  for (const r of [null, raw(null), raw(-1), raw(4096), raw(0, { status: "error" }), raw(0, { source: "esp32-usb" }),
    raw(0, { status: "estimated" }), raw(2649, { timestamp: new Date(now - 20000).toISOString() }),
    raw(2649, { timestamp: new Date(now + 6000).toISOString() })]) assert.equal(levelReading(r, c, now).value, null);
});
test("limits retain RAW provenance and distinguish observed endpoint noise from an out-of-reference signal", () => {
  const c = validateCalibration(record()), noisyWet = levelReading(raw(2655), c, now), outside = levelReading(raw(3000), c, now);
  assert.equal(noisyWet.value, 100); assert.equal(noisyWet.levelCalibration.clipped, true);
  assert.equal(noisyWet.levelCalibration.outsideReference, false);
  assert.equal(outside.value, 100); assert.equal(outside.levelCalibration.raw, 3000);
  assert.ok(outside.levelCalibration.unboundedPercent > 100);
  assert.equal(O.readingState(outside).tone, "warning");
  const summary = O.summarize(O.SENSORS.filter(s => s.id === "water-level"), { "water-level": outside }, "esp32-wifi", [], now);
  assert.equal(summary.quality.length, 1); assert.equal(summary.issues.length, 1);
});
test("projection is bound to this board and firmware and preserves real history gaps without mutating inputs", () => {
  const c = validateCalibration(record()), snapshot = { "water-level-raw": raw(0), "water-level": { value: null, status: "uncalibrated" } };
  const history = { "water-level-raw": [raw(100, { timestamp: new Date(now - 120000).toISOString() }), raw(2649), raw(null, { status: "error" })] };
  const projected = projectLevelState(snapshot, history, meta, c, now);
  assert.equal(projected.snapshot["water-level"].value, 0);
  assert.equal(snapshot["water-level"].value, null);
  assert.deepEqual(projected.history["water-level"].map(p => p.value), [100, null]);
  for (const other of [{ ...meta, firmwareBuild: "another-build" }, { ...meta, transport: { deviceId: "another-board" } },
    { ...meta, dataMode: "esp32-usb" }]) assert.equal(projectLevelState(snapshot, history, other, c, now).applied, false);
  const stale = projectLevelState({ ...snapshot, "water-level-raw": raw(null, { status: "stale" }) }, history, meta, c, now);
  assert.equal(stale.snapshot["water-level"].value, null);
});

test("isolated Wi-Fi server publishes persistent calibrated level without affecting pump states", async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net");
  const { spawn } = require("node:child_process"), { once } = require("node:events"), { LEGACY_RELAYS: RELAYS } = require("../app/relay-control");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydrovision-level-test-"));
  fs.writeFileSync(path.join(dir, "water-level-calibration.json"), JSON.stringify(record()));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const token = "isolated-level-ingest-token";
  const child = spawn(process.execPath, ["server.js"], { cwd: path.resolve(__dirname, ".."), windowsHide: true,
    env: { ...process.env, PORT: String(port), DATA_MODE: "esp32-wifi", HYDROVISION_DATA_DIR: dir, ESP32_DEVICE_ID: "huerta-j17",
      INGEST_TOKEN: token, RELAY_CONTROL_TOKEN: "isolated-level-control-token", CAMERA_MODE: "", CAMERA_MJPEG_URL: "", CAMERA_EMBED_URL: "" },
    stdio: ["ignore", "pipe", "pipe"] });
  const base = "http://127.0.0.1:" + port;
  let sequence = 0;
  const postRaw = reading => fetch(base + "/api/ingest/batch", { method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Token": token },
    body: JSON.stringify({ source: "esp32-wifi", fullSnapshot: true, firmwareProfile: "tesis-huerta-j17", firmwareBuild: meta.firmwareBuild,
      device: { id: "huerta-j17", bootId: "level-test-boot", protocol: 1, sequence: ++sequence, capability: "timed-continuous-pumps-v2" },
      readings: [{ sensorId: "water-level-raw", ...reading }, { sensorId: "water-level", value: null, status: "uncalibrated" }],
      actuators: RELAYS.map(r => ({ ...r, active: false, mode: "manual", result: "none", commandId: null, runMode: "pulse", durationMs: 5000 })) }) });
  const get = async () => (await fetch(base + "/api/bootstrap")).json();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Level server did not start")), 10000);
      child.stdout.on("data", bytes => { if (bytes.toString().includes("HydroVision running")) { clearTimeout(timer); resolve(); } });
      child.on("error", error => { clearTimeout(timer); reject(error); });
    });
    assert.equal((await get()).snapshot["water-level"].value, null);
    for (const [adc, percent] of [[0, 0], [2649, 100], [2636, 99], [2648, 99], [1325, 50]]) {
      const response = await postRaw({ value: adc }); assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).control.commands, []);
      const state = await get(), level = state.snapshot["water-level"];
      assert.equal(level.value, percent); assert.equal(level.levelCalibration.dryRaw, 0);
      assert.equal(level.levelCalibration.wetRaw, 2649); assert.equal(level.derivedFrom, "water-level-raw");
      assert.equal(state.sensors.find(s => s.id === "water-level").telemetry, true);
      assert.equal(state.alarms.some(a => a.sensorId === "water-level"), false);
      assert.ok(state.actuators.filter(a => a.supported).every(a => a.active === false && a.command === null));
    }
    await postRaw({ value: null, status: "error" });
    assert.equal((await get()).snapshot["water-level"].value, null);
    assert.equal((await fetch(base + "/data/water-level-calibration.json")).status, 403);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "water-level-calibration.json"), "utf8")), record());
  } finally {
    const exited = once(child, "exit"); child.kill(); await exited;
    if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith("hydrovision-level-test-")) throw new Error("Unsafe cleanup path");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

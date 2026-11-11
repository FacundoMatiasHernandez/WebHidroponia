const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net");
const { spawn } = require("node:child_process"), { once } = require("node:events");
const { RELAYS, LEGACY_RELAYS } = require("../app/relay-control");
for (const version of [1, 2, 3]) test(`isolated Wi-Fi server authenticates and confirms orders for firmware v${version}`, async () => {
  const continuous = version >= 2, supportedRelays = version === 3 ? RELAYS : LEGACY_RELAYS;
  const targetId = version === 3 ? "relay-41" : "relay-39", targetIndex = version === 3 ? 3 : 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydrovision-wifi-test-"));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const token = "isolated-test-ingest-token", controlToken = "isolated-test-control-token";
  const child = spawn(process.execPath, ["server.js"], { cwd: path.resolve(__dirname, ".."), windowsHide: true,
    env: { ...process.env, PORT: String(port), DATA_MODE: "esp32-wifi", HYDROVISION_DATA_DIR: dir, INGEST_TOKEN: token, RELAY_CONTROL_TOKEN: controlToken }, stdio: ["ignore", "pipe", "pipe"] });
  const base = `http://127.0.0.1:${port}`;
  const post = (route, body, headers = {}) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const get = async () => (await fetch(base + "/api/bootstrap")).json();
  let sequence = 0;
  const telemetry = changes => ({ source: "esp32-wifi", fullSnapshot: true, firmwareProfile: "tesis-huerta-j17", firmwareBuild: `tesis-huerta-j17-wifi-v${version}`,
    device: { id: "huerta-j17", bootId: "test-boot", protocol: 1, sequence: ++sequence, capability: version === 3 ? "four-timed-continuous-pumps-v3" : continuous ? "timed-continuous-pumps-v2" : "timed-pumps-v1" },
    readings: [{ sensorId: "air-temperature", value: 23.4 }, { sensorId: "water-ph", value: 27.96 }],
    actuators: supportedRelays.map(r => ({ ...r, active: false, mode: "manual", result: "none", commandId: null,
      ...(continuous ? { runMode: "pulse", durationMs: 5000 } : {}), ...(changes?.[r.id] || {}) })) });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Wi-Fi test server did not start")), 10000);
      child.stdout.on("data", bytes => { if (bytes.toString().includes("HydroVision running")) { clearTimeout(timer); resolve(); } });
      child.on("error", error => { clearTimeout(timer); reject(error); });
    });
    const initial = await get(); assert.equal(initial.sensors.length, 15);
    assert.ok(Object.values(initial.snapshot).every(r => r.value === null));
    assert.equal(initial.actuators.length, 4); assert.ok(initial.actuators.every(a => a.active === null && !a.controllable));
    assert.equal((await post("/api/ingest/batch", telemetry())).status, 401);
    const accepted = await post("/api/ingest/batch", telemetry(), { "X-Ingest-Token": token });
    assert.equal(accepted.status, 200); assert.deepEqual((await accepted.json()).control.commands, []);
    const state = await get(); assert.equal(state.snapshot["air-temperature"].value, 23.4);
    assert.equal(state.snapshot["water-ph"].value, null); assert.ok(state.actuators.filter(a => a.supported).every(a => a.active === false));
    assert.equal(state.relayControl.supportedRelayIds.length, supportedRelays.length);
    if (version < 3) assert.equal(state.actuators[3].controllable, false);
    assert.equal(JSON.stringify(state).includes(token), false); assert.equal(JSON.stringify(state).includes(controlToken), false);
    for (const route of ["/.env.wifi.local", "/firmware/tesis_huerta_j17_wifi/secrets.h", "/app/relay-control.js"]) assert.equal((await fetch(base + route)).status, 403);
    const command = { id: targetId, bootId: "test-boot", mode: "manual", active: true, durationMs: 5000, revision: state.relayControl.revision };
    assert.equal((await post("/api/control/actuator", command, { Origin: "http://evil.example" })).status, 403);
    assert.equal((await post("/api/control/actuator", { ...command, durationMs: 10001 }, { Origin: base })).status, 400);
    const queued = await post("/api/control/actuator", command, { Origin: base }); assert.equal(queued.status, 202);
    const id = (await queued.json()).command.commandId;
    assert.equal((await get()).actuators[targetIndex].active, false);
    const poll = await post("/api/ingest/batch", telemetry(), { "X-Ingest-Token": token });
    assert.equal((await poll.json()).control.commands[0].commandId, id);
    await post("/api/ingest/batch", telemetry({ [targetId]: { active: true, result: "applied", commandId: id } }), { "X-Ingest-Token": token });
    const confirmed = await get(); assert.equal(confirmed.actuators[targetIndex].active, true); assert.equal(confirmed.actuators[targetIndex].command.status, "confirmed");
    assert.equal((await post("/api/control/actuator", { ...command, id: "relay-40" }, { Origin: base })).status, 409);
    assert.equal((await post("/api/ingest/batch", { source: "esp32-usb", readings: [{ sensorId: "air-temperature", value: 99 }] }, { "X-Ingest-Token": token })).status, 409);
    assert.equal((await post("/api/control/toggle-simulation", {})).status, 410);
    await post("/api/ingest/batch", telemetry({ [targetId]: { active: false, result: "completed", commandId: id } }), { "X-Ingest-Token": token });
    assert.equal((await get()).actuators[targetIndex].active, false);
    const before = await get();
    assert.equal(before.relayControl.continuousSupported, continuous);
    const continuousCommand = { ...command, runMode: "continuous", durationMs: 0, revision: before.relayControl.revision };
    const startContinuous = await post("/api/control/actuator", continuousCommand, { Origin: base });
    assert.equal(startContinuous.status, continuous ? 202 : 409);
    if (continuous) {
      const continuousId = (await startContinuous.json()).command.commandId;
      assert.equal((await get()).actuators[targetIndex].active, false);
      await post("/api/ingest/batch", telemetry({ [targetId]: { active: true, runMode: "continuous", durationMs: 0, result: "applied", commandId: continuousId } }), { "X-Ingest-Token": token });
      const running = await get(); assert.equal(running.actuators[targetIndex].active, true);
      assert.equal(running.actuators[targetIndex].runMode, "continuous"); assert.equal(running.actuators[targetIndex].command.status, "confirmed");
      const stopResponse = await post("/api/control/stop-all", { bootId: "test-boot" }, { Origin: base });
      assert.equal(stopResponse.status, 202); const stops = (await stopResponse.json()).commands;
      await post("/api/ingest/batch", telemetry(Object.fromEntries(stops.map(stop => [stop.id,
        { active: false, runMode: "pulse", durationMs: 0, result: "applied", commandId: stop.commandId }]))), { "X-Ingest-Token": token });
      assert.ok((await get()).actuators.filter(a => a.supported).every(a => !a.active && a.command.status === "confirmed"));
    }
  } finally {
    const exited = once(child, "exit"); child.kill(); await exited;
    if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith("hydrovision-wifi-test-")) throw new Error("Unsafe test cleanup path");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

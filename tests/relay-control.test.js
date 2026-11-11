const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { RELAYS, LEGACY_RELAYS, createRelayControl, createControlAccess, sameOrigin } = require("../app/relay-control");

function rig({ continuous = false, four = false } = {}) {
  if (four) continuous = true;
  let clock = 1000000, seq = 0;
  const control = createRelayControl({ enabled: true, now: () => clock });
  const report = (changes = {}, bootId = "boot-a") => ({ source: "esp32-wifi", firmwareBuild: `tesis-huerta-j17-wifi-v${four ? 3 : continuous ? 2 : 1}`,
    device: { id: "huerta-j17", bootId, sequence: ++seq, protocol: 1, capability: four ? "four-timed-continuous-pumps-v3" : continuous ? "timed-continuous-pumps-v2" : "timed-pumps-v1" },
    actuators: (four ? RELAYS : LEGACY_RELAYS).map(r => ({ ...r, active: false, mode: "manual", result: "none", commandId: null,
      ...(continuous ? { runMode: "pulse", durationMs: 5000 } : {}), ...(changes[r.id] || {}) })) });
  const on = (id = "relay-39", extra = {}) => control.queue({ id, mode: "manual", active: true, durationMs: 5000, bootId: "boot-a", revision: control.info().revision, ...extra });
  control.accept(report());
  return { control, report, on, advance: ms => { clock += ms; } };
}
test("pump command stays pending until the device acknowledges, never changes reported state optimistically", () => {
  const { control, report, on } = rig();
  const order = on();
  assert.equal(control.actuators()[0].active, false);
  assert.equal(control.actuators()[0].command.status, "pending");
  assert.equal(control.response().commands[0].commandId, order.commandId);
  assert.equal(control.response().commands[0].commandId, order.commandId);
  control.accept(report({ "relay-39": { active: true, commandId: order.commandId, result: "applied" } }));
  assert.equal(control.actuators()[0].active, true);
  assert.equal(control.actuators()[0].command.status, "confirmed");
  assert.deepEqual(control.response().commands, []);
});
test("short pulses finishing before an acknowledgement are recognized as completed, not assumed still on", () => {
  const { control, report, on } = rig(), order = on();
  control.accept(report({ "relay-39": { active: false, commandId: order.commandId, result: "completed" } }));
  assert.equal(control.actuators()[0].active, false);
  assert.equal(control.actuators()[0].command.status, "confirmed");
});
test("unknown GPIO, automatic dosing, unbounded duration, nonboolean and old-boot orders are rejected", () => {
  for (const change of [{ id: "relay-4" }, { id: "relay-42" }, { mode: "auto" }, { durationMs: 0 }, { durationMs: 10001 },
    { durationMs: 1000.5 }, { active: "true" }, { bootId: "old" }]) {
    const { on } = rig(); assert.throws(() => on("relay-39", change));
  }
});
test("only one pump may be pending or running at a time", () => {
  const { control, report, on } = rig(), order = on();
  assert.throws(() => on("relay-40"), /una bomba/);
  control.accept(report({ "relay-39": { active: true, commandId: order.commandId, result: "applied" } }));
  assert.throws(() => on("relay-40"), /una bomba/);
});
test("OFF supersedes an ON still pending; obsolete acknowledgements cannot confirm the OFF", () => {
  const { control, report, on } = rig(), start = on();
  const stop = control.queue({ id: "relay-39", mode: "manual", active: false, bootId: "boot-a" });
  assert.notEqual(start.commandId, stop.commandId);
  assert.equal(control.response().commands[0].active, false);
  control.accept(report({ "relay-39": { active: true, commandId: start.commandId, result: "applied" } }));
  assert.equal(control.actuators()[0].command.status, "pending");
  control.accept(report({ "relay-39": { active: false, commandId: stop.commandId, result: "applied" } }));
  assert.equal(control.actuators()[0].command.status, "confirmed");
});
test("stop-all cancels pending starts and rejects a delayed ON based on a pre-stop screen", () => {
  const { control, on } = rig();
  const oldRevision = control.info().revision; on(); control.stopAll({ bootId: "boot-a" });
  assert.equal(control.response().commands.length, 3);
  assert.ok(control.response().commands.every(c => c.active === false));
  assert.throws(() => on("relay-40", { revision: oldRevision }), /control cambio/);
});
test("stale telemetry disables control and hides active states; commands expire instead of replaying later", () => {
  const { control, report, on, advance } = rig(); on(); advance(15001);
  assert.equal(control.actuators()[0].active, null);
  assert.equal(control.actuators()[0].controllable, false);
  assert.equal(control.actuators()[0].command.status, "expired");
  assert.throws(() => on(), /sin comunicacion/);
  control.accept(report()); assert.deepEqual(control.response().commands, []);
});
test("reboot aborts pending commands, does not restore outputs and rejects packets from a retired boot", () => {
  const { control, report, on } = rig(); on(); control.accept(report({}, "boot-b"));
  assert.equal(control.actuators()[0].command.status, "aborted");
  assert.equal(control.actuators()[0].active, false);
  assert.deepEqual(control.response().commands, []);
  assert.throws(() => control.accept(report({}, "boot-a")), /anterior/);
});
test("duplicates, missing reports and non-protocol telemetry never count as a confirmation", () => {
  const { control, report } = rig(); const p = report(); control.accept(p);
  assert.throws(() => control.accept(p), /fuera de orden/);
  const missing = report(); missing.actuators.pop(); assert.throws(() => control.accept(missing), /Cantidad/);
  assert.throws(() => control.accept({ ...report(), device: { ...report().device, capability: "unknown" } }), /protocolo/);
});
test("firmware rejections are reported as failures, not optimistic success", () => {
  const { control, report, on } = rig(), order = on();
  control.accept(report({ "relay-39": { commandId: order.commandId, result: "rejected" } }));
  assert.equal(control.actuators()[0].command.status, "failed");
  assert.equal(control.actuators()[0].active, false);
});

test("legacy firmware never enables GPIO41 or includes it in stop-all commands", () => {
  const { control, on } = rig({ continuous: true });
  const fourth = control.actuators().find(a => a.id === "relay-41");
  assert.equal(fourth.supported, false); assert.equal(fourth.active, null); assert.equal(fourth.controllable, false);
  assert.throws(() => on("relay-41"), /Actualizar el firmware/);
  assert.deepEqual(control.stopAll({ bootId: "boot-a" }).map(c => c.id), LEGACY_RELAYS.map(r => r.id));
});

test("fourth pump uses confirmed manual pulse and continuous orders and the one-pump interlock", () => {
  for (const runMode of ["pulse", "continuous"]) {
    const { control, report, on } = rig({ four: true });
    assert.equal(control.info().supportedRelayIds.length, 4);
    const order = on("relay-41", { runMode, durationMs: runMode === "continuous" ? 0 : 5000 });
    assert.equal(control.actuators()[3].active, false);
    assert.throws(() => on("relay-39"), /una bomba/);
    control.accept(report({ "relay-41": { active: true, runMode, durationMs: order.durationMs, commandId: order.commandId, result: "applied" } }));
    assert.equal(control.actuators()[3].active, true);
    assert.equal(control.actuators()[3].command.status, "confirmed");
    assert.throws(() => on("relay-47"), /una bomba/);
    const stops = control.stopAll({ bootId: "boot-a" }); assert.equal(stops.length, 4);
    control.accept(report(Object.fromEntries(stops.map(c => [c.id, { active: false, durationMs: 0, commandId: c.commandId, result: "applied" }]))));
    assert.ok(control.actuators().every(a => a.active === false && a.command.status === "confirmed"));
  }
});

test("four-pump capability requires an exact report set and a new boot for topology changes", () => {
  const modern = rig({ four: true }), missing = modern.report(); missing.actuators.pop();
  assert.throws(() => modern.control.accept(missing), /Cantidad/);
  const legacy = rig({ continuous: true }), extra = legacy.report(); extra.actuators.push(modern.report().actuators[3]);
  assert.throws(() => legacy.control.accept(extra), /Cantidad/);
  assert.throws(() => legacy.control.accept(modern.report()), /capacidad/);
  const start = legacy.on();
  legacy.control.accept(modern.report({}, "boot-v3"));
  assert.equal(legacy.control.actuators()[0].command.status, "aborted");
  assert.ok(legacy.control.actuators().every(a => a.active === false));
  assert.equal(legacy.control.response().commands.some(c => c.commandId === start.commandId), false);
});

test("GPIO41 is disabled on lost contact and never restarts automatically after reboot", () => {
  const { control, report, on, advance } = rig({ four: true });
  const order = on("relay-41", { runMode: "continuous", durationMs: 0 });
  control.accept(report({ "relay-41": { active: true, runMode: "continuous", durationMs: 0, commandId: order.commandId, result: "applied" } }));
  advance(15001);
  assert.equal(control.actuators()[3].active, null); assert.equal(control.actuators()[3].controllable, false);
  control.accept(report({}, "boot-b"));
  assert.ok(control.actuators().every(a => a.active === false));
  assert.deepEqual(control.response().commands, []);
  assert.equal(control.info().supportedRelayIds.includes("relay-42"), false);
});

test("continuous operation requires the upgraded firmware capability, not just duration zero", () => {
  const old = rig();
  assert.equal(old.control.info().continuousSupported, false);
  assert.throws(() => old.on("relay-39", { runMode: "continuous", durationMs: 0 }), /Actualizar el firmware/);
  const { control, on } = rig({ continuous: true });
  assert.equal(control.info().continuousSupported, true);
  assert.equal(control.info().maximumRunMs, null);
  assert.equal(control.info().maximumPulseMs, 10000);
  for (const changes of [{ durationMs: 0 }, { runMode: "continuous", durationMs: 5000 },
    { runMode: "continuous", durationMs: undefined }, { runMode: "unknown", durationMs: 0 }]) assert.throws(() => on("relay-39", changes));
});

test("continuous starts are explicit, confirmed by matching reports and not limited by the pulse or delivery timer", () => {
  const { control, report, on, advance } = rig({ continuous: true });
  const order = on("relay-39", { runMode: "continuous", durationMs: 0 });
  assert.equal(control.actuators()[0].active, false);
  assert.equal(control.actuators()[0].command.status, "pending");
  assert.equal(control.response().commands[0].runMode, "continuous");
  assert.equal(control.response().commands[0].durationMs, 0);
  const active = { active: true, runMode: "continuous", durationMs: 0, result: "applied", commandId: order.commandId };
  control.accept(report({ "relay-39": active }));
  assert.equal(control.actuators()[0].command.status, "confirmed");
  advance(60000); control.accept(report({ "relay-39": active }));
  assert.equal(control.actuators()[0].active, true);
  assert.equal(control.actuators()[0].runMode, "continuous");
  assert.deepEqual(control.response().commands, []);
  assert.throws(() => on("relay-40"), /una bomba/);
  const stop = control.queue({ id: "relay-39", mode: "manual", active: false, bootId: "boot-a" });
  assert.equal(stop.runMode, "pulse");
  control.accept(report({ "relay-39": { active: false, durationMs: 0, result: "applied", commandId: stop.commandId } }));
  assert.equal(control.actuators()[0].active, false);
  assert.equal(control.actuators()[0].command.status, "confirmed");
});

test("a pulse or completed pulse cannot falsely acknowledge a continuous order", () => {
  const { control, report, on } = rig({ continuous: true });
  const order = on("relay-39", { runMode: "continuous", durationMs: 0 });
  control.accept(report({ "relay-39": { active: true, runMode: "pulse", durationMs: 5000, result: "applied", commandId: order.commandId } }));
  assert.equal(control.actuators()[0].command.status, "pending");
  control.accept(report({ "relay-39": { active: false, result: "completed", commandId: order.commandId } }));
  assert.equal(control.actuators()[0].command.status, "pending");
});

test("continuous remains off after failsafe/reconnection or reboot, with no automatic restart order", () => {
  const { control, report, on, advance } = rig({ continuous: true });
  const order = on("relay-39", { runMode: "continuous", durationMs: 0 });
  control.accept(report({ "relay-39": { active: true, runMode: "continuous", durationMs: 0, result: "applied", commandId: order.commandId } }));
  advance(31000);
  assert.equal(control.actuators()[0].active, null);
  control.accept(report({ "relay-39": { active: false, mode: "safe-off", durationMs: 0, result: "failsafe", commandId: order.commandId } }));
  assert.equal(control.actuators()[0].active, false);
  assert.equal(control.actuators()[0].result, "failsafe");
  assert.deepEqual(control.response().commands, []);
  control.accept(report({}, "boot-b"));
  assert.ok(control.actuators().every(a => !a.active));
  assert.deepEqual(control.response().commands, []);
});

test("continuous capability and runtime telemetry are strictly validated", () => {
  const { control, report } = rig({ continuous: true });
  const invalid = report(); delete invalid.actuators[0].runMode;
  assert.throws(() => control.accept(invalid), /Modo de funcionamiento/);
  const inconsistent = report(); Object.assign(inconsistent.actuators[0], { runMode: "continuous", durationMs: 5000 });
  assert.throws(() => control.accept(inconsistent), /Modo de funcionamiento/);
  const old = rig(), changed = report();
  assert.throws(() => old.control.accept(changed), /capacidad/);
  const mismatched = report(); mismatched.firmwareBuild = "tesis-huerta-j17-wifi-v1";
  assert.throws(() => control.accept(mismatched), /protocolo/);
});

const request = (ip = "192.0.2.20", extra = {}) => ({ socket: { remoteAddress: ip },
  headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173", ...extra } });
test("control rejects cross-site and DNS-rebinding origins, even for loopback clients", () => {
  const access = createControlAccess({ token: "a-secure-control-token" });
  assert.throws(() => access.authorize(request("127.0.0.1", { origin: "https://other.example" })), /Origen/);
  assert.equal(sameOrigin(request("127.0.0.1", { host: "evil.example", origin: "http://evil.example" })), false);
  assert.throws(() => access.authorize(request("127.0.0.1", { origin: undefined })), /Origen/);
});
test("remote clients need a password session; local PC controls need no secret exposed to browser code", () => {
  const access = createControlAccess({ token: "a-secure-control-token" });
  assert.doesNotThrow(() => access.authorize(request("127.0.0.1")));
  assert.throws(() => access.authorize(request()), /clave/);
  assert.throws(() => access.login(request(), "incorrect"), /incorrecta/);
  const cookie = access.login(request(), "a-secure-control-token");
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.doesNotThrow(() => access.authorize(request("192.0.2.20", { cookie: cookie.split(";")[0] })));
  assert.throws(() => createControlAccess().authorize(request("127.0.0.1")), /Configurar/);
});
test("password guessing is rate-limited and sessions expire", () => {
  let time = 0; const access = createControlAccess({ token: "a-secure-control-token", now: () => time });
  const cookie = access.login(request(), "a-secure-control-token").split(";")[0];
  for (let i = 0; i < 5; i++) assert.throws(() => access.login(request(), "bad"), /incorrecta/);
  assert.throws(() => access.login(request(), "a-secure-control-token"), /Demasiados/);
  time = 8 * 3600000 + 1;
  assert.throws(() => access.authorize(request("192.0.2.20", { cookie })), /clave/);
});
test("Wi-Fi sketch preserves every sensor pin, removes lux actuation and has an independent pump cutoff", () => {
  const root = path.join(__dirname, "../firmware/tesis_huerta_j17_wifi");
  const sensors = fs.readFileSync(path.join(root, "sensores_j17.h"), "utf8"), sketch = fs.readFileSync(path.join(root, "tesis_huerta_j17_wifi.ino"), "utf8");
  for (const [name, pin] of Object.entries({ PIN_PH: 1, PIN_TDS: 2, PIN_NIVEL_RES: 3, PIN_DHT: 10, PIN_DS18B20: 11,
    PIN_SDA: 8, PIN_SCL: 9, PIN_MHZ_RX: 16, PIN_MHZ_TX: 17, US1_TRIG: 4, US1_ECHO: 5, US2_TRIG: 6, US2_ECHO: 7,
    US3_TRIG: 12, US3_ECHO: 13, US4_TRIG: 14, US4_ECHO: 15, US5_TRIG: 18, US5_ECHO: 21 })) assert.match(sensors, new RegExp(`#define ${name}\\s+${pin}\\b`));
  assert.match(sensors, /RELAY_PINS\[\] = \{39, 40, 47\}/);
  assert.doesNotMatch(sensors + sketch, /controlActuadores\(/);
  assert.match(sketch, /MAX_PUMP_MS = 10000/); assert.match(sketch, /xTaskCreate\(pumpSafetyTask/);
  assert.match(sketch, /now - pumps\[i\]\.startedAt >= pumps\[i\]\.durationMs/);
  assert.match(sketch, /pumps\[i\]\.active && !pumps\[i\]\.continuous && now - pumps\[i\]\.startedAt/);
  assert.match(sketch, /now - lastContactAt >= CONTACT_TIMEOUT_MS && pumps\[i\]\.active/);
  assert.match(sketch, /CONTACT_TIMEOUT_MS = 30000/);
  assert.match(sketch, /continuous && \(!cJSON_IsTrue\(active\) \|\| duration->valueint != 0\)/);
  assert.match(sketch, /pumps\[index\]\.continuous = false/);
  assert.match(sketch, /pumps\[0\]\.active \|\| pumps\[1\]\.active \|\| pumps\[2\]\.active/);
});

const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "../firmware/tesis_huerta_j17_wifi_v3");
const sensors = fs.readFileSync(path.join(root, "sensores_j17.h"), "utf8");
const sketch = fs.readFileSync(path.join(root, "tesis_huerta_j17_wifi_v3.ino"), "utf8");
test("four-pump firmware preserves the sensor acquisition functions and GPIO assignments", () => {
  const legacy = fs.readFileSync(path.join(root, "../tesis_huerta_j17_wifi/sensores_j17.h"), "utf8");
  assert.equal(sensors.slice(sensors.indexOf("// ===================== LECTURAS AGRUPADAS")).trimEnd(), legacy.slice(legacy.indexOf("// ===================== LECTURAS AGRUPADAS")).trimEnd());
  const acquisition = text => text.slice(text.indexOf("// ===================== OBJETOS"), text.indexOf("// ===================== RELES"));
  assert.equal(acquisition(sensors), acquisition(legacy));
  for (const [name, pin] of Object.entries({ PIN_PH: 1, PIN_TDS: 2, PIN_NIVEL_RES: 3, PIN_DHT: 10, PIN_DS18B20: 11,
    PIN_SDA: 8, PIN_SCL: 9, PIN_MHZ_RX: 16, PIN_MHZ_TX: 17, US1_TRIG: 4, US1_ECHO: 5, US2_TRIG: 6, US2_ECHO: 7,
    US3_TRIG: 12, US3_ECHO: 13, US4_TRIG: 14, US4_ECHO: 15, US5_TRIG: 18, US5_ECHO: 21 })) {
    assert.match(sensors, new RegExp("#define " + name + "\\s+" + pin + "\\b"));
  }
  assert.match(sensors, /RELAY_PINS\[\] = \{39, 40, 47, 41\}/);
  assert.match(sensors, /RELAY_ACTIVE_LOW_BY_INDEX\[\] = \{true, true, false, true\}/);
});
test("boot OFF levels, the independent cutoff and the interlock cover every pump including GPIO41", () => {
  assert.match(sketch, /PumpState pumps\[RELAY_COUNT\]/);
  assert.doesNotMatch(sketch, /i < 3|pumps\[3\]|pumps\[0\]\.active \|\|/);
  assert.match(sketch, /for \(uint8_t i = 0; i < RELAY_COUNT; i\+\+\) if \(pumps\[i\]\.active\) return true/);
  assert.match(sketch, /cJSON_GetArraySize\(commands\) > RELAY_COUNT/);
  assert.match(sketch, /MAX_PUMP_MS = 10000/);
  assert.match(sketch, /CONTACT_TIMEOUT_MS = 30000/);
  assert.match(sketch, /now - pumps\[i\]\.startedAt >= pumps\[i\]\.durationMs/);
  assert.match(sketch, /now - lastContactAt >= CONTACT_TIMEOUT_MS && pumps\[i\]\.active/);
  assert.match(sketch, /xTaskCreate\(pumpSafetyTask/);
  const setup = sketch.slice(sketch.indexOf("void setup()"), sketch.indexOf("iniciarSensores();"));
  assert.ok(setup.indexOf("gpio_set_level") < setup.indexOf("pinMode"));
  assert.match(setup, /RELAY_ACTIVE_LOW_BY_INDEX\[i\] \? HIGH : LOW/);
  assert.match(sketch, /"tesis-huerta-j17-wifi-v3"/);
  assert.match(sketch, /"four-timed-continuous-pumps-v3"/);
});

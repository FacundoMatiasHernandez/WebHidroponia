const test = require("node:test");
const assert = require("node:assert/strict");
const { parseBlock, createSerialParser } = require("../app/esp32-serial-parser");
const { normalizeLiveEntry, visibleSnapshot } = require("../app/live-readings");
const lines = ["Lux: 171.36 lux", "CO2: 876 ppm | Temp MH-Z19: 20 C",
  "Temp ambiente: 23.9 C | Humedad: 44.0 %", "Temp agua: 23.37 C (DS encontrados: 1) | pH: 27.96  | TDS: 0 ppm",
  "Matriz resistiva nivel RAW: 0", "Ultrasonico 1: 16.6 cm", "Ultrasonico 2: sin eco", "Ultrasonico 3: sin eco",
  "Ultrasonico 4: sin eco", "Ultrasonico 5: sin eco", "Reles por lux: apagados | ON >= 500 lux | OFF <= 400 lux"];
const date = new Date("2026-11-08T23:00:00.000Z");
const sensor = { id: "water-ph", label: "pH", unit: "pH", decimals: 2, channel: "test" };
test("parses the actual board protocol and does not invent level percent or EC", () => {
  const p = parseBlock(lines, date), get = id => p.readings.find(r => r.sensorId === id);
  assert.equal(get("air-temperature").value, 23.9); assert.equal(get("air-co2").value, 876);
  assert.equal(get("water-temperature").value, 23.37); assert.equal(get("water-tds").value, 0);
  assert.equal(get("water-level-raw").value, 0); assert.equal(get("distance-1").value, 16.6);
  assert.equal(get("distance-2").value, null); assert.equal(get("water-level").status, "uncalibrated");
  assert.equal(get("water-ec").value, null); assert.equal(p.actuators[0].active, false);
});
test("startup ERROR and missing echo do not become zero, sentinel temperatures or old values", () => {
  const p = parseBlock(["Lux: ERROR", "CO2: ERROR | Temp MH-Z19: -100 C",
    "Temp ambiente: ERROR | Humedad: ERROR", "Temp agua: ERROR (DS encontrados: 1) | pH: ERROR | TDS: ERROR"]);
  assert.ok(p.readings.filter(r => !["water-level", "water-ec"].includes(r.sensorId)).every(r => r.value === null));
});
test("stream framing tolerates chunk boundaries and ignores startup/truncated blocks", () => {
  const frames = [], parser = createSerialParser(p => frames.push(p), () => date);
  parser.push("ESP-ROM...\nUltrasonico 1: 1 cm\n");
  const block = "========== LECTURAS SISTEMA ==========\r\n" + lines.join("\r\n") + "\r\n=====================================\r\n";
  for (const char of block) parser.push(char);
  parser.push("========== LECTURAS SISTEMA ==========\nLux: 1 lux\n");
  assert.equal(frames.length, 1); assert.equal(frames[0].timestamp, date.toISOString());
});
test("invalid pH is rejected without clamping it to an apparently valid result", () => {
  const r = normalizeLiveEntry(sensor, { value: 27.96 }, "esp32-usb", date, () => "ok");
  assert.equal(r.value, null); assert.equal(r.status, "error"); assert.equal(r.reportedValue, 27.96);
  assert.equal(normalizeLiveEntry(sensor, { value: 0, status: "error" }, "esp32-usb", date, () => "ok").value, null);
});
test("mock, foreign-source, stale and future samples never appear as current live data", () => {
  const r = normalizeLiveEntry(sensor, { value: 6.2 }, "esp32-usb", date, () => "ok");
  const visible = (entry, now = date.getTime()) => visibleSnapshot([sensor], { "water-ph": entry }, "esp32-usb", now)["water-ph"];
  assert.equal(visible(r).value, 6.2); assert.equal(visible({ ...r, source: "mock-backend" }).value, null);
  assert.equal(visible({ ...r, source: "old-board" }).value, null);
  assert.equal(visible(r, date.getTime() + 15001).status, "stale");
  assert.equal(visible({ ...r, timestamp: new Date(date.getTime() + 60000).toISOString() }).value, null);
});

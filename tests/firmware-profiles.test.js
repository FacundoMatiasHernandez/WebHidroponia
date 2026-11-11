const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { J17, enrichJ17 } = require("../app/firmware-profiles");
const { normalizeLiveEntry } = require("../app/live-readings");
const { parseBlock } = require("../app/esp32-serial-parser");
test("the J17 conversion constants match the preserved user firmware", () => {
  const ino = fs.readFileSync(path.join(__dirname, "../firmware/tesis_huerta_j17_original/TESIS_HUERTA_J17.ino"), "utf8");
  assert.match(ino, /#define PIN_PH\s+1\b/); assert.match(ino, /#define PIN_TDS\s+2\b/);
  assert.match(ino, /857\.39 \* compensationVoltage\) \* 0\.5/);
  assert.equal(J17.tdsFactor, 0.5);
});
test("J17 reconstructs EC with explicit estimated provenance, not a new calibrated measurement", () => {
  const m = new Map([["water-tds", { value: 500 }]]); enrichJ17(m);
  const ec = m.get("water-ec"); assert.equal(ec.value, 1); assert.equal(ec.quality, "estimated");
  const stored = normalizeLiveEntry({ id: "water-ec", decimals: 3 }, ec, "esp32-usb", new Date(), () => "ok");
  assert.equal(stored.value, 1); assert.equal(stored.status, "estimated"); assert.equal(stored.derivedFrom, "water-tds");
});
test("zero TDS stays a qualified zero estimate; failed, absent or invalid TDS yields no EC", () => {
  const zero = new Map([["water-tds", { value: 0 }]]); enrichJ17(zero);
  assert.equal(zero.get("water-ec").value, 0); assert.equal(zero.get("water-ec").quality, "estimated");
  for (const tds of [undefined, { value: null, status: "error" }, { value: 0, status: "error" }, { value: -1 }, { value: 50001 }]) {
    const m = new Map([["water-tds", tds]]); enrichJ17(m); assert.equal(m.get("water-ec").value, null);
  }
});
test("the pH zero-input clue is diagnostic only and never supplies a valid pH", () => {
  const m = new Map([["water-ph", { value: 27.96 }]]); enrichJ17(m);
  const ph = m.get("water-ph"); assert.match(ph.note, /0 V en GPIO1/);
  const stored = normalizeLiveEntry({ id: "water-ph", unit: "pH", decimals: 2 }, ph, "esp32-usb", new Date(), () => "ok");
  assert.equal(stored.value, null); assert.equal(stored.status, "error"); assert.equal(stored.reportedValue, 27.96);
});
test("the profile is opt-in and the actual uppercase relay state is parsed", () => {
  const lines = ["Lux: 600 lux", "Temp ambiente: 23.9 C | Humedad: 44.0 %",
    "Temp agua: 23.3 C (DS encontrados: 1) | pH: 6.20 | TDS: 500 ppm", "Reles por lux: ENCENDIDOS | ON >= 500 lux | OFF <= 400 lux"];
  const unknown = parseBlock(lines); assert.equal(unknown.readings.find(r => r.sensorId === "water-ec").value, null);
  const known = parseBlock(lines, new Date(), { firmwareProfile: J17.id });
  assert.equal(known.readings.find(r => r.sensorId === "water-ec").value, 1);
  assert.equal(known.actuators[0].active, true);
});
test("diagnostic firmware reports real ADC/millivolts and unrounded EC separately from pH validity", () => {
  const lines = ["Firmware perfil: tesis-huerta-j17-diagnostico-v1", "Lux: 171 lux",
    "Temp ambiente: 23.9 C | Humedad: 44.0 %", "Temp agua: 23.3 C (DS encontrados: 1) | pH: 27.96 | TDS: 500 ppm",
    "PH ADC: raw=0 | GPIO mV=0", "TDS ADC: raw=1510 | GPIO mV=1120", "EC estimada: 1.000123 mS/cm"];
  const p = parseBlock(lines, new Date(), { firmwareProfile: J17.id });
  const ph = p.readings.find(r => r.sensorId === "water-ph"), ec = p.readings.find(r => r.sensorId === "water-ec");
  assert.equal(ph.diagnostic.raw, 0); assert.equal(ph.diagnostic.millivolts, 0); assert.match(ph.note, /Entrada en cero/);
  assert.equal(ec.value, 1.000123); assert.equal(ec.quality, "estimated"); assert.equal(ec.diagnostic.pin, 2);
});
test("diagnostic changes preserve GPIO assignments and relay control verbatim", () => {
  const original = fs.readFileSync(path.join(__dirname, "../firmware/tesis_huerta_j17_original/TESIS_HUERTA_J17.ino"), "utf8");
  const diagnostic = fs.readFileSync(path.join(__dirname, "../firmware/tesis_huerta_j17_diagnostico/tesis_huerta_j17_diagnostico.ino"), "utf8");
  for (const name of ["escribirRele", "apagarReles", "controlActuadores"]) {
    const pattern = new RegExp(`void ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
    assert.equal(diagnostic.match(pattern)?.[0], original.match(pattern)?.[0]);
  }
  assert.deepEqual(diagnostic.match(/^#define (?:PIN_|US\d_).+$/gm), original.match(/^#define (?:PIN_|US\d_).+$/gm));
});

const LIMITS = {
  "air-humidity": [0, 100], "air-temperature": [-40, 85], "air-co2": [1, 10000],
  "water-temperature": [-55, 125], "water-ph": [0, 14], "light-intensity": [0, 200000],
  "water-level": [0, 100], "water-ec": [0, 100], "water-tds": [0, 50000], "water-level-raw": [0, 4095]
};
for (let i = 1; i <= 5; i++) LIMITS[`distance-${i}`] = [0.1, 450];
const UNAVAILABLE = new Set(["error", "missing", "uncalibrated", "unsupported", "stale"]);
function unavailable(sensor, source, date, status = "missing", note = "Sin lectura de esta placa") {
  return { sensorId: sensor.id, label: sensor.label, unit: sensor.unit, channel: sensor.channel,
    value: null, status, source, timestamp: date.toISOString(), note };
}
function normalizeLiveEntry(sensor, entry, source, date, statusFor) {
  const d = entry.diagnostic;
  const diagnostic = d && [1, 2].includes(d.pin) && Number.isInteger(d.raw) && d.raw >= 0 && d.raw <= 4095
    && Number.isInteger(d.millivolts) && d.millivolts >= 0 && d.millivolts <= 3300
    ? { diagnostic: { pin: d.pin, raw: d.raw, millivolts: d.millivolts } } : {};
  if (UNAVAILABLE.has(entry.status)) {
    return { ...unavailable(sensor, source, date, entry.status, typeof entry.note === "string" ? entry.note.slice(0, 240) : "Sin lectura valida"), ...diagnostic };
  }
  const value = typeof entry.value === "number" ? entry.value
    : typeof entry.value === "string" && entry.value.trim() ? Number(entry.value) : NaN;
  if (!Number.isFinite(value)) return null;
  const limits = LIMITS[sensor.id];
  if (limits && (value < limits[0] || value > limits[1])) {
    return { ...unavailable(sensor, source, date, "error", `La placa informa ${value} ${sensor.unit}; fuera de ${limits[0]}-${limits[1]}. ${entry.note || "Revisar sensor y calibracion."}`), reportedValue: value, ...diagnostic };
  }
  return { sensorId: sensor.id, label: sensor.label, unit: sensor.unit, channel: sensor.channel,
    value: Number(value.toFixed(sensor.decimals)), status: entry.quality === "estimated" ? "estimated"
      : entry.calibration === "pending" ? "uncalibrated-reading" : sensor.telemetry ? "info" : statusFor(sensor, value),
    source, timestamp: date.toISOString(), ...(typeof entry.note === "string" ? { note: entry.note.slice(0, 240) } : {}),
    ...(entry.quality === "estimated" ? { quality: "estimated", derivedFrom: "water-tds", conversionFactor: 0.5 } : {}),
    ...(entry.calibration === "pending" ? { calibration: "pending" } : {}), ...diagnostic };
}
function visibleSnapshot(sensors, snapshot, source, now = Date.now(), staleMs = 15000) {
  return Object.fromEntries(sensors.map(sensor => {
    const reading = snapshot[sensor.id], date = new Date(now);
    if (!reading || reading.source !== source || reading.source === "mock-backend") return [sensor.id, unavailable(sensor, source, date)];
    const age = now - Date.parse(reading.timestamp);
    if (!Number.isFinite(age) || age > staleMs || age < -5000) return [sensor.id,
      { ...unavailable(sensor, source, date, "stale", "Sin datos recientes; no se muestra como medicion actual"), lastReadingAt: reading.timestamp }];
    return [sensor.id, reading];
  }));
}
const USB_SENSORS = [
  { id: "water-tds", label: "Solidos disueltos (TDS)", unit: "ppm", decimals: 0, min: 0, max: 2000, idealMin: 0, idealMax: 2000, base: 0, step: 0, color: "#9fddff", telemetry: true, channel: "huerta/sensores/agua/tds" },
  { id: "water-level-raw", label: "Matriz de nivel (RAW)", unit: "RAW", decimals: 0, min: 0, max: 4095, idealMin: 0, idealMax: 4095, base: 0, step: 0, color: "#8fe0ff", telemetry: true, channel: "huerta/sensores/agua/nivel-raw" },
  ...Array.from({ length: 5 }, (_, i) => ({ id: `distance-${i + 1}`, label: `Ultrasonico ${i + 1}`, unit: "cm", decimals: 1,
    min: 0, max: 450, idealMin: 0, idealMax: 450, base: 0, step: 0, color: "#8fe0ff", telemetry: true, channel: `huerta/sensores/distancia/${i + 1}` }))
];
module.exports = { LIMITS, USB_SENSORS, unavailable, normalizeLiveEntry, visibleSnapshot };

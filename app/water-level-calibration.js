const UNAVAILABLE = new Set(["error", "missing", "uncalibrated", "unsupported", "stale"]);
const NOTE = "Respuesta relativa entre sensor seco (0%) y sumergido (100%). No mide litros ni porcentaje de llenado del tanque.";
const adc = value => Number.isInteger(value) && value >= 0 && value <= 4095;

function validateCalibration(record) {
  if (record?.schemaVersion !== 1 || record.status !== "calibrated" || record.sensorId !== "water-level-raw"
    || record.outputSensorId !== "water-level" || record.pin !== 3 || record.source !== "esp32-wifi"
    || record.method !== "two-point-linear-reference" || record.meaning !== "relative-sensor-response-not-tank-volume"
    || !record.deviceId || !record.firmwareBuild || !Number.isFinite(Date.parse(record.completedAt))) return null;
  for (const point of [record.dry, record.wet]) {
    if (!point || !adc(point.referenceRaw) || !adc(point.minimumRaw) || !adc(point.maximumRaw)
      || point.minimumRaw > point.referenceRaw || point.maximumRaw < point.referenceRaw
      || !Number.isInteger(point.sampleCount) || point.sampleCount < 10) return null;
  }
  const span = Math.abs(record.wet.referenceRaw - record.dry.referenceRaw);
  const noise = Math.max(record.dry.maximumRaw - record.dry.minimumRaw, record.wet.maximumRaw - record.wet.minimumRaw);
  if (span < Math.max(100, noise * 5)) return null;
  return Object.freeze({ kind: "resistive-two-point", source: record.source, deviceId: record.deviceId,
    firmwareBuild: record.firmwareBuild, pin: 3, dryRaw: record.dry.referenceRaw, wetRaw: record.wet.referenceRaw,
    rawMin: Math.min(record.dry.minimumRaw, record.wet.minimumRaw), rawMax: Math.max(record.dry.maximumRaw, record.wet.maximumRaw),
    referenceTolerance: Math.max(5, noise),
    id: record.completedAt, completedAt: record.completedAt });
}

function matches(calibration, meta) {
  return calibration && meta?.dataMode === calibration.source && meta?.transport?.deviceId === calibration.deviceId
    && meta?.firmwareBuild === calibration.firmwareBuild;
}

function levelReading(raw, calibration, now = Date.now(), historical = false) {
  const reading = { sensorId: "water-level", label: "Nivel resistivo", unit: "%", channel: "huerta/sensores/agua/nivel",
    source: calibration.source, timestamp: raw?.timestamp || new Date(now).toISOString(), value: null, status: "missing", note: NOTE };
  if (!raw || raw.source !== calibration.source) return reading;
  const time = Date.parse(raw.timestamp);
  if (!Number.isFinite(time) || time < Date.parse(calibration.completedAt) || time > now + 5000 || (!historical && now - time > 15000)) {
    return { ...reading, status: "stale", lastReadingAt: raw.lastReadingAt || raw.timestamp };
  }
  if (UNAVAILABLE.has(raw.status)) return { ...reading, status: raw.status, lastReadingAt: raw.lastReadingAt || raw.timestamp };
  if (!adc(raw.value) || !["info", "ok"].includes(raw.status)) return { ...reading, status: "error", note: "La señal RAW no es válida; no se calcula el nivel." };
  const unboundedPercent = (raw.value - calibration.dryRaw) * 100 / (calibration.wetRaw - calibration.dryRaw);
  const clipped = unboundedPercent < 0 || unboundedPercent > 100;
  const outsideReference = raw.value < calibration.rawMin - calibration.referenceTolerance
    || raw.value > calibration.rawMax + calibration.referenceTolerance;
  const boundedPercent = Math.max(0, Math.min(100, unboundedPercent));
  // Do not round a below-reference signal up to the fully-wet endpoint.
  const percent = boundedPercent === 100 ? 100 : Math.min(99, Math.round(boundedPercent));
  return { ...reading, value: percent, status: "info", derivedFrom: "water-level-raw",
    note: NOTE + (clipped ? " Señal fuera de las referencias; el porcentaje se limita a 0-100%. Revisar si persiste." : ""),
    levelCalibration: { ...calibration, raw: raw.value, clipped, outsideReference, unboundedPercent } };
}

function projectLevelState(snapshot, history, meta, calibration, now = Date.now()) {
  if (!matches(calibration, meta)) return { snapshot, history, applied: false };
  // Project only actual RAW samples; never reuse the last percentage after signal loss.
  const points = (history["water-level-raw"] || []).filter(point => point.source === calibration.source
    && Date.parse(point.timestamp) >= Date.parse(calibration.completedAt));
  return { applied: true, snapshot: { ...snapshot, "water-level": levelReading(snapshot["water-level-raw"], calibration, now) },
    history: { ...history, "water-level": points.map(point => levelReading(point, calibration, now, true)) } };
}

module.exports = { validateCalibration, projectLevelState, levelReading };

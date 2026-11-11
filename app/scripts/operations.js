(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HydroVisionOperations = api;
})(typeof window === "undefined" ? this : window, function () {
  const LIVE_SOURCES = new Set(["esp32-wifi", "esp32-usb", "esp32-direct"]);
  const GROUPS = [
    { id: "environment", label: "Ambiente", icon: "i-leaf", ids: ["air-temperature", "air-humidity", "air-co2", "light-intensity"] },
    { id: "solution", label: "Solución nutritiva", icon: "i-drop", ids: ["water-temperature", "water-ph", "water-ec", "water-tds"] },
    { id: "levels", label: "Niveles y depósitos", icon: "i-drop", ids: ["water-level", "distance-1", "distance-2", "distance-3", "distance-4", "distance-5", "water-level-raw"] }
  ];
  const DEFINITIONS = [
    ["air-temperature", "Temperatura", "°C", 1, 20, 28], ["air-humidity", "Humedad", "%", 1, 55, 75],
    ["air-co2", "Dióxido de carbono", "ppm", 0, 500, 1200], ["light-intensity", "Iluminación", "lux", 0, 18000, 28000],
    ["water-temperature", "Temperatura del agua", "°C", 1, 18, 24], ["water-ph", "pH", "pH", 2, 5.8, 6.5],
    ["water-ec", "Conductividad", "mS/cm", 3, 1.2, 2.4], ["water-tds", "Sólidos disueltos", "ppm", 0],
    ["water-level", "Nivel resistivo", "%", 0], ["water-level-raw", "Señal de nivel", "RAW", 0],
    ...Array.from({ length: 5 }, (_, i) => ["distance-" + (i + 1), "Distancia " + (i + 1), "cm", 1])
  ];
  const SENSORS = DEFINITIONS.map(([id, label, unit, decimals, idealMin, idealMax]) => ({ id, label, unit, decimals, idealMin, idealMax }));
  const PRIMARY_IDS = GROUPS.slice(0, 2).flatMap(group => group.ids);
  const INVALID = new Set(["missing", "stale", "error", "unsupported", "uncalibrated"]);
  const isLiveSource = source => LIVE_SOURCES.has(source);
  const isRecent = (timestamp, now = Date.now()) => Number.isFinite(Date.parse(timestamp)) && now - Date.parse(timestamp) >= -5000 && now - Date.parse(timestamp) <= 15000;
  function visibleReading(entry, source, now = Date.now()) {
    if (!isLiveSource(source) || !entry || entry.source !== source) return { value: null, status: "missing", timestamp: null, note: "Esperando una lectura del equipo." };
    if (!isRecent(entry.timestamp, now)) return { ...entry, value: null, status: "stale", note: "No hay una lectura reciente. Revisá la conexión del equipo." };
    return { ...entry, value: Number.isFinite(entry.value) && !INVALID.has(entry.status) ? entry.value : null };
  }
  function sensorLabel(sensor) { return SENSORS.find(s => s.id === sensor.id)?.label || sensor.label; }
  function readingState(reading) {
    if (Number.isFinite(reading?.value) && reading.levelCalibration?.kind === "resistive-two-point") {
      return { label: reading.levelCalibration.outsideReference ? "Fuera de referencia" : "Referencia calibrada",
        tone: reading.levelCalibration.outsideReference ? "warning" : "neutral", help: reading.note };
    }
    const states = {
      stale: ["Sin actualizar", "neutral", "Esperando una nueva lectura."],
      missing: ["Sin lectura", "neutral", "El equipo todavía no informa este parámetro."],
      unsupported: ["No disponible", "neutral", "El equipo no informa este parámetro."],
      uncalibrated: ["Por calibrar", "warning", "Falta una referencia para calcular esta medición."],
      error: ["Revisar sensor", "warning", "La lectura no es utilizable; revisá conexión y calibración."],
      estimated: ["Estimada", "neutral", "Calculada a partir de TDS; calibración pendiente."],
      "uncalibrated-reading": ["Sin calibrar", "warning", "Lectura del equipo con calibración pendiente."],
      critical: ["Fuera de objetivo", "danger", "Fuera del intervalo de referencia configurado."],
      warning: ["Fuera de objetivo", "warning", "Fuera del intervalo de referencia configurado."],
      info: ["Reportada", "neutral", "Medición informada por el equipo."],
      ok: ["En objetivo", "ok", "Dentro del intervalo de referencia configurado."]
    };
    const [label, tone, help] = states[reading?.status] || states.missing;
    return { label, tone, help };
  }
  function formatValue(sensor, reading) {
    return Number.isFinite(reading?.value) ? new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: sensor.decimals || 0, maximumFractionDigits: sensor.decimals || 0
    }).format(reading.value) : "--";
  }
  function summarize(sensors, snapshot, source, actuators = [], now = Date.now()) {
    const entries = sensors.map(sensor => ({ sensor, reading: visibleReading(snapshot[sensor.id], source, now) }));
    const primary = entries.filter(e => PRIMARY_IDS.includes(e.sensor.id));
    const outside = primary.filter(e => ["critical", "warning"].includes(e.reading.status));
    const quality = entries.filter(e => ["error", "uncalibrated", "uncalibrated-reading", "estimated", "missing", "stale", "unsupported"].includes(e.reading.status)
      || e.reading.levelCalibration?.outsideReference);
    const rank = { critical: 0, error: 1, warning: 2, uncalibrated: 3, "uncalibrated-reading": 3, estimated: 4, missing: 5, stale: 5, unsupported: 5 };
    const issues = entries.filter(e => Object.hasOwn(rank, e.reading.status) || e.reading.levelCalibration?.outsideReference)
      .sort((a, b) => (rank[a.reading.status] ?? 3) - (rank[b.reading.status] ?? 3));
    const pumpStatesKnown = actuators.length > 0 && actuators.every(a => typeof a.active === "boolean" && !a.stale && isRecent(a.timestamp, now));
    return { entries, available: entries.filter(e => Number.isFinite(e.reading.value)).length, total: entries.length,
      outside, quality, issues, pumpCount: pumpStatesKnown ? actuators.filter(a => a.active).length : null,
      runningPumps: pumpStatesKnown ? actuators.filter(a => a.active) : [] };
  }
  function historyStats(points, source) {
    const valid = points.filter(p => p?.source === source && Number.isFinite(p.value) && !INVALID.has(p.status) && Number.isFinite(Date.parse(p.timestamp)));
    return { count: valid.length, last: valid.at(-1)?.value ?? null, min: valid.length ? Math.min(...valid.map(p => p.value)) : null,
      max: valid.length ? Math.max(...valid.map(p => p.value)) : null, mean: valid.length ? valid.reduce((sum, p) => sum + p.value, 0) / valid.length : null };
  }
  function isPlantAnalysis(analysis) { return analysis?.captureTarget === "plant" && (!analysis.metrics?.detectorProfile || analysis.metrics.detectorProfile === "plant"); }
  function pumpName(actuator) {
    const index = ["relay-39", "relay-40", "relay-47", "relay-41"].indexOf(actuator.id);
    return index >= 0 ? "Bomba " + String(index + 1).padStart(2, "0") : "Salidas de bombeo";
  }
  function offlinePayload() {
    return { sensors: SENSORS, snapshot: Object.fromEntries(SENSORS.map(sensor => [sensor.id, { value: null, status: "missing", source: "offline", timestamp: null }])),
      history: {}, actuators: [], alarms: [], services: [], meta: { dataMode: "offline", lastIngestAt: null },
      relayControl: { connected: false }, camera: { mode: "unavailable" }, plantVision: { latest: null, history: [] } };
  }
  return { GROUPS, SENSORS, PRIMARY_IDS, isLiveSource, isRecent, visibleReading, sensorLabel, readingState, formatValue, summarize, historyStats, isPlantAnalysis, pumpName, offlinePayload };
});

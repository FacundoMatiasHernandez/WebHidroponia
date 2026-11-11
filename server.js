const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { collectCameraBurst, withRestoredSettings } = require("./app/camera-burst");
const { retainHistory, historyForTarget } = require("./app/vision-history");
const { createSimulatorSync } = require("./app/simulator-sync");
const { createSimulatorAPI } = require("./app/simulator-api");
const { USB_SENSORS, unavailable, normalizeLiveEntry, visibleSnapshot } = require("./app/live-readings");
const { createRelayControl, createControlAccess, sameOrigin } = require("./app/relay-control");
const { validateCalibration, projectLevelState } = require("./app/water-level-calibration");

const PORT = process.env.PORT || 4173;
const APP_DIR = __dirname;
const DATA_DIR = process.env.HYDROVISION_DATA_DIR ? path.resolve(process.env.HYDROVISION_DATA_DIR) : path.join(APP_DIR, "data");
const RUNTIME_FILE = path.join(DATA_DIR, "runtime-state.json");
let levelCalibration = null;
try {
  levelCalibration = validateCalibration(JSON.parse(fs.readFileSync(path.join(DATA_DIR, "water-level-calibration.json"), "utf8")));
  if (!levelCalibration) console.warn("Nivel resistivo: referencias incompletas o no validas; no se aplica una conversion.");
} catch (error) {
  if (error.code !== "ENOENT") console.warn("Nivel resistivo: no se pudo leer la calibracion; se mantienen datos sin calibrar.");
}
const PLANT_CAPTURE_DIR = path.join(DATA_DIR, "plant-captures");
const PLANT_CAPTURE_ROUTE = "/api/plant-vision/images/";
const PLANT_VISION_HISTORY_SIZE = 40;
const CLIENTS = new Set();
const TICK_INTERVAL_MS = 2000;
const HISTORY_SIZE = 40;
const LIVE_STALE_MS = 15000;
const DEFAULT_LIVE_SOURCE = "esp32-direct";
const LIVE_MODE = process.env.DATA_MODE === "esp32-usb" ? "esp32-usb" : "esp32-wifi";
const INGEST_TOKEN = process.env.INGEST_TOKEN || "";
const controlAccess = createControlAccess({ token: process.env.RELAY_CONTROL_TOKEN || "" });
const relayControl = createRelayControl({ deviceId: process.env.ESP32_DEVICE_ID || "huerta-j17",
  enabled: INGEST_TOKEN.length >= 16 && controlAccess.configured });
const CAMERA_STREAM_PROXY_PATH = "/api/camera/stream";
const CAMERA_CAPTURE_PROXY_PATH = "/api/camera/capture";
const CAMERA_CAPTURE_REFRESH_MS = parseEnvInt("CAMERA_CAPTURE_REFRESH_MS", 3600000);
const CAMERA_CAPTURE_TARGET = process.env.CAMERA_CAPTURE_TARGET === "screen" ? "screen" : "plant";
const CAMERA_IS_SCREEN = CAMERA_CAPTURE_TARGET === "screen";
const CAMERA_ANALYSIS_FLASH_INTENSITY = CAMERA_IS_SCREEN ? 0 : clamp(parseEnvInt("CAMERA_ANALYSIS_FLASH_INTENSITY", 24), 0, 255);
const CAMERA_ANALYSIS_JPEG_QUALITY = clamp(parseEnvInt("CAMERA_ANALYSIS_JPEG_QUALITY", 8), 8, 63);
const CAMERA_ANALYSIS_FLASH_SETTLE_MS = parseEnvInt("CAMERA_ANALYSIS_FLASH_SETTLE_MS", 250);
const CAMERA_STILL_PROFILE = {
  framesize: parseEnvInt("CAMERA_STILL_FRAMESIZE", 19),
  quality: parseEnvInt("CAMERA_STILL_QUALITY", 8),
  label: process.env.CAMERA_STILL_LABEL || "QXGA 2048x1536 HQ",
  settings: {
    brightness: parseEnvInt("CAMERA_STILL_BRIGHTNESS", 0),
    contrast: parseEnvInt("CAMERA_STILL_CONTRAST", CAMERA_IS_SCREEN ? 0 : 1),
    saturation: parseEnvInt("CAMERA_STILL_SATURATION", 0),
    ae_level: parseEnvInt("CAMERA_STILL_AE_LEVEL", -1),
    ...(process.env.CAMERA_STILL_SHARPNESS !== undefined ? { sharpness: clamp(parseEnvInt("CAMERA_STILL_SHARPNESS", 1), -3, 3) } : {}),
    ...(process.env.CAMERA_STILL_DENOISE !== undefined ? { denoise: clamp(parseEnvInt("CAMERA_STILL_DENOISE", 1), 0, 8) } : {})
  }
};
const CAMERA_VIDEO_PROFILE = {
  framesize: parseEnvInt("CAMERA_VIDEO_FRAMESIZE", 15),
  quality: parseEnvInt("CAMERA_VIDEO_QUALITY", 10),
  label: process.env.CAMERA_VIDEO_LABEL || "UXGA 1600x1200",
  settings: {
    brightness: parseEnvInt("CAMERA_VIDEO_BRIGHTNESS", 0),
    contrast: parseEnvInt("CAMERA_VIDEO_CONTRAST", CAMERA_IS_SCREEN ? 0 : 1),
    saturation: parseEnvInt("CAMERA_VIDEO_SATURATION", 0),
    ae_level: parseEnvInt("CAMERA_VIDEO_AE_LEVEL", -1),
    ...(process.env.CAMERA_VIDEO_SHARPNESS !== undefined ? { sharpness: clamp(parseEnvInt("CAMERA_VIDEO_SHARPNESS", 1), -3, 3) } : {}),
    ...(process.env.CAMERA_VIDEO_DENOISE !== undefined ? { denoise: clamp(parseEnvInt("CAMERA_VIDEO_DENOISE", 1), 0, 8) } : {})
  }
};
const CAMERA_CONFIG = readCameraConfig();
const SIMULATOR_FILE = path.join(DATA_DIR, "simulator-state.json");
let savedSimulator;
try { savedSimulator = JSON.parse(fs.readFileSync(SIMULATOR_FILE, "utf8")); } catch { /* A new local lab starts with a healthy reference. */ }
const simulator = createSimulatorSync({ initial: savedSimulator, persist: config => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${SIMULATOR_FILE}.tmp`, JSON.stringify(config, null, 2));
  fs.renameSync(`${SIMULATOR_FILE}.tmp`, SIMULATOR_FILE);
} });
const handleSimulator = createSimulatorAPI(simulator, { port: PORT, history: () => historyForTarget(state.plantVision, "screen"), capture: async () => {
  if (!CAMERA_IS_SCREEN) throw Object.assign(new Error("Activar CAMERA_CAPTURE_TARGET=screen para el laboratorio"), { statusCode: 409 });
  return capturePlantImage();
} });
let currentCameraProfileKey = "";
let cameraOperations = Promise.resolve();
let cameraAnalysisPending = false;
const activeCameraResponses = new Set();

const sensors = [
  { id: "air-humidity", label: "Humedad ambiente", unit: "%", decimals: 1, min: 45, max: 85, idealMin: 55, idealMax: 75, color: "#85d3a8", channel: "huerta/sensores/ambiente/humedad" },
  { id: "air-temperature", label: "Temperatura ambiente", unit: "°C", decimals: 1, min: 15, max: 35, idealMin: 20, idealMax: 28, color: "#f6c96b", channel: "huerta/sensores/ambiente/temperatura" },
  { id: "water-level", label: "Nivel de agua", unit: "%", decimals: 0, min: 20, max: 100, idealMin: 55, idealMax: 95, color: "#8fe0ff", channel: "huerta/sensores/agua/nivel" },
  { id: "air-co2", label: "CO2 ambiente", unit: "ppm", decimals: 0, min: 350, max: 1800, idealMin: 500, idealMax: 1200, color: "#ffb86b", channel: "huerta/sensores/ambiente/co2" },
  { id: "water-temperature", label: "Temperatura del agua", unit: "°C", decimals: 1, min: 14, max: 32, idealMin: 18, idealMax: 24, color: "#7cc9ff", channel: "huerta/sensores/agua/temperatura" },
  { id: "water-ph", label: "pH del agua", unit: "pH", decimals: 2, min: 4.5, max: 8, idealMin: 5.8, idealMax: 6.5, color: "#d0ff85", channel: "huerta/sensores/agua/ph" },
  { id: "light-intensity", label: "Intensidad lumínica", unit: "lux", decimals: 0, min: 0, max: 35000, idealMin: 18000, idealMax: 28000, color: "#ffe08a", channel: "huerta/sensores/luz/intensidad" },
  { id: "water-ec", label: "Conductividad eléctrica", unit: "mS/cm", decimals: 3, min: 0.4, max: 3.5, idealMin: 1.2, idealMax: 2.4, color: "#9fddff", channel: "huerta/sensores/agua/ec" },
  ...USB_SENSORS
];

const sensorById = new Map(sensors.map((sensor) => [sensor.id, sensor]));
const sensorByChannel = new Map(sensors.map((sensor) => [sensor.channel, sensor]));

function parseEnvInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    return new URL(value.trim()).toString();
  } catch {
    return "";
  }
}

function repairText(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  return value
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãº/g, "ú")
    .replace(/Ã±/g, "ñ")
    .replace(/Ã/g, "Á")
    .replace(/Ã‰/g, "É")
    .replace(/Ã/g, "Í")
    .replace(/Ã“/g, "Ó")
    .replace(/Ãš/g, "Ú")
    .replace(/Ã‘/g, "Ñ")
    .replace(/Â°/g, "°")
    .replace(/Â/g, "");
}

function formatCameraHost(value) {
  try {
    const target = new URL(value);
    return target.port ? `${target.hostname}:${target.port}` : target.hostname;
  } catch {
    return value;
  }
}

function formatDuration(valueMs) {
  if (valueMs >= 3600000 && valueMs % 3600000 === 0) {
    const hours = valueMs / 3600000;
    return `${hours} h`;
  }

  if (valueMs >= 60000 && valueMs % 60000 === 0) {
    const minutes = valueMs / 60000;
    return `${minutes} min`;
  }

  return `${Math.round(valueMs / 1000)} s`;
}

function deriveEsp32CaptureUrl(mjpegUrl) {
  try {
    const target = new URL(mjpegUrl);
    target.pathname = "/capture";
    target.search = "";

    if (target.port === "81") {
      target.port = "";
    }

    return target.toString();
  } catch {
    return "";
  }
}

function deriveEsp32ControlUrl(mjpegUrl, captureUrl) {
  const value = captureUrl || mjpegUrl;

  try {
    const target = new URL(value);
    target.pathname = "/control";
    target.search = "";

    if (target.port === "81") {
      target.port = "";
    }

    return target.toString();
  } catch {
    return "";
  }
}

function deriveEsp32StatusUrl(mjpegUrl, captureUrl, controlUrl) {
  const value = captureUrl || controlUrl || mjpegUrl;

  try {
    const target = new URL(value);
    target.pathname = "/status";
    target.search = "";

    if (target.port === "81") {
      target.port = "";
    }

    return target.toString();
  } catch {
    return "";
  }
}

function readCameraConfig() {
  const requestedMode = typeof process.env.CAMERA_MODE === "string"
    ? process.env.CAMERA_MODE.trim().toLowerCase()
    : "";
  const mjpegUrl = normalizeUrl(process.env.CAMERA_MJPEG_URL);
  const captureUrl = normalizeUrl(process.env.CAMERA_CAPTURE_URL) || deriveEsp32CaptureUrl(mjpegUrl);
  const controlUrl = normalizeUrl(process.env.CAMERA_CONTROL_URL) || deriveEsp32ControlUrl(mjpegUrl, captureUrl);
  const statusUrl = normalizeUrl(process.env.CAMERA_STATUS_URL) || deriveEsp32StatusUrl(mjpegUrl, captureUrl, controlUrl);
  const embedUrl = normalizeUrl(process.env.CAMERA_EMBED_URL);
  const label = typeof process.env.CAMERA_LABEL === "string" && process.env.CAMERA_LABEL.trim()
    ? process.env.CAMERA_LABEL.trim()
    : "ESP32-CAM OV3660";

  if ((requestedMode === "embed" && embedUrl) || (!requestedMode && embedUrl && !mjpegUrl)) {
    return {
      mode: "embed",
      badge: "Stream embebido",
      label,
      embedUrl,
      note: `La vista carga un reproductor externo desde ${formatCameraHost(embedUrl)}.`
    };
  }

  if ((requestedMode === "mjpeg" && mjpegUrl) || (!requestedMode && mjpegUrl)) {
    return {
      mode: "mjpeg",
      captureTarget: CAMERA_CAPTURE_TARGET,
      badge: "Imagen HD",
      label,
      streamUrl: CAMERA_STREAM_PROXY_PATH,
      captureUrl: captureUrl ? CAMERA_CAPTURE_PROXY_PATH : "",
      captureRefreshMs: CAMERA_CAPTURE_REFRESH_MS,
      stillProfile: CAMERA_STILL_PROFILE,
      videoProfile: CAMERA_VIDEO_PROFILE,
      upstreamStreamUrl: mjpegUrl,
      upstreamCaptureUrl: captureUrl,
      upstreamControlUrl: controlUrl,
      upstreamStatusUrl: statusUrl,
      note: `${CAMERA_IS_SCREEN ? "Prueba con pantalla de tablet, sin flash. No es un diagnostico del cultivo. " : ""}Modo imagen: ${CAMERA_STILL_PROFILE.label} cada ${formatDuration(CAMERA_CAPTURE_REFRESH_MS)}. Modo video: ${CAMERA_VIDEO_PROFILE.label} desde ${formatCameraHost(mjpegUrl)}.`
    };
  }

  return {
    mode: "unavailable",
    badge: "No disponible",
    label: "ESP32-CAM OV3660",
    note: "Conectá la cámara para ver imágenes del cultivo."
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "on", "active", "enabled", "abierto", "encendido"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "off", "inactive", "disabled", "cerrado", "apagado"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function normalizeDate(value, fallback = new Date()) {
  const candidate = value ? new Date(value) : fallback;
  return Number.isNaN(candidate.getTime()) ? fallback : candidate;
}

function toStatus(sensor, value) {
  if (sensor.telemetry) return "info";
  if (value < sensor.idealMin || value > sensor.idealMax) {
    const criticalLow = sensor.idealMin - (sensor.idealMin - sensor.min) * 0.45;
    const criticalHigh = sensor.idealMax + (sensor.max - sensor.idealMax) * 0.45;
    return value < criticalLow || value > criticalHigh ? "critical" : "warning";
  }

  return "ok";
}

function seedState() {
  const now = new Date();
  return {
    sensors,
    snapshot: Object.fromEntries(sensors.map(sensor => [sensor.id, unavailable(sensor, LIVE_MODE, now, "missing", "Esperando una lectura de la ESP32")])),
    history: Object.fromEntries(sensors.map(sensor => [sensor.id, []])),
    alarms: [], actuators: [], services: [], remoteActuators: [],
    meta: { updatedAt: now.toISOString(), running: false, dataMode: LIVE_MODE, lastIngestAt: null },
    plantVision: { latest: null, history: [] }
  };
}

function normalizeActuator(actuator, index) {
  if (!actuator || typeof actuator !== "object") {
    return null;
  }

  const id = typeof actuator.id === "string" && actuator.id ? actuator.id : `remote-actuator-${index}`;
  const label = typeof actuator.label === "string" && actuator.label ? actuator.label : id;
  const active = normalizeBoolean(actuator.active ?? actuator.value ?? actuator.state);

  if (active === null) {
    return null;
  }

  return {
    id,
    label: repairText(label),
    active,
    detail: typeof actuator.detail === "string" && actuator.detail ? repairText(actuator.detail) : "Estado informado por el backend",
    mode: typeof actuator.mode === "string" && actuator.mode ? actuator.mode : "remote"
  };
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const snapshot = {};
  const history = {};
  const effectiveMode = LIVE_MODE;
  const sameMode = effectiveMode === source.meta?.dataMode;

  sensors.forEach((sensor) => {
    const sourceHistory = Array.isArray(source.history?.[sensor.id]) ? source.history[sensor.id] : [];
    const mergedHistory = sourceHistory
      .filter((entry) => entry && (Number.isFinite(entry.value) || entry.value === null) && entry.timestamp
        && entry.source === effectiveMode)
      .slice(-HISTORY_SIZE)
      .map((entry) => normalizeLiveEntry(sensor, entry, entry.source || effectiveMode, normalizeDate(entry.timestamp), toStatus)).filter(Boolean);

    history[sensor.id] = mergedHistory;

    const sourceSnapshot = source.snapshot?.[sensor.id];
    snapshot[sensor.id] = sourceSnapshot && (Number.isFinite(sourceSnapshot.value) || sourceSnapshot.value === null) && sourceSnapshot.timestamp
        && sourceSnapshot.source === effectiveMode
      ? normalizeLiveEntry(sensor, sourceSnapshot, sourceSnapshot.source || effectiveMode, normalizeDate(sourceSnapshot.timestamp), toStatus)
      : history[sensor.id][history[sensor.id].length - 1] || unavailable(sensor, effectiveMode, new Date());
  });

  return {
    sensors,
    snapshot,
    history,
    alarms: Array.isArray(source.alarms)
      ? source.alarms.slice(0, 20).map((alarm) => ({
          ...alarm,
          title: repairText(alarm?.title),
          detail: repairText(alarm?.detail),
          timeLabel: repairText(alarm?.timeLabel)
        }))
      : [],
    actuators: [],
    services: [],
    meta: {
      updatedAt: typeof source.meta?.updatedAt === "string" ? source.meta.updatedAt : new Date().toISOString(),
      running: false,
      dataMode: effectiveMode,
      transport: sameMode ? source.meta?.transport : undefined,
      firmwareProfile: sameMode ? source.meta?.firmwareProfile : undefined,
      firmwareBuild: sameMode ? source.meta?.firmwareBuild : undefined,
      lastIngestAt: sameMode && typeof source.meta?.lastIngestAt === "string" ? source.meta.lastIngestAt : null
    },
    remoteActuators: sameMode && Array.isArray(source.remoteActuators)
      ? source.remoteActuators.map(normalizeActuator).filter(Boolean)
      : [],
    plantVision: normalizePlantVision(source.plantVision)
  };
}

function normalizePlantVision(input) {
  const source = input && typeof input === "object" ? input : {};
  const history = Array.isArray(source.history)
    ? retainHistory(source.history
        .filter((entry) => entry && typeof entry === "object" && typeof entry.timestamp === "string"), PLANT_VISION_HISTORY_SIZE)
    : [];

  return {
    latest: source.latest && typeof source.latest === "object" ? source.latest : history[history.length - 1] || null,
    history
  };
}

function loadState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(RUNTIME_FILE)) {
    const initial = seedState();
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    return normalizeState(JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8")));
  } catch {
    const reset = seedState();
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify(reset, null, 2));
    return reset;
  }
}

let state = loadState();

function persistState() {
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify(state, null, 2));
}

function createAlarm(sensor, reading) {
  if (!Number.isFinite(reading.value) || !["warning", "critical"].includes(reading.status)) {
    return null;
  }

  const severity = reading.status === "critical" ? "critical" : "warning";
  const reason = reading.value < sensor.idealMin ? "por debajo del rango recomendado" : "por encima del rango recomendado";

  return {
    id: `${sensor.id}-${reading.timestamp}`,
    sensorId: sensor.id,
    title: `${sensor.label} ${reason}`,
    detail: `${reading.value} ${sensor.unit} | canal ${sensor.channel}`,
    severity,
    timeLabel: new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(reading.timestamp))
  };
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0s";
  }

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.round(minutes / 60)}h`;
}

function getLiveAgeMs() {
  if (!state.meta.lastIngestAt) {
    return Infinity;
  }

  return Date.now() - normalizeDate(state.meta.lastIngestAt, new Date(0)).getTime();
}

function buildActuators() {
  state.actuators = state.remoteActuators.map(actuator => ({ ...actuator }));
}

function buildAlarms() {
  const { snapshot } = currentLevelState();
  state.alarms = sensors.map(sensor => createAlarm(sensor, snapshot[sensor.id])).filter(Boolean);
}

function currentLevelState() {
  return projectLevelState(visibleSnapshot(sensors, state.snapshot, state.meta.dataMode), state.history, state.meta, levelCalibration);
}

function buildServices() {
  const connected = getLiveAgeMs() <= LIVE_STALE_MS;
  state.services = [
    { id: "api", label: "Servidor", status: "online", detail: "Comunicación con la página disponible" },
    { id: "sensor-ingest", label: "Equipo de sensores", status: connected ? "online" : "attention",
      detail: connected ? "Recibiendo mediciones del equipo" : "Esperando mediciones recientes" },
    { id: "camera", label: "Cámara del cultivo", status: CAMERA_CONFIG.mode === "unavailable" ? "pending" : "configured",
      detail: CAMERA_CONFIG.mode === "unavailable" ? "Sin configurar" : "La conexión se comprueba al abrir la imagen" },
    { id: "control", label: "Control de bombas", status: relayControl.info().connected ? "online" : "attention",
      detail: relayControl.info().connected ? "Estados confirmados por el equipo" : "Sin confirmación reciente del equipo" }
  ];
}

function broadcast() {
  const payload = JSON.stringify(getPublicState());
  CLIENTS.forEach((response) => {
    response.write("event: snapshot\n");
    response.write(`data: ${payload}\n\n`);
  });
}

function getPublicState() {
  const readings = currentLevelState();
  return {
    sensors: state.sensors.map(({ base, step, ...sensor }) => sensor.id === "water-level" && readings.applied
      ? { ...sensor, label: "Nivel resistivo", telemetry: true, min: 0, max: 100, idealMin: undefined, idealMax: undefined } : sensor),
    snapshot: readings.snapshot,
    history: readings.history,
    alarms: state.alarms,
    actuators: state.meta.dataMode === "esp32-wifi" ? relayControl.actuators()
      : getLiveAgeMs() > LIVE_STALE_MS ? state.actuators.map(a => ({ ...a, active: null, stale: true })) : state.actuators,
    relayControl: relayControl.info(),
    services: state.services,
    meta: state.meta,
    camera: { ...CAMERA_CONFIG, analysisInProgress: cameraAnalysisPending },
    plantVision: historyForTarget(state.plantVision, "plant")
  };
}

function tick() {
  buildAlarms();
  buildServices();
  broadcast();
}

function resolveSensor(entry) {
  if (typeof entry?.sensorId === "string" && sensorById.has(entry.sensorId)) {
    return sensorById.get(entry.sensorId);
  }

  const channel = entry?.channel || entry?.topic;
  if (typeof channel === "string" && sensorByChannel.has(channel)) {
    return sensorByChannel.get(channel);
  }

  return null;
}

function prepareReading(payload, fallbackSource = DEFAULT_LIVE_SOURCE) {
  const sensor = resolveSensor(payload);
  const value = normalizeNumber(payload?.value ?? payload?.payload ?? payload?.reading ?? payload?.data);

  if (!sensor) {
    return null;
  }

  const source = typeof payload.source === "string" && payload.source ? payload.source : fallbackSource;
  const date = normalizeDate(payload.timestamp ?? payload.ts ?? payload.updatedAt);
  return normalizeLiveEntry(sensor, { ...payload, value }, source, date, toStatus);
}

function applyLivePayload(body) {
  const payload = body && typeof body === "object" ? body : {};
  const source = typeof payload.source === "string" && payload.source ? payload.source : DEFAULT_LIVE_SOURCE;
  if (!/^[a-zA-Z0-9_.:-]{1,64}$/.test(source) || source === "mock-backend") return false;
  const entries = Array.isArray(payload.readings) ? payload.readings : [payload];
  const prepared = entries.map(entry => prepareReading({ ...entry, timestamp: entry?.timestamp || payload.timestamp,
    source: entry?.source || source }, source)).filter(Boolean);
  if (!prepared.length && !Array.isArray(payload.actuators)) return false;
  if (state.meta.dataMode !== source) {
    for (const sensor of sensors) { state.snapshot[sensor.id] = unavailable(sensor, source, new Date()); state.history[sensor.id] = []; }
    state.alarms = []; state.remoteActuators = [];
  }
  if (payload.fullSnapshot === true) {
    const present = new Set(prepared.map(entry => entry.sensorId));
    for (const sensor of sensors) if (!present.has(sensor.id)) state.snapshot[sensor.id] = unavailable(sensor, source, new Date());
  }
  let updatedCount = 0;
  let newestDate = null;

  prepared.forEach((reading) => {
    const sensor = sensorById.get(reading.sensorId);
    state.snapshot[sensor.id] = reading;
    state.history[sensor.id] = [...(state.history[sensor.id] || []), reading].slice(-HISTORY_SIZE);

    updatedCount += 1;
    const readingDate = normalizeDate(reading.timestamp);
    if (!newestDate || readingDate > newestDate) {
      newestDate = readingDate;
    }
  });

  if (Array.isArray(payload.actuators)) {
    state.remoteActuators = payload.actuators.map(normalizeActuator).filter(Boolean);
  }

  if (!updatedCount && !Array.isArray(payload.actuators)) {
    return false;
  }

  const effectiveDate = newestDate || normalizeDate(payload.timestamp);
  state.meta.running = false;
  state.meta.dataMode = source;
  if (["tesis-huerta-j17", "unknown"].includes(payload.firmwareProfile)) state.meta.firmwareProfile = payload.firmwareProfile;
  if (["tesis-huerta-j17-diagnostico-v1", "tesis-huerta-j17-wifi-v1", "tesis-huerta-j17-wifi-v2", "tesis-huerta-j17-wifi-v3"].includes(payload.firmwareBuild)) state.meta.firmwareBuild = payload.firmwareBuild;
  if (source === "esp32-wifi") state.meta.transport = { type: "wifi-http", deviceId: payload.device.id, ip: relayControl.info().ip };
  if (payload.transport?.type === "usb-serial" && /^COM\d+$/i.test(payload.transport.port) && Number.isInteger(payload.transport.baud)) {
    state.meta.transport = { type: "usb-serial", port: payload.transport.port, baud: payload.transport.baud };
  }
  state.meta.updatedAt = effectiveDate.toISOString();
  state.meta.lastIngestAt = effectiveDate.toISOString();
  buildActuators();
  buildAlarms();
  buildServices();
  persistState();
  broadcast();
  return true;
}

function isAuthorizedIngest(request) {
  if (!INGEST_TOKEN) {
    return true;
  }

  const headerToken = typeof request.headers["x-ingest-token"] === "string"
    ? request.headers["x-ingest-token"].trim()
    : "";

  if (headerToken === INGEST_TOKEN) {
    return true;
  }

  const authHeader = typeof request.headers.authorization === "string"
    ? request.headers.authorization.trim()
    : "";

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim() === INGEST_TOKEN;
  }

  return false;
}

function sendJson(response, statusCode, payload) {
  const data = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store"
  });
  response.end(data);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requestCameraControl(variable, value) {
  if (!CAMERA_CONFIG.upstreamControlUrl) {
    return Promise.resolve(false);
  }

  let target;
  try {
    target = new URL(CAMERA_CONFIG.upstreamControlUrl);
    target.searchParams.set("var", variable);
    target.searchParams.set("val", String(value));
  } catch {
    return Promise.reject(new Error("Invalid camera control URL"));
  }

  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const controlRequest = transport.request(target, {
      method: "GET",
      timeout: 5000
    }, (controlResponse) => {
      const statusCode = controlResponse.statusCode || 502;
      controlResponse.resume();

      if (statusCode < 200 || statusCode >= 300) {
        reject(new Error(`Camera control HTTP ${statusCode}`));
        return;
      }

      resolve(true);
    });

    controlRequest.on("timeout", () => {
      controlRequest.destroy(new Error("Timeout configuring camera"));
    });

    controlRequest.on("error", reject);
    controlRequest.end();
  });
}

async function applyCameraProfile(profile) {
  if (!profile || !CAMERA_CONFIG.upstreamControlUrl) {
    return false;
  }

  const settings = profile.settings || {};
  const settingKey = Object.entries(settings)
    .map(([name, value]) => `${name}=${value}`)
    .join(":");
  const key = `${profile.framesize}:${profile.quality}:${settingKey}`;
  if (currentCameraProfileKey === key) {
    return false;
  }

  await requestCameraControl("framesize", profile.framesize);
  await requestCameraControl("quality", profile.quality);

  for (const [name, value] of Object.entries(settings)) {
    await requestCameraControl(name, value);
  }

  currentCameraProfileKey = key;
  await delay(500);
  return true;
}

function proxyCameraResource(response, upstreamUrl, options = {}) {
  activeCameraResponses.add(response);
  response.on("close", () => activeCameraResponses.delete(response));
  if (!upstreamUrl) {
    sendJson(response, 404, { error: "Camera resource not configured" });
    return;
  }

  let target;
  try {
    target = new URL(upstreamUrl);
  } catch {
    sendJson(response, 500, { error: "Invalid camera URL" });
    return;
  }

  const transport = target.protocol === "https:" ? https : http;
  const upstreamRequest = transport.request(target, {
    method: "GET",
    timeout: options.timeoutMs || 8000,
    headers: {
      Accept: options.accept || "*/*"
    }
  }, (upstreamResponse) => {
    const statusCode = upstreamResponse.statusCode || 502;

    if (statusCode < 200 || statusCode >= 300) {
      upstreamResponse.resume();
      sendJson(response, 502, { error: `Camera upstream HTTP ${statusCode}` });
      return;
    }

    const headers = {
      "Content-Type": upstreamResponse.headers["content-type"] || options.contentType || "application/octet-stream",
      "Cache-Control": options.stream ? "no-store, no-cache, no-transform" : "no-store",
      "Access-Control-Allow-Origin": "*"
    };

    if (options.stream) {
      headers.Connection = "close";
    } else if (upstreamResponse.headers["content-length"]) {
      headers["Content-Length"] = upstreamResponse.headers["content-length"];
    }

    response.writeHead(200, headers);
    upstreamResponse.pipe(response);
  });

  upstreamRequest.on("timeout", () => {
    upstreamRequest.destroy(new Error("Timeout opening camera resource"));
  });

  upstreamRequest.on("error", (error) => {
    if (!response.headersSent) {
      sendJson(response, 502, { error: error.message });
      return;
    }

    response.destroy(error);
  });

  response.on("close", () => {
    upstreamRequest.destroy();
  });

  upstreamRequest.end();
}

function fetchCameraBuffer(upstreamUrl, options = {}) {
  if (!upstreamUrl) {
    return Promise.reject(new Error("Camera resource not configured"));
  }

  let target;
  try {
    target = new URL(upstreamUrl);
  } catch {
    return Promise.reject(new Error("Invalid camera URL"));
  }

  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const upstreamRequest = transport.request(target, {
      method: "GET",
      timeout: options.timeoutMs || 30000,
      headers: {
        Accept: options.accept || "image/jpeg,*/*"
      }
    }, (upstreamResponse) => {
      const statusCode = upstreamResponse.statusCode || 502;
      const chunks = [];

      if (statusCode < 200 || statusCode >= 300) {
        upstreamResponse.resume();
        reject(new Error(`Camera upstream HTTP ${statusCode}`));
        return;
      }

      upstreamResponse.on("data", (chunk) => {
        chunks.push(chunk);
      });
      upstreamResponse.on("error", reject);

      upstreamResponse.on("end", () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: upstreamResponse.headers["content-type"] || "image/jpeg"
        });
      });
    });

    upstreamRequest.on("timeout", () => {
      upstreamRequest.destroy(new Error("Timeout opening camera resource"));
    });

    upstreamRequest.on("error", reject);
    upstreamRequest.end();
  });
}

async function fetchCameraStatus() {
  if (!CAMERA_CONFIG.upstreamStatusUrl) {
    return null;
  }

  const status = await fetchCameraBuffer(CAMERA_CONFIG.upstreamStatusUrl, {
    accept: "application/json,*/*",
    timeoutMs: 5000
  });

  try {
    return JSON.parse(status.buffer.toString("utf8"));
  } catch {
    return null;
  }
}

function queueCameraOperation(operation) {
  const result = cameraOperations.then(operation);
  cameraOperations = result.catch(() => {});
  return result;
}

async function capturePlantImage() {
  if (CAMERA_CONFIG.mode !== "mjpeg") throw new Error("Camera capture not configured");
  if (cameraAnalysisPending) throw Object.assign(new Error("Ya hay una captura de analisis en curso"), { statusCode: 409 });
  const simulatorCase = CAMERA_IS_SCREEN ? simulator.beginCapture() : null;
  cameraAnalysisPending = true;
  try {
    broadcast();
    return await queueCameraOperation(async () => {
      for (const response of activeCameraResponses) response.destroy();
      activeCameraResponses.clear();
      await delay(500);
      const frames = await withRestoredSettings(fetchCameraStatus, requestCameraControl, {
        framesize: CAMERA_STILL_PROFILE.framesize,
        quality: CAMERA_ANALYSIS_JPEG_QUALITY,
        ...CAMERA_STILL_PROFILE.settings,
        led_intensity: CAMERA_ANALYSIS_FLASH_INTENSITY
      }, async () => {
        try {
          return await collectCameraBurst(CAMERA_CONFIG.upstreamStreamUrl, {
            warmupMs: Math.max(2000, CAMERA_ANALYSIS_FLASH_SETTLE_MS), discardFrames: 6, count: 3
          });
        } finally {
          // Give the ESP32 stream handler time to release its LED and frame buffer.
          await delay(500);
        }
      });
      fs.mkdirSync(PLANT_CAPTURE_DIR, { recursive: true });
      if (simulatorCase) simulator.assertCapture(simulatorCase);
      const burstId = Date.now().toString(36);
      const captures = frames.map((frame, index) => {
        const fileName = `plant-${burstId}-${index + 1}.jpg`;
        fs.writeFileSync(path.join(PLANT_CAPTURE_DIR, fileName), frame.buffer);
        return {
          fileName, imageUrl: `${PLANT_CAPTURE_ROUTE}${fileName}`,
          captureTarget: CAMERA_CAPTURE_TARGET,
          ...(simulatorCase ? { simulator: simulatorCase } : {}),
          captureSettings: { framesize: CAMERA_STILL_PROFILE.framesize, quality: CAMERA_ANALYSIS_JPEG_QUALITY, ...CAMERA_STILL_PROFILE.settings },
          capturedAt: frame.capturedAt, bytes: frame.buffer.length, contentType: "image/jpeg",
          lighting: { mode: CAMERA_ANALYSIS_FLASH_INTENSITY > 0 ? "flash" : "ambient",
            intensity: CAMERA_ANALYSIS_FLASH_INTENSITY, protocol: CAMERA_IS_SCREEN ? "screen-settled-burst-v1" : "settled-burst-v1" }
        };
      });
      const capture = { ...captures[0], frames: captures, burstId };
      if (simulatorCase) fs.writeFileSync(path.join(PLANT_CAPTURE_DIR, `case-${burstId}.json`), JSON.stringify(capture, null, 2));
      return capture;
    });
  } finally {
    currentCameraProfileKey = "";
    cameraAnalysisPending = false;
    if (simulatorCase) simulator.endCapture();
    broadcast();
  }
}

function savePlantVisionAnalysis(analysis) {
  const current = state.plantVision || { latest: null, history: [] };
  const entry = {
    ...analysis,
    timestamp: typeof analysis.timestamp === "string" ? analysis.timestamp : new Date().toISOString()
  };

  state.plantVision = {
    latest: entry,
    history: retainHistory([...(current.history || []), entry], PLANT_VISION_HISTORY_SIZE)
  };
  persistState();
  broadcast();
  return entry;
}

function servePlantCapture(requestPath, response) {
  const fileName = path.basename(decodeURIComponent(requestPath.slice(PLANT_CAPTURE_ROUTE.length)));
  const filePath = path.join(PLANT_CAPTURE_DIR, fileName);

  if (!fileName || !filePath.startsWith(PLANT_CAPTURE_DIR)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, 404, { error: "Image not found" });
      return;
    }

    response.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Content-Length": content.length,
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

async function proxyCameraStream(response) {
  if (CAMERA_CONFIG.mode !== "mjpeg") {
    sendJson(response, 404, { error: "Camera stream not configured" });
    return;
  }

  try {
    await applyCameraProfile(CAMERA_VIDEO_PROFILE);
  } catch (error) {
    sendJson(response, 502, { error: error.message });
    return;
  }

  proxyCameraResource(response, CAMERA_CONFIG.upstreamStreamUrl, {
    stream: true,
    contentType: "multipart/x-mixed-replace",
    accept: "multipart/x-mixed-replace,image/jpeg,*/*",
    timeoutMs: 20000
  });
}

async function proxyCameraCapture(response) {
  if (CAMERA_CONFIG.mode !== "mjpeg") {
    sendJson(response, 404, { error: "Camera capture not configured" });
    return;
  }

  try {
    await applyCameraProfile(CAMERA_STILL_PROFILE);
  } catch (error) {
    sendJson(response, 502, { error: error.message });
    return;
  }

  proxyCameraResource(response, CAMERA_CONFIG.upstreamCaptureUrl, {
    contentType: "image/jpeg",
    accept: "image/jpeg,*/*",
    timeoutMs: 30000
  });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".ttf": "font/ttf"
};

function serveStatic(requestPath, response) {
  const safePath = requestPath === "/"
    ? "index.html"
    : path.normalize(decodeURIComponent(requestPath)).replace(/^[/\\]+/, "");
  const filePath = path.resolve(APP_DIR, safePath);
  const publicPath = safePath.replaceAll(path.sep, "/");
  const allowed = publicPath === "index.html" || ["app/scripts/", "app/styles/", "app/simulator/"].some(prefix => publicPath.startsWith(prefix));

  if (!filePath.startsWith(APP_DIR + path.sep)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  if (!allowed || publicPath.split("/").some(part => part.startsWith("."))) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0, tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 65536) { tooLarge = true; reject(Object.assign(new Error("Cuerpo demasiado grande"), { statusCode: 413 })); return; }
      raw += chunk;
    });
    request.on("end", () => {
      if (tooLarge) return;
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("JSON invalido"), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

buildActuators();
buildAlarms();
buildServices();
persistState();
setInterval(tick, TICK_INTERVAL_MS);

setInterval(() => {
  CLIENTS.forEach((response) => {
    response.write(": keep-alive\n\n");
  });
}, 15000);

const server = http.createServer(async (request, response) => {
  try {
    const host = request.headers.host || `localhost:${PORT}`;
    const url = new URL(request.url || "/", `http://${host}`);
    if (await handleSimulator(request, response, url)) return;
    if (url.pathname === "/simulador" || url.pathname === "/simulador/") {
      serveStatic("/app/simulator/index.html", response); return;
    }
    if (url.pathname === "/simulador/control" || url.pathname === "/simulador/control/") {
      serveStatic("/app/simulator/control.html", response); return;
    }

    if (request.method === "GET" && url.pathname === CAMERA_STREAM_PROXY_PATH) {
      if (cameraAnalysisPending) { sendJson(response, 409, { error: "Captura de analisis en curso" }); return; }
      await queueCameraOperation(() => proxyCameraStream(response));
      return;
    }

    if (request.method === "GET" && url.pathname === CAMERA_CAPTURE_PROXY_PATH) {
      if (cameraAnalysisPending) { sendJson(response, 409, { error: "Captura de analisis en curso" }); return; }
      await queueCameraOperation(() => proxyCameraCapture(response));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith(PLANT_CAPTURE_ROUTE)) {
      servePlantCapture(url.pathname, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        port: Number(PORT),
        dataMode: state.meta.dataMode,
        updatedAt: state.meta.updatedAt,
        lastIngestAt: state.meta.lastIngestAt,
        cameraMode: CAMERA_CONFIG.mode
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      sendJson(response, 200, getPublicState());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/integration/topics") {
      sendJson(response, 200, {
        sourceMode: state.meta.dataMode,
        readings: sensors.map((sensor) => ({
          sensorId: sensor.id,
          label: sensor.label,
          unit: sensor.unit,
          topic: sensor.channel
        }))
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/stream") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });
      response.write("event: snapshot\n");
      response.write(`data: ${JSON.stringify(getPublicState())}\n\n`);
      CLIENTS.add(response);

      request.on("close", () => {
        CLIENTS.delete(response);
      });
      return;
    }

    if (request.method === "POST" && (url.pathname === "/api/ingest/reading" || url.pathname === "/api/ingest/batch")) {
      if (!isAuthorizedIngest(request)) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }

      const body = await parseBody(request);
      if (body.source === "esp32-wifi") {
        if (INGEST_TOKEN.length < 16) { sendJson(response, 503, { error: "Configurar INGEST_TOKEN para Wi-Fi" }); return; }
        relayControl.accept(body);
      } else if (relayControl.info().connected) {
        sendJson(response, 409, { error: "La ESP32 Wi-Fi esta activa; no se mezcla con otra fuente" }); return;
      }
      const ok = applyLivePayload(body);
      sendJson(response, ok ? 200 : 400, {
        ok,
        dataMode: state.meta.dataMode,
        updatedAt: state.meta.updatedAt,
        ...(ok && body.source === "esp32-wifi" ? { control: relayControl.response() } : {})
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/plant-vision/capture") {
      try {
        const capture = await capturePlantImage();
        sendJson(response, 200, { ok: true, capture });
      } catch (error) {
        sendJson(response, error.statusCode || 502, { ok: false, error: error.message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/plant-vision/analysis") {
      const body = await parseBody(request);
      const entry = savePlantVisionAnalysis(body);
      sendJson(response, 200, { ok: true, analysis: entry });
      return;
    }

    if (request.method === "POST" && ["/api/control/toggle-simulation", "/api/control/inject-critical"].includes(url.pathname)) {
      sendJson(response, 410, { error: "Esta función ya no está disponible en la instalación." });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/actuator") {
      const body = await parseBody(request);
      controlAccess.authorize(request);
      const command = relayControl.queue(body);
      broadcast();
      sendJson(response, 202, { ok: true, command });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/stop-all") {
      controlAccess.authorize(request);
      const body = await parseBody(request);
      const commands = relayControl.stopAll(body);
      broadcast(); sendJson(response, 202, { ok: true, commands }); return;
    }
    if (request.method === "GET" && url.pathname === "/api/control/access") {
      sendJson(response, 200, controlAccess.info(request)); return;
    }
    if (request.method === "POST" && url.pathname === "/api/control/login") {
      if (!sameOrigin(request)) { sendJson(response, 403, { error: "Origen no permitido" }); return; }
      const body = await parseBody(request);
      response.setHeader("Set-Cookie", controlAccess.login(request, body.password));
      sendJson(response, 200, { ok: true }); return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.statusCode ? error.message : "Internal server error"
    });
  }
});

server.listen(PORT, () => {
  console.log(`HydroVision running on http://localhost:${PORT}`);
});

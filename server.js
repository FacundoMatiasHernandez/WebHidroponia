const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 4173;
const APP_DIR = __dirname;
const DATA_DIR = path.join(APP_DIR, "data");
const RUNTIME_FILE = path.join(DATA_DIR, "runtime-state.json");
const CLIENTS = new Set();
const TICK_INTERVAL_MS = 2000;
const HISTORY_SIZE = 40;
const LIVE_STALE_MS = 15000;
const DEFAULT_LIVE_SOURCE = "plcnext-node-red";
const INGEST_TOKEN = process.env.INGEST_TOKEN || "";
const CAMERA_STREAM_PROXY_PATH = "/api/camera/stream";
const CAMERA_CAPTURE_PROXY_PATH = "/api/camera/capture";
const CAMERA_CAPTURE_REFRESH_MS = parseEnvInt("CAMERA_CAPTURE_REFRESH_MS", 3600000);
const CAMERA_STILL_PROFILE = {
  framesize: parseEnvInt("CAMERA_STILL_FRAMESIZE", 19),
  quality: parseEnvInt("CAMERA_STILL_QUALITY", 6),
  label: process.env.CAMERA_STILL_LABEL || "QXGA 2048x1536 HQ",
  settings: {
    brightness: parseEnvInt("CAMERA_STILL_BRIGHTNESS", 0),
    contrast: parseEnvInt("CAMERA_STILL_CONTRAST", 1),
    saturation: parseEnvInt("CAMERA_STILL_SATURATION", 0),
    ae_level: parseEnvInt("CAMERA_STILL_AE_LEVEL", -1)
  }
};
const CAMERA_VIDEO_PROFILE = {
  framesize: parseEnvInt("CAMERA_VIDEO_FRAMESIZE", 15),
  quality: parseEnvInt("CAMERA_VIDEO_QUALITY", 10),
  label: process.env.CAMERA_VIDEO_LABEL || "UXGA 1600x1200",
  settings: {
    brightness: parseEnvInt("CAMERA_VIDEO_BRIGHTNESS", 0),
    contrast: parseEnvInt("CAMERA_VIDEO_CONTRAST", 1),
    saturation: parseEnvInt("CAMERA_VIDEO_SATURATION", 0),
    ae_level: parseEnvInt("CAMERA_VIDEO_AE_LEVEL", -1)
  }
};
const CAMERA_CONFIG = readCameraConfig();
let currentCameraProfileKey = "";

const sensors = [
  { id: "air-humidity", label: "Humedad ambiente", unit: "%", decimals: 1, min: 45, max: 85, idealMin: 55, idealMax: 75, base: 67, step: 1.7, color: "#85d3a8", channel: "huerta/sensores/ambiente/humedad" },
  { id: "air-temperature", label: "Temperatura ambiente", unit: "°C", decimals: 1, min: 15, max: 35, idealMin: 20, idealMax: 28, base: 24.5, step: 0.7, color: "#f6c96b", channel: "huerta/sensores/ambiente/temperatura" },
  { id: "water-level", label: "Nivel de agua", unit: "%", decimals: 0, min: 20, max: 100, idealMin: 55, idealMax: 95, base: 74, step: 3, color: "#8fe0ff", channel: "huerta/sensores/agua/nivel" },
  { id: "air-co2", label: "CO2 ambiente", unit: "ppm", decimals: 0, min: 350, max: 1800, idealMin: 500, idealMax: 1200, base: 780, step: 55, color: "#ffb86b", channel: "huerta/sensores/ambiente/co2" },
  { id: "water-temperature", label: "Temperatura del agua", unit: "°C", decimals: 1, min: 14, max: 32, idealMin: 18, idealMax: 24, base: 21.1, step: 0.6, color: "#7cc9ff", channel: "huerta/sensores/agua/temperatura" },
  { id: "water-ph", label: "pH del agua", unit: "pH", decimals: 2, min: 4.5, max: 8, idealMin: 5.8, idealMax: 6.5, base: 6.18, step: 0.09, color: "#d0ff85", channel: "huerta/sensores/agua/ph" },
  { id: "light-intensity", label: "Intensidad lumínica", unit: "lux", decimals: 0, min: 0, max: 35000, idealMin: 18000, idealMax: 28000, base: 22600, step: 1300, color: "#ffe08a", channel: "huerta/sensores/luz/intensidad" },
  { id: "water-ec", label: "Conductividad eléctrica", unit: "mS/cm", decimals: 2, min: 0.4, max: 3.5, idealMin: 1.2, idealMax: 2.4, base: 1.82, step: 0.08, color: "#9fddff", channel: "huerta/sensores/agua/ec" }
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

function readCameraConfig() {
  const requestedMode = typeof process.env.CAMERA_MODE === "string"
    ? process.env.CAMERA_MODE.trim().toLowerCase()
    : "";
  const mjpegUrl = normalizeUrl(process.env.CAMERA_MJPEG_URL);
  const captureUrl = normalizeUrl(process.env.CAMERA_CAPTURE_URL) || deriveEsp32CaptureUrl(mjpegUrl);
  const controlUrl = normalizeUrl(process.env.CAMERA_CONTROL_URL) || deriveEsp32ControlUrl(mjpegUrl, captureUrl);
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
      note: `Modo imagen: ${CAMERA_STILL_PROFILE.label} cada ${formatDuration(CAMERA_CAPTURE_REFRESH_MS)}. Modo video: ${CAMERA_VIDEO_PROFILE.label} desde ${formatCameraHost(mjpegUrl)}.`
    };
  }

  return {
    mode: "mock",
    badge: "Mock stream",
    label: "LOGI C922 / Raspberry Pi",
    note: "Esta vista usa una simulación visual. Configurá CAMERA_MJPEG_URL o CAMERA_EMBED_URL para conectar la Raspberry."
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
  if (value < sensor.idealMin || value > sensor.idealMax) {
    const criticalLow = sensor.idealMin - (sensor.idealMin - sensor.min) * 0.45;
    const criticalHigh = sensor.idealMax + (sensor.max - sensor.idealMax) * 0.45;
    return value < criticalLow || value > criticalHigh ? "critical" : "warning";
  }

  return "ok";
}

function formatReading(sensor, value, date, source = "mock-backend") {
  return {
    sensorId: sensor.id,
    label: sensor.label,
    value: Number(value.toFixed(sensor.decimals)),
    unit: sensor.unit,
    status: toStatus(sensor, value),
    timestamp: date.toISOString(),
    source,
    channel: sensor.channel
  };
}

function seedState() {
  const now = Date.now();
  const history = {};
  const snapshot = {};

  sensors.forEach((sensor) => {
    const entries = [];
    let current = sensor.base;

    for (let index = HISTORY_SIZE; index > 0; index -= 1) {
      current += (Math.random() - 0.5) * sensor.step * 1.3 + (sensor.base - current) * 0.08;
      current = clamp(current, sensor.min, sensor.max);
      const reading = formatReading(sensor, current, new Date(now - index * TICK_INTERVAL_MS));
      entries.push(reading);
    }

    history[sensor.id] = entries;
    snapshot[sensor.id] = entries[entries.length - 1];
  });

  return {
    sensors,
    snapshot,
    history,
    alarms: [],
    actuators: [],
    services: [],
    meta: {
      updatedAt: new Date().toISOString(),
      running: true,
      dataMode: "mock-backend",
      lastIngestAt: null
    },
    manualOverrides: {},
    remoteActuators: []
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
    detail: typeof actuator.detail === "string" && actuator.detail ? repairText(actuator.detail) : "Estado informado por PLC / Node-RED",
    mode: typeof actuator.mode === "string" && actuator.mode ? actuator.mode : "remote"
  };
}

function normalizeState(input) {
  const seeded = seedState();
  const source = input && typeof input === "object" ? input : {};
  const snapshot = {};
  const history = {};

  sensors.forEach((sensor) => {
    const seededHistory = seeded.history[sensor.id];
    const sourceHistory = Array.isArray(source.history?.[sensor.id]) ? source.history[sensor.id] : [];
    const mergedHistory = sourceHistory
      .filter((entry) => entry && typeof entry.value === "number" && entry.timestamp)
      .slice(-HISTORY_SIZE)
      .map((entry) => formatReading(sensor, entry.value, normalizeDate(entry.timestamp), entry.source || "mock-backend"));

    history[sensor.id] = mergedHistory.length ? mergedHistory : seededHistory;

    const sourceSnapshot = source.snapshot?.[sensor.id];
    snapshot[sensor.id] = sourceSnapshot && typeof sourceSnapshot.value === "number" && sourceSnapshot.timestamp
      ? formatReading(sensor, sourceSnapshot.value, normalizeDate(sourceSnapshot.timestamp), sourceSnapshot.source || "mock-backend")
      : history[sensor.id][history[sensor.id].length - 1];
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
      running: typeof source.meta?.running === "boolean" ? source.meta.running : true,
      dataMode: typeof source.meta?.dataMode === "string" ? source.meta.dataMode : "mock-backend",
      lastIngestAt: typeof source.meta?.lastIngestAt === "string" ? source.meta.lastIngestAt : null
    },
    manualOverrides: source.manualOverrides && typeof source.manualOverrides === "object" ? source.manualOverrides : {},
    remoteActuators: Array.isArray(source.remoteActuators)
      ? source.remoteActuators.map(normalizeActuator).filter(Boolean)
      : []
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
let tickCount = 0;

function isMockMode() {
  return state.meta.dataMode === "mock-backend";
}

function persistState() {
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify(state, null, 2));
}

function createAlarm(sensor, reading) {
  if (reading.status === "ok") {
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
  if (!isMockMode() && state.remoteActuators.length) {
    state.actuators = state.remoteActuators.map((actuator) => {
      const override = state.manualOverrides[actuator.id];
      if (override) {
        return {
          ...actuator,
          active: override.active,
          mode: "manual"
        };
      }

      return actuator;
    });
    return;
  }

  const waterLevel = state.snapshot["water-level"];
  const ph = state.snapshot["water-ph"];
  const ec = state.snapshot["water-ec"];
  const light = state.snapshot["light-intensity"];
  const nowHour = new Date(state.meta.updatedAt).getHours();

  const derived = [
    {
      id: "pump",
      label: "Bomba de recirculación",
      active: waterLevel.value > 42,
      detail: waterLevel.value > 42 ? "Caudal estable" : "Protección por nivel bajo"
    },
    {
      id: "dosing",
      label: "Dosificador de nutrientes",
      active: ph.status !== "ok" || ec.status !== "ok",
      detail: ph.status !== "ok" || ec.status !== "ok" ? "Ajuste en revisión" : "Stand-by"
    },
    {
      id: "aeration",
      label: "Aireación del tanque",
      active: true,
      detail: "Oxigenación continua"
    },
    {
      id: "grow-lights",
      label: "Luces de cultivo",
      active: nowHour >= 7 && nowHour <= 21 && light.value < 26000,
      detail: nowHour >= 7 && nowHour <= 21 ? "Compensación fotoperiodo" : "Fuera de ventana lumínica"
    }
  ];

  state.actuators = derived.map((actuator) => {
    const override = state.manualOverrides[actuator.id];
    if (override) {
      return {
        ...actuator,
        active: override.active,
        mode: "manual"
      };
    }

    return {
      ...actuator,
      mode: isMockMode() ? "auto" : "derived"
    };
  });
}

function buildServices() {
  const criticalCount = Object.values(state.snapshot).filter((entry) => entry.status === "critical").length;
  const liveAgeMs = getLiveAgeMs();
  const liveConnected = !isMockMode() && liveAgeMs <= LIVE_STALE_MS;
  const cameraHost = CAMERA_CONFIG.upstreamStreamUrl || CAMERA_CONFIG.streamUrl || CAMERA_CONFIG.embedUrl;
  const cameraService = CAMERA_CONFIG.mode === "mock"
    ? {
        id: "camera",
        label: "Canal de cámara",
        status: "pending",
        detail: "Usando simulación local hasta conectar la Raspberry"
      }
    : {
        id: "camera",
        label: "Canal de cámara",
        status: "online",
        detail: CAMERA_CONFIG.mode === "mjpeg"
          ? `Stream MJPEG configurado en ${formatCameraHost(cameraHost)}`
          : `Reproductor externo configurado en ${formatCameraHost(CAMERA_CONFIG.embedUrl)}`
      };

  state.services = [
    { id: "api", label: "API Node", status: "online", detail: "Servidor HTTP y SSE activos" },
    {
      id: "mock",
      label: "Generador mock",
      status: isMockMode() ? (state.meta.running ? "online" : "paused") : "paused",
      detail: isMockMode()
        ? (state.meta.running ? "Emitiendo muestras cada 2 segundos" : "Simulación pausada")
        : "Desactivado por ingesta real"
    },
    {
      id: "plcnext",
      label: "PLCnext bridge",
      status: isMockMode() ? "pending" : (liveConnected ? "online" : "attention"),
      detail: isMockMode()
        ? "Esperando datos reales del PLC"
        : (liveConnected ? `Fuente ${state.meta.dataMode} conectada` : `Sin datos recientes (${formatAge(liveAgeMs)})`)
    },
    {
      id: "mqtt",
      label: "MQTT gateway",
      status: isMockMode() ? "pending" : (liveConnected ? "online" : "attention"),
      detail: isMockMode()
        ? "Esperando publicaciones MQTT"
        : `Última ingesta hace ${formatAge(liveAgeMs)}`
    },
    cameraService,
    {
      id: "alerts",
      label: "Motor de alarmas",
      status: criticalCount > 0 ? "attention" : "online",
      detail: criticalCount > 0 ? `${criticalCount} crítica(s) activas` : "Sin incidencias críticas"
    }
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
  return {
    sensors: state.sensors,
    snapshot: state.snapshot,
    history: state.history,
    alarms: state.alarms,
    actuators: state.actuators,
    services: state.services,
    meta: state.meta,
    camera: CAMERA_CONFIG
  };
}

function tick() {
  if (!isMockMode() || !state.meta.running) {
    return;
  }

  tickCount += 1;
  const now = new Date();
  const freshSnapshot = {};

  sensors.forEach((sensor) => {
    const previous = state.snapshot[sensor.id]?.value ?? sensor.base;
    let next = previous + (Math.random() - 0.5) * sensor.step * 2 + (sensor.base - previous) * 0.08;

    if (tickCount % 17 === 0 && Math.random() > 0.6) {
      next += sensor.step * (Math.random() > 0.5 ? 2.6 : -2.6);
    }

    next = clamp(next, sensor.min, sensor.max);
    const reading = formatReading(sensor, next, now);

    freshSnapshot[sensor.id] = reading;
    state.history[sensor.id].push(reading);
    state.history[sensor.id] = state.history[sensor.id].slice(-HISTORY_SIZE);

    const alarm = createAlarm(sensor, reading);
    if (alarm) {
      state.alarms = [alarm, ...state.alarms.filter((entry) => entry.id !== alarm.id)].slice(0, 20);
    }
  });

  state.snapshot = freshSnapshot;
  state.meta.updatedAt = now.toISOString();
  buildActuators();
  buildServices();
  persistState();
  broadcast();
}

function injectCritical() {
  if (!isMockMode()) {
    return false;
  }

  const sensor = sensors[Math.floor(Math.random() * sensors.length)];
  const value = Math.random() > 0.5 ? sensor.max : sensor.min;
  const reading = formatReading(sensor, value, new Date());
  state.snapshot[sensor.id] = reading;
  state.history[sensor.id].push(reading);
  state.history[sensor.id] = state.history[sensor.id].slice(-HISTORY_SIZE);

  const alarm = createAlarm(sensor, reading);
  if (alarm) {
    state.alarms = [alarm, ...state.alarms.filter((entry) => entry.id !== alarm.id)].slice(0, 20);
  }

  state.meta.updatedAt = new Date().toISOString();
  buildActuators();
  buildServices();
  persistState();
  broadcast();
  return true;
}

function switchToMockMode() {
  state.meta.running = true;
  state.meta.dataMode = "mock-backend";
  state.meta.lastIngestAt = null;
  state.remoteActuators = [];
  state.meta.updatedAt = new Date().toISOString();
  buildActuators();
  buildServices();
  persistState();
  broadcast();
}

function toggleSimulation() {
  if (!isMockMode()) {
    switchToMockMode();
    return;
  }

  state.meta.running = !state.meta.running;
  state.meta.updatedAt = new Date().toISOString();
  buildServices();
  persistState();
  broadcast();
}

function toggleActuator(id) {
  if (!isMockMode()) {
    return false;
  }

  const current = state.actuators.find((actuator) => actuator.id === id);
  if (!current) {
    return false;
  }

  state.manualOverrides[id] = {
    active: !current.active
  };

  state.meta.updatedAt = new Date().toISOString();
  buildActuators();
  buildServices();
  persistState();
  broadcast();
  return true;
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

function applyReadingUpdate(payload, fallbackSource = DEFAULT_LIVE_SOURCE) {
  const sensor = resolveSensor(payload);
  const value = normalizeNumber(payload?.value ?? payload?.payload ?? payload?.reading ?? payload?.data);

  if (!sensor || value === null) {
    return null;
  }

  const source = typeof payload.source === "string" && payload.source ? payload.source : fallbackSource;
  const date = normalizeDate(payload.timestamp ?? payload.ts ?? payload.updatedAt);
  const reading = formatReading(sensor, value, date, source);

  state.snapshot[sensor.id] = reading;
  state.history[sensor.id] = [...(state.history[sensor.id] || []), reading].slice(-HISTORY_SIZE);

  const alarm = createAlarm(sensor, reading);
  if (alarm) {
    state.alarms = [alarm, ...state.alarms.filter((entry) => entry.id !== alarm.id)].slice(0, 20);
  }

  return reading;
}

function applyLivePayload(body) {
  const payload = body && typeof body === "object" ? body : {};
  const source = typeof payload.source === "string" && payload.source ? payload.source : DEFAULT_LIVE_SOURCE;
  const entries = Array.isArray(payload.readings) ? payload.readings : [payload];
  let updatedCount = 0;
  let newestDate = null;

  entries.forEach((entry) => {
    const reading = applyReadingUpdate({ ...entry, source: entry?.source || source }, source);
    if (!reading) {
      return;
    }

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
  state.meta.updatedAt = effectiveDate.toISOString();
  state.meta.lastIngestAt = effectiveDate.toISOString();
  buildActuators();
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
  ".json": "application/json; charset=utf-8"
};

function serveStatic(requestPath, response) {
  const safePath = requestPath === "/"
    ? "index.html"
    : path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^\/+/, "");
  const filePath = path.join(APP_DIR, safePath);
  const blockedRoots = [`data${path.sep}`, `app${path.sep}docs${path.sep}`];

  if (!filePath.startsWith(APP_DIR)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  if (blockedRoots.some((blockedRoot) => safePath.startsWith(blockedRoot))) {
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
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

buildActuators();
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

    if (request.method === "GET" && url.pathname === CAMERA_STREAM_PROXY_PATH) {
      await proxyCameraStream(response);
      return;
    }

    if (request.method === "GET" && url.pathname === CAMERA_CAPTURE_PROXY_PATH) {
      await proxyCameraCapture(response);
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
      const ok = applyLivePayload(body);
      sendJson(response, ok ? 200 : 400, {
        ok,
        dataMode: state.meta.dataMode,
        updatedAt: state.meta.updatedAt
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/toggle-simulation") {
      toggleSimulation();
      sendJson(response, 200, {
        ok: true,
        running: state.meta.running,
        dataMode: state.meta.dataMode
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/inject-critical") {
      const ok = injectCritical();
      sendJson(response, ok ? 200 : 409, {
        ok,
        error: ok ? undefined : "Disabled while live data ingestion is active"
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control/actuator") {
      const body = await parseBody(request);
      const ok = toggleActuator(body.id);
      sendJson(response, ok ? 200 : 409, {
        ok,
        error: ok ? undefined : "Actuator control is only available in mock mode"
      });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, {
      error: "Internal server error"
    });
  }
});

server.listen(PORT, () => {
  console.log(`HydroVision running on http://localhost:${PORT}`);
});


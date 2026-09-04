(function bootstrapApp(global) {
  const { HydroVisionCharts } = global;

  const HISTORY_SIZE = 40;
  const TICK_INTERVAL_MS = 2000;
  const BOOTSTRAP_RETRY_MS = 10000;
  const PLANT_VISION_ANALYSIS_VERSION = "leaf-focus-v3";
  const LOCAL_SENSORS = [
    { id: "air-humidity", label: "Humedad ambiente", unit: "%", decimals: 1, min: 45, max: 85, idealMin: 55, idealMax: 75, base: 67, step: 1.7, color: "#85d3a8", channel: "huerta/sensores/ambiente/humedad" },
    { id: "air-temperature", label: "Temperatura ambiente", unit: "°C", decimals: 1, min: 15, max: 35, idealMin: 20, idealMax: 28, base: 24.5, step: 0.7, color: "#f6c96b", channel: "huerta/sensores/ambiente/temperatura" },
    { id: "water-level", label: "Nivel de agua", unit: "%", decimals: 0, min: 20, max: 100, idealMin: 55, idealMax: 95, base: 74, step: 3, color: "#8fe0ff", channel: "huerta/sensores/agua/nivel" },
    { id: "air-co2", label: "CO2 ambiente", unit: "ppm", decimals: 0, min: 350, max: 1800, idealMin: 500, idealMax: 1200, base: 780, step: 55, color: "#ffb86b", channel: "huerta/sensores/ambiente/co2" },
    { id: "water-temperature", label: "Temperatura del agua", unit: "°C", decimals: 1, min: 14, max: 32, idealMin: 18, idealMax: 24, base: 21.1, step: 0.6, color: "#7cc9ff", channel: "huerta/sensores/agua/temperatura" },
    { id: "water-ph", label: "pH del agua", unit: "pH", decimals: 2, min: 4.5, max: 8, idealMin: 5.8, idealMax: 6.5, base: 6.18, step: 0.09, color: "#d0ff85", channel: "huerta/sensores/agua/ph" },
    { id: "light-intensity", label: "Intensidad lumínica", unit: "lux", decimals: 0, min: 0, max: 35000, idealMin: 18000, idealMax: 28000, base: 22600, step: 1300, color: "#ffe08a", channel: "huerta/sensores/luz/intensidad" },
    { id: "water-ec", label: "Conductividad eléctrica", unit: "mS/cm", decimals: 2, min: 0.4, max: 3.5, idealMin: 1.2, idealMax: 2.4, base: 1.82, step: 0.08, color: "#9fddff", channel: "huerta/sensores/agua/ec" }
  ];

  const sensorGrid = document.getElementById("sensorGrid");
  const chartGrid = document.getElementById("chartGrid");
  const alarmList = document.getElementById("alarmList");
  const alarmCounter = document.getElementById("alarmCounter");
  const lastUpdate = document.getElementById("lastUpdate");
  const globalStatus = document.getElementById("globalStatus");
  const dataMode = document.getElementById("dataMode");
  const toggleButton = document.getElementById("toggleSimulation");
  const injectButton = document.getElementById("injectAlert");
  const cameraCanvas = document.getElementById("cameraCanvas");
  const cameraImage = document.getElementById("cameraImage");
  const cameraEmbed = document.getElementById("cameraEmbed");
  const cameraFallback = document.getElementById("cameraFallback");
  const cameraFrame = document.querySelector(".camera-frame");
  const cameraToolbar = document.getElementById("cameraToolbar");
  const cameraModeToggle = document.getElementById("cameraModeToggle");
  const cameraRefreshSnapshot = document.getElementById("cameraRefreshSnapshot");
  const cameraZoomToggle = document.getElementById("cameraZoomToggle");
  const cameraModeHint = document.getElementById("cameraModeHint");
  const cameraTimestamp = document.getElementById("cameraTimestamp");
  const cameraSourceLabel = document.getElementById("cameraSourceLabel");
  const cameraBadge = document.getElementById("cameraBadge");
  const cameraNote = document.getElementById("cameraNote");
  const actuatorGrid = document.getElementById("actuatorGrid");
  const serviceList = document.getElementById("serviceList");
  const serviceCounter = document.getElementById("serviceCounter");
  const plantVisionAnalyze = document.getElementById("plantVisionAnalyze");
  const plantVisionStatus = document.getElementById("plantVisionStatus");
  const plantVisionArea = document.getElementById("plantVisionArea");
  const plantVisionGrowth = document.getElementById("plantVisionGrowth");
  const plantVisionSpots = document.getElementById("plantVisionSpots");
  const plantVisionConfidence = document.getElementById("plantVisionConfidence");
  const plantVisionStability = document.getElementById("plantVisionStability");
  const plantVisionTrend = document.getElementById("plantVisionTrend");
  const plantVisionDetail = document.getElementById("plantVisionDetail");
  const plantVisionCanvas = document.getElementById("plantVisionCanvas");

  const cardMap = new Map();
  const chartMap = new Map();
  const actuatorMap = new Map();
  let sensors = [];
  let stream;
  let initialized = false;
  let currentDataMode = "mock-backend";
  let currentCameraMode = "mock";
  let currentCameraConfig = {};
  let currentCameraViewMode = "snapshot";
  let cameraSnapshotZoomed = false;
  let currentCameraClock = 0;
  let currentMockAnimation = 0;
  let cameraRefreshTimer = 0;
  let cameraSnapshotRefreshing = false;
  let localFallbackState = null;
  let localFallbackTimer = 0;
  let bootstrapRetryTimer = 0;
  let currentPlantVision = { latest: null, history: [] };
  let plantVisionBusy = false;

  function isMockMode() {
    return currentDataMode === "mock-backend";
  }

  function describeDataMode(mode) {
    if (mode === "mock-backend") {
      return "Backend mock";
    }

    return mode;
  }

  function describeCameraBadge(mode) {
    if (mode === "mjpeg") {
      return "MJPEG en vivo";
    }

    if (mode === "embed") {
      return "Stream embebido";
    }

    return "Mock stream";
  }

  function formatClock(date) {
    return new Intl.DateTimeFormat("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(date);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function toStatus(sensor, value) {
    if (value < sensor.idealMin || value > sensor.idealMax) {
      const criticalLow = sensor.idealMin - (sensor.idealMin - sensor.min) * 0.45;
      const criticalHigh = sensor.idealMax + (sensor.max - sensor.idealMax) * 0.45;
      return value < criticalLow || value > criticalHigh ? "critical" : "warning";
    }

    return "ok";
  }

  function createReading(sensor, value, date, source = "mock-backend") {
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

  function createAlarm(sensor, reading) {
    if (reading.status === "ok") {
      return null;
    }

    const reason = reading.value < sensor.idealMin ? "por debajo del rango recomendado" : "por encima del rango recomendado";

    return {
      id: `${sensor.id}-${reading.timestamp}`,
      sensorId: sensor.id,
      title: `${sensor.label} ${reason}`,
      detail: `${reading.value} ${sensor.unit} | canal ${sensor.channel}`,
      severity: reading.status === "critical" ? "critical" : "warning",
      timeLabel: formatClock(new Date(reading.timestamp))
    };
  }

  function buildLocalActuators(snapshot) {
    const waterLevel = snapshot["water-level"];
    const ph = snapshot["water-ph"];
    const ec = snapshot["water-ec"];
    const light = snapshot["light-intensity"];
    const currentHour = new Date().getHours();

    return [
      {
        id: "pump",
        label: "Bomba de recirculación",
        active: waterLevel.value > 42,
        detail: waterLevel.value > 42 ? "Caudal estable" : "Protección por nivel bajo",
        mode: "auto"
      },
      {
        id: "dosing",
        label: "Dosificador de nutrientes",
        active: ph.status !== "ok" || ec.status !== "ok",
        detail: ph.status !== "ok" || ec.status !== "ok" ? "Ajuste en revisión" : "Stand-by",
        mode: "auto"
      },
      {
        id: "aeration",
        label: "Aireación del tanque",
        active: true,
        detail: "Oxigenación continua",
        mode: "auto"
      },
      {
        id: "grow-lights",
        label: "Luces de cultivo",
        active: currentHour >= 7 && currentHour <= 21 && light.value < 26000,
        detail: currentHour >= 7 && currentHour <= 21 ? "Compensación fotoperiodo" : "Fuera de ventana lumínica",
        mode: "auto"
      }
    ];
  }

  function buildLocalServices(snapshot) {
    const criticalCount = Object.values(snapshot).filter((entry) => entry.status === "critical").length;

    return [
      { id: "api", label: "API Node", status: "attention", detail: "Backend no disponible, usando mock local" },
      { id: "mock", label: "Generador mock", status: "online", detail: "Emitiendo muestras locales cada 2 segundos" },
      { id: "sensor-ingest", label: "Ingesta ESP32-S3", status: "pending", detail: "Esperando datos reales de la ESP32-S3" },
      { id: "http-ingest", label: "HTTP ingest", status: "pending", detail: "Esperando publicaciones HTTP" },
      { id: "camera", label: "Canal de cámara", status: "pending", detail: "Usando simulación local hasta conectar la ESP32-CAM" },
      {
        id: "alerts",
        label: "Motor de alarmas",
        status: criticalCount > 0 ? "attention" : "online",
        detail: criticalCount > 0 ? `${criticalCount} crítica(s) activas` : "Sin incidencias críticas"
      }
    ];
  }

  function createLocalPayload() {
    const snapshot = {};
    const history = {};
    const now = Date.now();

    LOCAL_SENSORS.forEach((sensor) => {
      const points = [];
      let current = sensor.base;

      for (let index = HISTORY_SIZE; index > 0; index -= 1) {
        current += (Math.random() - 0.5) * sensor.step * 1.3 + (sensor.base - current) * 0.08;
        current = clamp(current, sensor.min, sensor.max);
        points.push(createReading(sensor, current, new Date(now - index * TICK_INTERVAL_MS)));
      }

      history[sensor.id] = points;
      snapshot[sensor.id] = points[points.length - 1];
    });

    return {
      sensors: LOCAL_SENSORS,
      snapshot,
      history,
      alarms: Object.values(snapshot)
        .map((reading) => createAlarm(LOCAL_SENSORS.find((sensor) => sensor.id === reading.sensorId), reading))
        .filter(Boolean)
        .slice(0, 20),
      actuators: buildLocalActuators(snapshot),
      services: buildLocalServices(snapshot),
      meta: {
        updatedAt: new Date().toISOString(),
        running: true,
        dataMode: "mock-backend",
        lastIngestAt: null
      },
      camera: {
        mode: "mock",
        badge: "Mock stream",
        label: "ESP32-CAM OV3660",
        note: "Esta vista puede usar simulación o imagen real desde la ESP32-CAM configurada en el backend."
      },
      plantVision: {
        latest: null,
        history: []
      }
    };
  }

  function tickLocalPayload() {
    if (!localFallbackState) {
      localFallbackState = createLocalPayload();
      return localFallbackState;
    }

    const updatedAt = new Date();
    const nextSnapshot = {};
    const nextAlarms = [];

    LOCAL_SENSORS.forEach((sensor) => {
      const previous = localFallbackState.snapshot[sensor.id]?.value ?? sensor.base;
      let next = previous + (Math.random() - 0.5) * sensor.step * 2 + (sensor.base - previous) * 0.08;
      next = clamp(next, sensor.min, sensor.max);

      const reading = createReading(sensor, next, updatedAt);
      nextSnapshot[sensor.id] = reading;
      localFallbackState.history[sensor.id] = [...localFallbackState.history[sensor.id], reading].slice(-HISTORY_SIZE);

      const alarm = createAlarm(sensor, reading);
      if (alarm) {
        nextAlarms.push(alarm);
      }
    });

    localFallbackState.snapshot = nextSnapshot;
    localFallbackState.alarms = nextAlarms.slice(0, 20);
    localFallbackState.actuators = buildLocalActuators(nextSnapshot);
    localFallbackState.services = buildLocalServices(nextSnapshot);
    localFallbackState.meta.updatedAt = updatedAt.toISOString();

    return localFallbackState;
  }

  function stopLocalFallback() {
    if (!localFallbackTimer) {
      return;
    }

    clearInterval(localFallbackTimer);
    localFallbackTimer = 0;
  }

  function startLocalFallback() {
    if (!localFallbackState) {
      localFallbackState = createLocalPayload();
      hydrate(localFallbackState);
    }

    if (localFallbackTimer) {
      return;
    }

    localFallbackTimer = setInterval(() => {
      hydrate(tickLocalPayload());
    }, TICK_INTERVAL_MS);
  }

  function stopBootstrapRetry() {
    if (!bootstrapRetryTimer) {
      return;
    }

    clearInterval(bootstrapRetryTimer);
    bootstrapRetryTimer = 0;
  }

  function scheduleBootstrapRetry() {
    if (bootstrapRetryTimer) {
      return;
    }

    bootstrapRetryTimer = setInterval(() => {
      bootstrap();
    }, BOOTSTRAP_RETRY_MS);
  }

  function formatValue(sensor, reading) {
    return Number(reading.value).toFixed(sensor.decimals);
  }

  function percentageInRange(sensor, value) {
    return ((value - sensor.min) / (sensor.max - sensor.min)) * 100;
  }

  function buildSensorCards(snapshot) {
    sensorGrid.innerHTML = "";
    sensors.forEach((sensor) => {
      const reading = snapshot[sensor.id];
      const article = document.createElement("article");
      article.className = "sensor-card";
      article.innerHTML = `
        <div class="sensor-card__label">
          <span>${sensor.label}</span>
          <span class="status-pill"></span>
        </div>
        <div class="sensor-card__value">
          <strong class="sensor-card__number"></strong>
          <span class="sensor-card__unit">${sensor.unit}</span>
        </div>
        <div class="sensor-card__meta">
          <span class="trend"></span>
          <span>Canal HTTP</span>
        </div>
        <div class="mini-meter"><span></span></div>
      `;
      sensorGrid.appendChild(article);
      cardMap.set(sensor.id, article);
      updateSensorCard(sensor, reading, null);
    });
  }

  function updateSensorCard(sensor, reading, previous) {
    const card = cardMap.get(sensor.id);
    if (!card || !reading) {
      return;
    }

    const statusPill = card.querySelector(".status-pill");
    const number = card.querySelector(".sensor-card__number");
    const trend = card.querySelector(".trend");
    const meter = card.querySelector(".mini-meter > span");
    const meta = card.querySelector(".sensor-card__meta span:last-child");
    const delta = previous ? reading.value - previous.value : 0;

    statusPill.className = `status-pill status-pill--${reading.status === "critical" ? "danger" : reading.status}`;
    statusPill.textContent = reading.status === "ok" ? "En rango" : reading.status === "warning" ? "Atención" : "Crítico";
    number.textContent = formatValue(sensor, reading);

    trend.className = `trend ${delta >= 0 ? "trend--up" : "trend--down"}`;
    trend.textContent = `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(sensor.decimals)} desde la muestra previa`;

    meter.style.width = `${Math.max(3, Math.min(100, percentageInRange(sensor, reading.value)))}%`;
    meter.style.background = `linear-gradient(90deg, ${sensor.color}66, ${sensor.color})`;
    meta.textContent = sensor.channel;
  }

  function buildCharts(history) {
    chartGrid.innerHTML = "";
    sensors.forEach((sensor) => {
      const article = document.createElement("article");
      article.className = "chart-card";
      article.innerHTML = `
        <header>
          <div>
            <h3>${sensor.label}</h3>
            <p>${sensor.idealMin} - ${sensor.idealMax} ${sensor.unit} ideal</p>
          </div>
          <span class="badge badge--dark">${sensor.unit}</span>
        </header>
        <canvas width="320" height="180"></canvas>
      `;
      chartGrid.appendChild(article);
      chartMap.set(sensor.id, article.querySelector("canvas"));
      updateChart(sensor, history[sensor.id] || []);
    });
  }

  function updateChart(sensor, points) {
    const canvas = chartMap.get(sensor.id);
    if (!canvas) {
      return;
    }

    HydroVisionCharts.drawLineChart(canvas, points, {
      color: sensor.color,
      min: sensor.min,
      max: sensor.max
    });
  }

  function buildActuators(actuators) {
    actuatorGrid.innerHTML = "";
    actuatorMap.clear();

    actuators.forEach((actuator) => {
      const article = document.createElement("article");
      article.className = "actuator-card";
      article.innerHTML = `
        <div class="actuator-card__row">
          <strong>${actuator.label}</strong>
          <span class="badge badge--dark">${actuator.mode}</span>
        </div>
        <p>${actuator.detail}</p>
        <button class="button button--ghost" type="button">Alternar</button>
      `;

      article.querySelector("button").addEventListener("click", async () => {
        if (!isMockMode()) {
          return;
        }

        await fetch("/api/control/actuator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: actuator.id })
        });
      });

      actuatorGrid.appendChild(article);
      actuatorMap.set(actuator.id, article);
      updateActuator(actuator);
    });
  }

  function updateActuator(actuator) {
    const card = actuatorMap.get(actuator.id);
    if (!card) {
      return;
    }

    const badge = card.querySelector(".badge");
    const button = card.querySelector("button");
    const detail = card.querySelector("p");
    const mockMode = isMockMode();

    badge.textContent = `${actuator.mode} / ${actuator.active ? "activo" : "apagado"}`;
    button.textContent = mockMode ? (actuator.active ? "Apagar" : "Encender") : "Solo lectura";
    button.disabled = !mockMode;
    button.title = mockMode ? "" : "En modo real, el control debe venir desde el firmware o el backend.";
    detail.textContent = actuator.detail;
  }

  function renderServices(services) {
    serviceList.innerHTML = "";
    serviceCounter.textContent = `${services.filter((service) => service.status === "online").length}/${services.length} online`;

    services.forEach((service) => {
      const article = document.createElement("article");
      article.className = "service-card";
      article.innerHTML = `
        <div>
          <strong>${service.label}</strong>
          <p>${service.detail}</p>
        </div>
        <div class="service-dot"></div>
      `;

      article.querySelector(".service-dot").classList.add(`service-${service.status}`);
      serviceList.appendChild(article);
    });
  }

  function showTransientStatus(message, level) {
    globalStatus.className = `status-pill status-pill--${level}`;
    globalStatus.textContent = message;
  }

  function updateAlarms(alarms) {
    alarmList.innerHTML = "";

    if (!alarms.length) {
      const item = document.createElement("li");
      item.className = "alarm-item";
      item.innerHTML = `
        <div class="alarm-item__title"><strong>Sin alarmas activas</strong><span class="badge">Sistema estable</span></div>
        <div class="alarm-item__meta">Los valores actuales se mantienen dentro de los rangos previstos.</div>
      `;
      alarmList.appendChild(item);
      alarmCounter.textContent = "0 activas";
      return;
    }

    alarms.slice(0, 6).forEach((alarm) => {
      const item = document.createElement("li");
      item.className = `alarm-item alarm-item--${alarm.severity}`;
      item.innerHTML = `
        <div class="alarm-item__title">
          <strong>${alarm.title}</strong>
          <span class="badge ${alarm.severity === "critical" ? "" : "badge--dark"}">${alarm.severity === "critical" ? "Crítica" : "Advertencia"}</span>
        </div>
        <div class="alarm-item__meta">${alarm.detail}</div>
        <div class="alarm-item__meta">${alarm.timeLabel}</div>
      `;
      alarmList.appendChild(item);
    });

    alarmCounter.textContent = `${alarms.filter((alarm) => alarm.severity === "critical").length} críticas / ${alarms.length} total`;
  }

  function updateGlobalStatus(snapshot) {
    const values = Object.values(snapshot);
    const hasCritical = values.some((entry) => entry.status === "critical");
    const hasWarning = values.some((entry) => entry.status === "warning");

    if (hasCritical) {
      globalStatus.className = "status-pill status-pill--danger";
      globalStatus.textContent = "Revisión inmediata";
      return;
    }

    if (hasWarning) {
      globalStatus.className = "status-pill status-pill--warning";
      globalStatus.textContent = "Ajustes recomendados";
      return;
    }

    globalStatus.className = "status-pill status-pill--ok";
    globalStatus.textContent = "Operación estable";
  }

  function stopCameraClock() {
    if (!currentCameraClock) {
      return;
    }

    clearInterval(currentCameraClock);
    currentCameraClock = 0;
  }

  function ensureCameraClock() {
    if (currentCameraClock) {
      return;
    }

    currentCameraClock = setInterval(() => {
      if (currentCameraMode === "mock") {
        return;
      }

      cameraTimestamp.textContent = formatClock(new Date());
    }, 1000);
  }

  function stopMockCamera() {
    if (!currentMockAnimation) {
      return;
    }

    cancelAnimationFrame(currentMockAnimation);
    currentMockAnimation = 0;
  }

  function startMockCamera() {
    if (currentMockAnimation) {
      return;
    }

    const frame = (time) => {
      if (currentCameraMode !== "mock") {
        currentMockAnimation = 0;
        return;
      }

      HydroVisionCharts.drawCamera(cameraCanvas, { time });
      cameraTimestamp.textContent = formatClock(new Date());
      currentMockAnimation = requestAnimationFrame(frame);
    };

    currentMockAnimation = requestAnimationFrame(frame);
  }

  function hideCameraFallback() {
    cameraFallback.hidden = true;
    cameraFallback.textContent = "";
  }

  function showCameraFallback(message) {
    cameraFallback.hidden = false;
    cameraFallback.textContent = message;
  }

  function stopCameraRefresh() {
    if (!cameraRefreshTimer) {
      return;
    }

    clearInterval(cameraRefreshTimer);
    cameraRefreshTimer = 0;
  }

  function withCacheBust(url) {
    if (!url) {
      return "";
    }

    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}t=${Date.now()}`;
  }

  function describeRefresh(ms) {
    if (ms >= 3600000 && ms % 3600000 === 0) {
      const hours = ms / 3600000;
      return `${hours} h`;
    }

    if (ms >= 60000 && ms % 60000 === 0) {
      const minutes = ms / 60000;
      return `${minutes} min`;
    }

    const seconds = Math.max(1, Math.round(ms / 1000));
    return `${seconds} s`;
  }

  function setCameraControlsVisible(visible) {
    if (!cameraToolbar) {
      return;
    }

    cameraToolbar.hidden = !visible;
  }

  function setSnapshotRefreshVisible(visible) {
    if (!cameraRefreshSnapshot) {
      return;
    }

    cameraRefreshSnapshot.hidden = !visible;
  }

  function setSnapshotZoomVisible(visible) {
    if (!cameraZoomToggle) {
      return;
    }

    cameraZoomToggle.hidden = !visible;
  }

  function applySnapshotZoom() {
    if (cameraFrame) {
      cameraFrame.dataset.zoom = cameraSnapshotZoomed ? "true" : "false";
    }

    if (cameraZoomToggle) {
      cameraZoomToggle.textContent = cameraSnapshotZoomed ? "Ver encuadre" : "Ampliar imagen";
    }
  }

  function setSnapshotRefreshBusy(isBusy) {
    cameraSnapshotRefreshing = isBusy;

    if (!cameraRefreshSnapshot) {
      return;
    }

    cameraRefreshSnapshot.disabled = isBusy;
    cameraRefreshSnapshot.textContent = isBusy ? "Actualizando..." : "Actualizar imagen HD";
  }

  function setMediaSource(element, nextSource) {
    const currentSource = element.dataset.src || "";
    const normalizedSource = nextSource || "";

    if (currentSource === normalizedSource) {
      return;
    }

    element.dataset.src = normalizedSource;
    if (normalizedSource) {
      element.src = normalizedSource;
      return;
    }

    element.removeAttribute("src");
  }

  function refreshCameraSnapshot(manual = false) {
    if (currentCameraMode !== "mjpeg" || currentCameraViewMode !== "snapshot") {
      return;
    }

    if (!currentCameraConfig.captureUrl) {
      setMediaSource(cameraImage, "");
      showCameraFallback("No hay una URL de captura configurada en el backend.");
      return;
    }

    if (manual || !cameraImage.dataset.src) {
      setSnapshotRefreshBusy(true);
    }

    setMediaSource(cameraImage, withCacheBust(currentCameraConfig.captureUrl));
  }

  function renderCameraSnapshot(cameraConfig) {
    const refreshMs = cameraConfig.captureRefreshMs || 5000;
    const stillLabel = cameraConfig.stillProfile?.label || "alta calidad";

    setMediaSource(cameraEmbed, "");
    cameraBadge.textContent = "Imagen HD";
    setSnapshotRefreshVisible(true);
    setSnapshotZoomVisible(true);
    applySnapshotZoom();
    if (cameraModeToggle) {
      cameraModeToggle.textContent = "Ver video en vivo";
    }

    if (cameraModeHint) {
      cameraModeHint.textContent = `Imagen ${stillLabel}, actualizada cada ${describeRefresh(refreshMs)}`;
    }

    if (!cameraRefreshTimer) {
      refreshCameraSnapshot();
      cameraRefreshTimer = setInterval(refreshCameraSnapshot, refreshMs);
    }
  }

  function renderCameraVideo(cameraConfig) {
    const videoLabel = cameraConfig.videoProfile?.label || "MJPEG";

    stopCameraRefresh();
    cameraBadge.textContent = "MJPEG en vivo";
    setSnapshotRefreshVisible(false);
    setSnapshotZoomVisible(false);
    cameraSnapshotZoomed = false;
    applySnapshotZoom();
    setSnapshotRefreshBusy(false);
    if (cameraModeToggle) {
      cameraModeToggle.textContent = "Ver imagen HD";
    }

    if (cameraModeHint) {
      cameraModeHint.textContent = `Video en tiempo real, perfil ${videoLabel}`;
    }

    setMediaSource(cameraEmbed, "");

    if (!cameraConfig.streamUrl) {
      setMediaSource(cameraImage, "");
      showCameraFallback("No hay una URL MJPEG configurada en el backend.");
      return;
    }

    setMediaSource(cameraImage, cameraConfig.streamUrl);
    cameraTimestamp.textContent = formatClock(new Date());
  }

  function renderCamera(camera) {
    const cameraConfig = camera && typeof camera === "object" ? camera : {};
    const mode = cameraConfig.mode || "mock";

    currentCameraMode = mode;
    currentCameraConfig = cameraConfig;
    if (cameraFrame) {
      cameraFrame.dataset.mode = mode;
      cameraFrame.dataset.view = currentCameraViewMode;
      cameraFrame.dataset.zoom = cameraSnapshotZoomed ? "true" : "false";
    }

    cameraBadge.textContent = cameraConfig.badge || describeCameraBadge(mode);
    cameraSourceLabel.textContent = cameraConfig.label || "ESP32-CAM OV3660";
    cameraNote.textContent = cameraConfig.note || "Esta vista puede usar simulación o imagen real desde la ESP32-CAM configurada en el backend.";

    cameraCanvas.hidden = mode !== "mock";
    cameraImage.hidden = mode !== "mjpeg";
    cameraEmbed.hidden = mode !== "embed";
    hideCameraFallback();

    if (mode === "mjpeg") {
      stopMockCamera();
      ensureCameraClock();
      setCameraControlsVisible(true);

      if (!cameraConfig.captureUrl && currentCameraViewMode === "snapshot") {
        currentCameraViewMode = "video";
      }

      if (cameraFrame) {
        cameraFrame.dataset.view = currentCameraViewMode;
      }

      if (currentCameraViewMode === "video") {
        renderCameraVideo(cameraConfig);
        return;
      }

      renderCameraSnapshot(cameraConfig);
      return;
    }

    if (mode === "embed") {
      stopMockCamera();
      stopCameraRefresh();
      ensureCameraClock();
      setCameraControlsVisible(false);
      setSnapshotRefreshVisible(false);
      setSnapshotZoomVisible(false);
      cameraSnapshotZoomed = false;
      applySnapshotZoom();
      setSnapshotRefreshBusy(false);
      setMediaSource(cameraImage, "");

      if (!cameraConfig.embedUrl) {
        setMediaSource(cameraEmbed, "");
        showCameraFallback("No hay una URL de visor embebido configurada en el backend.");
        return;
      }

      setMediaSource(cameraEmbed, cameraConfig.embedUrl);
      cameraTimestamp.textContent = formatClock(new Date());
      return;
    }

    stopCameraClock();
    stopCameraRefresh();
    setCameraControlsVisible(false);
    setSnapshotRefreshVisible(false);
    setSnapshotZoomVisible(false);
    cameraSnapshotZoomed = false;
    applySnapshotZoom();
    setSnapshotRefreshBusy(false);
    setMediaSource(cameraImage, "");
    setMediaSource(cameraEmbed, "");
    startMockCamera();
  }

  function toPercent(value, decimals = 1) {
    if (!Number.isFinite(value)) {
      return "--";
    }

    return `${value.toFixed(decimals)}%`;
  }

  function rgbToHsv(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;

    if (delta) {
      if (max === r) {
        hue = ((g - b) / delta) % 6;
      } else if (max === g) {
        hue = (b - r) / delta + 2;
      } else {
        hue = (r - g) / delta + 4;
      }

      hue *= 60;
      if (hue < 0) {
        hue += 360;
      }
    }

    return {
      hue,
      saturation: max === 0 ? 0 : delta / max,
      value: max
    };
  }

  function classifyPlantVision(plantRatio, spotRatio, growthDelta, confidence) {
    if (plantRatio < 1) {
      return {
        status: "attention",
        label: "Sin hojas",
        detail: "No se detectó suficiente vegetación en el encuadre."
      };
    }

    if (confidence < 45) {
      return {
        status: "warning",
        label: "Baja confianza",
        detail: "La iluminación o el encuadre limitan la lectura visual."
      };
    }

    if (spotRatio > 10 || growthDelta < -8) {
      return {
        status: "attention",
        label: "Revisar",
        detail: "Hay una variación fuerte o zonas atípicas cerca de la hoja."
      };
    }

    if (spotRatio > 1 || growthDelta < -3) {
      return {
        status: "warning",
        label: "Atención",
        detail: "Se detectan pequeñas zonas sospechosas para seguir observando."
      };
    }

    return {
      status: "ok",
      label: "Estable",
      detail: "El área foliar y el color se ven dentro de lo esperado."
    };
  }

  function getPlantTrend(history, currentArea) {
    const previousAreas = (history || [])
      .map((entry) => Number(entry?.metrics?.plantAreaPercent))
      .filter(Number.isFinite)
      .slice(-5);

    if (!previousAreas.length || !Number.isFinite(currentArea)) {
      return {
        label: "Base",
        delta: 0,
        baseline: currentArea
      };
    }

    const baseline = previousAreas.reduce((sum, value) => sum + value, 0) / previousAreas.length;
    const delta = currentArea - baseline;

    if (delta > 1) {
      return { label: "Creciendo", delta, baseline };
    }

    if (delta < -1) {
      return { label: "Bajando", delta, baseline };
    }

    return { label: "Estable", delta, baseline };
  }

  function getFrameStability(previous, box, sourceWidth, sourceHeight, plantRatio) {
    const previousBox = previous?.metrics?.boundingBox;
    if (!previousBox || !box) {
      return {
        label: "Base",
        score: 100,
        shiftPercent: 0
      };
    }

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const previousCenterX = previousBox.x + previousBox.width / 2;
    const previousCenterY = previousBox.y + previousBox.height / 2;
    const shift = Math.hypot(centerX - previousCenterX, centerY - previousCenterY);
    const diagonal = Math.hypot(sourceWidth, sourceHeight);
    const shiftPercent = diagonal ? (shift / diagonal) * 100 : 0;
    const previousArea = Number(previous?.metrics?.plantAreaPercent);
    const areaDelta = Number.isFinite(previousArea) ? Math.abs(plantRatio - previousArea) : 0;
    const score = clamp(100 - shiftPercent * 5.5 - areaDelta * 2.2, 0, 100);

    if (score >= 70) {
      return { label: "Fijo", score: Number(score.toFixed(0)), shiftPercent: Number(shiftPercent.toFixed(2)) };
    }

    if (score >= 45) {
      return { label: "Variable", score: Number(score.toFixed(0)), shiftPercent: Number(shiftPercent.toFixed(2)) };
    }

    return { label: "Movido", score: Number(score.toFixed(0)), shiftPercent: Number(shiftPercent.toFixed(2)) };
  }

  function getAnalysisConfidence(plantRatio, averageBrightness, averageSaturation, stabilityScore, spotRatio) {
    let score = 50;
    score += clamp(plantRatio * 2.4, 0, 28);
    score += averageBrightness >= 35 && averageBrightness <= 78 ? 18 : -12;
    score += averageSaturation >= 14 ? 12 : -8;
    score += clamp((stabilityScore - 50) * 0.22, -8, 10);
    if (spotRatio > 4) {
      score = Math.min(score, 76);
    } else if (spotRatio > 1) {
      score = Math.min(score, 84);
    }
    return Math.round(clamp(score, 0, 100));
  }

  function weightedQuantile(points, quantile) {
    if (!points.length) {
      return 0;
    }

    const ordered = [...points].sort((a, b) => a.value - b.value);
    const totalWeight = ordered.reduce((total, point) => total + point.weight, 0);
    const target = totalWeight * quantile;
    let running = 0;

    for (const point of ordered) {
      running += point.weight;
      if (running >= target) {
        return point.value;
      }
    }

    return ordered[ordered.length - 1].value;
  }

  function getLeafFocus(blocks, blocksX, blocksY, blockSize, targetWidth, targetHeight) {
    const blockPixelCount = blockSize * blockSize;
    const blockMeta = blocks.map((block) => ({
      density: block.green / blockPixelCount,
      averageHue: block.green ? block.hue / block.green : 0,
      averageBrightness: block.green ? block.brightness / block.green : 0,
      averageSaturation: block.green ? block.saturation / block.green : 0
    }));
    const lowerLeafLimit = Math.floor(blocksY * 0.72);
    const coreCandidates = blocks.map((block, index) => {
      const blockY = Math.floor(index / blocksX);
      const meta = blockMeta[index];
      const leafColor = meta.averageHue >= 55
        && meta.averageHue <= 178
        && meta.averageSaturation >= 0.075
        && meta.averageBrightness >= 0.08;
      const denseSurface = block.green >= blockPixelCount * 0.07 && meta.density >= 0.075;
      const veryDenseSurface = block.green >= blockPixelCount * 0.16 && meta.density >= 0.16;
      const lowerThinStem = blockY > lowerLeafLimit && meta.density < 0.24;
      return leafColor && (denseSurface || veryDenseSurface) && !lowerThinStem;
    });
    const visited = new Set();
    const components = [];

    coreCandidates.forEach((isCandidate, startIndex) => {
      if (!isCandidate || visited.has(startIndex)) {
        return;
      }

      const stack = [startIndex];
      const indexes = [];
      let green = 0;
      let minBlockX = blocksX;
      let minBlockY = blocksY;
      let maxBlockX = 0;
      let maxBlockY = 0;
      let broadBlocks = 0;

      visited.add(startIndex);
      while (stack.length) {
        const index = stack.pop();
        const blockX = index % blocksX;
        const blockY = Math.floor(index / blocksX);
        const meta = blockMeta[index];
        indexes.push(index);
        green += blocks[index].green;
        broadBlocks += meta.density >= 0.18 ? 1 : 0;
        minBlockX = Math.min(minBlockX, blockX);
        minBlockY = Math.min(minBlockY, blockY);
        maxBlockX = Math.max(maxBlockX, blockX);
        maxBlockY = Math.max(maxBlockY, blockY);

        [
          [blockX - 1, blockY],
          [blockX + 1, blockY],
          [blockX, blockY - 1],
          [blockX, blockY + 1]
        ].forEach(([nextX, nextY]) => {
          if (nextX < 0 || nextX >= blocksX || nextY < 0 || nextY >= blocksY) {
            return;
          }

          const nextIndex = nextY * blocksX + nextX;
          if (!coreCandidates[nextIndex] || visited.has(nextIndex)) {
            return;
          }

          visited.add(nextIndex);
          stack.push(nextIndex);
        });
      }

      const widthBlocks = maxBlockX - minBlockX + 1;
      const heightBlocks = maxBlockY - minBlockY + 1;
      const density = green / (indexes.length * blockPixelCount);
      const compactness = indexes.length / (widthBlocks * heightBlocks);
      const hasLeafShape = indexes.length >= 3 && widthBlocks >= 2 && heightBlocks >= 2 && density >= 0.075 && compactness >= 0.24;
      const hasSmallLeafShape = indexes.length >= 4 && broadBlocks >= 2 && density >= 0.12 && compactness >= 0.3;
      const aspect = Math.max(widthBlocks, heightBlocks) / Math.max(1, Math.min(widthBlocks, heightBlocks));
      const isThinLine = (Math.min(widthBlocks, heightBlocks) <= 1 && Math.max(widthBlocks, heightBlocks) >= 4)
        || (aspect > 5.5 && broadBlocks / indexes.length < 0.52)
        || (maxBlockY > lowerLeafLimit && compactness < 0.28);
      if ((hasLeafShape || hasSmallLeafShape) && !isThinLine) {
        const lowerPenalty = maxBlockY > lowerLeafLimit ? 0.7 : 1;
        const score = (green * (0.8 + density) + broadBlocks * 80) * lowerPenalty;
        components.push({ indexes, green, minBlockX, minBlockY, maxBlockX, maxBlockY, density, score });
      }
    });

    const ranked = components.sort((a, b) => b.score - a.score);
    const topScore = ranked[0]?.score || 0;
    const selected = ranked
      .filter((component, index) => index < 5 && (index === 0 || component.score >= topScore * 0.18 || component.green >= blockPixelCount * 1.4))
      .slice(0, 5);
    const leafIndexes = new Set(selected.flatMap((component) => component.indexes));

    const canExpandTo = (index) => {
      const block = blocks[index];
      const blockY = Math.floor(index / blocksX);
      const meta = blockMeta[index];
      const edgeLeafColor = meta.averageHue >= 58
        && meta.averageHue <= 175
        && meta.averageSaturation >= 0.055
        && meta.averageBrightness >= 0.08;
      const edgeSurface = block.green >= Math.max(4, blockPixelCount * 0.018) && meta.density >= 0.018;
      const lowerThinStem = blockY > lowerLeafLimit && meta.density < 0.18;
      return edgeLeafColor && edgeSurface && !lowerThinStem;
    };

    for (let pass = 0; pass < 1; pass += 1) {
      const additions = [];
      leafIndexes.forEach((index) => {
        const blockX = index % blocksX;
        const blockY = Math.floor(index / blocksX);
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (!offsetX && !offsetY) {
              continue;
            }

            const neighborX = blockX + offsetX;
            const neighborY = blockY + offsetY;
            if (neighborX < 0 || neighborX >= blocksX || neighborY < 0 || neighborY >= blocksY) {
              continue;
            }

            const neighborIndex = neighborY * blocksX + neighborX;
            if (!leafIndexes.has(neighborIndex) && canExpandTo(neighborIndex)) {
              additions.push(neighborIndex);
            }
          }
        }
      });
      additions.forEach((index) => leafIndexes.add(index));
    }

    if (!leafIndexes.size) {
      blocks.forEach((block, index) => {
        const meta = blockMeta[index];
        const blockY = Math.floor(index / blocksX);
        if (block.green >= Math.max(5, blockPixelCount * 0.03) && meta.density >= 0.03 && blockY <= lowerLeafLimit) {
          leafIndexes.add(index);
        }
      });
    }

    if (!leafIndexes.size) {
      return {
        leafIndexes,
        leafPixels: 0,
        leafBlockCount: 0,
        focusBox: null
      };
    }

    let leafPixels = 0;
    const weightedX = [];
    const weightedY = [];
    leafIndexes.forEach((index) => {
      const block = blocks[index];
      const blockX = index % blocksX;
      const blockY = Math.floor(index / blocksX);
      const centerX = blockX * blockSize + blockSize / 2;
      const centerY = blockY * blockSize + blockSize / 2;
      leafPixels += block.green;
      weightedX.push({ value: centerX, weight: Math.max(block.green, 1) });
      weightedY.push({ value: centerY, weight: Math.max(block.green, 1) });
    });

    const minX = Math.max(0, weightedQuantile(weightedX, 0.03) - blockSize * 1.5);
    const maxX = Math.min(targetWidth, weightedQuantile(weightedX, 0.97) + blockSize * 1.5);
    const minY = Math.max(0, weightedQuantile(weightedY, 0.03) - blockSize * 1.5);
    const maxY = Math.min(targetHeight, weightedQuantile(weightedY, 0.91) + blockSize * 1.5);

    return {
      leafIndexes,
      leafPixels,
      leafBlockCount: leafIndexes.size,
      focusBox: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      }
    };
  }

  function expandCropToAspect(box, targetWidth, targetHeight, aspectRatio) {
    if (!box) {
      return { x: 0, y: 0, width: targetWidth, height: targetHeight };
    }

    const padding = 0.12;
    let width = box.width * (1 + padding * 2);
    let height = box.height * (1 + padding * 2);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    if (width / height > aspectRatio) {
      height = width / aspectRatio;
    } else {
      width = height * aspectRatio;
    }

    width = Math.min(targetWidth, Math.max(width, targetWidth * 0.28));
    height = Math.min(targetHeight, Math.max(height, targetHeight * 0.28));

    let x = clamp(centerX - width / 2, 0, targetWidth - width);
    let y = clamp(centerY - height / 2, 0, targetHeight - height);

    return { x, y, width, height };
  }

  function isLeafContext(blockPosition, leafIndexes, blocksX, blocksY) {
    if (leafIndexes.has(blockPosition)) {
      return true;
    }

    const blockX = blockPosition % blocksX;
    const blockY = Math.floor(blockPosition / blocksX);
    let leafNeighbors = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (!offsetX && !offsetY) {
          continue;
        }

        const neighborX = blockX + offsetX;
        const neighborY = blockY + offsetY;
        if (neighborX < 0 || neighborX >= blocksX || neighborY < 0 || neighborY >= blocksY) {
          continue;
        }

        if (leafIndexes.has(neighborY * blocksX + neighborX)) {
          leafNeighbors += 1;
        }
      }
    }

    return leafNeighbors >= 2;
  }

  function drawFocusedPlantOverlay(context, blocks, blocksX, blockSize, crop, canvasWidth, canvasHeight, leafIndexes) {
    context.save();
    blocks.forEach((block, index) => {
      if (!leafIndexes.has(index) && !block.suspectConfirmed) {
        return;
      }

      const x = (index % blocksX) * blockSize;
      const y = Math.floor(index / blocksX) * blockSize;
      const scaleX = canvasWidth / crop.width;
      const scaleY = canvasHeight / crop.height;
      const drawX = (x - crop.x) * scaleX;
      const drawY = (y - crop.y) * scaleY;
      const drawWidth = blockSize * scaleX;
      const drawHeight = blockSize * scaleY;

      if (drawX + drawWidth < 0 || drawY + drawHeight < 0 || drawX > canvasWidth || drawY > canvasHeight) {
        return;
      }

      if (leafIndexes.has(index) && block.green > block.suspectConfirmed) {
        context.fillStyle = "rgba(107, 229, 170, 0.16)";
        context.fillRect(drawX, drawY, drawWidth, drawHeight);
      }

      if (block.suspectConfirmed) {
        context.fillStyle = "rgba(255, 127, 110, 0.38)";
        context.fillRect(drawX, drawY, drawWidth, drawHeight);
      }
    });
    context.restore();
  }

  function analyzePlantImage(image, capture, previous) {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const targetWidth = Math.min(640, sourceWidth);
    const targetHeight = Math.round((targetWidth / sourceWidth) * sourceHeight);
    const context = plantVisionCanvas.getContext("2d", { willReadFrequently: true });

    plantVisionCanvas.width = targetWidth;
    plantVisionCanvas.height = targetHeight;
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const pixels = context.getImageData(0, 0, targetWidth, targetHeight).data;
    const blockSize = 12;
    const blocksX = Math.ceil(targetWidth / blockSize);
    const blocksY = Math.ceil(targetHeight / blockSize);
    const blocks = Array.from({ length: blocksX * blocksY }, () => ({
      green: 0,
      suspect: 0,
      suspectConfirmed: 0,
      hue: 0,
      brightness: 0,
      saturation: 0
    }));
    const totalPixels = targetWidth * targetHeight;

    for (let index = 0; index < pixels.length; index += 4) {
      const pixelIndex = index / 4;
      const x = pixelIndex % targetWidth;
      const y = Math.floor(pixelIndex / targetWidth);
      const blockIndex = Math.floor(y / blockSize) * blocksX + Math.floor(x / blockSize);
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const hsv = rgbToHsv(red, green, blue);
      const isWhiteBackground = hsv.value > 0.72 && hsv.saturation < 0.18;
      const isGreenLeaf = hsv.hue >= 55 && hsv.hue <= 175 && hsv.saturation > 0.1 && hsv.value > 0.08;
      const isRustOrBrownPatch = (hsv.hue <= 34 || hsv.hue >= 345)
        && hsv.saturation > 0.11
        && hsv.value > 0.08
        && hsv.value < 0.7
        && red > green * 0.72;
      const isBrownOrYellowPatch = hsv.hue >= 18 && hsv.hue <= 92 && hsv.saturation > 0.08 && hsv.value > 0.09 && hsv.value < 0.75;
      const isPurpleOrDarkPatch = hsv.value < 0.44 && hsv.saturation > 0.06 && (blue > green * 0.82 || red > green * 0.72);

      if (isWhiteBackground) {
        continue;
      }

      if (isGreenLeaf) {
        blocks[blockIndex].green += 1;
        blocks[blockIndex].hue += hsv.hue;
        blocks[blockIndex].brightness += hsv.value;
        blocks[blockIndex].saturation += hsv.saturation;
      }

      if (!isGreenLeaf && (isRustOrBrownPatch || isBrownOrYellowPatch || isPurpleOrDarkPatch)) {
        blocks[blockIndex].suspect += 1;
      }
    }

    const leafFocus = getLeafFocus(blocks, blocksX, blocksY, blockSize, targetWidth, targetHeight);
    const leafIndexes = leafFocus.leafIndexes;
    let suspectBlockCount = 0;
    const suspectPixels = blocks.reduce((total, block, blockPosition) => {
      const blockPixelCount = blockSize * blockSize;
      const greenDensity = block.green / blockPixelCount;
      const suspectDensity = block.suspect / blockPixelCount;
      const leafHue = block.green ? block.hue / block.green : 0;
      const leafSaturation = block.green ? block.saturation / block.green : 0;
      const blockY = Math.floor(blockPosition / blocksX);
      const leafLikeColor = leafHue >= 68 && leafHue <= 172 && leafSaturation >= 0.09;
      const hasLeafSurface = leafIndexes.has(blockPosition)
        ? greenDensity >= 0.05 && leafLikeColor
        : block.green >= blockPixelCount * 0.18 && greenDensity >= 0.18 && leafLikeColor && isLeafContext(blockPosition, leafIndexes, blocksX, blocksY);
      const lowerNonLeafNoise = blockY > blocksY * 0.72 && !leafIndexes.has(blockPosition);
      const looksLikeWholeStemOrShadow = (block.green < 4 && suspectDensity > 0.48)
        || (suspectDensity > 0.34 && greenDensity < 0.04)
        || (block.suspect > block.green * 1.6 && greenDensity < 0.16)
        || lowerNonLeafNoise;
      const hasEnoughPatch = block.suspect >= Math.max(3, blockPixelCount * 0.025);
      if (!hasLeafSurface || !hasEnoughPatch || looksLikeWholeStemOrShadow) {
        return total;
      }

      block.suspectConfirmed = block.suspect;
      suspectBlockCount += 1;
      return total + block.suspect;
    }, 0);
    let leafHueSum = 0;
    let leafBrightnessSum = 0;
    let leafSaturationSum = 0;
    leafIndexes.forEach((index) => {
      const block = blocks[index];
      leafHueSum += block.hue;
      leafBrightnessSum += block.brightness;
      leafSaturationSum += block.saturation;
    });

    const greenPixels = leafFocus.leafPixels;
    const plantPixels = greenPixels + suspectPixels;
    const plantRatio = plantPixels ? (plantPixels / totalPixels) * 100 : 0;
    const spotRatio = plantPixels ? (suspectPixels / plantPixels) * 100 : 0;
    const comparableHistory = (currentPlantVision.history || [])
      .filter((entry) => entry?.metrics?.analysisVersion === PLANT_VISION_ANALYSIS_VERSION);
    const comparablePrevious = previous?.metrics?.analysisVersion === PLANT_VISION_ANALYSIS_VERSION
      ? previous
      : comparableHistory[comparableHistory.length - 1] || null;
    const previousArea = Number(comparablePrevious?.metrics?.plantAreaPercent);
    const growthDelta = Number.isFinite(previousArea) ? plantRatio - previousArea : 0;
    const averageBrightness = greenPixels ? Number(((leafBrightnessSum / greenPixels) * 100).toFixed(1)) : null;
    const averageSaturation = greenPixels ? Number(((leafSaturationSum / greenPixels) * 100).toFixed(1)) : null;
    const boundingBox = greenPixels && leafFocus.focusBox
      ? {
          x: Number((leafFocus.focusBox.x / targetWidth).toFixed(4)),
          y: Number((leafFocus.focusBox.y / targetHeight).toFixed(4)),
          width: Number((leafFocus.focusBox.width / targetWidth).toFixed(4)),
          height: Number((leafFocus.focusBox.height / targetHeight).toFixed(4))
        }
      : null;
    const stability = getFrameStability(comparablePrevious, boundingBox, 1, 1, plantRatio);
    const confidence = getAnalysisConfidence(plantRatio, averageBrightness, averageSaturation, stability.score, spotRatio);
    const trend = getPlantTrend(comparableHistory, plantRatio);
    const classification = classifyPlantVision(plantRatio, spotRatio, growthDelta, confidence);
    const crop = expandCropToAspect(leafFocus.focusBox, targetWidth, targetHeight, 4 / 3);
    const previewWidth = 640;
    const previewHeight = 480;
    const sourceCrop = {
      x: (crop.x / targetWidth) * sourceWidth,
      y: (crop.y / targetHeight) * sourceHeight,
      width: (crop.width / targetWidth) * sourceWidth,
      height: (crop.height / targetHeight) * sourceHeight
    };

    plantVisionCanvas.hidden = false;
    plantVisionCanvas.width = previewWidth;
    plantVisionCanvas.height = previewHeight;
    context.drawImage(
      image,
      sourceCrop.x,
      sourceCrop.y,
      sourceCrop.width,
      sourceCrop.height,
      0,
      0,
      previewWidth,
      previewHeight
    );
    drawFocusedPlantOverlay(context, blocks, blocksX, blockSize, crop, previewWidth, previewHeight, leafIndexes);

    return {
      timestamp: new Date().toISOString(),
      imageUrl: capture.imageUrl,
      fileName: capture.fileName,
      capturedAt: capture.capturedAt,
      lighting: capture.lighting || null,
      status: classification.status,
      label: classification.label,
      detail: classification.detail,
      metrics: {
        plantAreaPercent: Number(plantRatio.toFixed(2)),
        analysisVersion: PLANT_VISION_ANALYSIS_VERSION,
        growthDeltaPercent: Number(growthDelta.toFixed(2)),
        trendDeltaPercent: Number(trend.delta.toFixed(2)),
        suspectSpotPercent: Number(spotRatio.toFixed(2)),
        suspectBlockCount,
        leafBlockCount: leafFocus.leafBlockCount,
        confidence,
        stability,
        trend,
        boundingBox,
        focusCrop: {
          x: Number((crop.x / targetWidth).toFixed(4)),
          y: Number((crop.y / targetHeight).toFixed(4)),
          width: Number((crop.width / targetWidth).toFixed(4)),
          height: Number((crop.height / targetHeight).toFixed(4))
        },
        averageHue: greenPixels ? Number((leafHueSum / greenPixels).toFixed(1)) : null,
        averageBrightness,
        averageSaturation,
        sampleWidth: targetWidth,
        sampleHeight: targetHeight
      }
    };
  }

  function renderPlantVision(plantVision) {
    currentPlantVision = plantVision || { latest: null, history: [] };
    const latest = currentPlantVision.latest;

    if (!plantVisionStatus || !plantVisionArea || !plantVisionGrowth || !plantVisionSpots || !plantVisionDetail) {
      return;
    }

    if (!latest) {
      plantVisionStatus.className = "badge";
      plantVisionStatus.textContent = "Sin análisis";
      plantVisionArea.textContent = "--";
      plantVisionGrowth.textContent = "--";
      plantVisionSpots.textContent = "--";
      if (plantVisionConfidence) {
        plantVisionConfidence.textContent = "--";
      }
      if (plantVisionStability) {
        plantVisionStability.textContent = "--";
      }
      if (plantVisionTrend) {
        plantVisionTrend.textContent = "--";
      }
      if (plantVisionCanvas) {
        plantVisionCanvas.hidden = true;
      }
      plantVisionDetail.textContent = "Ejecutá un análisis para medir hojas sobre el fondo y comparar con la captura anterior.";
      return;
    }

    const metrics = latest.metrics || {};
    const growth = Number(metrics.growthDeltaPercent);
    const confidence = Number(metrics.confidence);
    const spots = Number(metrics.suspectSpotPercent);
    const stability = metrics.stability || {};
    const trend = metrics.trend || {};
    plantVisionStatus.className = `badge plant-vision__status plant-vision__status--${latest.status || "ok"}`;
    plantVisionStatus.textContent = latest.label || "Analizado";
    plantVisionArea.textContent = toPercent(Number(metrics.plantAreaPercent));
    plantVisionGrowth.textContent = Number.isFinite(growth) ? `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%` : "--";
    plantVisionSpots.textContent = toPercent(spots);
    if (plantVisionConfidence) {
      plantVisionConfidence.textContent = Number.isFinite(confidence) ? `${confidence}%` : "--";
    }
    if (plantVisionStability) {
      plantVisionStability.textContent = stability.label || "--";
    }
    if (plantVisionTrend) {
      plantVisionTrend.textContent = trend.label || "--";
    }

    const capturedAt = latest.capturedAt ? formatClock(new Date(latest.capturedAt)) : "--:--:--";
    const brightness = Number.isFinite(metrics.averageBrightness) ? `${metrics.averageBrightness.toFixed(1)}% brillo` : "brillo sin datos";
    const suspectBlocks = Number(metrics.suspectBlockCount);
    const focused = metrics.focusCrop && metrics.focusCrop.width < 0.98 && metrics.focusCrop.height < 0.98
      ? " Foco ajustado a hojas."
      : "";
    const lighting = latest.lighting?.mode === "flash" ? " Luz controlada." : "";
    const blockText = Number.isFinite(suspectBlocks) ? ` ${suspectBlocks} zona(s) marcadas.` : "";
    plantVisionDetail.textContent = `${latest.detail || "Análisis completado."} Captura ${capturedAt}, ${brightness}.${focused}${lighting}${blockText}`;
  }

  async function runPlantVisionAnalysis() {
    if (plantVisionBusy || currentCameraMode !== "mjpeg") {
      return;
    }

    plantVisionBusy = true;
    plantVisionAnalyze.disabled = true;
    plantVisionAnalyze.textContent = "Analizando...";

    try {
      const captureResponse = await fetch("/api/plant-vision/capture", { method: "POST" });
      const capturePayload = await captureResponse.json();
      if (!captureResponse.ok || !capturePayload.capture) {
        throw new Error(capturePayload.error || "No se pudo capturar la imagen.");
      }

      const image = new Image();
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("No se pudo cargar la captura para analizar."));
      });
      image.src = `${capturePayload.capture.imageUrl}?t=${Date.now()}`;
      await loaded;

      const analysis = analyzePlantImage(image, capturePayload.capture, currentPlantVision.latest);
      const saveResponse = await fetch("/api/plant-vision/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analysis)
      });
      const savePayload = await saveResponse.json();
      if (!saveResponse.ok || !savePayload.analysis) {
        throw new Error(savePayload.error || "No se pudo guardar el análisis.");
      }

      renderPlantVision({
        latest: savePayload.analysis,
        history: [...(currentPlantVision.history || []), savePayload.analysis].slice(-40)
      });
      showTransientStatus("Análisis visual actualizado", savePayload.analysis.status === "attention" ? "warning" : "ok");
    } catch (error) {
      plantVisionStatus.className = "badge plant-vision__status plant-vision__status--attention";
      plantVisionStatus.textContent = "Error";
      plantVisionDetail.textContent = error.message;
      showTransientStatus("No se pudo analizar la imagen", "warning");
    } finally {
      plantVisionBusy = false;
      plantVisionAnalyze.disabled = false;
      plantVisionAnalyze.textContent = "Analizar ahora";
    }
  }

  function hydrate(payload) {
    if (!sensors.length) {
      sensors = payload.sensors || [];
    }

    currentDataMode = payload.meta.dataMode || "mock-backend";

    if (!initialized) {
      buildSensorCards(payload.snapshot);
      buildCharts(payload.history);
      buildActuators(payload.actuators || []);
      initialized = true;
    }

    sensors.forEach((sensor) => {
      const points = payload.history[sensor.id];
      const current = payload.snapshot[sensor.id];
      const previous = points?.[points.length - 2] ?? null;
      updateSensorCard(sensor, current, previous);
      updateChart(sensor, points || []);
    });

    renderCamera(payload.camera);
    renderPlantVision(payload.plantVision);
    updateAlarms(payload.alarms || []);
    updateGlobalStatus(payload.snapshot);
    (payload.actuators || []).forEach(updateActuator);
    renderServices(payload.services || []);

    const updatedAt = new Date(payload.meta.updatedAt);
    lastUpdate.textContent = formatClock(updatedAt);
    dataMode.textContent = describeDataMode(currentDataMode);

    if (isMockMode()) {
      toggleButton.textContent = payload.meta.running ? "Pausar simulación" : "Reanudar simulación";
      injectButton.disabled = false;
      injectButton.textContent = "Forzar evento crítico";
      injectButton.title = "";
    } else {
      toggleButton.textContent = "Volver a mock";
      injectButton.disabled = true;
      injectButton.textContent = "Evento crítico deshabilitado";
      injectButton.title = "La ingesta real está activa.";
    }
  }

  function connectStream() {
    if (stream) {
      stream.close();
    }

    stream = new EventSource("/api/stream");
    stream.addEventListener("snapshot", (event) => {
      hydrate(JSON.parse(event.data));
    });
    stream.onerror = () => {
      showTransientStatus("Reconectando stream", "warning");
    };
  }

  async function bootstrap() {
    try {
      const response = await fetch("/api/bootstrap");
      if (!response.ok) {
        throw new Error("bootstrap failed");
      }

      const payload = await response.json();
      stopLocalFallback();
      stopBootstrapRetry();
      hydrate(payload);
      connectStream();
    } catch {
      if (!localFallbackState) {
        localFallbackState = createLocalPayload();
        hydrate(localFallbackState);
      }

      startLocalFallback();
      scheduleBootstrapRetry();
      showTransientStatus("Mock local activo", "warning");
    }
  }

  toggleButton.addEventListener("click", async () => {
    await fetch("/api/control/toggle-simulation", { method: "POST" });
  });

  injectButton.addEventListener("click", async () => {
    if (!isMockMode()) {
      return;
    }

    await fetch("/api/control/inject-critical", { method: "POST" });
  });

  if (cameraModeToggle) {
    cameraModeToggle.addEventListener("click", () => {
      if (currentCameraMode !== "mjpeg") {
        return;
      }

      currentCameraViewMode = currentCameraViewMode === "video" ? "snapshot" : "video";
      renderCamera(currentCameraConfig);
    });
  }

  if (cameraRefreshSnapshot) {
    cameraRefreshSnapshot.addEventListener("click", () => {
      if (currentCameraMode !== "mjpeg" || currentCameraViewMode !== "snapshot" || cameraSnapshotRefreshing) {
        return;
      }

      refreshCameraSnapshot(true);
    });
  }

  if (cameraZoomToggle) {
    cameraZoomToggle.addEventListener("click", () => {
      if (currentCameraMode !== "mjpeg" || currentCameraViewMode !== "snapshot") {
        return;
      }

      cameraSnapshotZoomed = !cameraSnapshotZoomed;
      applySnapshotZoom();
    });
  }

  if (plantVisionAnalyze) {
    plantVisionAnalyze.addEventListener("click", runPlantVisionAnalysis);
  }

  cameraImage.addEventListener("load", () => {
    if (currentCameraMode !== "mjpeg") {
      return;
    }

    hideCameraFallback();
    setSnapshotRefreshBusy(false);
    cameraTimestamp.textContent = formatClock(new Date());
  });

  cameraImage.addEventListener("error", () => {
    if (currentCameraMode !== "mjpeg") {
      return;
    }

    const message = currentCameraViewMode === "snapshot"
      ? "No se pudo actualizar la imagen HD. Revisá la conexión con la ESP32-CAM."
      : "No se pudo abrir el stream MJPEG. Revisá la URL de la cámara y que el puerto sea accesible.";

    showCameraFallback(message);
    setSnapshotRefreshBusy(false);
  });

  cameraEmbed.addEventListener("load", () => {
    if (currentCameraMode !== "embed") {
      return;
    }

    hideCameraFallback();
    cameraTimestamp.textContent = formatClock(new Date());
  });

  bootstrap();
  startMockCamera();
})(window);

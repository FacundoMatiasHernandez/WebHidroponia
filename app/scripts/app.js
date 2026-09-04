(function bootstrapApp(global) {
  const { HydroVisionCharts } = global;

  const HISTORY_SIZE = 40;
  const TICK_INTERVAL_MS = 2000;
  const BOOTSTRAP_RETRY_MS = 10000;
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
    if (plantVisionBusy) return;
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
    if (plantVisionBusy) return;
    const cameraConfig = camera && typeof camera === "object" ? camera : {};
    const mode = cameraConfig.mode || "mock";

    currentCameraMode = mode;
    currentCameraConfig = cameraConfig;
    if (cameraConfig.analysisInProgress) {
      stopCameraRefresh();
      setMediaSource(cameraImage, "");
      cameraModeHint.textContent = "Captura de análisis en curso";
      return;
    }
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

  const plantEngine = global.HydroVisionPlant;
  const plantMarks = document.getElementById("plantVisionMarks");
  const plantSelect = document.getElementById("plantVisionSelect");
  const plantReset = document.getElementById("plantVisionReset");
  const plantOriginal = document.getElementById("plantVisionOriginal");
  let leafRegion = null, plantFrames = [], plantPreview = null, previewKey = "";
  let selectingLeaf = false, selectionStart = null, selectionBox = null;
  let plantVisionError = "";

  function loadPlantImage(capture) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ image, capture });
      image.onerror = () => reject(new Error("No se pudo cargar la foto del análisis."));
      image.src = capture.imageUrl;
    });
  }

  function analyzePlantFrames(frames) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    return plantEngine.combine(frames.map(({ image }) => {
      canvas.width = Math.min(1024, image.naturalWidth);
      canvas.height = Math.round(canvas.width * image.naturalHeight / image.naturalWidth);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return plantEngine.analyze(context.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width, canvas.height, { roi: leafRegion });
    }));
  }

  function getPlantCrop(result) {
    if (selectingLeaf || !result.boundingBox) return { x: 0, y: 0, width: 1, height: 1 };
    const box = leafRegion || result.boundingBox;
    const size = Math.min(1, Math.max(0.18, box.width * 1.18, box.height * 1.18));
    return { x: clamp(box.x + box.width / 2 - size / 2, 0, 1 - size),
      y: clamp(box.y + box.height / 2 - size / 2, 0, 1 - size), width: size, height: size };
  }

  function drawPlantPreview() {
    if (!plantPreview) return;
    const { result, image } = plantPreview;
    const crop = getPlantCrop(result);
    plantVisionCanvas.width = 960;
    plantVisionCanvas.height = Math.round(960 * image.naturalHeight / image.naturalWidth);
    plantVisionCanvas.hidden = false;
    plantVisionCanvas.style.aspectRatio = image.naturalWidth + " / " + image.naturalHeight;
    const ctx = plantVisionCanvas.getContext("2d");
    const w = plantVisionCanvas.width, h = plantVisionCanvas.height;
    ctx.drawImage(image, crop.x * image.naturalWidth, crop.y * image.naturalHeight,
      crop.width * image.naturalWidth, crop.height * image.naturalHeight, 0, 0, w, h);
    if (plantMarks.checked && !selectingLeaf) {
      const overlay = document.createElement("canvas");
      overlay.width = result.width; overlay.height = result.height;
      const layer = overlay.getContext("2d");
      const pixels = layer.createImageData(result.width, result.height);
      for (let i = 0; i < result.overlay.length; i++) {
        const value = result.overlay[i];
        if (!value) continue;
        pixels.data[i * 4] = value === 2 ? 238 : 244;
        pixels.data[i * 4 + 1] = value === 2 ? 72 : 190;
        pixels.data[i * 4 + 2] = value === 2 ? 88 : 70;
        pixels.data[i * 4 + 3] = 150;
      }
      layer.putImageData(pixels, 0, 0);
      ctx.drawImage(overlay, crop.x * result.width, crop.y * result.height,
        crop.width * result.width, crop.height * result.height, 0, 0, w, h);
    }
    const box = selectingLeaf ? selectionBox || leafRegion : null;
    if (box) {
      ctx.strokeStyle = "#16a370"; ctx.lineWidth = 3;
      ctx.strokeRect(box.x * w, box.y * h, box.width * w, box.height * h);
    }
    plantVisionCanvas.classList.toggle("plant-vision__preview--selecting", selectingLeaf);
    plantSelect.textContent = selectingLeaf ? "Cancelar selección" : "Seleccionar hoja";
    plantSelect.setAttribute("aria-pressed", String(selectingLeaf));
    plantReset.hidden = !leafRegion;
  }

  function plantClassification(result) {
    if (result.quality.issues.includes("insufficient-leaf")) return {
      status: "warning", label: "Sin lectura", detail: "No hay suficiente superficie de hoja visible."
    };
    if (!result.quality.usable) {
      const reasons = { blurred: "Falta nitidez", underexposed: "Luz insuficiente", overexposed: "Exceso de luz" };
      return { status: "warning", label: "Foto no evaluable",
        detail: result.quality.issues.map((issue) => reasons[issue] || issue).join(". ") + ". No se puede descartar daño." };
    }
    if (!result.stable) return { status: "warning", label: "Repetir captura",
      detail: "Las fotos no son comparables por movimiento o cambios de luz." };
    if (result.repeatedPixels) return { status: "attention", label: "Manchas posibles",
      detail: "Hay cambios de color que se repiten sobre la hoja. La imagen no determina su causa." };
    if (result.tentativePixels) return { status: "warning", label: "Marcas por revisar",
      detail: "Hay marcas cuya forma o repetición no permite una lectura confiable." };
    return { status: "ok", label: "Sin manchas visibles",
      detail: "No se encontraron marcas repetidas en el área evaluable de estas fotos." };
  }

  function makePlantAnalysis(result, frames) {
    const capture = frames[result.selectedIndex].capture;
    const previous = currentPlantVision.latest, old = previous?.metrics;
    const sameRegion = JSON.stringify(old?.roi || null) === JSON.stringify(leafRegion);
    const sameLight = previous?.lighting?.protocol === capture.lighting?.protocol
      && previous?.lighting?.intensity === capture.lighting?.intensity;
    const box = result.boundingBox, last = old?.boundingBox;
    const shift = box && last ? Math.hypot(box.x + box.width / 2 - last.x - last.width / 2,
      box.y + box.height / 2 - last.y - last.height / 2) : 1;
    const similarBox = box && last && Math.abs(box.width - last.width) < 0.04 && Math.abs(box.height - last.height) < 0.04;
    const elapsed = Date.parse(capture.capturedAt) - Date.parse(previous?.capturedAt);
    const comparable = result.usable && old?.usable && old.analysisVersion === plantEngine.VERSION
      && sameRegion && sameLight && shift < 0.015 && similarBox
      && Math.abs(result.averageBrightness - old.averageBrightness) < 10;
    const growth = comparable && elapsed > 60000 ? result.plantAreaPercent - old.plantAreaPercent : null;
    return {
      ...capture, timestamp: new Date().toISOString(), ...plantClassification(result),
      frames: frames.map((frame) => frame.capture),
      metrics: {
        analysisVersion: plantEngine.VERSION, usable: result.usable, roi: leafRegion,
        plantAreaPercent: +result.plantAreaPercent.toFixed(2),
        suspectSpotPercent: result.suspectSpotPercent === null ? null : +result.suspectSpotPercent.toFixed(2),
        tentativeSpotPercent: result.leafPixels ? +(result.tentativePixels / result.leafPixels * 100).toFixed(2) : null,
        regionCount: result.regions.filter((region) => region.repeated).length,
        tentativeRegionCount: result.regions.filter((region) => !region.repeated).length,
        regions: result.regions, quality: result.quality,
        stability: { label: result.stable ? "Estable" : "Variable" },
        trend: { label: growth === null ? "Sin base" : Math.abs(growth) < 0.5 ? "Sin cambio" : "Cambio" },
        growthDeltaPercent: growth === null ? null : +growth.toFixed(2),
        boundingBox: result.boundingBox, focusCrop: getPlantCrop(result),
        averageBrightness: result.averageBrightness,
        frameCount: result.frameCount, comparableFrames: result.comparableFrames,
        sampleWidth: result.width, sampleHeight: result.height
      }
    };
  }

  async function restorePlantPreview(latest, key) {
    try {
      const captures = latest.frames?.length ? latest.frames : [latest];
      const frames = await Promise.all(captures.map(loadPlantImage));
      if (key !== previewKey || plantVisionBusy) return;
      leafRegion = latest.metrics?.roi || null;
      const result = analyzePlantFrames(frames);
      plantFrames = frames;
      plantPreview = { result, image: frames[result.selectedIndex].image };
      drawPlantPreview();
    } catch {
      if (key === previewKey && !plantVisionBusy) {
        plantVisionCanvas.hidden = true;
        plantVisionDetail.textContent += " No se pudo recuperar la foto.";
      }
    }
  }

  function renderPlantVision(plantVision) {
    currentPlantVision = plantVision || { latest: null, history: [] };
    if (plantVisionBusy) return;
    if (plantVisionError) {
      plantVisionStatus.className = "badge plant-vision__status plant-vision__status--warning";
      plantVisionStatus.textContent = "Análisis pendiente";
      plantVisionDetail.textContent = plantVisionError + " La foto anterior no es un análisis nuevo.";
      plantVisionSpots.textContent = "--";
      plantVisionGrowth.textContent = "--";
      return;
    }
    const latest = currentPlantVision.latest;
    if (!latest) return;
    const metrics = latest.metrics || {};
    const currentVersion = metrics.analysisVersion === plantEngine.VERSION;
    plantVisionStatus.className = `badge plant-vision__status plant-vision__status--${latest.status || "warning"}`;
    plantVisionStatus.textContent = currentVersion ? latest.label : "Análisis anterior";
    plantVisionArea.textContent = toPercent(metrics.plantAreaPercent);
    plantVisionGrowth.textContent = Number.isFinite(metrics.growthDeltaPercent) && currentVersion
      ? `${metrics.growthDeltaPercent >= 0 ? "+" : ""}${metrics.growthDeltaPercent.toFixed(1)} pp` : "--";
    plantVisionSpots.textContent = currentVersion ? toPercent(metrics.suspectSpotPercent) : "--";
    plantVisionConfidence.textContent = currentVersion ? metrics.quality?.usable ? "Apta" : "Insuficiente" : "--";
    plantVisionStability.textContent = metrics.stability?.label || "--";
    plantVisionTrend.textContent = currentVersion ? metrics.trend?.label || "--" : "--";
    plantOriginal.href = latest.imageUrl;
    plantOriginal.hidden = false;
    const regions = currentVersion ? ` ${metrics.regionCount || 0} zona(s) repetidas, ${metrics.tentativeRegionCount || 0} por revisar.` : "";
    plantVisionDetail.textContent = (currentVersion ? latest.detail : "Pendiente de evaluar con el análisis actualizado.")
      + regions + ` Captura ${formatClock(new Date(latest.capturedAt))}.`;
    const key = latest.timestamp + latest.imageUrl;
    if (previewKey !== key) {
      previewKey = key;
      restorePlantPreview(latest, key);
    }
  }

  async function runPlantVisionAnalysis(reuse = false) {
    if (plantVisionBusy || (!reuse && currentCameraMode !== "mjpeg")) return;
    plantVisionBusy = true; selectingLeaf = false; plantVisionError = "";
    for (const button of [plantVisionAnalyze, plantSelect, plantReset, cameraModeToggle, cameraRefreshSnapshot]) button.disabled = true;
    plantVisionAnalyze.textContent = reuse ? "Evaluando hoja..." : "Capturando 3 fotos...";
    if (!reuse) { stopCameraRefresh(); setMediaSource(cameraImage, ""); }
    try {
      if (!reuse) {
        const response = await fetch("/api/plant-vision/capture", { method: "POST" });
        const payload = await response.json();
        if (!response.ok || !payload.capture) throw new Error(payload.error || "No se pudo capturar la imagen.");
        plantFrames = await Promise.all((payload.capture.frames || [payload.capture]).map(loadPlantImage));
      }
      if (!plantFrames.length) throw new Error("Primero hace falta una captura.");
      plantVisionAnalyze.textContent = "Comparando hojas...";
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const result = analyzePlantFrames(plantFrames), analysis = makePlantAnalysis(result, plantFrames);
      const response = await fetch("/api/plant-vision/analysis", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(analysis)
      });
      const payload = await response.json();
      if (!response.ok || !payload.analysis) throw new Error(payload.error || "No se pudo guardar el análisis.");
      plantPreview = { result, image: plantFrames[result.selectedIndex].image };
      previewKey = payload.analysis.timestamp + payload.analysis.imageUrl;
      currentPlantVision = { latest: payload.analysis, history: [...(currentPlantVision.history || []).filter(
        (entry) => entry.timestamp !== payload.analysis.timestamp), payload.analysis].slice(-40) };
      drawPlantPreview();
      showTransientStatus("Análisis visual actualizado", result.usable ? "ok" : "warning");
    } catch (error) {
      plantVisionError = error.message;
      plantVisionStatus.className = "badge plant-vision__status plant-vision__status--warning";
      plantVisionStatus.textContent = "Análisis pendiente";
      plantVisionDetail.textContent = error.message;
      plantVisionSpots.textContent = "--";
      showTransientStatus("No se pudo completar el análisis", "warning");
      return;
    } finally {
      plantVisionBusy = false;
      for (const button of [plantVisionAnalyze, plantSelect, plantReset, cameraModeToggle, cameraRefreshSnapshot]) button.disabled = false;
      plantVisionAnalyze.textContent = "Analizar ahora";
      if (!reuse) {
        if (currentCameraViewMode === "snapshot" && plantFrames.length) {
          const selected = plantPreview?.result.selectedIndex || 0;
          setMediaSource(cameraImage, plantFrames[selected]?.capture.imageUrl || plantFrames[0].capture.imageUrl);
          cameraRefreshTimer = setInterval(refreshCameraSnapshot, currentCameraConfig.captureRefreshMs || 5000);
        }
        renderCamera(currentCameraConfig);
      }
    }
    renderPlantVision(currentPlantVision);
  }

  plantMarks.addEventListener("change", drawPlantPreview);
  plantSelect.addEventListener("click", () => {
    if (!plantPreview || plantVisionBusy) return;
    selectingLeaf = !selectingLeaf; selectionBox = null; drawPlantPreview();
  });
  plantReset.addEventListener("click", () => { leafRegion = null; runPlantVisionAnalysis(true); });
  function leafPointer(event) {
    const rect = plantVisionCanvas.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  }
  plantVisionCanvas.addEventListener("pointerdown", (event) => {
    if (!selectingLeaf || event.button !== 0) return;
    selectionStart = leafPointer(event);
    plantVisionCanvas.setPointerCapture(event.pointerId);
  });
  plantVisionCanvas.addEventListener("pointermove", (event) => {
    if (!selectionStart) return;
    const end = leafPointer(event);
    selectionBox = { x: Math.min(selectionStart.x, end.x), y: Math.min(selectionStart.y, end.y),
      width: Math.abs(end.x - selectionStart.x), height: Math.abs(end.y - selectionStart.y) };
    drawPlantPreview();
  });
  plantVisionCanvas.addEventListener("pointerup", () => {
    if (!selectionStart) return;
    selectionStart = null;
    if (selectionBox?.width >= 0.025 && selectionBox?.height >= 0.025) {
      leafRegion = selectionBox; selectingLeaf = false; runPlantVisionAnalysis(true);
    }
  });
  plantVisionCanvas.addEventListener("pointercancel", () => { selectionStart = null; selectionBox = null; drawPlantPreview(); });

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
    plantVisionAnalyze.addEventListener("click", () => runPlantVisionAnalysis(false));
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
    if (plantVisionBusy) return;
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

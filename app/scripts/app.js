(function bootstrapApp(global) {
  const { HydroVisionCharts } = global;

  const Operations = global.HydroVisionOperations;
  const BOOTSTRAP_RETRY_MS = 10000;
  const sensorGrid = document.getElementById("sensorGrid");
  const alarmList = document.getElementById("alarmList");
  const alarmCounter = document.getElementById("alarmCounter");
  const lastUpdate = document.getElementById("lastUpdate");
  const globalStatus = document.getElementById("globalStatus");
  const dataMode = document.getElementById("dataMode");
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
  const plantVisionYellow = document.getElementById("plantVisionYellow");
  const plantVisionDetailScore = document.getElementById("plantVisionDetailScore");
  const plantVisionConfidence = document.getElementById("plantVisionConfidence");
  const plantVisionStability = document.getElementById("plantVisionStability");
  const plantVisionTrend = document.getElementById("plantVisionTrend");
  const plantVisionDetail = document.getElementById("plantVisionDetail");
  const plantVisionCanvas = document.getElementById("plantVisionCanvas");

  const cardMap = new Map();
  const actuatorMap = new Map();
  const reportedActuators = new Map();
  const relayBusy = new Set();
  let relayAccess = false;
  let relayInfo = {};
  const relayNote = document.getElementById("relayControlNote");
  const relayMessage = document.getElementById("relayControlMessage");
  const relayToolbar = document.getElementById("relayControlToolbar");
  const relayUnlock = document.getElementById("relayUnlock");
  const relayStopAll = document.getElementById("relayStopAll");
  const relayLogin = document.getElementById("relayLogin");
  let sensors = [];
  let stream;
  let initialized = false;
  let currentDataMode = "offline";
  let currentCameraMode = "unavailable";
  let currentCameraConfig = {};
  let currentCameraViewMode = "snapshot";
  let cameraSnapshotZoomed = false;
  let currentCameraClock = 0;
  let cameraRefreshTimer = 0;
  let cameraSnapshotRefreshing = false;
  let bootstrapRetryTimer = 0;
  let currentPlantVision = { latest: null, history: [] };
  let plantVisionBusy = false;
  let lastLiveSnapshot = null;


  let lastPayload = null, activeView = "resumen", serverReachable = false, showAllIssues = false;
  let selectedHistorySensor = "air-temperature", toastTimer = 0, cameraMediaState = "pending";
  const lastKnownPumpStates = new Map();

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


  const VIEW_INFO = {
    resumen: ["Resumen", "Resumen del cultivo", "Mediciones actuales y estado de la instalación.", "MONITOREO DEL CULTIVO"],
    bombas: ["Bombas", "Control de bombas", "Operación manual con confirmación del equipo.", "DOSIFICACIÓN SUPERVISADA"],
    camara: ["Cámara", "Supervisión por cámara", "Imagen HD, video en vivo y observación del cultivo.", "OBSERVACIÓN REMOTA"],
    tendencias: ["Tendencias", "Historial de mediciones", "Evolución y estadísticos del registro reciente.", "SEGUIMIENTO DEL CULTIVO"],
    equipo: ["Equipo", "Estado del equipo", "Conectividad, disponibilidad y calibración.", "ESTADO DE LA INSTALACIÓN"]
  };
  function text(id, value) { const element = document.getElementById(id); const next = String(value); if (element && element.textContent !== next) element.textContent = next; }
  function setView(view) {
    activeView = Object.hasOwn(VIEW_INFO, view) ? view : "resumen";
    global.scrollTo({ top: 0, behavior: "instant" });
    document.querySelectorAll("[data-view]").forEach(element => { element.hidden = element.dataset.view !== activeView; });
    document.querySelectorAll("[data-view-link]").forEach(link => {
      const current = link.dataset.viewLink === activeView; link.classList.toggle("is-active", current);
      if (current) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    const info = VIEW_INFO[activeView];
    text("viewBreadcrumb", info[0]); text("pageTitle", info[1]); text("pageSubtitle", info[2]); text("dataEyebrow", info[3]);
    if (activeView !== "camara") { stopCameraRefresh(); stopCameraClock(); setMediaSource(cameraImage, ""); setMediaSource(cameraEmbed, ""); }
    if (lastPayload) {
      if (activeView === "camara") { renderCamera(lastPayload.camera); renderPlantVision(lastPayload.plantVision); }
      if (activeView === "tendencias") renderHistory();
      if (activeView === "equipo") renderEquipment();
    }
    document.title = "HydroVision | " + info[0];
  }
  global.addEventListener("hashchange", () => setView(location.hash.slice(1)));
  global.addEventListener("resize", () => { if (activeView === "tendencias") renderHistory(); });
  document.getElementById("currentDate").textContent = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  document.getElementById("showAllAlerts").addEventListener("click", () => { showAllIssues = !showAllIssues; renderOverview(); });
  document.getElementById("historySensor").addEventListener("change", event => { selectedHistorySensor = event.target.value; renderHistory(); });

  function formatValue(sensor, reading) { return Operations.formatValue(sensor, reading); }
  function buildSensorCards(snapshot) {
    sensorGrid.innerHTML = ""; cardMap.clear();
    for (const group of Operations.GROUPS) {
      const available = group.ids.map(id => sensors.find(sensor => sensor.id === id)).filter(Boolean);
      if (!available.length) continue;
      const section = document.createElement(group.id === "levels" ? "details" : "section");
      section.className = group.id === "levels" ? "supplemental" : "sensor-group";
      section.innerHTML = group.id === "levels" ? '<summary>Niveles y depósitos · ' + available.length + ' parámetros</summary><div class="reading-grid"></div>'
        : '<div class="sensor-group__header"><svg class="icon" aria-hidden="true"><use href="#' + group.icon + '"/></svg><h3>' + group.label + '</h3></div><div class="reading-grid"></div>';
      sensorGrid.appendChild(section);
      for (const sensor of available) {
        const article = document.createElement("article"); article.className = "sensor-card"; article.id = "sensor-" + sensor.id; article.tabIndex = -1;
        article.innerHTML = '<div class="sensor-card__label"><span></span><svg class="icon" aria-hidden="true"><use href="#' + group.icon + '"/></svg></div>'
          + '<div class="sensor-card__value"><strong class="sensor-card__number">--</strong><span class="sensor-card__unit"></span></div>'
          + '<div class="sensor-card__status"><span class="status-pill"></span></div><p class="sensor-card__hint"></p>'
          + '<div class="sensor-card__meta"><span></span><button type="button" title="Ver tendencia" aria-label="Ver tendencia"><svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg></button></div>';
        article.querySelector(".sensor-card__label span").textContent = Operations.sensorLabel(sensor);
        article.querySelector(".sensor-card__unit").textContent = sensor.unit;
        article.querySelector("button").setAttribute("aria-label", "Ver tendencia de " + Operations.sensorLabel(sensor));
        article.querySelector("button").addEventListener("click", () => {
          selectedHistorySensor = sensor.id; document.getElementById("historySensor").value = sensor.id;
          if (location.hash === "#tendencias") setView("tendencias"); else location.hash = "tendencias";
        });
        section.querySelector(".reading-grid").appendChild(article); cardMap.set(sensor.id, article);
        updateSensorCard(sensor, snapshot[sensor.id]);
      }
    }
  }
  function updateSensorCard(sensor, entry) {
    const card = cardMap.get(sensor.id); if (!card) return;
    const reading = Operations.visibleReading(entry, currentDataMode), state = Operations.readingState(reading);
    card.dataset.status = reading.status;
    card.querySelector(".sensor-card__number").textContent = formatValue(sensor, reading);
    const badge = card.querySelector(".status-pill"); badge.className = "status-pill status-pill--" + state.tone; badge.textContent = state.label; badge.title = state.help;
    const hint = card.querySelector(".sensor-card__hint");
    hint.textContent = reading.levelCalibration ? "0% seco · 100% sumergido; no volumen" : reading.status === "estimated" ? "Desde TDS · sin calibrar" : reading.status === "uncalibrated-reading" ? "Calibración pendiente"
      : reading.status === "uncalibrated" ? "Falta una referencia de nivel" : Number.isFinite(sensor.idealMin) && Number.isFinite(sensor.idealMax) && !sensor.telemetry
      ? "Objetivo " + sensor.idealMin + "–" + sensor.idealMax + " " + sensor.unit : sensor.id === "water-level-raw" ? "Señal eléctrica, no altura" : "Medición del equipo";
    card.querySelector(".sensor-card__meta > span").textContent = reading.timestamp ? formatClock(new Date(reading.timestamp)) : "Sin lectura";
    card.title = state.help;
  }
  function buildCharts() {
    const select = document.getElementById("historySensor"); select.innerHTML = "";
    for (const sensor of sensors) { const option = document.createElement("option"); option.value = sensor.id; option.textContent = Operations.sensorLabel(sensor) + " · " + sensor.unit; select.appendChild(option); }
    if (!sensors.some(sensor => sensor.id === selectedHistorySensor)) selectedHistorySensor = sensors[0]?.id || "";
    select.value = selectedHistorySensor;
  }
  function renderHistory() {
    if (!lastPayload || activeView !== "tendencias") return;
    const sensor = sensors.find(item => item.id === selectedHistorySensor); if (!sensor) return;
    const points = (lastPayload.history[sensor.id] || []).filter(entry => entry.source === currentDataMode);
    const stats = Operations.historyStats(points, currentDataMode);
    for (const [id, value] of Object.entries({ historyLast: stats.last, historyMin: stats.min, historyMax: stats.max, historyMean: stats.mean })) {
      text(id, formatValue(sensor, { value }) + (value === null ? "" : " " + sensor.unit));
    }
    const validDates = points.filter(point => Number.isFinite(Date.parse(point.timestamp)));
    text("historyWindow", validDates.length ? formatClock(new Date(validDates[0].timestamp)) + " – " + formatClock(new Date(validDates.at(-1).timestamp)) : "Sin registro disponible");
    text("historyRange", Number.isFinite(sensor.idealMin) && !sensor.telemetry ? "Referencia: " + sensor.idealMin + "–" + sensor.idealMax + " " + sensor.unit : "Medición informada por el equipo");
    const latest = Operations.visibleReading(lastPayload.snapshot[sensor.id], currentDataMode);
    text("historyNote", stats.count ? (sensor.id === "water-level" && points.some(point => point.levelCalibration)
      ? "Respuesta relativa del sensor entre seco y sumergido; no es altura ni volumen del tanque. "
      : ["estimated", "uncalibrated-reading"].includes(latest.status) ? "Registro con calibración pendiente. " : "")
      + "Los intervalos sin medición se muestran como interrupciones, no como valores cero." : "Todavía no hay mediciones utilizables para este parámetro.");
    HydroVisionCharts.drawLineChart(document.getElementById("historyCanvas"), points, { color: "#4c805b", unit: sensor.unit, decimals: sensor.decimals });
  }

  let pendingPumpConfirmation = null;
  const confirmDialog = document.getElementById("pumpConfirm"), confirmCheck = document.getElementById("pumpConfirmCheck"), confirmAccept = document.getElementById("pumpConfirmAccept");
  function requestPumpConfirmation(actuator, continuous, durationMs) {
    if (confirmDialog.open || pendingPumpConfirmation) return Promise.resolve(false);
    confirmDialog.returnValue = ""; confirmDialog.dataset.continuous = String(continuous); confirmCheck.checked = false;
    text("pumpConfirmTitle", Operations.pumpName(actuator) + (continuous ? " · modo continuo" : " · pulso de " + durationMs / 1000 + " segundos"));
    text("pumpConfirmDescription", continuous ? "La bomba permanecerá encendida hasta que la detengas. Verificá el volumen disponible y que el equipo admita funcionamiento continuo." : "Verificá la manguera y el recipiente antes de iniciar este pulso. Podés detenerlo antes de que termine.");
    document.getElementById("pumpConfirmWarning").hidden = !continuous; document.getElementById("pumpConfirmCheckLabel").hidden = !continuous;
    confirmAccept.disabled = continuous; confirmAccept.textContent = continuous ? "Encender en continuo" : "Iniciar pulso";
    return new Promise(resolve => { pendingPumpConfirmation = resolve; confirmDialog.showModal(); });
  }
  confirmCheck.addEventListener("change", () => { confirmAccept.disabled = confirmDialog.dataset.continuous === "true" && !confirmCheck.checked; });
  confirmDialog.querySelector("form").addEventListener("submit", event => {
    if (event.submitter?.value === "confirm" && confirmDialog.dataset.continuous === "true" && !confirmCheck.checked) event.preventDefault();
  });
  confirmDialog.addEventListener("close", () => {
    const resolve = pendingPumpConfirmation; pendingPumpConfirmation = null;
    if (resolve) resolve(confirmDialog.returnValue === "confirm" && (confirmDialog.dataset.continuous !== "true" || confirmCheck.checked));
    confirmDialog.returnValue = "";
  });

  function buildActuators(actuators) {
    actuatorGrid.innerHTML = "";
    actuatorMap.clear();
    reportedActuators.clear();

    actuators.forEach((actuator) => {
      const article = document.createElement("article");
      article.className = "actuator-card";
      article.innerHTML = '<div class="actuator-card__row"><strong class="actuator-card__label"></strong><span class="badge badge--neutral"></span></div><strong class="actuator-card__state"></strong><p class="actuator-card__detail"></p><label class="actuator-card__duration">Funcionamiento<select aria-label="Modo y duracion de encendido"><option value="1000">Pulso de 1 segundo</option><option value="2000">Pulso de 2 segundos</option><option value="5000" selected>Pulso de 5 segundos</option><option value="10000">Pulso de 10 segundos</option><option value="continuous" disabled>Continuo (actualizar equipo)</option></select></label><div class="actuator-card__actions"><button class="button button--primary actuator-start" type="button">Iniciar pulso</button><button class="button button--stop actuator-stop" type="button">Apagar</button></div><p class="actuator-card__command" aria-live="polite"></p>';
      article.querySelector(".actuator-card__label").textContent = Operations.pumpName(actuator);
      article.querySelector(".actuator-start").addEventListener("click", () => commandActuator(actuator.id, true));
      article.querySelector(".actuator-stop").addEventListener("click", () => commandActuator(actuator.id, false));
      article.querySelector("select").addEventListener("change", () => updateActuator(reportedActuators.get(actuator.id) || actuator));

      actuatorGrid.appendChild(article);
      actuatorMap.set(actuator.id, article);
      updateActuator(actuator);
    });
  }

  function updateActuator(actuator) {
    reportedActuators.set(actuator.id, actuator);
    const card = actuatorMap.get(actuator.id);
    if (!card) {
      return;
    }

    const badge = card.querySelector(".badge");
    const start = card.querySelector(".actuator-start"), stop = card.querySelector(".actuator-stop");
    const detail = card.querySelector(".actuator-card__detail");
    const stale = !serverReachable || actuator.stale || !Operations.isRecent(actuator.timestamp);
    const pending = actuator.command?.status === "pending";
    const allowed = actuator.controllable && relayAccess && !stale && Operations.isLiveSource(currentDataMode);
    const occupied = [...reportedActuators.values()].some(a => a.active === true || a.command?.status === "pending");
    const select = card.querySelector("select");
    const continuousOption = select.querySelector('option[value="continuous"]');
    continuousOption.disabled = !relayInfo.continuousSupported;
    continuousOption.textContent = relayInfo.continuousSupported ? "Continuo (hasta apagar)" : "Continuo (requiere actualizar ESP32)";
    if (!stale && actuator.active && actuator.runMode === "continuous") select.value = "continuous";
    else if (!stale && actuator.active && actuator.runMode === "pulse" && actuator.durationMs
      && [...select.options].some(option => option.value === String(actuator.durationMs))) select.value = String(actuator.durationMs);
    const selectedContinuous = select.value === "continuous";
    const state = stale || actuator.active === null ? "Sin confirmar" : actuator.active
      ? actuator.runMode === "continuous" ? "Encendida / continuo" : "Encendida / pulso" : "Apagada";
    badge.textContent = actuator.supported === false ? "No disponible" : stale ? "Sin señal" : "Confirmado";
    card.querySelector(".actuator-card__state").textContent = state;
    card.dataset.active = String(!stale && actuator.active === true);
    card.dataset.runMode = !stale && actuator.active ? actuator.runMode || "pulse" : "off";
    start.disabled = !allowed || occupied || relayBusy.has(actuator.id) || (selectedContinuous && !relayInfo.continuousSupported);
    stop.disabled = !allowed || (pending && !actuator.command.active);
    const duration = card.querySelector(".actuator-card__duration");
    duration.hidden = !actuator.id.startsWith("relay-");
    select.disabled = pending || actuator.active === true || actuator.supported === false;
    start.textContent = selectedContinuous ? "Encender continuo" : "Encender pulso";
    card.querySelector(".actuator-card__command").textContent = relayBusy.has(actuator.id) ? "Enviando solicitud..."
      : pending ? `Orden de ${actuator.command.active ? "encendido" : "apagado"} pendiente de confirmacion`
      : actuator.command?.status === "expired" ? "Sin confirmacion: la orden vencio; no se reintenta al reconectar."
      : actuator.command?.status === "aborted" ? "Orden cancelada por reinicio de la ESP32."
      : actuator.command?.status === "failed" ? "La ESP32 rechazo o detuvo la orden."
      : actuator.result === "failsafe" ? "Apagada por perdida de comunicacion; requiere un nuevo encendido manual."
      : !stale && actuator.active && actuator.runMode === "continuous" ? "Modo continuo confirmado. Cerrar esta pagina no detiene la bomba: usa Apagar."
      : actuator.result === "completed" ? "Pulso finalizado por el temporizador local."
      : actuator.command?.status === "confirmed" ? "Orden confirmada por la ESP32." : "";
    detail.textContent = actuator.supported === false ? "El equipo necesita una actualización para controlar esta bomba."
      : stale ? "Esperando el estado del equipo." : actuator.active && actuator.runMode === "continuous" ? "En marcha hasta que la detengas." : actuator.active ? "Pulso temporizado por el equipo." : "Dosificación manual.";
  }

  function renderRelayControls() {
    relayToolbar.hidden = currentDataMode !== "esp32-wifi";
    relayUnlock.hidden = relayAccess;
    const fresh = serverReachable && relayInfo.reportedAt && Operations.isRecent(relayInfo.reportedAt);
    relayStopAll.disabled = !relayAccess || !relayInfo.connected || !fresh;
    text("controlEyebrow", "DOSIFICACIÓN MANUAL");
    relayNote.textContent = currentDataMode !== "esp32-wifi" ? "Esperando la conexión del equipo para habilitar las órdenes."
      : relayInfo.continuousSupported ? "Una bomba por vez. Elegí un pulso o funcionamiento continuo y esperá la confirmación del equipo."
      : "Pulsos de hasta 10 segundos. Para funcionamiento continuo, el equipo necesita una actualización.";
    for (const a of reportedActuators.values()) updateActuator(a);
  }

  async function refreshRelayAccess() {
    try { const response = await fetch("/api/control/access"); relayAccess = response.ok && (await response.json()).authenticated; }
    catch { relayAccess = false; }
    renderRelayControls();
  }

  async function commandActuator(id, active) {
    const actuator = reportedActuators.get(id), card = actuatorMap.get(id);
    if (!actuator || !card || (active && relayBusy.has(id))) return;
    if (!serverReachable || !relayAccess || !actuator.controllable || !Operations.isRecent(actuator.timestamp)) { relayMessage.textContent = "El control no está disponible. Revisá la conexión y el acceso al equipo."; return; }
    const expectedBootId = actuator.bootId, expectedRevision = relayInfo.revision;
    const continuous = active && card.querySelector("select").value === "continuous";
    if (continuous && !relayInfo.continuousSupported) { relayMessage.textContent = "La ESP32 aun no admite continuo; actualizar su firmware."; return; }
    const durationMs = active && !continuous ? Number(card.querySelector("select").value) : 0;
    if (active && !await requestPumpConfirmation(actuator, continuous, durationMs)) return;
    relayBusy.add(id); renderRelayControls();
    try {
      const response = await fetch("/api/control/actuator", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, mode: "manual", active, runMode: continuous ? "continuous" : "pulse", durationMs, bootId: expectedBootId, revision: expectedRevision }), signal: AbortSignal.timeout(5000) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 401) { relayAccess = false; relayLogin.showModal(); } throw new Error(result.error || "No se pudo solicitar la orden"); }
      relayMessage.textContent = "Solicitud enviada. Esperá el estado confirmado por el equipo.";
    } catch (error) { relayMessage.textContent = error.message + " No se asume que la orden fue ejecutada."; }
    finally { relayBusy.delete(id); renderRelayControls(); }
  }

  relayUnlock.addEventListener("click", () => relayLogin.showModal());
  document.getElementById("relayLoginCancel").addEventListener("click", () => relayLogin.close());
  document.getElementById("relayLoginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const field = document.getElementById("relayPassword"), error = document.getElementById("relayLoginError");
    try {
      const response = await fetch("/api/control/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: field.value }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      field.value = ""; error.textContent = ""; relayLogin.close(); await refreshRelayAccess();
    } catch (e) { error.textContent = e.message; }
  });
  async function stopAllPumps() {
    if (!serverReachable || !relayAccess || !relayInfo.connected) { relayMessage.textContent = "No se puede confirmar el apagado: el equipo no está disponible."; return; }
    try {
      const response = await fetch("/api/control/stop-all", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bootId: relayInfo.bootId }), signal: AbortSignal.timeout(5000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      relayMessage.textContent = "Apagado de todas solicitado. Consultá la confirmación en cada bomba.";
      showTransientStatus(relayMessage.textContent);
    } catch (error) { relayMessage.textContent = error.message + " No se asume que las bombas se apagaron."; showTransientStatus(relayMessage.textContent, "warning"); }
  }
  relayStopAll.addEventListener("click", stopAllPumps);
  document.getElementById("quickStopAll").addEventListener("click", stopAllPumps);



  function showTransientStatus(message, level = "ok") {
    const toast = document.getElementById("toast"); toast.textContent = message; toast.dataset.level = level; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }
  function renderOverview() {
    if (!lastPayload) return;
    const summary = Operations.summarize(sensors, lastPayload.snapshot, currentDataMode,
      [...reportedActuators.values()].map(a => ({ ...a, stale: a.stale || !serverReachable })));
    const connected = serverReachable && Operations.isLiveSource(currentDataMode) && Operations.isRecent(lastPayload.meta.lastIngestAt);
    text("summaryReadings", summary.available); text("summaryReadingsTotal", "/ " + summary.total);
    text("summaryReadingsNote", connected ? "Datos recibidos del equipo" : "Sin actualización reciente");
    text("summaryAttention", connected ? summary.outside.length : "--");
    text("summaryAttentionNote", connected ? "Según tus intervalos de referencia" : "Esperando mediciones actuales");
    text("summaryQuality", summary.quality.length); text("summaryQualityNote", "Disponibilidad y calibración");
    text("summaryPumps", summary.pumpCount === null ? "--" : summary.pumpCount);
    text("summaryPumpTotal", "/ " + (reportedActuators.size || "--"));
    text("summaryPumpNote", summary.pumpCount === null ? "Sin estado confirmado" : summary.pumpCount ? "Funcionamiento informado por el equipo" : "Todas las salidas detenidas");
    const status = !connected ? ["Sin comunicación", "neutral"] : summary.outside.length ? ["Requiere atención", "warning"]
      : summary.quality.length ? ["Revisar mediciones", "warning"] : ["Dentro de objetivos", "ok"];
    globalStatus.className = "status-pill status-pill--" + status[1]; text("globalStatus", status[0]);
    text("dataMode", connected ? currentDataMode === "esp32-usb" ? "Equipo por USB" : "Equipo conectado" : "Sin conexión al equipo");
    document.getElementById("connectionBadge").className = "connection-badge " + (connected ? "is-online" : "is-offline");
    document.querySelector(".live-label").classList.toggle("is-online", connected);
    document.getElementById("sidebarDot").className = "connection-dot" + (connected ? " is-online" : "");
    text("sidebarConnection", connected ? "Equipo conectado" : "Sin conexión");
    text("sidebarConnectionDetail", currentDataMode === "esp32-usb" ? "Conexión USB" : "Conexión Wi-Fi");
    text("lastUpdate", lastPayload.meta.lastIngestAt ? formatClock(new Date(lastPayload.meta.lastIngestAt)) : "--:--:--");
    text("sensorDataNote", connected ? "Última recepción " + formatClock(new Date(lastPayload.meta.lastIngestAt)) + ". Las lecturas pendientes de calibración se identifican en cada parámetro." : "Esperando una lectura reciente. Los valores no disponibles no se reemplazan por cero.");
    const running = summary.runningPumps;
    const uncertain = summary.pumpCount === null ? [...lastKnownPumpStates.values()].filter(a => a.active) : [];
    document.getElementById("activePumpBar").hidden = !running.length && !uncertain.length;
    text("activePumpText", running.length ? Operations.pumpName(running[0]) + " en marcha" + (running[0].runMode === "continuous" ? " · modo continuo" : " · pulso temporizado")
      : uncertain.length ? "Último estado: " + Operations.pumpName(uncertain[0]) + " en marcha · sin confirmar" : "");
    document.querySelector("#activePumpBar > div > span").textContent = uncertain.length ? "No se puede confirmar el apagado mientras falta la conexión con el equipo." : "El modo continuo no se detiene al cerrar esta página.";
    document.getElementById("quickStopAll").disabled = !relayAccess || !connected || !relayInfo.connected;
    const count = document.getElementById("navPumpCount"); count.hidden = !running.length; count.textContent = String(running.length);
    renderAlarms(connected ? summary.issues : null);
  }
  function renderAlarms(issues) {
    alarmList.innerHTML = "";
    text("alarmCounter", issues === null ? "Sin datos" : issues.length + " observaciones");
    const button = document.getElementById("showAllAlerts"); button.hidden = !issues || issues.length <= 4;
    button.textContent = showAllIssues ? "Ver menos" : "Ver todas las observaciones";
    if (!issues || !issues.length) {
      const item = document.createElement("li"); item.className = "alarm-item";
      item.innerHTML = '<div class="alarm-item__title"><span class="alarm-item__dot"></span><strong></strong></div><div class="alarm-item__meta"></div>';
      item.querySelector("strong").textContent = issues === null ? "Esperando al equipo" : "Sin observaciones actuales";
      item.querySelector(".alarm-item__meta").textContent = issues === null ? "Cuando vuelva la conexión, se evaluarán las nuevas mediciones." : "Las mediciones disponibles están dentro de los objetivos y sin avisos de calidad.";
      alarmList.appendChild(item); return;
    }
    for (const { sensor, reading } of (showAllIssues ? issues : issues.slice(0, 4))) {
      const state = Operations.readingState(reading), item = document.createElement("li");
      item.className = "alarm-item alarm-item--" + reading.status;
      item.innerHTML = '<div class="alarm-item__title"><span class="alarm-item__dot"></span><strong></strong></div><div class="alarm-item__meta"></div><a href="#resumen">Revisar parámetro</a>';
      item.querySelector("strong").textContent = Operations.sensorLabel(sensor);
      item.querySelector(".alarm-item__meta").textContent = Number.isFinite(reading.value) && ["critical", "warning"].includes(reading.status)
        ? formatValue(sensor, reading) + " " + sensor.unit + ". Referencia: " + sensor.idealMin + "–" + sensor.idealMax + " " + sensor.unit + "."
        : state.help;
      item.querySelector("a").addEventListener("click", event => {
        event.preventDefault(); setView("resumen");
        const card = document.getElementById("sensor-" + sensor.id), section = card?.closest("details");
        if (section) section.open = true;
        card?.focus({ preventScroll: false });
      });
      alarmList.appendChild(item);
    }
  }
  function renderEquipment() {
    if (!lastPayload) return;
    serviceList.innerHTML = "";
    const fresh = serverReachable && Operations.isRecent(lastPayload.meta.lastIngestAt);
    const services = [
      { label: "Equipo de sensores", status: fresh ? "Conectado" : "Sin comunicación", tone: fresh ? "ok" : "warning", detail: fresh ? "Está enviando mediciones de la instalación." : "Revisá la alimentación del equipo y su conexión a la red." },
      { label: "Servidor de la instalación", status: serverReachable ? "Disponible" : "Sin conexión", tone: serverReachable ? "ok" : "warning", detail: "Recibe las mediciones y transmite las órdenes de control." },
      { label: "Cámara", status: cameraMediaState === "online" ? "Imagen recibida" : cameraMediaState === "error" ? "Revisar conexión" : lastPayload.camera?.mode === "mjpeg" || lastPayload.camera?.mode === "embed" ? "Configurada" : "Sin configurar",
        tone: cameraMediaState === "online" ? "ok" : "neutral", detail: cameraMediaState === "online" ? "La última imagen se recibió correctamente." : "La conexión se comprueba al abrir la vista de cámara." }
    ];
    text("serviceCounter", services.filter(service => service.tone === "ok").length + " equipos disponibles");
    for (const service of services) {
      const card = document.createElement("article"); card.className = "service-card";
      card.innerHTML = '<div class="service-card__head"><strong></strong><span class="badge"></span></div><p></p>';
      card.querySelector("strong").textContent = service.label; const badge = card.querySelector(".badge");
      badge.textContent = service.status; badge.className = "badge badge--" + service.tone; card.querySelector("p").textContent = service.detail; serviceList.appendChild(card);
    }
    const table = document.createElement("table"); table.innerHTML = "<thead><tr><th>Parámetro</th><th>Última lectura</th><th>Estado</th><th>Recepción</th></tr></thead><tbody></tbody>";
    for (const sensor of sensors) {
      const reading = Operations.visibleReading(lastPayload.snapshot[sensor.id], currentDataMode), state = Operations.readingState(reading);
      const row = document.createElement("tr");
      for (const value of [Operations.sensorLabel(sensor), formatValue(sensor, reading) + " " + sensor.unit, state.label, reading.timestamp ? formatClock(new Date(reading.timestamp)) : "--"]) {
        const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell);
      }
      row.title = state.help; table.querySelector("tbody").appendChild(row);
    }
    const target = document.getElementById("diagnosticTable"); target.replaceChildren(table);
    text("sensorAddress", lastPayload.meta.transport?.ip || lastPayload.meta.transport?.port || "Sin información");
    text("firmwareVersion", lastPayload.meta.firmwareBuild || "Sin información");
    text("deviceLastSeen", lastPayload.meta.lastIngestAt ? new Date(lastPayload.meta.lastIngestAt).toLocaleString("es-AR") : "Sin información");
    const diagnostic = document.getElementById("electricalDiagnostics"); diagnostic.innerHTML = "";
    const levelReference = lastPayload.snapshot["water-level"]?.levelCalibration;
    if (levelReference) {
      const p = document.createElement("p");
      p.textContent = "Nivel resistivo · GPIO3 · seco " + levelReference.dryRaw + " RAW · sumergido " + levelReference.wetRaw
        + " RAW. Respuesta relativa, no volumen del tanque.";
      diagnostic.appendChild(p);
    }
    for (const sensor of sensors) {
      const entry = lastPayload.snapshot[sensor.id]; if (!entry?.diagnostic) continue;
      const p = document.createElement("p"); p.textContent = Operations.sensorLabel(sensor) + ": GPIO" + entry.diagnostic.pin + " · ADC " + entry.diagnostic.raw + "/4095 · " + entry.diagnostic.millivolts + " mV. " + (entry.note || ""); diagnostic.appendChild(p);
    }
  }

  function stopCameraClock() { if (currentCameraClock) clearInterval(currentCameraClock); currentCameraClock = 0; }
  function ensureCameraClock() {
    if (currentCameraClock) return;
    currentCameraClock = setInterval(() => { if (currentCameraViewMode === "video" && cameraMediaState === "online") cameraTimestamp.textContent = formatClock(new Date()); }, 1000);
  }
  function hideCameraFallback() { cameraFallback.hidden = true; }
  function showCameraFallback(message) { cameraFallback.hidden = false; cameraFallback.textContent = message; }
  function stopCameraRefresh() { if (cameraRefreshTimer) clearInterval(cameraRefreshTimer); cameraRefreshTimer = 0; }
  function withCacheBust(url) { return url ? url + (url.includes("?") ? "&" : "?") + "t=" + Date.now() : ""; }
  function describeRefresh(ms) { return ms >= 3600000 ? Math.round(ms / 3600000) + " h" : ms >= 60000 ? Math.round(ms / 60000) + " min" : Math.round(ms / 1000) + " s"; }
  function setCameraControlsVisible(visible) { cameraToolbar.hidden = !visible; }
  function setSnapshotRefreshVisible(visible) { cameraRefreshSnapshot.hidden = !visible; }
  function setSnapshotZoomVisible(visible) { cameraZoomToggle.hidden = !visible; }
  function applySnapshotZoom() {
    cameraFrame.dataset.zoom = String(cameraSnapshotZoomed);
    cameraZoomToggle.textContent = cameraSnapshotZoomed ? "Ver encuadre" : "Ampliar";
  }
  function setSnapshotRefreshBusy(busy) {
    cameraSnapshotRefreshing = busy; cameraRefreshSnapshot.disabled = busy || !serverReachable;
    cameraRefreshSnapshot.textContent = busy ? "Actualizando..." : "Actualizar imagen";
  }
  function setMediaSource(element, source) {
    source = source || "";
    if (element.dataset.src === source) return;
    element.dataset.src = source;
    if (source) element.src = source; else element.removeAttribute("src");
  }
  function refreshCameraSnapshot() {
    if (plantVisionBusy || activeView !== "camara" || currentCameraMode !== "mjpeg" || currentCameraViewMode !== "snapshot" || !serverReachable) return;
    if (!currentCameraConfig.captureUrl) { showCameraFallback("La captura de imagen todavía no está configurada."); return; }
    setSnapshotRefreshBusy(true); cameraMediaState = "pending"; cameraBadge.textContent = "Actualizando";
    setMediaSource(cameraImage, withCacheBust(currentCameraConfig.captureUrl));
  }
  function renderCameraSnapshot(cameraConfig) {
    const refreshMs = cameraConfig.captureRefreshMs || 3600000;
    setMediaSource(cameraEmbed, ""); stopCameraClock();
    cameraBadge.textContent = cameraMediaState === "error" ? "Sin conexión" : cameraMediaState === "pending" ? "Actualizando" : "Imagen HD";
    setSnapshotRefreshVisible(true); setSnapshotZoomVisible(true); applySnapshotZoom();
    cameraModeToggle.textContent = "Ver video en vivo";
    cameraModeHint.textContent = "Actualización automática cada " + describeRefresh(refreshMs);
    if (!cameraRefreshTimer) { refreshCameraSnapshot(); cameraRefreshTimer = setInterval(refreshCameraSnapshot, refreshMs); }
  }
  function renderCameraVideo(cameraConfig) {
    stopCameraRefresh(); cameraSnapshotZoomed = false; applySnapshotZoom(); setSnapshotRefreshBusy(false);
    cameraBadge.textContent = cameraMediaState === "error" ? "Sin conexión" : cameraMediaState === "online" ? "En vivo" : "Conectando";
    setSnapshotRefreshVisible(false); setSnapshotZoomVisible(false); ensureCameraClock();
    cameraModeToggle.textContent = "Ver imagen HD"; cameraModeHint.textContent = "Video en tiempo real";
    setMediaSource(cameraEmbed, "");
    if (!cameraConfig.streamUrl) { showCameraFallback("La transmisión de video no está configurada."); return; }
    setMediaSource(cameraImage, cameraConfig.streamUrl);
  }
  function renderCamera(camera) {
    if (plantVisionBusy || activeView !== "camara") return;
    const config = camera && typeof camera === "object" ? camera : {};
    currentCameraConfig = config; currentCameraMode = config.mode || "unavailable";
    cameraSourceLabel.textContent = "Cámara de la instalación";
    cameraNote.textContent = "La imagen HD permite revisar los detalles. El video en vivo prioriza la continuidad de la transmisión.";
    cameraFrame.dataset.mode = currentCameraMode; cameraFrame.dataset.view = currentCameraViewMode;
    if (config.analysisInProgress) { stopCameraRefresh(); cameraModeHint.textContent = "Preparando imágenes para el análisis"; return; }
    cameraImage.hidden = currentCameraMode !== "mjpeg"; cameraEmbed.hidden = currentCameraMode !== "embed";
    if (currentCameraMode === "mjpeg") {
      setCameraControlsVisible(true);
      if (!config.captureUrl) currentCameraViewMode = "video";
      cameraFrame.dataset.view = currentCameraViewMode;
      if (currentCameraViewMode === "snapshot") renderCameraSnapshot(config); else renderCameraVideo(config);
      return;
    }
    stopCameraRefresh(); stopCameraClock(); setCameraControlsVisible(false); setMediaSource(cameraImage, "");
    if (currentCameraMode === "embed" && config.embedUrl) { setMediaSource(cameraEmbed, config.embedUrl); cameraBadge.textContent = "Visor de cámara"; return; }
    setMediaSource(cameraEmbed, ""); cameraBadge.textContent = "No disponible";
    showCameraFallback("La cámara todavía no está disponible. Revisá la alimentación y la conexión del equipo.");
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
    if (frames.some(frame => frame.capture.captureTarget !== "plant")) throw new Error("La captura no está preparada para analizar plantas reales.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    return plantEngine.combine(frames.map(({ image, capture }) => {
      canvas.width = Math.min(1024, image.naturalWidth);
      canvas.height = Math.round(canvas.width * image.naturalHeight / image.naturalWidth);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return plantEngine.analyze(context.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width, canvas.height, { roi: leafRegion });
    }));
  }

  function getPlantCrop(result) {
    return plantEngine.focusCrop({ ...result, roi: leafRegion }, selectingLeaf);
  }

  function drawPlantPreview() {
    if (!plantPreview) return;
    const { result, image } = plantPreview;
    const crop = getPlantCrop(result);
    plantVisionCanvas.width = 960;
    plantVisionCanvas.height = Math.round(960 * crop.height * image.naturalHeight / (crop.width * image.naturalWidth));
    plantVisionCanvas.hidden = false;
    plantVisionCanvas.style.aspectRatio = plantVisionCanvas.width + " / " + plantVisionCanvas.height;
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
        const color = value === 2 ? [238, 72, 88] : value === 3 ? [196, 90, 16] : [83, 189, 224];
        pixels.data.set([...color, value === 3 ? 175 : 150], i * 4);
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

  function makePlantAnalysis(result, frames) {
    const capture = frames[result.selectedIndex].capture;
    const analysis = {
      ...capture, timestamp: new Date().toISOString(), ...global.HydroVisionPlantReport.classify(result),
      frames: frames.map((frame) => frame.capture),
      metrics: {
        analysisVersion: plantEngine.VERSION + (result.profile ? "/" + result.profile : ""), usable: result.usable, roi: leafRegion,
        detectorProfile: "plant",
        plantAreaPercent: +result.plantAreaPercent.toFixed(2),
        areaMeasurement: result.areaMeasurement ? {
          min: Math.floor(result.areaMeasurement.min * 100) / 100,
          max: Math.ceil(result.areaMeasurement.max * 100) / 100,
          samples: result.areaMeasurement.samples
        } : null,
        suspectSpotPercent: result.suspectSpotPercent === null ? null : +result.suspectSpotPercent.toFixed(2),
        yellowPercent: result.yellowPercent === null ? null : +result.yellowPercent.toFixed(2),
        yellowRegionCount: result.yellowRegions.filter((region) => region.repeated).length,
        yellowTentativePixels: result.yellowTentativePixels,
        yellowOutsidePixels: result.yellowOutsidePixels,
        yellowRegions: result.yellowRegions,
        tentativeSpotPercent: result.leafPixels ? +(result.tentativePixels / result.leafPixels * 100).toFixed(2) : null,
        regionCount: result.regions.filter((region) => region.repeated).length,
        tentativeRegionCount: result.regions.filter((region) => !region.repeated).length,
        regions: result.regions, quality: result.quality,
        stability: { label: result.stable ? "Estable" : "Variable" },
        boundingBox: result.boundingBox, focusCrop: getPlantCrop(result),
        averageBrightness: result.averageBrightness,
        frameCount: result.frameCount, comparableFrames: result.comparableFrames,
        sampleWidth: result.width, sampleHeight: result.height
      }
    };
    analysis.metrics.trend = global.HydroVisionPlantTrends.compareHistory(analysis,
      [...(currentPlantVision.history || []), currentPlantVision.latest].filter(Boolean));
    analysis.metrics.growthDeltaPercent = analysis.metrics.trend.deltaPercent;
    return analysis;
  }

  async function restorePlantPreview(latest, key) {
    try {
      const captures = latest.frames?.length ? latest.frames : [latest];
      const frames = await Promise.all(captures.map(loadPlantImage));
      if (key !== previewKey || plantVisionBusy || currentCameraConfig.captureTarget !== "plant" || activeView !== "camara") return;
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
    currentPlantVision = { latest: Operations.isPlantAnalysis(plantVision?.latest) ? plantVision.latest : null,
      history: (plantVision?.history || []).filter(Operations.isPlantAnalysis) };
    if (plantVisionBusy) return;
    const ready = currentCameraConfig.captureTarget === "plant" && serverReachable && currentCameraMode === "mjpeg";
    plantVisionAnalyze.disabled = !ready;
    const hasAnalysis = ready && Boolean(currentPlantVision.latest);
    document.getElementById("plantMetrics").hidden = !hasAnalysis;
    document.getElementById("plantTools").hidden = !hasAnalysis;
    document.getElementById("plantVisionEmpty").hidden = hasAnalysis;
    if (!hasAnalysis) {
      for (const id of ["plantVisionArea", "plantVisionGrowth", "plantVisionSpots", "plantVisionYellow", "plantVisionDetailScore", "plantVisionConfidence", "plantVisionStability", "plantVisionTrend"]) text(id, "--");
      plantVisionCanvas.hidden = true; plantOriginal.hidden = true;
      plantVisionStatus.className = "badge badge--neutral";
      plantVisionStatus.textContent = ready ? "Sin análisis" : "No habilitado";
      plantVisionDetail.textContent = ready ? "Tomá una captura del cultivo para iniciar la observación visual." : "El análisis de plantas todavía no está habilitado. Podés visualizar la cámara sin generar un diagnóstico.";
      return;
    }
    if (plantVisionError) {
      plantVisionStatus.className = "badge plant-vision__status plant-vision__status--warning";
      plantVisionStatus.textContent = "Análisis pendiente";
      plantVisionDetail.textContent = plantVisionError + " La foto anterior no es un análisis nuevo.";
      plantVisionSpots.textContent = "--";
      plantVisionYellow.textContent = "--";
      plantVisionDetailScore.textContent = "--";
      plantVisionGrowth.textContent = "--";
      return;
    }
    const latest = currentPlantVision.latest;
    const metrics = latest.metrics || {};
    const expectedVersion = plantEngine.VERSION;
    const currentVersion = metrics.analysisVersion === expectedVersion;
    plantVisionStatus.className = `badge plant-vision__status plant-vision__status--${latest.status || "warning"}`;
    plantVisionStatus.textContent = currentVersion ? latest.label : "Análisis anterior";
    plantVisionArea.textContent = toPercent(metrics.plantAreaPercent);
    const area = metrics.areaMeasurement;
    plantVisionArea.title = currentVersion && area
      ? `Área observada: ${area.min.toFixed(2)}–${area.max.toFixed(2)} % en ${area.samples} fotos comparables.` : "";
    plantVisionGrowth.textContent = Number.isFinite(metrics.growthDeltaPercent) && currentVersion
      ? `${metrics.growthDeltaPercent >= 0 ? "+" : ""}${metrics.growthDeltaPercent.toFixed(1)} pp` : "--";
    plantVisionSpots.textContent = currentVersion ? toPercent(metrics.suspectSpotPercent) : "--";
    const yellowReasons = new Set((metrics.yellowRegions || []).filter((r) => !r.repeated).map((r) => r.reason));
    const yellowPending = metrics.yellowOutsidePixels > 100 || yellowReasons.has("selection-edge") ? "Área incompleta"
      : yellowReasons.has("clipped-channel") ? "Exceso de luz" : "Por revisar";
    plantVisionYellow.textContent = currentVersion
      ? !metrics.yellowRegionCount && (metrics.yellowTentativePixels || metrics.yellowOutsidePixels > 100)
        ? yellowPending : toPercent(metrics.yellowPercent) : "--";
    const detailValue = metrics.quality?.detail?.value;
    plantVisionDetailScore.textContent = currentVersion && Number.isFinite(detailValue) ? detailValue.toFixed(2) : "--";
    plantVisionDetailScore.title = "Detalle relativo dentro del follaje, no porcentaje ni autofocus. Comparar con la misma hoja, luz, distancia y resolución.";
    plantVisionYellow.title = "Superficie amarillenta repetida respecto de la unión del follaje segmentado y las zonas amarillentas repetidas; no es un porcentaje de enfermedad.";
    plantVisionConfidence.textContent = currentVersion ? metrics.quality?.usable ? "Apta" : "Insuficiente" : "--";
    plantVisionStability.textContent = metrics.stability?.label || "--";
    const trendLabels = { "clipped-leaf": "Área recortada", "no-baseline": "Sin base", "change": metrics.growthDeltaPercent > 0 ? "Mayor área" : "Menor área" };
    plantVisionTrend.textContent = currentVersion ? trendLabels[metrics.trend?.reason] || metrics.trend?.label || "--" : "--";
    plantOriginal.href = latest.imageUrl;
    plantOriginal.hidden = false;
    const regions = currentVersion ? ` ${metrics.regionCount || 0} zona(s) repetidas, ${metrics.tentativeRegionCount || 0} por revisar.` : "";
    plantVisionDetail.textContent = (currentVersion ? latest.detail : "Pendiente de evaluar con el análisis actualizado.")
      + regions + ` Captura ${formatClock(new Date(latest.capturedAt))}.`;
    if (currentVersion && metrics.yellowRegionCount) plantVisionDetail.textContent += ` ${metrics.yellowRegionCount} zona(s) amarillentas repetidas.`;
    if (currentVersion && (metrics.yellowTentativePixels || metrics.yellowOutsidePixels > 100)) {
      const reason = yellowPending === "Área incompleta" ? "Parte del amarillo está fuera de la selección."
        : yellowPending === "Exceso de luz" ? "La saturación de color impide medir parte del amarillo."
        : "Parte del amarillo no se repite con suficiente consistencia.";
      plantVisionDetail.textContent += " " + reason;
    }
    if (currentVersion && metrics.trend) {
      const messages = {
        "invalid-measurement": "Cambio de área no evaluable con estas fotos.",
        "clipped-leaf": "La hoja está cortada por el encuadre o la selección.",
        "too-recent": "La referencia comparable tiene menos de una hora.",
        "no-baseline": "Sin referencia compatible entre una hora y siete días.",
        "within-variation": "La diferencia de área no supera la variación entre fotos.",
        "change": "Cambio de área visible; no equivale a crecimiento físico."
      };
      plantVisionDetail.textContent += " " + (messages[metrics.trend.reason] || "");
      if (metrics.trend.baseline) plantVisionDetail.textContent += " Base: "
        + new Date(metrics.trend.baseline.capturedAt).toLocaleString("es-AR") + ".";
    }
    const key = latest.timestamp + latest.imageUrl;
    if (previewKey !== key) {
      previewKey = key;
      // Restore the selection before asynchronous image loading or a new capture can begin.
      leafRegion = latest.metrics?.roi || null;
      if (currentVersion) restorePlantPreview(latest, key);
      else { plantFrames = []; plantPreview = null; plantVisionCanvas.hidden = true; }
    }
  }

  async function runPlantVisionAnalysis(reuse = false) {
    if (plantVisionBusy || !serverReachable || currentCameraConfig.captureTarget !== "plant" || (!reuse && currentCameraMode !== "mjpeg")) return;
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
      plantVisionYellow.textContent = "--";
      plantVisionDetailScore.textContent = "--";
      showTransientStatus("No se pudo completar el análisis", "warning");
      return;
    } finally {
      plantVisionBusy = false;
      for (const button of [plantVisionAnalyze, plantSelect, plantReset, cameraModeToggle, cameraRefreshSnapshot]) button.disabled = false;
      plantVisionAnalyze.textContent = "Analizar imagen";
      if (!reuse) {
        if (currentCameraViewMode === "snapshot" && plantFrames.length) {
          const selected = plantPreview?.result.selectedIndex || 0;
          setMediaSource(cameraImage, plantFrames[selected]?.capture.imageUrl || plantFrames[0].capture.imageUrl);
          cameraRefreshTimer = setInterval(refreshCameraSnapshot, currentCameraConfig.captureRefreshMs || 3600000);
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
    if (!payload || !Array.isArray(payload.sensors) || !payload.meta) return;
    if (!Operations.isLiveSource(payload.meta.dataMode)) payload = Operations.offlinePayload();
    const changed = sensors.map(s => s.id).join() !== payload.sensors.map(s => s.id).join();
    currentDataMode = payload.meta.dataMode; lastPayload = payload; lastLiveSnapshot = payload.snapshot;
    relayInfo = payload.relayControl || {};
    if (!initialized || changed) { sensors = payload.sensors; buildSensorCards(payload.snapshot); buildCharts(); initialized = true; }
    if ((payload.actuators || []).map(a => a.id).join() !== [...actuatorMap.keys()].join()) buildActuators(payload.actuators || []);
    for (const sensor of sensors) updateSensorCard(sensor, payload.snapshot[sensor.id]);
    for (const actuator of payload.actuators || []) {
      if (typeof actuator.active === "boolean" && !actuator.stale && Operations.isRecent(actuator.timestamp)) lastKnownPumpStates.set(actuator.id, actuator);
      updateActuator(actuator);
    }
    renderRelayControls(); renderOverview();
    if (activeView === "tendencias") renderHistory();
    if (activeView === "equipo") renderEquipment();
    if (activeView === "camara") { renderCamera(payload.camera); renderPlantVision(payload.plantVision); }
  }
  function connectStream() {
    if (stream) stream.close();
    stream = new EventSource("/api/stream");
    stream.addEventListener("open", () => { serverReachable = true; refreshRelayAccess(); });
    stream.addEventListener("snapshot", event => {
      try { serverReachable = true; hydrate(JSON.parse(event.data)); } catch { showTransientStatus("No se pudo actualizar la vista del equipo.", "warning"); }
    });
    stream.onerror = () => { serverReachable = false; relayAccess = false; renderOverview(); renderRelayControls(); if (activeView === "equipo") renderEquipment(); };
  }
  async function bootstrap() {
    try {
      const response = await fetch("/api/bootstrap", { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Servidor no disponible");
      const payload = await response.json(); serverReachable = true;
      stopBootstrapRetry(); hydrate(payload); await refreshRelayAccess(); connectStream();
    } catch {
      serverReachable = false; relayAccess = false;
      if (!initialized) hydrate(Operations.offlinePayload());
      renderOverview(); renderRelayControls(); scheduleBootstrapRetry();
    }
  }
  cameraModeToggle.addEventListener("click", () => {
    if (currentCameraMode !== "mjpeg") return;
    stopCameraRefresh(); stopCameraClock(); setMediaSource(cameraImage, ""); cameraMediaState = "pending";
    currentCameraViewMode = currentCameraViewMode === "snapshot" ? "video" : "snapshot";
    renderCamera(currentCameraConfig);
  });
  cameraRefreshSnapshot.addEventListener("click", () => { if (!cameraSnapshotRefreshing) refreshCameraSnapshot(); });
  cameraZoomToggle.addEventListener("click", () => { cameraSnapshotZoomed = !cameraSnapshotZoomed; applySnapshotZoom(); });
  plantVisionAnalyze.addEventListener("click", () => runPlantVisionAnalysis(false));
  cameraImage.addEventListener("load", () => {
    if (activeView !== "camara" || currentCameraMode !== "mjpeg") return;
    cameraMediaState = "online"; hideCameraFallback(); setSnapshotRefreshBusy(false);
    cameraTimestamp.textContent = (currentCameraViewMode === "snapshot" ? "Capturada " : "En vivo · ") + formatClock(new Date());
    cameraBadge.textContent = currentCameraViewMode === "video" ? "En vivo" : "Imagen HD";
  });
  cameraImage.addEventListener("error", () => {
    if (plantVisionBusy || activeView !== "camara" || !cameraImage.dataset.src) return;
    cameraMediaState = "error"; setSnapshotRefreshBusy(false); cameraBadge.textContent = "Sin conexión";
    showCameraFallback("No se pudo recibir la imagen. Comprobá que la cámara esté encendida y conectada a la red.");
  });
  cameraEmbed.addEventListener("load", () => { if (activeView === "camara" && currentCameraMode === "embed") { hideCameraFallback(); cameraMediaState = "online"; } });
  setInterval(() => {
    if (!lastPayload) return;
    for (const sensor of sensors) updateSensorCard(sensor, lastPayload.snapshot[sensor.id]);
    renderOverview(); renderRelayControls();
    if (activeView === "equipo") renderEquipment();
  }, 2000);
  setView(location.hash.slice(1)); bootstrap();
})(window);

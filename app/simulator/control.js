(function controlLab() {
  "use strict";
  const $ = id => document.getElementById(id), form = $("caseForm");
  const fields = { yellow: "Amarillamiento", aphids: "Pulgones", whitefly: "Mosca blanca", mites: "Arana roja", thrips: "Trips", miners: "Minadores", caterpillars: "Orugas" };
  let state, shownRevision = "", busy = false, lastCapture = null;
  const reevaluate = document.createElement("button"); reevaluate.type = "button";
  reevaluate.className = "button button--ghost"; reevaluate.textContent = "Reevaluar foto guardada"; reevaluate.disabled = true;
  $("capture").after(reevaluate);
  const capturedCase = document.createElement("p"); capturedCase.className = "panel__note";
  $("metrics").before(capturedCase);
  const detection = document.createElement("h3"); detection.setAttribute("aria-live", "polite");
  $("metrics").before(detection);
  const patternResults = document.createElement("div"); patternResults.className = "plant-patterns";
  $("metrics").after(patternResults);
  for (const [key, label] of Object.entries(fields)) {
    const row = document.createElement("label"); row.textContent = label;
    const output = document.createElement("output"); output.textContent = "0%";
    const slider = document.createElement("input"); Object.assign(slider, { name: key, type: "range", min: "0", max: "100", value: "0" });
    slider.addEventListener("input", () => { output.textContent = slider.value + "%"; });
    row.append(output, slider); $("sliders").append(row);
  }
  async function api(path, input) {
    const response = await fetch(`/api/simulator/${path}`, input ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : { cache: "no-store" });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "No responde el laboratorio"); return result;
  }
  function showConfig(config) {
    for (const [key, value] of Object.entries(config)) {
      const field = form.elements.namedItem(key); if (!field) continue;
      if (field.type === "checkbox") field.checked = value; else field.value = value;
      if (field.type === "range") field.previousElementSibling.textContent = value + "%";
    }
  }
  function readConfig() {
    const config = Object.fromEntries(new FormData(form));
    for (const key of [...Object.keys(fields), "day", "zoom", "rotation"]) config[key] = Number(config[key]);
    config.chart = form.elements.namedItem("chart").checked; return config;
  }
  function render(next) {
    state = next; const key = `${next.sessionId}:${next.revision}`;
    if (shownRevision !== key) { showConfig(next.config); shownRevision = key; }
    const display = next.displays.find(item => item.id === next.activeDisplayId);
    $("connection").textContent = display ? `${display.label}: ${display.ready ? "lista" : display.online ? "esperando dibujo" : "sin conexion"} / caso ${next.revision}` : "Sin tablet. Abri el enlace de arriba y pulsa Iniciar pantalla.";
    $("connection").dataset.ready = String(!!display?.ready);
    $("capture").disabled = busy || next.capturing || !display?.ready;
    reevaluate.disabled = busy || next.capturing || !lastCapture?.frames?.length;
    $("caseFields").disabled = busy || next.capturing;
    document.querySelectorAll("[data-preset]").forEach(button => { button.disabled = busy || next.capturing; });
    $("displaySelect").replaceChildren();
    if (!next.displays.length) $("displaySelect").add(new Option("Sin pantalla", ""));
    for (const item of next.displays) $("displaySelect").add(new Option(`${item.label} - ${item.online ? "conectada" : "sin conexion"}`, item.id, false, item.id === next.activeDisplayId));
    $("displaySelect").disabled = busy || next.capturing;
    if (next.displayUrls) {
      $("displayLinks").replaceChildren();
      for (const url of next.displayUrls) { const link = document.createElement("a"); link.className = "lab-url"; link.href = url; link.textContent = url; $("displayLinks").append(link); }
    }
  }
  async function refresh() {
    try { render(await api("state")); } catch (error) { $("connection").textContent = error.message; $("capture").disabled = true; }
  }
  async function refreshTrials() {
    const response = await fetch("/api/simulator/history", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el historial de ensayos");
    const data = await response.json();
    HydroVisionPlantReport.renderTrials($("trialResults"), data.plantVision.history);
    return data;
  }
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (!state) return;
    try { render(await api("state", { config: readConfig(), expectedRevision: state.revision })); $("message").textContent = "Caso enviado. Esperando confirmacion de la tablet..."; }
    catch (error) { $("message").textContent = error.message; }
  });
  form.addEventListener("input", () => { $("message").textContent = "Ajustes sin enviar. Pulsa Aplicar en la tablet."; });
  $("displaySelect").addEventListener("change", async () => {
    try { render(await api("select", { displayId: $("displaySelect").value })); } catch (error) { $("message").textContent = error.message; }
  });
  const healthy = { yellow: 0, aphids: 0, whitefly: 0, mites: 0, thrips: 0, miners: 0, caterpillars: 0, day: 0, chart: false };
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => {
    const presets = { healthy: { name: "Hoja sana" }, yellow: { name: "Amarillo moderado", yellow: 25 },
      aphids: { name: "Pulgones 25", aphids: 25 }, mixed: { name: "Danios mixtos", yellow: 15, miners: 20, caterpillars: 15, aphids: 20 } };
    showConfig({ ...readConfig(), ...healthy, ...presets[button.dataset.preset] });
    $("message").textContent = "Pulsa Aplicar en la tablet para enviar este caso.";
  }));
  async function analyze(capture) {
    if (capture.simulator.config.chart) return { note: "Patron de enfoque: revisar las lineas y los cuadros. No se analiza como hoja." };
    const frames = await Promise.all(capture.frames.map(async item => {
      const image = new Image(); image.src = item.imageUrl; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = Math.min(1024, image.naturalWidth); canvas.height = Math.round(canvas.width * image.naturalHeight / image.naturalWidth);
      const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return HydroVisionPlant.analyze(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { profile: "tablet-leaf-v1" });
    }));
    const result = HydroVisionPlant.combine(frames), selected = capture.frames[result.selectedIndex];
    const conclusion = HydroVisionPlantReport.classify(result);
    const analysis = { ...selected, frames: capture.frames, burstId: capture.burstId, timestamp: new Date().toISOString(),
      ...conclusion,
      detail: "Prueba sincronizada con tablet; no es un diagnostico del cultivo. " + conclusion.detail,
      metrics: { analysisVersion: HydroVisionPlant.VERSION + "/tablet-leaf-v1", usable: result.usable, roi: null,
        detectorProfile: result.profile, simulatedPatterns: result.simulatedPatterns,
        plantAreaPercent: result.plantAreaPercent, areaMeasurement: result.areaMeasurement,
        suspectSpotPercent: result.suspectSpotPercent, yellowPercent: result.yellowPercent,
        yellowRegionCount: result.yellowRegions.filter(region => region.repeated).length,
        yellowTentativePixels: result.yellowTentativePixels, yellowOutsidePixels: result.yellowOutsidePixels, yellowRegions: result.yellowRegions,
        regionCount: result.regions.filter(region => region.repeated).length, tentativeRegionCount: result.regions.filter(region => !region.repeated).length,
        regions: result.regions, quality: result.quality, stability: { label: result.stable ? "Estable" : "Variable" },
        boundingBox: result.boundingBox, focusCrop: HydroVisionPlant.focusCrop(result), averageBrightness: result.averageBrightness,
        frameCount: result.frameCount, comparableFrames: result.comparableFrames, sampleWidth: result.width, sampleHeight: result.height } };
    const existing = await (await fetch("/api/simulator/history")).json();
    analysis.metrics.trend = HydroVisionPlantTrends.compareHistory(analysis, existing.plantVision.history);
    analysis.metrics.growthDeltaPercent = analysis.metrics.trend.deltaPercent;
    const response = await fetch("/api/plant-vision/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(analysis) });
    if (!response.ok) throw new Error("La captura se guardo, pero no se pudo guardar el analisis");
    detection.textContent = conclusion.label;
    detection.title = conclusion.detail;
    HydroVisionPlantReport.renderPatterns(patternResults, analysis.metrics);
    return { note: result.usable ? "Ensayo guardado. Son metricas del algoritmo, no una validacion de exactitud." : "Captura guardada, pero la imagen no es evaluable. No se fuerza una lectura sana.",
      "Area de hoja": result.plantAreaPercent, "Amarillamiento medido": result.yellowPercent, "Manchas repetidas": result.suspectSpotPercent,
      "Detalle relativo": result.quality?.detail?.value, "Calidad": result.quality?.score };
  }
  function showCapture(capture) {
    lastCapture = capture;
    capturedCase.textContent = `Ultima captura: caso ${capture.simulator.revision}, ${capture.simulator.config.name}. ${new Date(capture.capturedAt).toLocaleString("es-AR")}.`;
    $("photo").src = capture.imageUrl; $("photo").hidden = false;
    $("captureInfo").textContent = JSON.stringify({ case: capture.simulator, camera: capture.captureSettings, images: capture.frames.map(frame => frame.imageUrl) }, null, 2);
  }
  function showReport(report) {
    $("metrics").replaceChildren();
    for (const [label, value] of Object.entries(report)) {
      if (label === "note") continue;
      const cell = document.createElement("div"), term = document.createElement("dt"), number = document.createElement("dd");
      term.textContent = label; number.textContent = Number.isFinite(value) ? value.toFixed(2) : "No evaluable"; cell.append(term, number); $("metrics").append(cell);
    }
    $("message").textContent = report.note;
  }
  $("capture").addEventListener("click", async () => {
    busy = true; $("capture").disabled = true; $("message").textContent = "Verificando pantalla y capturando tres fotos...";
    try {
      const result = await api("capture", {}), capture = result.capture;
      showCapture(capture); showReport(await analyze(capture)); await refreshTrials();
    } catch (error) { $("message").textContent = error.message; }
    finally { busy = false; refresh(); }
  });
  reevaluate.addEventListener("click", async () => {
    if (!state || !lastCapture || busy) return;
    busy = true; render(state); $("message").textContent = "Reevaluando la rafaga guardada, sin tomar una foto nueva...";
    try {
      const report = await analyze(lastCapture);
      report.note = "Reevaluacion de la foto guardada, no una captura actual de la tablet. " + report.note;
      showReport(report); await refreshTrials();
    } catch (error) { $("message").textContent = error.message; }
    finally { busy = false; refresh(); }
  });
  refresh(); setInterval(refresh, 1500);
  refreshTrials().then(data => {
    const latest = data.plantVision.latest;
    if (busy || !latest?.simulator || !latest.frames?.length) return;
    showCapture(latest);
    detection.textContent = latest.label;
    detection.title = latest.detail;
    HydroVisionPlantReport.renderPatterns(patternResults, latest.metrics);
    showReport({ note: "Ultimo ensayo guardado. Los resultados corresponden al caso indicado junto a la foto, no a los ajustes sin capturar.",
      "Area de hoja": latest.metrics.plantAreaPercent, "Amarillamiento medido": latest.metrics.yellowPercent,
      "Manchas repetidas": latest.metrics.suspectSpotPercent, "Detalle relativo": latest.metrics.quality?.detail?.value,
      "Calidad": latest.metrics.quality?.score });
  }).catch(() => { /* The controls still work if no prior result can be restored. */ });
})();

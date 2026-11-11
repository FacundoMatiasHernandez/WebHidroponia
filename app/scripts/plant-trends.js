(function exposePlantTrends(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HydroVisionPlantTrends = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlantTrends() {
  "use strict";
  const MIN_INTERVAL_MS = 60 * 60 * 1000;
  const MAX_INTERVAL_MS = 7 * 24 * MIN_INTERVAL_MS;
  const NOISE_FLOOR_PP = 0.5;
  const fullRegion = { x: 0, y: 0, width: 1, height: 1 };
  const validBox = (box) => box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
    && box.x + box.width <= 1 + 1e-9 && box.y + box.height <= 1 + 1e-9;

  function validMeasurement(metrics) {
    const area = metrics?.areaMeasurement;
    return metrics?.usable === true && typeof metrics.analysisVersion === "string"
      && Number.isFinite(metrics.plantAreaPercent) && Number.isFinite(metrics.averageBrightness)
      && Number.isInteger(metrics.sampleWidth) && metrics.sampleWidth >= 16
      && Number.isInteger(metrics.sampleHeight) && metrics.sampleHeight >= 16
      && validBox(metrics.boundingBox) && validBox(metrics.roi || fullRegion)
      && area && Number.isInteger(area.samples) && area.samples >= 2
      && Number.isFinite(area.min) && Number.isFinite(area.max) && area.min > 0 && area.max <= 100
      && area.min <= metrics.plantAreaPercent && metrics.plantAreaPercent <= area.max;
  }

  function sameRegion(a, b) {
    a = a || fullRegion; b = b || fullRegion;
    return ["x", "y", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 1e-6);
  }

  function clipped(metrics) {
    const box = metrics.boundingBox, roi = metrics.roi || fullRegion;
    const dx = 2 / metrics.sampleWidth, dy = 2 / metrics.sampleHeight;
    return box.x <= roi.x + dx || box.y <= roi.y + dy
      || box.x + box.width >= roi.x + roi.width - dx || box.y + box.height >= roi.y + roi.height - dy;
  }

  function comparable(current, previous) {
    if ((current.captureTarget || "plant") !== (previous?.captureTarget || "plant")) return false;
    const scenario = current.simulator?.config || {}, oldScenario = previous?.simulator?.config || {};
    if (Object.keys(scenario).length !== Object.keys(oldScenario).length
        || Object.keys(scenario).some(key => scenario[key] !== oldScenario[key])) return false;
    const settings = current.captureSettings || {}, oldSettings = previous?.captureSettings || {};
    if (Object.keys(settings).length !== Object.keys(oldSettings).length
        || Object.keys(settings).some((key) => settings[key] !== oldSettings[key])) return false;
    const a = current.metrics, b = previous?.metrics;
    if (!validMeasurement(b) || clipped(b) || a.analysisVersion !== b.analysisVersion
        || a.sampleWidth !== b.sampleWidth || a.sampleHeight !== b.sampleHeight || !sameRegion(a.roi, b.roi)) return false;
    const light = current.lighting, oldLight = previous.lighting;
    if (!light?.protocol || !Number.isFinite(light.intensity) || light.protocol !== oldLight?.protocol
        || light.intensity !== oldLight?.intensity || light.mode !== oldLight?.mode) return false;
    const box = a.boundingBox, last = b.boundingBox;
    const shift = Math.hypot(box.x + box.width / 2 - last.x - last.width / 2,
      box.y + box.height / 2 - last.y - last.height / 2);
    return shift < 0.015 && Math.abs(box.width - last.width) < 0.04 && Math.abs(box.height - last.height) < 0.04
      && Math.abs(a.averageBrightness - b.averageBrightness) < 10;
  }

  function sameCapture(a, b) {
    const urls = new Set([a.imageUrl, ...(a.frames || []).map((frame) => frame.imageUrl)].filter(Boolean));
    return a.capturedAt === b.capturedAt || (a.burstId && a.burstId === b.burstId)
      || [b.imageUrl, ...(b.frames || []).map((frame) => frame.imageUrl)].some((url) => url && urls.has(url));
  }

  function compareHistory(current, history = []) {
    const empty = (reason, label) => ({ reason, label, deltaPercent: null, baseline: null });
    if (!validMeasurement(current?.metrics) || !Number.isFinite(Date.parse(current?.capturedAt))) {
      return empty("invalid-measurement", "Sin lectura");
    }
    if (clipped(current.metrics)) return empty("clipped-leaf", "Area recortada");
    const now = Date.parse(current.capturedAt);
    const candidates = history.filter((entry) => entry && !sameCapture(current, entry)
      && Number.isFinite(Date.parse(entry.capturedAt)) && Date.parse(entry.capturedAt) < now
      && now - Date.parse(entry.capturedAt) <= MAX_INTERVAL_MS && comparable(current, entry));
    const baseline = candidates.filter((entry) => now - Date.parse(entry.capturedAt) >= MIN_INTERVAL_MS)
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
    if (!baseline) return empty(candidates.length ? "too-recent" : "no-baseline", candidates.length ? "Intervalo corto" : "Sin base compatible");
    const a = current.metrics, b = baseline.metrics;
    // Observed burst spread is a repeatability bound, not a statistical confidence interval.
    const interval = { min: a.areaMeasurement.min - b.areaMeasurement.max,
      max: a.areaMeasurement.max - b.areaMeasurement.min };
    const detectable = interval.min > NOISE_FLOOR_PP || interval.max < -NOISE_FLOOR_PP;
    const delta = a.plantAreaPercent - b.plantAreaPercent;
    return {
      reason: detectable ? "change" : "within-variation",
      label: detectable ? delta > 0 ? "Mayor area" : "Menor area" : "No concluyente",
      deltaPercent: detectable ? +delta.toFixed(2) : null,
      observedDeltaPercent: +delta.toFixed(2), interval,
      elapsedMs: now - Date.parse(baseline.capturedAt),
      baseline: { imageUrl: baseline.imageUrl, capturedAt: baseline.capturedAt }
    };
  }
  return { compareHistory, MIN_INTERVAL_MS, MAX_INTERVAL_MS, NOISE_FLOOR_PP };
});

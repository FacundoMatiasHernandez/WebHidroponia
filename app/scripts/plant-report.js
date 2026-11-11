(function exposePlantReport(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HydroVisionPlantReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlantReport() {
  "use strict";
  // Conclusions use measured image evidence only, never the simulator's requested case.
  function classify(result) {
    if (result.quality.issues.includes("insufficient-leaf")) return {
      status: "warning", label: "Sin lectura", detail: "No hay suficiente superficie de hoja visible."
    };
    if (!result.quality.usable) {
      const reasons = { blurred: "Falta nitidez", underexposed: "Luz insuficiente", overexposed: "Exceso de luz",
        "tablet-reference-missing": "Falta la tira de calibracion completa: se acepta solo la hoja del simulador tablet-leaf-v1",
        "tablet-reference-invalid": "Los colores de referencia no se distinguen: revisar foco, reflejos y brillo",
        "tablet-leaf-shape": "La silueta no corresponde a la hoja de este laboratorio",
        "tablet-leaf-clipped": "La hoja esta recortada: encuadrarla completa",
        "tablet-burst-disagreement": "Las fotos discrepan en color o posicion: repetir sin cambiar la pantalla" };
      return { status: "warning", label: "Foto no evaluable",
        detail: result.quality.issues.map(issue => reasons[issue] || issue).join(". ") + ". No se puede descartar dano." };
    }
    if (!result.stable) return { status: "warning", label: "Repetir captura",
      detail: "Las fotos no son comparables por movimiento o cambios de luz." };
    if (result.profile === "tablet-leaf-v1") {
      const patterns = result.simulatedPatterns || [];
      const damage = patterns.length > 0;
      if (!damage && !result.yellowPixels && (result.tentativePixels > 12 || result.yellowTentativePixels > 15)) return {
        status: "warning", label: "Marcas simuladas por revisar", detail: "Hay color o marcas sin suficiente repeticion. No se confirma una hoja sin danos."
      };
      const label = result.yellowPixels ? damage ? "Amarillamiento y danos simulados" : "Amarillamiento simulado"
        : damage ? "Danos simulados detectados" : "Sin danos simulados visibles";
      return { status: damage || result.yellowPixels ? "attention" : "ok", label,
        detail: "Perfil exclusivo tablet-leaf-v1, calibrado desde la foto. " + (damage
          ? `Se repitieron ${patterns.length} firmas de dano; se detallan en la lista del simulador. `
          : "No se encontraron firmas ampliadas de dano repetidas. ")
          + "Los porcentajes describen superficie visible; no intensidad ni diagnosticos de plagas reales." };
    }
    if (result.yellowOutsidePixels > 100 && !result.yellowPixels) return { status: "warning", label: "Seleccion incompleta",
      detail: "Hay tejido de color amarillento fuera del area seleccionada. La seleccion no cubre toda la zona visible." };
    if (result.yellowPixels) return { status: "attention", label: result.repeatedPixels ? "Manchas y amarillamiento" : "Amarillamiento visible",
      detail: "Hay zonas amarillentas amplias que se repiten cerca del follaje. Es una senal visual, no un diagnostico de su causa." };
    if (result.yellowTentativePixels && !result.repeatedPixels) return { status: "warning", label: "Color por revisar",
      detail: "Hay zonas amarillentas cuya iluminacion, recorte o repeticion no permite cuantificarlas." };
    if (result.repeatedPixels) return { status: "attention", label: "Manchas posibles",
      detail: "Hay cambios de color que se repiten sobre la hoja. La imagen no determina su causa." };
    if (result.tentativePixels) return { status: "warning", label: "Marcas por revisar",
      detail: "Hay marcas cuya forma o repeticion no permite una lectura confiable." };
    return { status: "ok", label: "Sin manchas visibles",
      detail: "No se encontraron marcas repetidas en el area evaluable de estas fotos. Esto no descarta plagas, perforaciones ni danos finos." };
  }
  function trialRows(history = []) {
    return history.filter(entry => entry?.captureTarget === "screen" && entry.simulator?.config && entry.metrics)
      .slice(-10).reverse().map(entry => {
        const metrics = entry.metrics, config = entry.simulator.config;
        const measurable = metrics.usable === true;
        const patches = ["aphids", "whitefly", "mites", "thrips", "miners", "caterpillars"];
        return { name: config.name || "Ensayo", revision: entry.simulator.revision,
          requestedYellow: config.yellow, activePests: patches.filter(key => config[key] > 0).length,
          label: entry.label || "Sin conclusion", usable: measurable, analysisVersion: metrics.analysisVersion || "version anterior",
          yellow: measurable && Number.isFinite(metrics.yellowPercent) ? metrics.yellowPercent : null,
          spots: measurable && Number.isFinite(metrics.suspectSpotPercent) ? metrics.suspectSpotPercent : null,
          imageUrl: typeof entry.imageUrl === "string" && /^\/api\/plant-vision\/images\/[\w.-]+\.jpg$/.test(entry.imageUrl) ? entry.imageUrl : null };
      });
  }
  function renderTrials(container, history) {
    if (!container) return;
    const rows = trialRows(history);
    container.replaceChildren();
    if (!rows.length) { container.textContent = "Todavia no hay ensayos sincronizados."; return; }
    const table = document.createElement("table"), header = table.createTHead().insertRow();
    for (const title of ["Caso simulado", "Ajustes simulados: amarillo / tipos de plaga", "Conclusion visual", "Amarillo medido", "Manchas medidas"]) {
      const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = title; header.append(cell);
    }
    const body = table.createTBody();
    const percent = value => Number.isFinite(value) ? value.toFixed(2) + "%" : "No evaluable";
    for (const row of rows) {
      const tr = body.insertRow(); tr.dataset.usable = String(row.usable);
      for (const text of [`${row.revision}. ${row.name}`, `${row.requestedYellow} / ${row.activePests} tipo(s)`, row.label, percent(row.yellow), percent(row.spots)]) {
        const cell = tr.insertCell(); cell.textContent = text;
      }
      if (row.imageUrl) {
        const link = document.createElement("a"); link.href = row.imageUrl; link.textContent = "Foto";
        link.target = "_blank"; link.rel = "noopener"; tr.cells[0].append(document.createElement("br"), link);
      }
      const version = document.createElement("small"); version.textContent = row.analysisVersion;
      tr.cells[0].append(document.createElement("br"), version);
    }
    container.append(table);
  }
  function renderPatterns(container, metrics) {
    if (!container) return;
    container.replaceChildren();
    container.hidden = metrics?.detectorProfile !== "tablet-leaf-v1";
    if (container.hidden) return;
    const title = document.createElement("strong"); title.textContent = "Firmas visuales del simulador"; container.append(title);
    const note = document.createElement("p");
    if (!metrics.usable) { note.textContent = "No evaluables en esta captura."; container.append(note); return; }
    const patterns = (metrics.simulatedPatterns || []).filter(item => typeof item.label === "string" && Number.isFinite(item.percent) && item.percent > 0);
    if (!patterns.length) { note.textContent = "No se repitieron firmas ampliadas de plagas. El amarillo se mide por separado."; container.append(note); return; }
    const list = document.createElement("ul");
    for (const item of patterns) {
      const row = document.createElement("li"); row.textContent = `${item.label}: ${item.percent.toFixed(2)}% de la superficie visible`; list.append(row);
    }
    container.append(list);
  }
  return { classify, trialRows, renderTrials, renderPatterns };
});

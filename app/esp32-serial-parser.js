const START = "========== LECTURAS SISTEMA ==========", END = "=====================================";
const { J17, enrichJ17 } = require("./firmware-profiles");
const IDS = ["air-humidity", "air-temperature", "light-intensity", "air-co2", "water-temperature", "water-ph", "water-tds", "water-level-raw",
  ...Array.from({ length: 5 }, (_, i) => `distance-${i + 1}`)];
function parseBlock(lines, date = new Date(), { firmwareProfile } = {}) {
  const readings = new Map(IDS.map(sensorId => [sensorId, { sensorId, value: null, status: "missing", note: "El bloque no informa este sensor" }]));
  const value = (id, text, unit, note) => {
    const pattern = new RegExp(`^(-?\\d+(?:[.,]\\d+)?)\\s*${unit}(?:\\s|$)`);
    const match = text.trim().match(pattern);
    readings.set(id, match ? { sensorId: id, value: Number(match[1].replace(",", ".")), ...(note ? { note } : {}) }
      : { sensorId: id, value: null, status: "error", note: /sin eco/i.test(text) ? "Sin eco; no equivale a distancia cero" : "El firmware informa ERROR; revisar conexion o arranque" });
  };
  let relay = null, recognized = 0, firmwareBuild = null, directEc = null;
  const adc = new Map();
  for (const line of lines) {
    let m;
    if ((m = /^Firmware perfil:\s*(tesis-huerta-j17-diagnostico-v1)$/.exec(line))) firmwareBuild = m[1];
    else if ((m = /^(PH|TDS) ADC: raw=(\d+)\s*\|\s*GPIO mV=(\d+)$/.exec(line))) {
      const raw = Number(m[2]), millivolts = Number(m[3]);
      if (raw <= 4095 && millivolts <= 3300) adc.set(m[1] === "PH" ? "water-ph" : "water-tds", { pin: m[1] === "PH" ? 1 : 2, raw, millivolts });
    } else if ((m = /^EC estimada:\s*(\d+(?:\.\d+)?)\s*mS\/cm$/.exec(line))) directEc = Number(m[1]);
    else if ((m = /^Lux:\s*(.+)$/.exec(line))) { value("light-intensity", m[1], "lux"); recognized++; }
    else if ((m = /^CO2:\s*(.+?)\s*\|\s*Temp MH-Z19:/.exec(line))) { value("air-co2", m[1], "ppm"); recognized++; }
    else if ((m = /^Temp ambiente:\s*(.+?)\s*\|\s*Humedad:\s*(.+)$/.exec(line))) {
      value("air-temperature", m[1], "C"); value("air-humidity", m[2], "%"); recognized++;
    } else if ((m = /^Temp agua:\s*(.+?)\s*\|\s*pH:\s*(.+?)\s*\|\s*TDS:\s*(.+)$/.exec(line))) {
      value("water-temperature", m[1], "C"); value("water-ph", m[2], ""); value("water-tds", m[3], "ppm", "Valor informado por firmware; calibracion pendiente. No se convierte a conductividad."); recognized++;
    } else if ((m = /^Matriz resistiva nivel RAW:\s*(\d+)\s*$/.exec(line))) {
      readings.set("water-level-raw", { sensorId: "water-level-raw", value: Number(m[1]), note: "ADC informado por la placa; no es porcentaje ni altura de agua" }); recognized++;
    } else if ((m = /^Ultrasonico ([1-5]):\s*(.+)$/.exec(line))) { value(`distance-${m[1]}`, m[2], "cm"); recognized++; }
    else if ((m = /^Reles por lux:\s*(apagados|encendidos)\s*\|/i.exec(line))) {
      relay = { id: "lux-relays", label: "Reles controlados por luz", active: m[1].toLowerCase() === "encendidos", mode: "reported", detail: "Estado informado por la ESP32. La web no envia ordenes a los reles." };
    }
  }
  if (recognized < 3) return null;
  readings.set("water-level", { sensorId: "water-level", value: null, status: "uncalibrated", note: "Faltan alturas de tanque vacio/lleno; se muestra distancia y nivel RAW por separado" });
  readings.set("water-ec", { sensorId: "water-ec", value: null, status: "unsupported", note: "La placa informa TDS en ppm, no EC. Falta un factor de conversion validado." });
  if (firmwareProfile === J17.id) {
    enrichJ17(readings);
    if (firmwareBuild) {
      for (const [id, diagnostic] of adc) {
        const reading = readings.get(id); reading.diagnostic = diagnostic;
        reading.note = `GPIO${diagnostic.pin}: ADC ${diagnostic.raw}/4095, ${diagnostic.millivolts} mV. ` + (diagnostic.raw === 0
          ? "Entrada en cero; comprobar senal, alimentacion y conexion de la sonda." : "Lectura electrica directa; calibracion quimica pendiente.");
      }
      const tds = readings.get("water-tds");
      if (Number.isFinite(tds?.value) && Number.isFinite(directEc) && directEc >= 0 && directEc <= 100) readings.set("water-ec", {
        sensorId: "water-ec", value: directEc, quality: "estimated", derivedFrom: "water-tds", conversionFactor: 0.5,
        ...(adc.has("water-tds") ? { diagnostic: adc.get("water-tds") } : {}),
        note: "EC estimada por la formula del firmware antes de redondear TDS. No es una medicion calibrada; revisar ADC de GPIO2 si permanece en cero."
      });
    }
  }
  return { source: "esp32-usb", timestamp: date.toISOString(), firmwareProfile, firmwareBuild,
    readings: [...readings.values()], actuators: relay ? [relay] : [], fullSnapshot: true };
}
function createSerialParser(onBlock, now = () => new Date(), options = {}) {
  let buffer = "", lines = null;
  return { push(chunk) {
    buffer += chunk;
    if (buffer.length > 32768) { buffer = ""; lines = null; return; }
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "").trim(); buffer = buffer.slice(index + 1);
      if (line === START) lines = [];
      else if (line === END && lines) { const payload = parseBlock(lines, now(), options); lines = null; if (payload) onBlock(payload); }
      else if (lines) { lines.push(line); if (lines.length > 30) lines = null; }
    }
  } };
}
module.exports = { parseBlock, createSerialParser };

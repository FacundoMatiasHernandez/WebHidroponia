const { spawn } = require("node:child_process");
const path = require("node:path");
const { createSerialParser } = require("../app/esp32-serial-parser");
const port = process.env.ESP32_SERIAL_PORT || "COM13", baud = Number(process.env.ESP32_SERIAL_BAUD || 115200);
const firmwareProfile = process.env.ESP32_FIRMWARE_PROFILE || "unknown";
if (!["unknown", "tesis-huerta-j17"].includes(firmwareProfile)) throw new Error("Perfil de firmware no reconocido");
if (!/^COM\d+$/i.test(port) || !Number.isInteger(baud) || baud < 1200 || baud > 2000000) throw new Error("Puerto o velocidad serie invalidos");
const endpoint = `http://127.0.0.1:${process.env.PORT || 4173}/api/ingest/batch`;
let reader, pending, posting = false, stopping = false, retry;
async function publish() {
  if (stopping || posting || !pending) return;
  if (Date.now() - Date.parse(pending.timestamp) > 15000) { pending = null; return; }
  posting = true; const payload = pending; pending = null;
  try {
    const response = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(3000),
      headers: { "Content-Type": "application/json", ...(process.env.INGEST_TOKEN ? { "X-Ingest-Token": process.env.INGEST_TOKEN } : {}) }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const good = payload.readings.filter(r => Number.isFinite(r.value)).map(r => `${r.sensorId}=${r.value}`).join(" | ");
    console.log(`${payload.timestamp} ${port}: ${good}`);
  } catch (error) {
    console.error(`No se pudo publicar la lectura: ${error.message}`);
    if (!pending) pending = payload;
    retry = setTimeout(() => { retry = null; publish(); }, 1500);
  } finally { posting = false; if (pending && !retry) publish(); }
}
function connect() {
  if (stopping) return;
  const parser = createSerialParser(payload => {
    pending = { ...payload, transport: { type: "usb-serial", port, baud } };
    if (retry) { clearTimeout(retry); retry = null; }
    publish();
  }, () => new Date(), { firmwareProfile });
  console.log(`Leyendo ${port} a ${baud} baud, sin escribir comandos ni cargar firmware.`);
  reader = spawn(process.env.ESP32_POWERSHELL || "pwsh.exe", ["-NoProfile", "-File", path.join(__dirname, "read-serial.ps1"), "-Port", port, "-BaudRate", String(baud)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  reader.stdout.setEncoding("utf8"); reader.stdout.on("data", data => parser.push(data));
  reader.stderr.on("data", data => console.error(String(data).trim()));
  reader.on("error", error => console.error(error.message));
  reader.on("close", () => { if (!stopping) { pending = null; setTimeout(connect, 5000); } });
}
function stop() { stopping = true; pending = null; if (retry) clearTimeout(retry); reader?.kill(); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
process.on("message", message => { if (message === "shutdown") { stop(); process.disconnect(); } });
process.on("disconnect", stop);
connect();

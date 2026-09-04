const http = require("node:http");
const https = require("node:https");

// The ESP32 multipart stream includes Content-Length for each JPEG. Never split JPEG bytes on a guessed delimiter.
function createFrameParser(onFrame, maxBytes = 4 * 1024 * 1024) {
  let pending = Buffer.alloc(0), length = null;
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > maxBytes + 8192) throw new Error("Camera frame exceeds size limit");
    while (pending.length) {
      if (length === null) {
        const end = pending.indexOf("\r\n\r\n");
        if (end < 0) {
          if (pending.length > 8192) throw new Error("Invalid camera frame headers");
          return;
        }
        const header = pending.subarray(0, end).toString("ascii");
        const match = /(?:^|\r\n)Content-Length:\s*(\d+)\s*(?:\r\n|$)/i.exec(header);
        if (!match) throw new Error("Camera frame has no Content-Length");
        length = Number(match[1]);
        if (length < 4 || length > maxBytes) throw new Error("Invalid camera frame length");
        pending = pending.subarray(end + 4);
      }
      if (pending.length < length) return;
      const jpeg = Buffer.from(pending.subarray(0, length));
      pending = pending.subarray(length);
      length = null;
      if (jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg.at(-2) !== 255 || jpeg.at(-1) !== 217) throw new Error("Incomplete camera JPEG");
      onFrame(jpeg);
    }
  };
}

function collectCameraBurst(url, { count = 3, warmupMs = 1200, discardFrames = 3, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    let complete = false, response, received = 0;
    const frames = [];
    const started = Date.now();
    const finish = (error) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      response?.destroy();
      request.destroy();
      if (error) reject(error); else resolve(frames);
    };
    const request = transport.get(target, { headers: { Accept: "multipart/x-mixed-replace" } }, (incoming) => {
      response = incoming;
      if (incoming.statusCode !== 200) { finish(new Error(`Camera stream HTTP ${incoming.statusCode}`)); return; }
      const parse = createFrameParser((buffer) => {
        if (complete || ++received <= discardFrames || Date.now() - started < warmupMs) return;
        frames.push({ buffer, capturedAt: new Date().toISOString() });
        if (frames.length === count) finish();
      });
      incoming.on("data", (chunk) => {
        if (complete) return;
        try { parse(chunk); } catch (error) { finish(error); }
      });
      incoming.on("error", finish);
      incoming.on("end", () => finish(new Error("Camera stream ended before the burst completed")));
      incoming.on("close", () => { if (!complete) finish(new Error("Camera stream disconnected")); });
    });
    const timer = setTimeout(() => finish(new Error("Camera burst timed out")), timeoutMs);
    request.on("error", finish);
  });
}

async function withRestoredSettings(readStatus, control, settings, capture) {
  const status = await readStatus();
  if (!status || Object.keys(settings).some((key) => !Number.isFinite(status[key]))) {
    throw new Error("No se pudo verificar la configuracion de la camara");
  }
  let result, captureError;
  const attempted = [];
  try {
    for (const [key, value] of Object.entries(settings)) {
      attempted.push(key);
      await control(key, value);
    }
    result = await capture();
  } catch (error) { captureError = error; }
  const failures = [];
  for (const key of attempted.reverse()) {
    let restored = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await control(key, status[key]); restored = true; break; } catch { /* Retry a transient camera timeout. */ }
    }
    if (!restored) failures.push(key);
  }
  if (failures.length) throw new Error(`No se pudo restaurar la camara (${failures.join(", ")}). Revisar conexion y flash.`);
  if (captureError) throw captureError;
  return result;
}

module.exports = { createFrameParser, collectCameraBurst, withRestoredSettings };

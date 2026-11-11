const os = require("node:os");
const { URL } = require("node:url");

function localAddresses() {
  return ["127.0.0.1", "::1", ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item => item.address)];
}
const normalizeIP = ip => (ip || "").replace(/^::ffff:/, "");

function createSimulatorAPI(lab, { port, capture, history = () => ({ latest: null, history: [] }) }) {
  const send = (response, code, body) => {
    response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  };
  async function body(request) {
    let size = 0, raw = "";
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16384) throw Object.assign(new Error("Solicitud demasiado grande"), { statusCode: 413 });
      raw += chunk;
    }
    try { return JSON.parse(raw || "{}"); } catch { throw Object.assign(new Error("JSON invalido"), { statusCode: 400 }); }
  }
  return async (request, response, url) => {
    if (!url.pathname.startsWith("/api/simulator/")) return false;
    try {
      const local = localAddresses();
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      if (hostname !== "localhost" && !local.includes(hostname)) throw Object.assign(new Error("Host no permitido"), { statusCode: 403 });
      if (request.headers.origin && request.headers.origin !== url.origin) throw Object.assign(new Error("Origen no permitido"), { statusCode: 403 });
      if (request.method === "GET" && url.pathname === "/api/simulator/history") {
        send(response, 200, { plantVision: history() }); return true;
      }
      if (request.method === "GET" && url.pathname === "/api/simulator/state") {
        const displayUrls = local.filter(ip => /^\d+\./.test(ip) && !ip.startsWith("127.") && !ip.startsWith("169.254."))
          .map(ip => `http://${ip}:${port}/simulador/`);
        send(response, 200, { ...lab.view(), displayUrls }); return true;
      }
      if (request.method === "GET" && url.pathname === "/api/simulator/events") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        const emit = state => response.write(`data: ${JSON.stringify(state)}\n\n`);
        emit(lab.view()); const unsubscribe = lab.subscribe(emit);
        const timer = setInterval(() => response.write(": heartbeat\n\n"), 15000);
        response.on("close", () => { clearInterval(timer); unsubscribe(); }); return true;
      }
      if (request.method !== "POST") { send(response, 405, { error: "Metodo no permitido" }); return true; }
      const input = await body(request);
      if (url.pathname === "/api/simulator/display") {
        send(response, 200, lab.register(input.label)); return true;
      }
      if (url.pathname === "/api/simulator/ack") {
        send(response, 200, lab.ack(input.displayId, request.headers["x-display-token"], input)); return true;
      }
      if (!local.includes(normalizeIP(request.socket.remoteAddress))) throw Object.assign(new Error("Control disponible solo desde esta PC"), { statusCode: 403 });
      if (url.pathname === "/api/simulator/state") send(response, 200, lab.update(input.config, input.expectedRevision));
      else if (url.pathname === "/api/simulator/select") send(response, 200, lab.select(input.displayId));
      else if (url.pathname === "/api/simulator/capture") send(response, 200, { ok: true, capture: await capture() });
      else send(response, 404, { error: "Ruta desconocida" });
    } catch (error) { send(response, error.statusCode || 500, { error: error.statusCode ? error.message : "Error interno del laboratorio" }); }
    return true;
  };
}

module.exports = { createSimulatorAPI };

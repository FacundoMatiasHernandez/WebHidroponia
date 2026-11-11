const { randomUUID, randomBytes, timingSafeEqual, createHash } = require("node:crypto");
const net = require("node:net");

const LEGACY_RELAYS = [39, 40, 47].map((pin, index) => ({ id: `relay-${pin}`, pin, label: `Bomba peristaltica ${index + 1} / GPIO${pin}` }));
const RELAYS = [...LEGACY_RELAYS, { id: "relay-41", pin: 41, label: "Bomba peristaltica 4 / GPIO41" }];
const CAPABILITIES = {
  "tesis-huerta-j17-wifi-v1": { name: "timed-pumps-v1", relays: LEGACY_RELAYS, continuous: false },
  "tesis-huerta-j17-wifi-v2": { name: "timed-continuous-pumps-v2", relays: LEGACY_RELAYS, continuous: true },
  "tesis-huerta-j17-wifi-v3": { name: "four-timed-continuous-pumps-v3", relays: RELAYS, continuous: true }
};
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const equalSecret = (a, b) => timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());

function sameOrigin(request) {
  try {
    const target = new URL(`http://${request.headers.host}`);
    const origin = new URL(request.headers.origin);
    const name = target.hostname.replace(/^\[|\]$/g, "");
    return (name === "localhost" || Boolean(net.isIP(name))) && ["http:", "https:"].includes(origin.protocol)
      && origin.host === target.host && !request.headers["x-forwarded-host"];
  } catch { return false; }
}

function createControlAccess({ token = "", now = Date.now } = {}) {
  const sessions = new Map(), attempts = new Map();
  const local = request => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress);
  function session(request) {
    const id = /(?:^|;\s*)hydro_control=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || "")?.[1];
    if (id && sessions.get(id) > now()) return true;
    if (id) sessions.delete(id);
    return false;
  }
  return {
    configured: token.length >= 16,
    info(request) { return { authenticated: token.length >= 16 && (local(request) || session(request)), local: local(request) }; },
    authorize(request) {
      if (!sameOrigin(request)) fail(403, "Origen de control no permitido");
      if (token.length < 16) fail(503, "Configurar RELAY_CONTROL_TOKEN antes de habilitar los reles");
      if (!local(request) && !session(request)) fail(401, "Ingresar la clave de control para esta pantalla");
    },
    login(request, password) {
      if (!sameOrigin(request)) fail(403, "Origen de control no permitido");
      if (token.length < 16) fail(503, "Control remoto sin configurar");
      const key = request.socket.remoteAddress;
      const attempt = attempts.get(key) || { count: 0, until: now() + 60000 };
      if (attempt.until <= now()) { attempt.count = 0; attempt.until = now() + 60000; }
      if (attempt.count >= 5) fail(429, "Demasiados intentos; esperar un minuto");
      if (!equalSecret(password, token)) {
        attempt.count++; if (attempts.size >= 128) attempts.delete(attempts.keys().next().value);
        attempts.set(key, attempt); fail(401, "Clave de control incorrecta");
      }
      attempts.delete(key);
      for (const [id, expiry] of sessions) if (expiry <= now()) sessions.delete(id);
      if (sessions.size >= 64) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(32).toString("hex"); sessions.set(id, now() + 8 * 3600000);
      return `hydro_control=${id}; HttpOnly; SameSite=Strict; Path=/api/control; Max-Age=28800`;
    }
  };
}

function createRelayControl({ deviceId = "huerta-j17", enabled = false, now = Date.now, staleMs = 15000, commandMs = 15000 } = {}) {
  let device = null;
  let revision = 0;
  const retiredBoots = new Set(), orders = new Map();
  function expire() {
    for (const order of orders.values()) if (order.status === "pending" && order.deadline <= now()) order.status = "expired";
  }
  function connected() { return Boolean(device && now() - device.seenAt <= staleMs); }
  function accept(payload) {
    const d = payload?.device;
    const profile = Object.hasOwn(CAPABILITIES, payload?.firmwareBuild) ? CAPABILITIES[payload.firmwareBuild] : null;
    if (payload?.source !== "esp32-wifi" || !profile
      || d?.id !== deviceId || !validId(d.bootId) || d.protocol !== 1 || d.capability !== profile.name
      || !Number.isSafeInteger(d.sequence) || d.sequence < 1 || d.sequence > 0xffffffff) fail(400, "Identidad o protocolo de ESP32 invalido");
    const continuousSupported = profile.continuous;
    if (!Array.isArray(payload.actuators) || payload.actuators.length !== profile.relays.length) fail(400, "Cantidad de reles incompatible con el firmware");
    const reports = profile.relays.map(relay => {
      const matches = (Array.isArray(payload.actuators) ? payload.actuators : []).filter(a => a?.id === relay.id);
      const a = matches[0];
      if (matches.length !== 1 || a.pin !== relay.pin || typeof a.active !== "boolean"
        || !["manual", "safe-off"].includes(a.mode) || !["none", "applied", "completed", "failsafe", "rejected"].includes(a.result)
        || (a.commandId !== null && a.commandId !== undefined && !validId(a.commandId))) fail(400, "Estado de rele invalido");
      if (continuousSupported && (!["pulse", "continuous"].includes(a.runMode) || !Number.isInteger(a.durationMs)
        || a.durationMs < 0 || a.durationMs > 10000 || (a.runMode === "continuous" && a.durationMs !== 0)
        || (a.active && a.runMode === "pulse" && a.durationMs < 1000))) fail(400, "Modo de funcionamiento informado invalido");
      return { ...relay, active: a.active, mode: a.mode, runMode: continuousSupported ? a.runMode : "pulse",
        durationMs: continuousSupported ? a.durationMs : null, result: a.result, commandId: a.commandId || null };
    });
    if (device?.bootId === d.bootId && d.sequence <= device.sequence) fail(409, "Telemetria repetida o fuera de orden");
    if (device?.bootId === d.bootId && device.firmwareBuild !== payload.firmwareBuild) fail(409, "La capacidad del equipo cambio sin un nuevo arranque");
    if (retiredBoots.has(d.bootId)) fail(409, "Arranque anterior; no se aceptan sus estados ni ordenes");
    if (device && device.bootId !== d.bootId) {
      retiredBoots.add(device.bootId);
      if (retiredBoots.size > 64) retiredBoots.delete(retiredBoots.values().next().value);
      for (const order of orders.values()) if (order.status === "pending") order.status = "aborted";
    }
    device = { id: d.id, bootId: d.bootId, sequence: d.sequence, continuousSupported, firmwareBuild: payload.firmwareBuild,
      ip: net.isIP(d.ip || "") ? d.ip : null, seenAt: now(), reports };
    expire();
    for (const report of reports) {
      const order = orders.get(report.id);
      if (order?.status === "pending" && order.commandId === report.commandId && order.bootId === d.bootId) {
        if (["failsafe", "rejected"].includes(report.result)) order.status = "failed";
        else if (order.mode === report.mode && ((!order.active && !report.active)
          || (order.active && report.active && order.runMode === report.runMode)
          || (order.active && order.runMode === "pulse" && !report.active && report.result === "completed"))) order.status = "confirmed";
      }
    }
  }
  function queue(body) {
    expire();
    if (!enabled) fail(503, "Configurar las claves de ingesta y control");
    if (!connected()) fail(409, "ESP32 sin comunicacion reciente; no se envia la orden");
    if (body?.bootId !== device.bootId) fail(409, "La ESP32 se reinicio; actualizar el estado antes de ordenar");
    if (!RELAYS.some(relay => relay.id === body.id)) fail(400, "Rele desconocido");
    if (!device.reports.some(relay => relay.id === body.id)) fail(409, "Actualizar el firmware para habilitar esta bomba; el equipo aun no la informa");
    if (body.mode !== "manual" || typeof body.active !== "boolean") fail(400, "Las bombas solo admiten control manual explicito");
    const runMode = body.active ? (body.runMode === undefined ? "pulse" : body.runMode) : "pulse";
    if (!["pulse", "continuous"].includes(runMode)) fail(400, "Modo de funcionamiento desconocido");
    if (runMode === "continuous" && !device.continuousSupported) fail(409, "Actualizar el firmware de la ESP32 para habilitar continuo");
    if (body.active && body.revision !== revision) fail(409, "El control cambio; actualizar el estado antes de encender");
    if (body.active && runMode === "pulse" && (!Number.isInteger(body.durationMs) || body.durationMs < 1000 || body.durationMs > 10000)) fail(400, "Duracion de pulso permitida: 1 a 10 segundos");
    if (runMode === "continuous" && body.durationMs !== 0) fail(400, "El modo continuo requiere duracion cero y seleccion explicita");
    if (body.active && (device.reports.some(r => r.active) || [...orders.values()].some(o => o.status === "pending"))) fail(409, "Solo puede funcionar una bomba a la vez; esperar su apagado confirmado");
    if (orders.get(body.id)?.status === "pending" && body.active) fail(409, "Hay una orden pendiente para este rele");
    const order = { id: body.id, commandId: randomUUID(), bootId: device.bootId, mode: body.mode,
      active: body.active, runMode, durationMs: body.active ? body.durationMs : 0, status: "pending", deadline: now() + commandMs };
    orders.set(body.id, order);
    revision++;
    return { ...order };
  }
  function response() {
    expire();
    return { deviceId, bootId: device?.bootId, sequence: device?.sequence, controlLeaseMs: 30000,
      commands: enabled && connected() ? [...orders.values()].filter(o => o.status === "pending" && o.bootId === device.bootId)
        .map(o => ({ id: o.id, commandId: o.commandId, mode: o.mode, active: o.active, runMode: o.runMode,
          durationMs: o.durationMs, expiresInMs: o.deadline - now() })) : [] };
  }
  function info() {
    return { enabled, connected: connected(), deviceId, revision, ip: device?.ip || null, bootId: device?.bootId || null,
      reportedAt: device ? new Date(device.seenAt).toISOString() : null, failsafeMs: 30000,
      maximumRunMs: device?.continuousSupported ? null : 10000, maximumPulseMs: 10000, continuousSupported: Boolean(device?.continuousSupported),
      supportedRelayIds: device?.reports.map(report => report.id) || [] };
  }
  function actuators() {
    expire();
    return RELAYS.map(relay => {
      const report = device?.reports.find(r => r.id === relay.id), order = orders.get(relay.id);
      const fresh = connected();
      return { ...relay, active: fresh && report ? report.active : null, mode: report?.mode || "unknown",
        runMode: fresh && report ? report.runMode : null, durationMs: fresh && report ? report.durationMs : null,
        stale: !fresh || !report, supported: device ? Boolean(report) : null, controllable: enabled && fresh && Boolean(report), bootId: device?.bootId || null,
        timestamp: report ? new Date(device.seenAt).toISOString() : null,
        result: report?.result || "none", detail: "Salida informada por la ESP32; sin realimentacion de contactos ni confirmacion de caudal.",
        command: order ? { commandId: order.commandId, status: order.status, mode: order.mode,
          active: order.active, runMode: order.runMode, durationMs: order.durationMs } : null };
    });
  }
  function stopAll(body) {
    if (!connected()) fail(409, "ESP32 sin comunicacion reciente; no se envia la orden");
    return device.reports.map(relay => queue({ id: relay.id, mode: "manual", active: false, bootId: body?.bootId }));
  }
  return { accept, queue, stopAll, response, info, actuators };
}

module.exports = { RELAYS, LEGACY_RELAYS, createRelayControl, createControlAccess, sameOrigin };

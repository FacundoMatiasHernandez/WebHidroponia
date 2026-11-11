const { randomUUID } = require("node:crypto");
const PESTS = ["aphids", "whitefly", "mites", "thrips", "miners", "caterpillars"];
const DEFAULTS = { yellow: 0, aphids: 0, whitefly: 0, mites: 0, thrips: 0, miners: 0,
  caterpillars: 0, day: 0, background: "gray", zoom: 0.85, rotation: 0, chart: false, name: "Hoja sana", renderProfile: "tablet-leaf-v1" };
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function validateConfig(input, previous = DEFAULTS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Caso de prueba invalido");
  if (Object.keys(input).some(key => !Object.hasOwn(DEFAULTS, key))) throw fail("Parametro desconocido");
  const config = { ...previous, ...input };
  for (const key of ["yellow", ...PESTS, "day", "zoom", "rotation"]) {
    const [min, max] = key === "day" ? [0, 30] : key === "zoom" ? [0.75, 1.5]
      : key === "rotation" ? [-180, 180] : [0, 100];
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max) throw fail(`Valor invalido: ${key}`);
  }
  if (!Number.isInteger(config.day) || !["light", "gray", "dark"].includes(config.background)
      || typeof config.chart !== "boolean" || typeof config.name !== "string" || config.name.length > 80
      || config.renderProfile !== DEFAULTS.renderProfile) throw fail("Caso de prueba invalido");
  return config;
}

function createSimulatorSync({ initial, persist = () => {}, now = Date.now } = {}) {
  const sessionId = randomUUID(), clients = new Map(), listeners = new Set();
  let config = validateConfig(initial || {}), revision = 1, activeDisplayId = null, capture = null;
  const clone = value => JSON.parse(JSON.stringify(value));
  const fresh = client => client && now() - client.lastSeen <= 8000;
  function view() {
    return { sessionId, revision, config: clone(config), activeDisplayId, capturing: !!capture,
      displays: [...clients.values()].map(client => ({ id: client.id, label: client.label,
        online: fresh(client), lastSeen: client.lastSeen, renderedRevision: client.ack?.revision || null,
        ready: fresh(client) && client.ack?.revision === revision && client.ack.visible && client.ack.assetsReady
          && client.ack.renderProfile === config.renderProfile,
        viewport: client.ack?.viewport || null })) };
  }
  function emit() { for (const listener of listeners) listener(view()); }
  function mutable() { if (capture) throw fail("Captura en curso: espera antes de cambiar la pantalla", 423); }
  function registered(id, token) {
    const client = clients.get(id);
    if (!client || client.token !== token) throw fail("Registrar de nuevo esta pantalla", 403);
    return client;
  }
  function ready(id = activeDisplayId) {
    const client = clients.get(id);
    if (!fresh(client) || client.ack?.revision !== revision || !client.ack?.visible || !client.ack?.assetsReady
        || client.ack.renderProfile !== config.renderProfile) {
      throw fail("La tablet no confirmo el caso actual. Abri /simulador/ en la tablet y pulsa Iniciar pantalla.", 409);
    }
    return client;
  }
  return {
    view,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(patch, expectedRevision) {
      mutable();
      if (expectedRevision !== revision) throw fail("El caso cambio. Actualiza el panel y vuelve a aplicar.", 409);
      const next = validateConfig(patch, config);
      persist(next); config = next; revision++; emit(); return view();
    },
    register(label) {
      for (const [id, client] of clients) if (now() - client.lastSeen > 3600000) clients.delete(id);
      if (clients.size >= 12) throw fail("Demasiadas pantallas registradas", 429);
      const client = { id: randomUUID(), token: randomUUID(), label: typeof label === "string" ? label.slice(0, 60) : "Tablet",
        lastSeen: now(), ack: null };
      clients.set(client.id, client);
      if (!activeDisplayId || !fresh(clients.get(activeDisplayId))) activeDisplayId = client.id;
      return { id: client.id, token: client.token, state: view() };
    },
    select(id) {
      mutable(); if (!clients.has(id)) throw fail("Pantalla desconocida");
      activeDisplayId = id; emit(); return view();
    },
    ack(id, token, ack) {
      const client = registered(id, token);
      if (ack?.sessionId !== sessionId || ack?.revision !== revision) throw fail("Confirmacion de otro caso o sesion", 409);
      if (typeof ack.visible !== "boolean" || typeof ack.assetsReady !== "boolean"
          || !Number.isFinite(ack.viewport?.width) || !Number.isFinite(ack.viewport?.height)
          || ack.viewport.width < 1 || ack.viewport.height < 1 || ack.viewport.width > 20000 || ack.viewport.height > 20000) throw fail("Confirmacion de pantalla invalida");
      client.lastSeen = now();
      client.ack = { sessionId, revision, visible: ack.visible, assetsReady: ack.assetsReady, renderProfile: ack.renderProfile,
        viewport: { width: ack.viewport.width, height: ack.viewport.height } };
      return { ok: true };
    },
    beginCapture() {
      mutable(); const client = ready();
      capture = { sessionId, revision, displayId: client.id, displayLabel: client.label,
        config: clone(config), viewport: clone(client.ack.viewport), confirmedAt: new Date(client.lastSeen).toISOString() };
      emit(); return clone(capture);
    },
    assertCapture(lease) {
      if (!capture || lease.sessionId !== sessionId || lease.revision !== revision || lease.displayId !== activeDisplayId) throw fail("La pantalla cambio durante la captura", 409);
      ready(lease.displayId);
    },
    endCapture() { capture = null; emit(); }
  };
}

module.exports = { DEFAULTS, PESTS, validateConfig, createSimulatorSync };

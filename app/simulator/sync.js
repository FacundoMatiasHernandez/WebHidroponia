(function connectDisplay() {
  "use strict";
  const banner = document.createElement("aside"); banner.className = "sync-banner";
  banner.innerHTML = '<h1>Hoja sincronizada</h1><p>Esta pantalla sera controlada desde HydroVision en la PC. La simulacion no valida diagnosticos de plagas reales.</p><button type="button">Iniciar pantalla</button><p class="sync-message" role="status">Mantene la tablet en la misma red Wi-Fi y con la pantalla encendida.</p>';
  document.body.append(banner);
  const chart = document.createElement("div"); chart.className = "sync-chart";
  chart.innerHTML = '<div class="stripes"></div><div class="checker"></div><div class="patches"><i style="--patch:#151515"></i><i style="--patch:#777"></i><i style="--patch:#ddd"></i><i style="--patch:#368542"></i><i style="--patch:#c6b54a"></i><i style="--patch:#855332"></i></div>';
  document.getElementById("stage").append(chart);
  const message = banner.querySelector(".sync-message"), button = banner.querySelector("button");
  let identity, current, appliedKey = "", rendered = null, started = false, applying = false, dirty = false;
  try { identity = JSON.parse(sessionStorage.getItem("hydrovision-display")); } catch { /* Storage may be unavailable on a tablet. */ }
  let wakeLock;
  async function post(path, body, headers = {}) {
    const response = await fetch(`/api/simulator/${path}`, { method: "POST", signal: AbortSignal.timeout(6000), headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || "Sin conexion con la PC"), { status: response.status });
    return result;
  }
  function visible() { return document.visibilityState === "visible" && banner.hidden; }
  async function acknowledge() {
    if (!identity || !current || !rendered) return;
    try {
      await post("ack", { displayId: identity.id, sessionId: current.sessionId, revision: rendered.revision,
        visible: visible(), renderProfile: rendered.renderProfile, assetsReady: rendered.assetsReady && !applying && !dirty && window.HydroVisionSimulator.matches(current.config),
        viewport: rendered.viewport }, { "X-Display-Token": identity.token });
    } catch (error) {
      if (error.status === 403) { identity = null; appliedKey = ""; rendered = null; }
      else if (error.status !== 409) { banner.hidden = false; message.textContent = "Sin conexion con la PC. Reintentando..."; }
    }
  }
  async function apply() {
    if (!started || !current || !identity || document.hidden) return;
    const key = `${current.sessionId}:${current.revision}`;
    if (applying) { dirty = true; return; }
    if (key === appliedKey && !dirty) return;
    applying = true; dirty = false; rendered = null;
    const state = current;
    try {
      const result = await window.HydroVisionSimulator.apply(state.config);
      if (current.sessionId !== state.sessionId || current.revision !== state.revision) { dirty = true; return; }
      appliedKey = key; rendered = { ...result, revision: state.revision };
      banner.hidden = true;
    } catch (error) { banner.hidden = false; message.textContent = error.message; }
    finally { applying = false; if (dirty) { await apply(); } else await acknowledge(); }
  }
  async function refresh() {
    if (!started) return;
    try {
      const response = await fetch("/api/simulator/state", { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error("No responde la PC");
      const state = await response.json();
      if (!identity || identity.sessionId !== state.sessionId) {
        const registration = await post("display", { label: new URLSearchParams(location.search).get("name") || "Tablet" });
        identity = { id: registration.id, token: registration.token, sessionId: registration.state.sessionId };
        try { sessionStorage.setItem("hydrovision-display", JSON.stringify(identity)); } catch { /* The live session still works without storage. */ }
        appliedKey = ""; rendered = null;
      }
      current = state;
      if (!banner.hidden || !window.HydroVisionSimulator.matches(state.config)) dirty = true;
      await apply(); await acknowledge();
    } catch (error) { banner.hidden = false; message.textContent = error.message + ". Reintentando..."; }
  }
  button.addEventListener("click", async () => {
    button.disabled = true; message.textContent = "Cargando y conectando...";
    try {
      await Promise.all(["assets/leaf-v2.webp", "assets/pests-v2.webp"].map(async src => {
        const image = new Image(); image.src = src; await image.decode();
      }));
      await window.HydroVisionSimulator.start();
      if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen").catch(() => null);
      started = true; await refresh();
    } catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
  });
  document.addEventListener("visibilitychange", () => { dirty = true; acknowledge(); if (!document.hidden) refresh(); });
  window.addEventListener("resize", async () => { dirty = true; await acknowledge(); rendered = null; apply(); });
  document.getElementById("stage").addEventListener("click", () => {
    if (started && banner.hidden) document.getElementById("stage").classList.add("capture-clean");
  });
  const events = new EventSource("/api/simulator/events");
  events.onmessage = event => { current = JSON.parse(event.data); apply(); };
  setInterval(refresh, 2500);
})();

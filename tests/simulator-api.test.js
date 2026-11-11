const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createSimulatorSync } = require("../app/simulator-sync");
const { createSimulatorAPI } = require("../app/simulator-api");

test("simulator HTTP protocol fences revisions, origin, tokens and ready state", async () => {
  const lab = createSimulatorSync();
  const handler = createSimulatorAPI(lab, { port: 4173, capture: async () => {
    const lease = lab.beginCapture();
    try { lab.assertCapture(lease); return { simulator: lease }; } finally { lab.endCapture(); }
  } });
  const server = http.createServer(async (req, res) => {
    if (!await handler(req, res, new URL(req.url, `http://${req.headers.host}`))) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("/api/simulator/capture", {})).status, 409);
    assert.equal((await post("/api/simulator/state", { config: {}, expectedRevision: 1 }, { Origin: "https://untrusted.test" })).status, 403);
    const registration = await (await post("/api/simulator/display", { label: "Prueba HTTP aislada" })).json();
    const state = lab.view();
    const ack = { displayId: registration.id, sessionId: state.sessionId, revision: state.revision,
      visible: true, assetsReady: true, renderProfile: "tablet-leaf-v1", viewport: { width: 1200, height: 800 } };
    assert.equal((await post("/api/simulator/ack", ack, { "X-Display-Token": "wrong" })).status, 403);
    assert.equal((await post("/api/simulator/ack", ack, { "X-Display-Token": registration.token })).status, 200);
    const captured = await (await post("/api/simulator/capture", {})).json();
    assert.equal(captured.capture.simulator.config.yellow, 0);
    assert.equal((await post("/api/simulator/state", { config: { yellow: 20 }, expectedRevision: 1 })).status, 200);
    assert.equal((await post("/api/simulator/capture", {})).status, 409);
    assert.equal((await post("/api/simulator/state", { config: { yellow: 21 }, expectedRevision: 1 })).status, 409);
    const snapshot = await (await fetch(base + "/api/simulator/state")).text();
    assert.ok(!snapshot.includes(registration.token));
    const invalid = await fetch(base + "/api/simulator/state", { method: "POST", body: "{" });
    assert.equal(invalid.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("a LAN display can render and acknowledge but cannot control the PC", async () => {
  const lab = createSimulatorSync();
  const handler = createSimulatorAPI(lab, { port: 4173, capture: () => { throw new Error("Must not capture"); } });
  const { Readable } = require("node:stream");
  const request = Readable.from([Buffer.from(JSON.stringify({ config: { yellow: 90 }, expectedRevision: 1 }))]);
  request.url = "/api/simulator/state"; request.method = "POST";
  request.headers = {}; request.socket = { remoteAddress: "192.0.2.12" };
  let status, body;
  await handler(request, { writeHead: code => { status = code; }, end: data => { body = JSON.parse(data); } }, new URL(request.url, "http://127.0.0.1:4173"));
  assert.equal(status, 403); assert.match(body.error, /solo desde esta PC/);
  assert.equal(lab.view().config.yellow, 0);
});

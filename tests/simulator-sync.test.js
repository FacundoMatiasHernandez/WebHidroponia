const test = require("node:test");
const assert = require("node:assert/strict");
const { createSimulatorSync, validateConfig } = require("../app/simulator-sync");
function setup() {
  let time = 100000;
  const lab = createSimulatorSync({ now: () => time });
  const tablet = lab.register("Tablet de prueba");
  const ack = (extra = {}) => lab.ack(tablet.id, tablet.token, { sessionId: lab.view().sessionId,
    revision: lab.view().revision, visible: true, assetsReady: true, renderProfile: "tablet-leaf-v1", viewport: { width: 1000, height: 700 }, ...extra });
  return { lab, tablet, ack, advance: ms => { time += ms; } };
}
test("simulator validates all fields without silently clamping invalid cases", () => {
  for (const patch of [{ yellow: -1 }, { mites: 101 }, { zoom: 0 }, { rotation: Infinity }, { day: 1.5 },
    { background: "red" }, { chart: "false" }, { unknown: 1 }, { name: "x".repeat(81) }, { yellow: null }, { renderProfile: "old" }]) {
    assert.throws(() => validateConfig(patch));
  }
  assert.equal(validateConfig({ yellow: 25, miners: 10 }).yellow, 25);
});
test("capture requires a freshly rendered visible tablet with loaded assets", () => {
  const { lab, ack, advance } = setup();
  assert.throws(() => lab.beginCapture(), /no confirmo/);
  ack({ visible: false }); assert.throws(() => lab.beginCapture());
  ack({ assetsReady: false }); assert.throws(() => lab.beginCapture());
  ack({ renderProfile: undefined }); assert.throws(() => lab.beginCapture());
  ack({ renderProfile: "old-renderer" }); assert.throws(() => lab.beginCapture());
  ack(); advance(8001); assert.throws(() => lab.beginCapture());
  ack(); assert.equal(lab.beginCapture().config.yellow, 0); lab.endCapture();
});
test("revision fencing rejects stale acknowledgements and conflicting controls", () => {
  const { lab, tablet, ack } = setup();
  const old = lab.view(); ack(); lab.update({ yellow: 30 }, old.revision);
  assert.throws(() => lab.beginCapture());
  assert.throws(() => lab.update({}, old.revision));
  assert.throws(() => lab.ack(tablet.id, tablet.token, { sessionId: old.sessionId, revision: old.revision }));
  ack(); const lease = lab.beginCapture(); assert.equal(lease.config.yellow, 30);
  assert.throws(() => lab.update({ yellow: 40 }, lab.view().revision), /Captura en curso/);
  assert.throws(() => lab.select(tablet.id));
  lab.assertCapture(lease); lab.endCapture(); lab.update({ yellow: 40 }, lab.view().revision);
});
test("hidden or disconnected screens invalidate an in-progress capture", () => {
  const { lab, ack } = setup(); ack(); const lease = lab.beginCapture();
  ack({ visible: false }); assert.throws(() => lab.assertCapture(lease)); lab.endCapture();
});
test("tokens never appear in public state and cannot acknowledge another display", () => {
  const { lab, tablet } = setup(); const other = lab.register("Otra");
  assert.ok(!JSON.stringify(lab.view()).includes(tablet.token));
  assert.throws(() => lab.ack(tablet.id, other.token, {}));
});
test("persistence failure does not publish a new revision", () => {
  const lab = createSimulatorSync({ persist: () => { throw new Error("disk full"); } });
  assert.throws(() => lab.update({ yellow: 20 }, 1));
  assert.equal(lab.view().revision, 1); assert.equal(lab.view().config.yellow, 0);
});
test("a server restart invalidates old display registrations", () => {
  const { lab, tablet, ack } = setup(); ack();
  const restarted = createSimulatorSync({ initial: lab.view().config });
  assert.notEqual(restarted.view().sessionId, lab.view().sessionId);
  assert.throws(() => restarted.ack(tablet.id, tablet.token, {}));
});

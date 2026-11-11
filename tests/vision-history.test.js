const test = require("node:test");
const assert = require("node:assert/strict");
const { retainHistory, historyForTarget } = require("../app/vision-history");

test("tablet captures do not displace the real leaf history", () => {
  const real = { timestamp: "old" };
  const screen = Array.from({ length: 45 }, (_, i) => ({ captureTarget: "screen", timestamp: String(i) }));
  const history = retainHistory([real, ...screen]);
  assert.equal(history.length, 41);
  assert.equal(history[0], real);
  assert.equal(history[1], screen[5]);
  assert.equal(historyForTarget({ history, latest: screen[44] }, "plant").latest, real);
  assert.equal(historyForTarget({ history, latest: real }, "screen").latest, screen[44]);
  assert.deepEqual(historyForTarget(null, "screen"), { latest: null, history: [] });
});

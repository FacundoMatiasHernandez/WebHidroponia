const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const window = { devicePixelRatio: 2 };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/scripts/charts.js"), "utf8"), { window, Intl, Date, Set, Math, Number });
const fixture = () => {
  const calls = [];
  const ctx = Object.fromEntries(["scale", "clearRect", "beginPath", "moveTo", "lineTo", "stroke", "fillText", "arc", "fill"].map(name =>
    [name, (...args) => { assert.ok(args.every(v => typeof v !== "number" || Number.isFinite(v)), name + " received non-finite coordinates"); calls.push([name, ...args]); }]));
  return { canvas: { clientWidth: 360, clientHeight: 320, getContext: () => ctx }, calls };
};
const point = (seconds, value, status = "ok") => ({ value, status, timestamp: new Date(1700000000000 + seconds * 1000).toISOString() });
test("chart scales to device pixels and zero readings are real data", () => {
  const { canvas, calls } = fixture();
  window.HydroVisionCharts.drawLineChart(canvas, [point(0, 0), point(2, 1)], { decimals: 1 });
  assert.equal(canvas.width, 720); assert.equal(canvas.height, 640);
  assert.ok(calls.some(c => c[0] === "arc"));
  assert.equal(window.HydroVisionCharts.drawCamera, undefined);
});
test("chart never bridges missing measurements or long acquisition gaps", () => {
  const { canvas, calls } = fixture();
  window.HydroVisionCharts.drawLineChart(canvas, [point(0, 1), point(2, 2), point(4, null, "error"), point(6, 3), point(40, 4)]);
  // Five grid lines plus the single valid two-point segment; isolated points are dots.
  assert.equal(calls.filter(c => c[0] === "lineTo").length, 6);
  assert.equal(calls.filter(c => c[0] === "arc").length, 3);
});
test("chart displays unavailable state instead of drawing invalid pH", () => {
  const { canvas, calls } = fixture();
  window.HydroVisionCharts.drawLineChart(canvas, [point(0, 27.96, "error")]);
  assert.ok(calls.some(c => c[0] === "fillText" && c[1] === "Sin mediciones disponibles"));
  assert.equal(calls.some(c => c[0] === "arc"), false);
});

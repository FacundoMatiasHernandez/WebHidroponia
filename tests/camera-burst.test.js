const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createFrameParser, collectCameraBurst, withRestoredSettings } = require("../app/camera-burst");
const jpeg = Buffer.from([255, 216, 12, 34, 56, 255, 217]);
const part = (image = jpeg) => Buffer.concat([Buffer.from(`\r\n--camera\r\nContent-Type: image/jpeg\r\nContent-Length: ${image.length}\r\n\r\n`), image]);

test("multipart parser handles every byte boundary and multiple frames", () => {
  const frames = [], parse = createFrameParser((frame) => frames.push(frame));
  const input = Buffer.concat([part(), part()]);
  for (const byte of input) parse(Buffer.from([byte]));
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], jpeg);
});
test("malformed and oversized frames fail closed", () => {
  const parse = createFrameParser(() => {});
  assert.throws(() => parse(Buffer.from("--x\r\nContent-Length: 99999999\r\n\r\n")));
  assert.throws(() => createFrameParser(() => {})(part(Buffer.from([1, 2, 3, 4]))));
});
test("restores all camera settings on failed capture", async () => {
  const status = { led_intensity: 0, framesize: 15, quality: 10 }, original = { ...status };
  await assert.rejects(withRestoredSettings(async () => ({ ...status }), async (k, v) => { status[k] = v; },
    { framesize: 19, quality: 4, led_intensity: 96 }, async () => { throw new Error("offline"); }), /offline/);
  assert.deepEqual(status, original);
});
test("a control timeout also restores the possibly applied setting", async () => {
  const status = { led_intensity: 0 };
  await assert.rejects(withRestoredSettings(async () => ({ ...status }), async (k, v) => {
    status[k] = v; if (v === 96) throw new Error("timeout");
  }, { led_intensity: 96 }, async () => null), /timeout/);
  assert.equal(status.led_intensity, 0);
});
test("restoration failure is visible, never silently successful", async () => {
  await assert.rejects(withRestoredSettings(async () => ({ led_intensity: 0 }), async (k, v) => {
    if (v === 0) throw new Error("offline");
  }, { led_intensity: 96 }, async () => []), /restaurar/);
});
test("unknown prior settings are not changed", async () => {
  let changes = 0;
  await assert.rejects(withRestoredSettings(async () => ({}), async () => changes++, { led_intensity: 96 }, async () => []));
  assert.equal(changes, 0);
});
test("burst discards warmup frames and closes the connection", async () => {
  let closed = false;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "multipart/x-mixed-replace;boundary=camera" });
    const timer = setInterval(() => res.write(part()), 15);
    res.on("close", () => { clearInterval(timer); closed = true; });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const frames = await collectCameraBurst(`http://127.0.0.1:${server.address().port}`, { warmupMs: 0, discardFrames: 3, count: 3, timeoutMs: 2000 });
    assert.equal(frames.length, 3);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(closed, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test("a disconnected burst rejects instead of hanging", async () => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end(part()); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(collectCameraBurst(`http://127.0.0.1:${server.address().port}`, { warmupMs: 0, timeoutMs: 500 }), /ended|disconnected/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("screen detail controls and disabled flash apply during capture and restore after failure", async () => {
  const status = { sharpness: 1, denoise: 0, quality: 12, ae_level: -1, led_intensity: 0 };
  const original = { ...status };
  const settings = { sharpness: 2, denoise: 1, quality: 8, ae_level: -3, led_intensity: 0 };
  await assert.rejects(withRestoredSettings(async () => ({ ...status }), async (key, value) => {
    status[key] = value;
  }, settings, async () => {
    assert.deepEqual(status, settings);
    throw new Error("capture failed");
  }), /capture failed/);
  assert.deepEqual(status, original);
});

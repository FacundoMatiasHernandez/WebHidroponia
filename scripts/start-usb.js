const { spawn } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => {
    if (child.connected) child.send("shutdown");
    else child.kill();
  });
  setTimeout(() => children.forEach(child => child.kill()), 1500).unref();
  process.exitCode = code;
}
for (const file of ["server.js", "scripts/esp32-usb-bridge.js"]) {
  const child = spawn(process.execPath, ["--env-file-if-exists=.env.camera.local", "--env-file-if-exists=.env.usb.local", file], {
    cwd: root, env: { ...process.env, DATA_MODE: "esp32-usb" }, windowsHide: true, stdio: ["ignore", "inherit", "inherit", "ipc"]
  });
  children.push(child);
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code || 1); });
}
process.on("SIGINT", () => stop()); process.on("SIGTERM", () => stop());

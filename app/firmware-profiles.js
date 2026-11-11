// Audited against the user's TESIS_HUERTA_J17.ino; do not apply to unknown firmware.
const J17 = Object.freeze({ id: "tesis-huerta-j17", tdsFactor: 0.5, phPin: 1, tdsPin: 2,
  lowPh: 2.8, highPh: 8.3, lowVoltage: 3.243, highVoltage: 2.534 });
function enrichJ17(readings) {
  const tds = readings.get("water-tds"), ph = readings.get("water-ph");
  const slope = (J17.highPh - J17.lowPh) / (J17.highVoltage - J17.lowVoltage);
  const zeroPh = J17.lowPh - slope * J17.lowVoltage;
  if (Number.isFinite(ph?.value)) {
    ph.calibration = "pending";
    ph.note = Math.abs(ph.value - zeroPh) < 0.02
      ? "La formula J17 da este pH con entrada cercana a 0 V en GPIO1. Es una inferencia: comprobar senal y alimentacion."
      : "pH calculado con la calibracion heredada del .ino; requiere validacion con soluciones patron.";
  }
  if (tds && Number.isFinite(tds.value) && !["error", "missing", "stale"].includes(tds.status) && tds.value >= 0 && tds.value <= 50000) {
    tds.calibration = "pending";
    tds.note = "TDS informado por J17 con factor 0.5; lectura sin calibracion verificada.";
    readings.set("water-ec", { sensorId: "water-ec", value: tds.value / J17.tdsFactor / 1000,
      quality: "estimated", derivedFrom: "water-tds", conversionFactor: J17.tdsFactor,
      note: "EC estimada = TDS / 500 segun J17. TDS llega redondeado a 1 ppm; EC tiene hasta 0.001 mS/cm de redondeo. Requiere calibracion." });
  } else {
    readings.set("water-ec", { sensorId: "water-ec", value: null, status: "error",
      note: "No hay TDS valido para calcular EC; no se usa la ultima lectura ni se sustituye por cero." });
  }
}
module.exports = { J17, enrichJ17 };

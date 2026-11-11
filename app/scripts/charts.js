(function buildCharts(global) {
  function drawLineChart(canvas, points, options = {}) {
    const width = Math.max(260, canvas.clientWidth), height = Math.max(220, canvas.clientHeight);
    const ratio = global.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);
    const pad = { left: width < 500 ? 48 : 62, right: 20, top: 22, bottom: 38 };
    const plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom;
    const invalid = new Set(["missing", "stale", "error", "unsupported", "uncalibrated"]);
    const data = points.filter(p => Number.isFinite(Date.parse(p.timestamp))).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const valid = data.filter(p => Number.isFinite(p.value) && !invalid.has(p.status));
    ctx.font = "11px 'IBM Plex Mono', monospace";
    if (!valid.length) {
      ctx.fillStyle = "#768078"; ctx.textAlign = "center";
      ctx.fillText("Sin mediciones disponibles", width / 2, height / 2); return;
    }
    const low = Math.min(...valid.map(p => p.value)), high = Math.max(...valid.map(p => p.value));
    const margin = Math.max((high - low) * .15, Math.abs(high) * .025, .1);
    const min = low - margin, max = high + margin;
    const start = Date.parse(data[0].timestamp), end = Date.parse(data.at(-1).timestamp);
    const x = p => pad.left + (end === start ? .5 : (Date.parse(p.timestamp) - start) / (end - start)) * plotWidth;
    const y = p => pad.top + (max - p.value) / (max - min) * plotHeight;
    const number = new Intl.NumberFormat("es-AR", { maximumFractionDigits: options.decimals ?? 1 });
    for (let i = 0; i <= 4; i++) {
      const py = pad.top + plotHeight * i / 4;
      ctx.strokeStyle = "#e8ece7"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(width - pad.right, py); ctx.stroke();
      ctx.fillStyle = "#768078"; ctx.textAlign = "right"; ctx.fillText(number.format(max - (max - min) * i / 4), pad.left - 10, py + 4);
    }
    const clock = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const labelCount = width < 500 ? 2 : 4;
    for (let i = 0; i <= labelCount; i++) {
      ctx.textAlign = i === 0 ? "left" : i === labelCount ? "right" : "center";
      ctx.fillText(clock.format(new Date(start + (end - start) * i / labelCount)), pad.left + plotWidth * i / labelCount, height - 12);
    }
    // Break the line at missing readings and long acquisition gaps.
    const segments = []; let segment = [], previous = null;
    for (const point of data) {
      if (!Number.isFinite(point.value) || invalid.has(point.status)) {
        if (segment.length) segments.push(segment); segment = []; previous = null; continue;
      }
      if (previous && Date.parse(point.timestamp) - Date.parse(previous.timestamp) > 15000) { segments.push(segment); segment = []; }
      segment.push(point); previous = point;
    }
    if (segment.length) segments.push(segment);
    for (const entries of segments) {
      ctx.beginPath(); entries.forEach((p, i) => { if (i) ctx.lineTo(x(p), y(p)); else ctx.moveTo(x(p), y(p)); });
      ctx.strokeStyle = options.color || "#4c805b"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
      if (entries.length === 1) { ctx.beginPath(); ctx.arc(x(entries[0]), y(entries[0]), 3, 0, Math.PI * 2); ctx.fillStyle = options.color || "#4c805b"; ctx.fill(); }
    }
    const last = valid.at(-1); ctx.beginPath(); ctx.arc(x(last), y(last), 4, 0, Math.PI * 2); ctx.fillStyle = options.color || "#4c805b"; ctx.fill();
  }
  global.HydroVisionCharts = { drawLineChart };
})(window);

(function exposeTabletProfile(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HydroVisionTabletProfile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTabletProfile() {
  "use strict";
  const VERSION = "tablet-leaf-v1";
  // These are enlarged educational signatures, not realistic species recognition.
  const PALETTE = [
    { id: "green", label: "Tejido verde", rgb: [54, 145, 69] },
    { id: "yellow", label: "Amarillamiento", rgb: [221, 181, 36] },
    { id: "aphids", label: "Colonias oscuras / pulgones simulados", rgb: [111, 59, 28] },
    { id: "whitefly", label: "Marcas blancas / mosca blanca simulada", rgb: [235, 237, 224] },
    { id: "mites", label: "Puntos rojizos / acaros simulados", rgb: [202, 57, 43] },
    { id: "thrips", label: "Trazos plateados / trips simulados", rgb: [159, 144, 205] },
    { id: "miners", label: "Galerias claras / minadores simulados", rgb: [226, 204, 153] },
    { id: "caterpillars", label: "Perforaciones oscuras / orugas simuladas", rgb: [23, 33, 40] },
    { id: "background", label: "Referencia neutra", rgb: [96, 96, 96] }
  ];
  const MARKER = [232, 46, 217];
  const css = rgb => `rgb(${rgb.join(",")})`;
  function prepare(source, width, height) {
    const data = new Uint8ClampedArray(source), rows = [];
    let widest = 0;
    for (let y = 0; y < height; y++) {
      let lo = width, hi = -1;
      for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 160) { lo = Math.min(lo, x); hi = x; }
      rows.push([lo, hi]); widest = Math.max(widest, hi - lo + 1);
    }
    const ranked = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, offset = i * 4;
      if (rows[y][1] - rows[y][0] < widest * 0.17 || data[offset + 3] < 160) { data[offset + 3] = 0; continue; }
      const score = Math.sin(x / width * 13) + Math.cos(y / height * 19)
        + 0.55 * Math.sin((x + y) / width * 9) + y / height * 0.4;
      ranked.push({ i, score });
    }
    ranked.sort((a, b) => a.score - b.score);
    return { data, width, height, ranked };
  }
  function tissue(template, yellow) {
    const data = new Uint8ClampedArray(template.data);
    const count = Math.round(template.ranked.length * Math.min(100, Math.max(0, yellow)) / 100);
    const yellowSet = new Uint8Array(template.width * template.height);
    for (let j = 0; j < count; j++) yellowSet[template.ranked[j].i] = 1;
    for (const { i } of template.ranked) {
      const offset = i * 4;
      const lum = (data[offset] + data[offset + 1] * 2 + data[offset + 2]) / 4;
      const shade = 0.90 + Math.min(1, lum / 180) * 0.17;
      const color = PALETTE[yellowSet[i] ? 1 : 0].rgb;
      for (let c = 0; c < 3; c++) data[offset + c] = color[c] * shade;
    }
    return data;
  }
  function drawDamage(ctx, config, point) {
    for (let kind = 2; kind <= 7; kind++) {
      const item = PALETTE[kind], value = config[item.id];
      if (!(value > 0)) continue;
      const side = kind % 2 ? 1 : -1, t = 0.30 + Math.floor((kind - 2) / 2) * 0.17;
      const anchor = point(t, side, 0.43), count = Math.ceil(value / 14);
      ctx.fillStyle = ctx.strokeStyle = css(item.rgb); ctx.lineCap = "round";
      for (let j = 0; j < count; j++) {
        const x = anchor.x + (j % 3 - 1) * 23, y = anchor.y + (Math.floor(j / 3) - 1) * 23;
        ctx.beginPath();
        if (item.id === "miners") {
          ctx.lineWidth = 7; ctx.moveTo(x - 13, y + 8);
          ctx.bezierCurveTo(x - 22, y - 18, x + 22, y + 18, x + 12, y - 10); ctx.stroke();
        } else {
          const rx = item.id === "caterpillars" ? 10 : item.id === "whitefly" ? 9 : item.id === "thrips" ? 4 : 6;
          const ry = item.id === "thrips" ? 11 : item.id === "whitefly" ? 5 : rx;
          ctx.ellipse(x, y, rx, ry, 0.3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }
  function drawReferences(ctx, width, height, leafBottom) {
    const size = Math.min(width * 0.068, height * 0.042), count = PALETTE.length + 2;
    const x = (width - size * count) / 2, y = Math.min(height - size * 1.5, leafBottom + size * 0.4);
    ctx.fillStyle = "#303030"; ctx.fillRect(x - size * 0.15, y - size * 0.15, size * (count + 0.3), size * 1.3);
    [MARKER, ...PALETTE.map(item => item.rgb), MARKER].forEach((color, index) => {
      ctx.fillStyle = css(color); ctx.fillRect(x + index * size + size * 0.05, y, size * 0.9, size);
    });
  }
  return { VERSION, PALETTE, MARKER, prepare, tissue, drawDamage, drawReferences };
});

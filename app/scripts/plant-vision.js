(function exposePlantVision(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./tablet-profile") : root.HydroVisionTabletProfile);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HydroVisionPlant = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlantVision(tabletProfile) {
  "use strict";
  const VERSION = "leaf-pixel-v4.7";
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const median = (values) => {
    if (!values.length) return 0;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };

  function integral(values, width, height) {
    const stride = width + 1;
    const out = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        row += values[y * width + x];
        out[(y + 1) * stride + x + 1] = out[y * stride + x + 1] + row;
      }
    }
    return (x, y, radius) => {
      const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius);
      const x1 = Math.min(width, x + radius + 1), y1 = Math.min(height, y + radius + 1);
      return out[y1 * stride + x1] - out[y0 * stride + x1] - out[y1 * stride + x0] + out[y0 * stride + x0];
    };
  }

  function morphology(mask, width, height, radius, erode) {
    const sum = integral(mask, width, height);
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const area = (Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1)
          * (Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1);
        out[y * width + x] = erode ? +(sum(x, y, radius) === area) : +(sum(x, y, radius) > 0);
      }
    }
    return out;
  }

  function components(mask, width, height) {
    const labels = new Int32Array(mask.length);
    const queue = new Int32Array(mask.length);
    const items = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      const id = items.length + 1;
      let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0;
      queue[0] = start;
      labels[start] = id;
      while (head < tail) {
        const i = queue[head++], x = i % width, y = Math.floor(i / width);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy, next = ny * width + nx;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || labels[next] || !mask[next]) continue;
            labels[next] = id;
            queue[tail++] = next;
          }
        }
      }
      items.push({ id, pixels: tail, x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
    }
    return { labels, items };
  }

  function measureDetail(brightness, mask, width, height) {
    // Smooth before measuring fine detail so sensor noise and leaf silhouettes weigh less.
    const safe = morphology(mask, width, height, 4, true);
    const sum = integral(brightness, width, height);
    const smooth = new Float32Array(mask.length);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      smooth[y * width + x] = sum(x, y, 1) / 9;
    }
    let energy = 0, count = 0;
    for (let y = 4; y < height - 4; y += 2) for (let x = 4; x < width - 4; x += 2) {
      const i = y * width + x;
      if (!safe[i]) continue;
      const laplacian = smooth[i - 2] + smooth[i + 2] + smooth[i - width * 2] + smooth[i + width * 2] - 4 * smooth[i];
      energy += laplacian * laplacian; count++;
    }
    return { value: count >= 25 ? +(Math.sqrt(energy / count) * 255).toFixed(2) : null, samples: count };
  }

  function analyze(data, width, height, options = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16
        || width * height > 4000000 || data.length !== width * height * 4) throw new Error("Invalid image dimensions");
    const n = width * height;
    const roi = options.roi || { x: 0, y: 0, width: 1, height: 1 };
    if (![roi.x, roi.y, roi.width, roi.height].every(Number.isFinite) || roi.width <= 0 || roi.height <= 0
        || roi.x < 0 || roi.y < 0 || roi.x + roi.width > 1 + 1e-9 || roi.y + roi.height > 1 + 1e-9) {
      throw new Error("Invalid leaf region");
    }
    if (options.profile === "tablet-leaf-v1") return analyzeTablet(data, width, height, options);
    const inRegion = (x, y) => x >= roi.x * width && y >= roi.y * height
      && x < (roi.x + roi.width) * width && y < (roi.y + roi.height) * height;
    // Estimate the illuminant only from bright, near-neutral background samples.
    const whites = [[], [], []];
    for (let i = 0; i < n; i += 13) {
      const x = i % width, y = Math.floor(i / width);
      if (x > width * 0.12 && x < width * 0.88 && y > height * 0.12 && y < height * 0.88) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      if (lo > 145 && hi < 253 && hi - lo < 40 && r >= g * 0.94 && b >= g * 0.94) {
        whites[0].push(r); whites[1].push(g); whites[2].push(b);
      }
    }
    const neutral = whites[0].length > 100 ? whites.map(median) : [220, 220, 220];
    const gray = (neutral[0] + neutral[1] + neutral[2]) / 3;
    const gains = neutral.map((v) => clamp(gray / v, 0.8, 1.25));
    const redRatio = new Float32Array(n), blueRatio = new Float32Array(n);
    const brightness = new Float32Array(n), saturation = new Float32Array(n);
    const green = new Uint8Array(n), greenContext = new Uint8Array(n), background = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4] * gains[0], g = data[i * 4 + 1] * gains[1], b = data[i * 4 + 2] * gains[2];
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      redRatio[i] = r / Math.max(g, 1); blueRatio[i] = b / Math.max(g, 1);
      brightness[i] = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
      saturation[i] = hi ? (hi - lo) / hi : 0;
      background[i] = 0;
      greenContext[i] = +(redRatio[i] < 0.97 && blueRatio[i] < 0.98 && redRatio[i] + blueRatio[i] < 1.84
        && saturation[i] > 0.09 && brightness[i] > 0.055);
      green[i] = +(greenContext[i] && inRegion(i % width, Math.floor(i / width)));
    }
    // Remove thin stems before reconstructing broad leaf surfaces, irrespective of position.
    const radius = Math.max(1, Math.round(width / 90));
    const core = morphology(green, width, height, radius, true);
    const opened = morphology(core, width, height, radius, false);
    // Learn common non-leaf colours away from the plant; holes can reveal this same background.
    const away = morphology(green, width, height, radius * 3, false);
    const histogram = new Map();
    for (let i = 0; i < n; i += 4) {
      if (away[i]) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      const bucket = histogram.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b; histogram.set(key, bucket);
    }
    const backdrop = [];
    for (const v of [...histogram.values()].filter((bucket) => bucket.count > n * 0.0008).sort((a, b) => b.count - a.count)) {
      const color = [v.r / v.count, v.g / v.count, v.b / v.count];
      if (backdrop.every((other) => color.reduce((sum, channel, i) => sum + (channel - other[i]) ** 2, 0) > 900)) backdrop.push(color);
      if (backdrop.length >= 12) break;
    }
    for (let i = 0; i < n; i++) {
      if (green[i]) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const tolerance = brightness[i] < 0.62 ? 600 : 225;
      if (backdrop.some((v) => (r - v[0]) ** 2 + (g - v[1]) ** 2 + (b - v[2]) ** 2 < tolerance)) background[i] = 1;
    }
    const groups = components(opened, width, height);
    const minArea = Math.max(35, n * 0.002);
    const accepted = new Set(groups.items.filter((c) => c.pixels >= minArea
      && c.pixels / (c.width * c.height) > 0.24
      && Math.min(c.width, c.height) >= radius * 3 && Math.max(c.width, c.height) / Math.min(c.width, c.height) < 9).map((c) => c.id));
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = +(accepted.has(groups.labels[i]) && green[i]);
    // A closed surface can contain non-green damage. Background-coloured holes stay excluded.
    const closed = morphology(morphology(mask, width, height, radius * 3, false), width, height, radius * 3, true);
    const nearby = morphology(mask, width, height, radius * 2, false);
    for (let i = 0; i < n; i++) {
      if (!inRegion(i % width, Math.floor(i / width)) || background[i]) continue;
      if (closed[i] || (nearby[i] && (green[i] || (redRatio[i] > 0.93 && blueRatio[i] < 0.97 && saturation[i] > 0.065)))) mask[i] = 1;
    }
    const interior = morphology(mask, width, height, Math.max(1, radius), true);
    // Yellow tissue can lie outside the green reconstruction. Keep it separate from spot and growth masks.
    const yellowRaw = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      yellowRaw[i] = +(redRatio[i] > 1.02 && redRatio[i] < 1.48
        && blueRatio[i] < 0.86 && saturation[i] > 0.18 && brightness[i] > 0.38 && brightness[i] < 0.94);
    }
    const yellowCore = morphology(morphology(yellowRaw, width, height, Math.max(1, Math.round(width / 300)), true),
      width, height, Math.max(1, Math.round(width / 300)), false);
    const yellowGroups = components(yellowCore, width, height);
    const contextOpened = options.roi ? morphology(morphology(greenContext, width, height, radius, true), width, height, radius, false) : opened;
    const nearFoliage = morphology(contextOpened, width, height, Math.max(4, Math.round(width * 0.08)), false);
    const yellowCandidates = new Uint8Array(n), yellowRegions = [], yellowDiagnostics = [];
    let yellowOutsidePixels = 0;
    for (const c of yellowGroups.items) {
      const compactness = c.pixels / (c.width * c.height);
      if (c.pixels < Math.max(40, n * 0.0015) || Math.min(c.width, c.height) < Math.max(4, width * 0.015)
          || compactness < 0.18 || compactness > 0.9 || Math.max(c.width, c.height) / Math.min(c.width, c.height) > 8) {
        if (c.pixels > 100) yellowDiagnostics.push({ pixels: c.pixels, compactness, reason: "shape" });
        continue;
      }
      let nearbyPixels = 0, clippedPixels = 0, insidePixels = 0;
      for (let y = c.y; y < c.y + c.height; y++) for (let x = c.x; x < c.x + c.width; x++) {
        const i = y * width + x;
        if (yellowGroups.labels[i] !== c.id) continue;
        nearbyPixels += nearFoliage[i];
        insidePixels += +inRegion(x, y);
        clippedPixels += +(Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) >= 252);
      }
      // A large yellow leaf can touch green tissue along only a short edge.
      if (nearbyPixels < Math.max(20, Math.min(c.pixels * 0.1, Math.min(c.width, c.height) * 2))) {
        yellowDiagnostics.push({ pixels: c.pixels, nearbyPixels, reason: "isolated" }); continue;
      }
      yellowOutsidePixels += c.pixels - insidePixels;
      if (!insidePixels) continue;
      const evaluable = clippedPixels / c.pixels <= 0.1;
      yellowDiagnostics.push({ pixels: c.pixels, clippedFraction: clippedPixels / c.pixels, reason: evaluable ? "candidate" : "clipped-channel" });
      for (let y = c.y; y < c.y + c.height; y++) for (let x = c.x; x < c.x + c.width; x++) {
        const i = y * width + x;
        if (yellowGroups.labels[i] === c.id && inRegion(x, y)) yellowCandidates[i] = evaluable ? 1 : 2;
      }
      yellowRegions.push({ id: c.id, x: c.x / width, y: c.y / height, width: c.width / width, height: c.height / height,
        pixels: insidePixels, evaluable });
    }
    const leafGroups = components(mask, width, height);
    const reference = new Map();
    for (const c of leafGroups.items) reference.set(c.id, { r: [], b: [], light: [] });
    let leafPixels = 0, lightSum = 0, satSum = 0, dark = 0, clipped = 0;
    let xSum = 0, ySum = 0, edgeEnergy = 0, edgeCount = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const x = i % width, y = Math.floor(i / width);
      leafPixels++; lightSum += brightness[i]; satSum += saturation[i];
      xSum += x; ySum += y;
      dark += +(brightness[i] < 0.09);
      clipped += +(Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) >= 252);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      const ref = reference.get(leafGroups.labels[i]);
      if (green[i] && i % 3 === 0) { ref.r.push(redRatio[i]); ref.b.push(blueRatio[i]); ref.light.push(brightness[i]); }
      if (x > 1 && y > 1 && x < width - 2 && y < height - 2 && interior[i]) {
        const dx = brightness[i + 2] - brightness[i - 2], dy = brightness[i + width * 2] - brightness[i - width * 2];
        edgeEnergy += dx * dx + dy * dy; edgeCount++;
      }
    }
    for (const [id, ref] of reference) reference.set(id, { r: median(ref.r) || 0.8, b: median(ref.b) || 0.7, light: median(ref.light) || 0.4 });
    const referenceMask = new Uint8Array(n), referenceRed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (mask[i] && green[i] && redRatio[i] < 0.94) {
        referenceMask[i] = 1; referenceRed[i] = redRatio[i];
      }
    }
    const nearbyCount = integral(referenceMask, width, height), nearbyRed = integral(referenceRed, width, height);
    const referenceRadius = Math.max(6, Math.round(width / 25));
    const raw = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const ref = reference.get(leafGroups.labels[i]);
      const x = i % width, y = Math.floor(i / width), count = nearbyCount(x, y, referenceRadius);
      const localRed = count > 25 ? nearbyRed(x, y, referenceRadius) / count : ref.r;
      const referenceR = Math.max(ref.r - 0.03, localRed);
      const warm = redRatio[i] > Math.max(0.88, referenceR + 0.10) && blueRatio[i] < 0.97 && saturation[i] > 0.07;
      const yellow = redRatio[i] > Math.max(0.94, referenceR + 0.15) && blueRatio[i] < Math.min(0.76, ref.b - 0.08);
      const neutralDark = interior[i] && brightness[i] < ref.light * 0.68 && redRatio[i] > ref.r + 0.13
        && blueRatio[i] > ref.b + 0.06 && saturation[i] < 0.3;
      // Darker green alone is a shadow, not evidence of a lesion.
      const brighterThanLeaf = brightness[i] > ref.light * 1.18 && saturation[i] < 0.35;
      if (!brighterThanLeaf && (warm || yellow || neutralDark)) raw[i] = 1;
    }
    const support = integral(raw, width, height);
    const clean = new Uint8Array(n);
    for (let i = 0; i < n; i++) clean[i] = +(raw[i] && support(i % width, Math.floor(i / width), 1) >= 4);
    const patches = components(clean, width, height);
    const regions = [], candidates = new Uint8Array(n);
    const minimumPatch = Math.max(8, n * 0.00003);
    const kept = new Set();
    for (const c of patches.items) {
      if (c.pixels < minimumPatch || Math.min(c.width, c.height) < 2) continue;
      const aspect = Math.max(c.width, c.height) / Math.min(c.width, c.height);
      if (aspect > 12) continue;
      kept.add(c.id);
      regions.push({ ...c, x: c.x / width, y: c.y / height, width: c.width / width, height: c.height / height });
    }
    let suspectPixels = 0;
    for (let i = 0; i < n; i++) if (kept.has(patches.labels[i])) { candidates[i] = 1; suspectPixels++; }
    const averageBrightness = leafPixels ? lightSum / leafPixels * 100 : 0;
    const sharpness = edgeCount ? Math.sqrt(edgeEnergy / edgeCount) * 255 : 0;
    const issues = [];
    if (leafPixels < Math.max(150, n * 0.003)) issues.push("insufficient-leaf");
    if (leafPixels && (averageBrightness < 17 || dark / leafPixels > 0.25)) issues.push("underexposed");
    if (leafPixels && (averageBrightness > 88 || clipped / leafPixels > 0.1)) issues.push("overexposed");
    if (leafPixels && sharpness < 3.5) issues.push("blurred");
    const qualityScore = issues.length ? Math.min(44, Math.round(sharpness * 15))
      : Math.round(clamp(55 + sharpness * 5 - Math.abs(averageBrightness - 48) * 0.25, 45, 95));
    const signature = new Float32Array(32 * 24), cells = new Uint32Array(signature.length);
    for (let i = 0; i < n; i += 3) {
      const cell = Math.min(23, Math.floor(Math.floor(i / width) * 24 / height)) * 32
        + Math.min(31, Math.floor((i % width) * 32 / width));
      signature[cell] += brightness[i]; cells[cell]++;
    }
    for (let i = 0; i < signature.length; i++) signature[i] /= Math.max(1, cells[i]);
    const detailMask = Uint8Array.from(mask, (value, i) => +(value || yellowCandidates[i]));
    const detail = measureDetail(brightness, detailMask, width, height);
    return {
      width, height, mask, candidates, regions, signature, yellowCandidates, yellowRegions, yellowLabels: yellowGroups.labels, roi: options.roi || null,
      yellowDiagnostics, yellowOutsidePixels,
      leafPixels, suspectPixels, quality: { usable: issues.length === 0, issues, score: qualityScore, sharpness: +sharpness.toFixed(2), detail },
      averageBrightness: +averageBrightness.toFixed(2), averageSaturation: leafPixels ? satSum / leafPixels * 100 : 0,
      plantAreaPercent: leafPixels / n * 100, suspectSpotPercent: leafPixels ? suspectPixels / leafPixels * 100 : null,
      centroid: leafPixels ? { x: xSum / leafPixels / width, y: ySum / leafPixels / height } : null,
      boundingBox: leafPixels ? { x: minX / width, y: minY / height, width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height } : null,
      gains
    };
  }

  function analyzeTablet(data, width, height, options) {
    const n = width * height, blank = () => new Uint8Array(n), roi = options.roi || { x: 0, y: 0, width: 1, height: 1 };
    const brightness = Float32Array.from({ length: n }, (_, i) =>
      (data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722) / 255);
    const signature = new Float32Array(32 * 24), cells = new Uint32Array(signature.length);
    for (let i = 0; i < n; i += 3) {
      const cell = Math.min(23, Math.floor(Math.floor(i / width) * 24 / height)) * 32 + Math.min(31, Math.floor(i % width * 32 / width));
      signature[cell] += brightness[i]; cells[cell]++;
    }
    signature.forEach((v, i) => { signature[i] = v / Math.max(1, cells[i]); });
    const result = { width, height, profile: "tablet-leaf-v1", mask: blank(), candidates: blank(), regions: [], signature,
      yellowCandidates: blank(), yellowRegions: [], yellowLabels: new Int32Array(n), yellowOutsidePixels: 0,
      leafPixels: 0, suspectPixels: 0, plantAreaPercent: 0, suspectSpotPercent: null, averageBrightness: 0,
      centroid: null, boundingBox: null, roi: options.roi || null, patternCandidates: {},
      quality: { usable: false, issues: ["tablet-reference-missing"], score: 0, sharpness: 0, detail: { value: null, samples: 0 } } };
    if (!tabletProfile) return result;
    const magenta = blank();
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      magenta[i] = +(r > 70 && b > 70 && r > g * 1.4 && b > g * 1.4 && Math.abs(r - b) < 95);
    }
    const markers = components(magenta, width, height).items.filter(c => c.pixels > Math.max(15, n * 0.00002)
      && Math.min(c.width, c.height) >= 4 && c.pixels / (c.width * c.height) > 0.5
      && c.x > 1 && c.y > 1 && c.x + c.width < width - 1 && c.y + c.height < height - 1)
      .sort((a, b) => b.pixels - a.pixels).slice(0, 8);
    let pair, rank = 0;
    for (let i = 0; i < markers.length; i++) for (let j = i + 1; j < markers.length; j++) {
      const a = markers[i], b = markers[j], dx = b.x + b.width / 2 - a.x - a.width / 2, dy = b.y + b.height / 2 - a.y - a.height / 2;
      const distance = Math.hypot(dx, dy), step = distance / (tabletProfile.PALETTE.length + 1);
      const size = Math.sqrt((a.pixels + b.pixels) / 2);
      if (distance > width * 0.18 && step > size * 0.7 && step < size * 1.9 && a.pixels / b.pixels < 2.2
          && a.pixels + b.pixels > rank) { pair = [a, b]; rank = a.pixels + b.pixels; }
    }
    if (!pair) return result;
    const center = c => ({ x: c.x + c.width / 2, y: c.y + c.height / 2 });
    // The strip is ordered left-to-right (or top-to-bottom if the camera is rotated).
    pair.sort((a, b) => Math.abs(a.x - b.x) > Math.abs(a.y - b.y) ? a.x - b.x : a.y - b.y);
    const a = center(pair[0]), b = center(pair[1]), dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    const radius = Math.max(1, Math.floor(Math.min(...pair.map(c => Math.min(c.width, c.height))) * 0.16));
    const sample = (x, y) => {
      const colors = [[], [], []];
      for (let yy = Math.round(y) - radius; yy <= Math.round(y) + radius; yy++) for (let xx = Math.round(x) - radius; xx <= Math.round(x) + radius; xx++) {
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        for (let c = 0; c < 3; c++) colors[c].push(data[(yy * width + xx) * 4 + c]);
      }
      return colors.map(values => median(values));
    };
    let references = tabletProfile.PALETTE.map((_, i) => sample(a.x + dx * (i + 1) / 10, a.y + dy * (i + 1) / 10));
    const greenReference = color => color[1] > color[0] * 1.15 && color[1] > color[2] * 1.15;
    if (!greenReference(references[0]) && greenReference(references[8])) references.reverse();
    const distance = (u, v) => u.reduce((sum, value, c) => sum + (value - v[c]) ** 2, 0);
    if (!greenReference(references[0]) || references[1][0] < references[1][2] * 1.4
        || references.some((color, i) => references.slice(i + 1).some(other => distance(color, other) < 180))) {
      result.quality.issues = ["tablet-reference-invalid"]; return result;
    }
    result.calibration = { profile: tabletProfile.VERSION, references };
    const classes = new Int8Array(n).fill(-1), leafColors = blank();
    const totals = references.map(color => Math.max(1, color[0] + color[1] + color[2]));
    const normalized = references.map((color, i) => color.map(v => v / totals[i]));
    const band = Math.max(...pair.map(c => Math.max(c.width, c.height))) * 0.85;
    for (let i = 0; i < n; i++) {
      const x = i % width, y = Math.floor(i / width), t = ((x - a.x) * dx + (y - a.y) * dy) / length2;
      const perpendicular = Math.abs((x - a.x) * dy - (y - a.y) * dx) / Math.sqrt(length2);
      if ((t > -0.08 && t < 1.08 && perpendicular < band) || x < roi.x * width || y < roi.y * height
          || x >= (roi.x + roi.width) * width || y >= (roi.y + roi.height) * height) continue;
      const color = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      const total = Math.max(1, color.reduce((sum, v) => sum + v, 0));
      let closest = -1, best = 0.015;
      normalized.forEach((reference, kind) => {
        const refTotal = totals[kind];
        // Screen brightness varies across the photographed panel; chromaticity is more stable.
        const d = color.reduce((sum, v, c) => sum + (v / total - reference[c]) ** 2, 0)
          + 0.025 * ((total - refTotal) / 765) ** 2;
        if (d < best) { best = d; closest = kind; }
      });
      if (total < totals[8] * 0.8) {
        const dark = [2, 7].map(kind => ({ kind, d: distance(color, references[kind]) })).sort((a, b) => a.d - b.d)[0];
        if (dark.d < 2500) closest = dark.kind;
      }
      const rg = color[0] / Math.max(1, color[1]);
      const yellowRG = references[1][0] / Math.max(1, references[1][1]);
      const brownRG = references[2][0] / Math.max(1, references[2][1]);
      const redRG = references[4][0] / Math.max(1, references[4][1]);
      if (rg > yellowRG * 1.13 && rg < (brownRG + redRG) / 2 && color[2] < color[1] * 1.25) closest = 2;
      classes[i] = closest; leafColors[i] = +(closest === 0 || closest === 1);
    }
    const joined = morphology(morphology(leafColors, width, height, 2, false), width, height, 2, true);
    const groups = components(joined, width, height), leaf = groups.items.sort((a, b) => b.pixels - a.pixels)[0];
    if (!leaf || leaf.pixels < n * 0.008) { result.quality.issues = ["insufficient-leaf"]; return result; }
    const mask = blank();
    for (let i = 0; i < n; i++) mask[i] = +(groups.labels[i] === leaf.id);
    // Fill enclosed damage inside the blade, not the calibration strip or a petiole.
    const outside = blank(), queue = new Int32Array(n); let head = 0, tail = 0;
    const visit = i => { if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
    while (head < tail) {
      const i = queue[head++], x = i % width;
      if (x) visit(i - 1); if (x < width - 1) visit(i + 1);
      if (i >= width) visit(i - width); if (i < n - width) visit(i + width);
    }
    for (let i = 0; i < n; i++) mask[i] = +!outside[i];
    const inside = morphology(mask, width, height, 2, true), yellow = blank(), candidates = blank();
    const patterns = Object.fromEntries(tabletProfile.PALETTE.slice(2, 8).map(item => [item.id, blank()]));
    let pixels = 0, light = 0, sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      pixels++; light += brightness[i]; sx += i % width; sy += Math.floor(i / width);
      if (inside[i] && classes[i] === 1) yellow[i] = 1;
      if (inside[i] && classes[i] >= 2 && classes[i] <= 7) {
        candidates[i] = 1; patterns[tabletProfile.PALETTE[classes[i]].id][i] = 1;
      }
    }
    // Defocus blends a coloured core into a different palette at its rim.
    // Attribute that narrow fringe to the adjacent core, not a second simulated pest.
    const contexts = Object.fromEntries(["mites", "caterpillars", "miners"].map(key =>
      [key, morphology(patterns[key], width, height, Math.max(2, Math.round(width / 250)), false)]));
    for (const [core, fringe] of [["mites", "aphids"], ["mites", "miners"], ["mites", "whitefly"], ["caterpillars", "aphids"], ["miners", "whitefly"]]) {
      const near = contexts[core];
      for (let i = 0; i < n; i++) if (near[i] && patterns[fringe][i]) { patterns[core][i] = 1; patterns[fringe][i] = 0; }
    }
    const yellowGroups = components(yellow, width, height), keep = new Set();
    const yellowRegions = yellowGroups.items.filter(c => c.pixels >= Math.max(15, n * 0.00004)).map(c => {
      keep.add(c.id); return { ...c, x: c.x / width, y: c.y / height, width: c.width / width, height: c.height / height, evaluable: true };
    });
    for (let i = 0; i < n; i++) if (!keep.has(yellowGroups.labels[i])) yellow[i] = 0;
    const issues = [], compactness = pixels / (leaf.width * leaf.height), aspect = Math.max(leaf.width, leaf.height) / Math.min(leaf.width, leaf.height);
    if (compactness < 0.35 || compactness > 0.92 || aspect > 3.5 || pixels > n * 0.75) issues.push("tablet-leaf-shape");
    if (leaf.x <= roi.x * width + 2 || leaf.y <= roi.y * height + 2 || leaf.x + leaf.width >= (roi.x + roi.width) * width - 2
        || leaf.y + leaf.height >= (roi.y + roi.height) * height - 2) issues.push("tablet-leaf-clipped");
    const average = light / Math.max(1, pixels) * 100, detail = measureDetail(brightness, mask, width, height);
    if (average < 15) issues.push("underexposed"); if (average > 90) issues.push("overexposed");
    return { ...result, mask, candidates, yellowCandidates: yellow, yellowLabels: yellowGroups.labels, yellowRegions,
      patternCandidates: patterns, leafPixels: pixels, suspectPixels: candidates.reduce((sum, value) => sum + value, 0),
      plantAreaPercent: pixels / n * 100, averageBrightness: average,
      centroid: { x: sx / pixels / width, y: sy / pixels / height },
      boundingBox: { x: leaf.x / width, y: leaf.y / height, width: leaf.width / width, height: leaf.height / height },
      quality: { usable: !issues.length, issues, score: issues.length ? 20 : 85, sharpness: detail.value || 0, detail } };
  }

  function compareFrames(a, b) {
    if (!a.centroid || !b.centroid || a.width !== b.width || a.height !== b.height || a.profile !== b.profile) return false;
    // Compare the photographed scene, not mask centroid jitter caused by threshold crossings.
    const meanA = a.signature.reduce((sum, v) => sum + v, 0) / a.signature.length;
    const meanB = b.signature.reduce((sum, v) => sum + v, 0) / b.signature.length;
    let covariance = 0, varianceA = 0, varianceB = 0;
    for (let i = 0; i < a.signature.length; i++) {
      const x = a.signature[i] - meanA, y = b.signature[i] - meanB;
      covariance += x * y; varianceA += x * x; varianceB += y * y;
    }
    const correlation = covariance / Math.max(0.000001, Math.sqrt(varianceA * varianceB));
    let intersection = 0, union = 0;
    for (let i = 0; i < a.mask.length; i++) { intersection += +(a.mask[i] && b.mask[i]); union += +(a.mask[i] || b.mask[i]); }
    return correlation > 0.985 && intersection / Math.max(1, union) > 0.65
      && Math.abs(a.averageBrightness - b.averageBrightness) < 12;
  }

  function combine(frames) {
    if (!frames.length) throw new Error("No frames to analyze");
    const expanded = frames.map((f) => morphology(f.candidates, f.width, f.height, Math.max(1, Math.round(f.width / 500)), false));
    const yellowVotes = frames.map((frame) => morphology(Uint8Array.from(frame.yellowCandidates, (v) => +(v === 1)),
      frame.width, frame.height, Math.max(1, Math.round(frame.width / 500)), false));
    const peers = frames.map((a) => frames.map((b) => a.quality.usable && b.quality.usable && compareFrames(a, b)));
    const ranks = frames.map((frame, index) => {
      let supported = 0, yellowSupported = 0;
      for (let pixel = 0; pixel < frame.candidates.length; pixel++) {
        if (frame.yellowCandidates[pixel] === 1) {
          let count = 0;
          for (let j = 0; j < frames.length; j++) if (peers[index][j]) count += yellowVotes[j][pixel];
          yellowSupported += +(count >= 2);
        }
        if (!frame.candidates[pixel]) continue;
        let count = 0;
        for (let j = 0; j < frames.length; j++) if (peers[index][j]) count += expanded[j][pixel];
        supported += +(count >= 2);
      }
      return (frame.quality.usable ? 10000 : 0) + peers[index].filter(Boolean).length * 1000
        + (supported >= 20 ? 100 : 0) + (yellowSupported >= 40 ? 50 : 0)
        + Math.min(40, frame.quality.detail?.value || 0) + frame.quality.score * 0.01;
    });
    let selectedIndex = 0;
    for (let i = 1; i < frames.length; i++) {
      if (ranks[i] > ranks[selectedIndex]) selectedIndex = i;
    }
    const best = frames[selectedIndex];
    const comparable = frames.filter((f, i) => peers[selectedIndex][i]);
    const stable = frames.length >= 2 && comparable.length >= 2;
    const screenDisagreement = best.profile === "tablet-leaf-v1" && comparable.length < frames.filter(frame => frame.quality.usable).length;
    const votes = expanded.filter((f, i) => peers[selectedIndex][i]);
    const required = Math.max(2, Math.ceil(comparable.length * 0.6));
    const overlay = new Uint8Array(best.mask.length);
    const innerLeaf = morphology(best.mask, best.width, best.height, Math.max(2, Math.round(best.width / 120)), true);
    let repeatedPixels = 0, tentativePixels = 0;
    const regions = [];
    const regionRadius = Math.max(1, Math.round(best.width / 400));
    const surfaces = morphology(morphology(best.candidates, best.width, best.height, regionRadius, false),
      best.width, best.height, regionRadius, true);
    const patches = components(surfaces, best.width, best.height);
    for (const region of patches.items) {
      let supported = 0, actualPixels = 0, interiorPixels = 0;
      for (let y = region.y; y < region.y + region.height; y++) {
        for (let x = region.x; x < region.x + region.width; x++) {
          const i = y * best.width + x;
          if (patches.labels[i] !== region.id || !best.candidates[i]) continue;
          actualPixels++;
          interiorPixels += innerLeaf[i];
          let count = 0;
          for (const vote of votes) count += vote[i];
          supported += +(count >= required);
        }
      }
      // Thin contour halos and tiny fragments remain uncertain even when the lighting repeats.
      const broadPatch = best.profile === "tablet-leaf-v1"
        ? actualPixels >= Math.max(12, best.width * best.height * 0.00002)
        : region.pixels / (region.width * region.height) >= 0.42
        && Math.min(region.width, region.height) >= Math.max(3, best.width * 0.012)
        && actualPixels >= Math.max(15, best.width * best.height * 0.00006);
      const atFrameEdge = region.x <= 1 || region.y <= 1
        || region.x + region.width >= best.width - 1 || region.y + region.height >= best.height - 1;
      const roi = best.roi;
      const atSelectionEdge = roi && (region.x <= Math.ceil(roi.x * best.width) + 1
        || region.y <= Math.ceil(roi.y * best.height) + 1
        || region.x + region.width >= (roi.x + roi.width) * best.width - 1
        || region.y + region.height >= (roi.y + roi.height) * best.height - 1);
      const sufficientSurface = interiorPixels / Math.max(1, actualPixels) >= 0.6 || actualPixels >= best.leafPixels * 0.004;
      const repeated = stable && !screenDisagreement && broadPatch && sufficientSurface && !atFrameEdge && !atSelectionEdge
        && supported / Math.max(1, actualPixels) >= 0.45;
      for (let y = region.y; y < region.y + region.height; y++) {
        for (let x = region.x; x < region.x + region.width; x++) {
          const i = y * best.width + x;
          if (patches.labels[i] === region.id && best.candidates[i]) overlay[i] = repeated ? 2 : 1;
        }
      }
      repeatedPixels += repeated ? actualPixels : 0;
      tentativePixels += repeated ? 0 : actualPixels;
      regions.push({ x: region.x / best.width, y: region.y / best.height, width: region.width / best.width,
        height: region.height / best.height, pixels: actualPixels, repeated });
    }
    const quality = screenDisagreement ? { ...best.quality, usable: false, issues: [...best.quality.issues, "tablet-burst-disagreement"], score: 20 } : best.quality;
    const usable = quality.usable && stable;
    const areas = comparable.map((frame) => frame.plantAreaPercent);
    const areaMeasurement = usable ? { min: Math.min(...areas), max: Math.max(...areas), samples: areas.length } : null;
    const yellowRepeated = new Uint8Array(best.mask.length);
    let yellowPixels = 0, yellowTentativePixels = 0, colorAreaPixels = best.leafPixels;
    const yellowRegions = best.yellowRegions.map((region) => {
      const x0 = Math.round(region.x * best.width), y0 = Math.round(region.y * best.height);
      const rw = Math.round(region.width * best.width), rh = Math.round(region.height * best.height);
      const roi = best.roi || { x: 0, y: 0, width: 1, height: 1 };
      const cut = region.x <= roi.x + 2 / best.width || region.y <= roi.y + 2 / best.height
        || region.x + region.width >= roi.x + roi.width - 2 / best.width
        || region.y + region.height >= roi.y + roi.height - 2 / best.height;
      let supported = 0, count = 0;
      for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) {
        const i = y * best.width + x;
        if (!best.yellowCandidates[i] || best.yellowLabels[i] !== region.id) continue;
        let votes = 0;
        for (let j = 0; j < frames.length; j++) if (peers[selectedIndex][j]) votes += yellowVotes[j][i];
        supported += +(votes >= required); count++;
      }
      const repeated = usable && region.evaluable && !cut && supported / Math.max(1, count) >= 0.65;
      for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) {
        const i = y * best.width + x;
        if (!best.yellowCandidates[i] || best.yellowLabels[i] !== region.id) continue;
        yellowRepeated[i] = +repeated;
        if (overlay[i] !== 2) overlay[i] = repeated ? 3 : 1;
      }
      return { ...region, repeated, reason: !usable ? "quality-or-motion" : !region.evaluable ? "clipped-channel"
        : cut ? "selection-edge" : !repeated ? "not-repeated" : "repeated" };
    });
    for (let i = 0; i < overlay.length; i++) {
      if (best.yellowCandidates[i]) {
        // Count the union once, including pixels where a red spot takes visual priority.
        if (yellowRepeated[i]) { yellowPixels++; if (!best.mask[i]) colorAreaPixels++; }
        else yellowTentativePixels++;
      }
    }
    const simulatedPatterns = [];
    if (usable && best.profile === "tablet-leaf-v1") {
      for (const item of tabletProfile.PALETTE.slice(2, 8)) {
        const repeated = new Uint8Array(best.mask.length), own = best.patternCandidates[item.id];
        const votes = frames.filter((_, i) => peers[selectedIndex][i]).map(frame =>
          morphology(frame.patternCandidates[item.id], best.width, best.height, Math.max(1, Math.round(best.width / 500)), false));
        for (let i = 0; i < own.length; i++) if (own[i]) {
          let support = 0; for (const vote of votes) support += vote[i];
          repeated[i] = +(support >= required);
        }
        const groups = components(repeated, best.width, best.height).items.filter(c => c.pixels >= Math.max(12, best.width * best.height * 0.00002));
        const pixels = groups.reduce((sum, c) => sum + c.pixels, 0);
        if (pixels) simulatedPatterns.push({ id: item.id, label: item.label, count: groups.length, pixels,
          percent: pixels / Math.max(1, best.leafPixels) * 100 });
      }
    }
    return { ...best, quality, overlay, regions, selectedIndex, stable, usable, repeatedPixels, tentativePixels, simulatedPatterns,
      areaMeasurement, yellowRegions, yellowPixels, yellowTentativePixels, colorAreaPixels,
      yellowPercent: usable ? yellowPixels / Math.max(1, colorAreaPixels) * 100 : null,
      suspectSpotPercent: usable ? repeatedPixels / Math.max(1, best.leafPixels) * 100 : null,
      frameCount: frames.length, comparableFrames: comparable.length };
  }

  function focusCrop(result, selecting = false) {
    if (selecting) return { x: 0, y: 0, width: 1, height: 1 };
    const boxes = [result.boundingBox, ...(result.yellowRegions || [])].filter(Boolean);
    if (!boxes.length && !result.roi) return { x: 0, y: 0, width: 1, height: 1 };
    const box = result.roi || {
      x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)),
      width: Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x)),
      height: Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y))
    };
    const width = Math.min(1, Math.max(0.18, box.width * 1.12));
    const height = Math.min(1, Math.max(0.18, box.height * 1.12));
    return { x: clamp(box.x + box.width / 2 - width / 2, 0, 1 - width),
      y: clamp(box.y + box.height / 2 - height / 2, 0, 1 - height), width, height };
  }

  return { VERSION, analyze, combine, compareFrames, focusCrop };
});

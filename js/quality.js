// On-device photo checks: size, light, contrast and sharpness.
// Runs before anything is sent, so blurry or dark photos are rejected early.

const MIN_SIDE = 480;          // px, shortest side of the original photo
const MIN_BRIGHTNESS = 45;     // mean luma 0-255
const MAX_BRIGHTNESS = 225;
const MAX_CLIPPED = 0.35;      // share of pixels blown out (white)
const MAX_DARK = 0.55;         // share of pixels nearly black
const MIN_CONTRAST = 18;       // luma standard deviation
const MIN_SHARPNESS = 60;      // variance of Laplacian at 512px analysis size

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("cantOpen")); };
    img.src = url;
  });
}

function drawScaled(img, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

export function analyseQuality(img) {
  const problems = [];
  const shortSide = Math.min(img.naturalWidth, img.naturalHeight);
  if (shortSide < MIN_SIDE) {
    problems.push({ code: "small" });
  }

  const { ctx, w, h } = drawScaled(img, 512);
  const data = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const gray = new Float32Array(n);
  let sum = 0, sumSq = 0, clipped = 0, dark = 0;
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = y;
    sum += y;
    sumSq += y * y;
    if (y > 250) clipped++;
    if (y < 12) dark++;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));

  // Variance of the Laplacian, measured in a 4x4 grid of tiles. Close-ups
  // often have a soft background on purpose, so the photo counts as sharp
  // when the in-focus part (second-sharpest tile) is sharp.
  const G = 4, tiles = [];
  for (let ty = 0; ty < G; ty++) {
    for (let tx = 0; tx < G; tx++) {
      const x0 = Math.max(1, Math.floor(tx * w / G)), x1 = Math.min(w - 1, Math.floor((tx + 1) * w / G));
      const y0 = Math.max(1, Math.floor(ty * h / G)), y1 = Math.min(h - 1, Math.floor((ty + 1) * h / G));
      let lapSum = 0, lapSq = 0, count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
          lapSum += v;
          lapSq += v * v;
          count++;
        }
      }
      if (count) tiles.push(lapSq / count - (lapSum / count) ** 2);
    }
  }
  tiles.sort((a, b) => b - a);
  const sharpness = tiles.length > 1 ? tiles[1] : tiles[0] || 0;

  if (mean < MIN_BRIGHTNESS || dark / n > MAX_DARK) {
    problems.push({ code: "dark" });
  } else if (mean > MAX_BRIGHTNESS || clipped / n > MAX_CLIPPED) {
    problems.push({ code: "bright" });
  }
  if (std < MIN_CONTRAST) {
    problems.push({ code: "flat" });
  }
  if (sharpness < MIN_SHARPNESS) {
    problems.push({ code: "blur" });
  }

  return {
    ok: problems.length === 0,
    problems,
    stats: { mean: Math.round(mean), contrast: Math.round(std), sharpness: Math.round(sharpness), width: img.naturalWidth, height: img.naturalHeight }
  };
}

// Resize for upload and for a small history thumbnail.
export function toJpeg(img, maxSide, quality = 0.85) {
  const { canvas } = drawScaled(img, maxSide);
  return canvas.toDataURL("image/jpeg", quality);
}

// Screenshots and forwarded images often carry flat black or white bars
// (status bar, letterboxing). Cut them off so the plant fills the photo.
export async function trimBorders(img, url) {
  const { ctx, w, h } = drawScaled(img, 400);
  const px = ctx.getImageData(0, 0, w, h).data;
  const luma = (x, y) => { const i = (y * w + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
  const flat = (len, at) => {
    let lo = 255, hi = 0;
    for (let k = 0; k < len; k++) { const v = at(k); if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi - lo < 14;
  };
  const maxCut = (n) => Math.floor(n * 0.25);
  let top = 0, bottom = 0, left = 0, right = 0;
  while (top < maxCut(h) && flat(w, (x) => luma(x, top))) top++;
  while (bottom < maxCut(h) && flat(w, (x) => luma(x, h - 1 - bottom))) bottom++;
  while (left < maxCut(w) && flat(h, (y) => luma(left, y))) left++;
  while (right < maxCut(w) && flat(h, (y) => luma(w - 1 - right, y))) right++;
  if (top + bottom + left + right < 3) return { img, url };

  const sx = img.naturalWidth / w, sy = img.naturalHeight / h;
  const x0 = Math.ceil(left * sx), y0 = Math.ceil(top * sy);
  const cw = Math.floor((w - left - right) * sx), ch = Math.floor((h - top - bottom) * sy);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext("2d").drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.95));
  if (!blob) return { img, url };
  URL.revokeObjectURL(url);
  return loadImage(blob);
}

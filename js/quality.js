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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not open this file as a photo.")); };
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
    problems.push({ code: "small", text: "The photo is too small. Take it with the phone camera instead of a screenshot or forwarded image." });
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

  // Variance of the Laplacian: low values mean a blurry photo.
  let lapSum = 0, lapSq = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lapSum += v;
      lapSq += v * v;
      count++;
    }
  }
  const lapMean = count ? lapSum / count : 0;
  const sharpness = count ? lapSq / count - lapMean * lapMean : 0;

  if (mean < MIN_BRIGHTNESS || dark / n > MAX_DARK) {
    problems.push({ code: "dark", text: "The photo is too dark. Move into daylight or open shade, and don't cover the camera." });
  } else if (mean > MAX_BRIGHTNESS || clipped / n > MAX_CLIPPED) {
    problems.push({ code: "bright", text: "The photo is too bright or washed out. Avoid direct sun glare and flash." });
  }
  if (std < MIN_CONTRAST) {
    problems.push({ code: "flat", text: "The photo has almost no detail. Make sure the plant fills most of the frame." });
  }
  if (sharpness < MIN_SHARPNESS) {
    problems.push({ code: "blur", text: "The photo is blurry. Hold the phone steady, tap the leaf on screen to focus, then take it again." });
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

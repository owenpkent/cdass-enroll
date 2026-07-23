// Document scanning entry points. All decoding happens in this browser via
// WASM that is served from this app's own origin. No image ever leaves the machine.

import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { createWorker } from "tesseract.js";
import { parseAamva, AAMVA_READ_OPTIONS } from "./aamva.js";
import { parseMrz } from "./mrz.js";
import { parseSsnCard } from "./ssncard.js";
import { parseLicenseFront, parseNameRegion } from "./dlfront.js";

prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) =>
      path.endsWith(".wasm") ? new URL("vendor/zxing/zxing_reader.wasm", document.baseURI).href : prefix + path,
  },
});

let workerPromise = null;
function getOcrWorker() {
  workerPromise ??= createWorker("eng", 1, {
    workerPath: new URL("vendor/tesseract/worker.min.js", document.baseURI).href,
    corePath: new URL("vendor/tesseract/", document.baseURI).href,
    langPath: new URL("tessdata/", document.baseURI).href,
    gzip: false,
  });
  return workerPromise;
}

async function ocr(input) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(input);
  return data.text ?? "";
}

// A pass constrained to digits and separators. Tesseract reads numbers far more
// reliably when it cannot try to fit letters, which matters for the SSN. The
// whitelist is cleared afterwards so the shared worker stays general-purpose.
async function ocrDigits(input) {
  const worker = await getOcrWorker();
  await worker.setParameters({ tessedit_char_whitelist: "0123456789 -" });
  try {
    const { data } = await worker.recognize(input);
    return data.text ?? "";
  } finally {
    await worker.setParameters({ tessedit_char_whitelist: "" });
  }
}

// ---- image preprocessing -------------------------------------------------
// Phone photos of small cards are often too low-resolution or low-contrast for
// reliable OCR / barcode decoding. Upscaling, converting to high-contrast
// grayscale, and sharpening all improve both. Each scanner tries the original
// first (so a good photo is never made worse) and falls back to the enhanced
// version.
//
// Sharpening is the load-bearing step for the license barcode, which was
// measured rather than assumed. On a real 1553px Colorado ID photo whose PDF417
// sits at ~1.3 pixels per module, neither upscaling nor a contrast stretch
// decodes on any binarizer; an unsharp mask decodes even without upscaling.
// Phone optics and JPEG leave the bars soft but intact, and unsharp restores
// the edges. (Synthetic motion blur is a different thing and is not
// recoverable, so do not use it to judge whether this step earns its place.)

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read the image file."));
      img.src = URL.createObjectURL(file);
    });
  }
}

async function enhanceCanvas(file, { target = 2000, upscaleOnly = false } = {}) {
  const bmp = await loadBitmap(file);
  const longest = Math.max(bmp.width, bmp.height) || 1;
  let scale = target / longest;
  if (upscaleOnly) scale = Math.max(1, scale);
  scale = Math.min(scale, 3);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  grayContrast(img.data);
  unsharp(img.data, w, h);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Grayscale plus a contrast stretch to the full 0-255 range.
function grayContrast(d) {
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = max - min || 1;
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

// Luma grayscale in place on a canvas, without grayContrast's contrast stretch.
// Used before OCR of a name crop, where the stretch does more harm than good.
function grayscale(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Unsharp mask over the grayscale already in `d` (RGBA, gray in every channel).
 * result = pixel + amount * (pixel - blurred). Defaults match what was measured
 * to decode a real license photo (PIL's radius=2 / percent=200 equivalent).
 */
function unsharp(d, w, h, sigma = 2, amount = 2) {
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = d[i * 4];

  const blurred = gaussianBlur(gray, w, h, sigma);
  for (let i = 0; i < n; i++) {
    const v = gray[i] + amount * (gray[i] - blurred[i]);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
}

// Separable Gaussian. Two 1-D passes, so cost stays linear in pixels.
function gaussianBlur(src, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i; // clamp at edges
        acc += src[y * w + xx] * k[i + r];
      }
      tmp[y * w + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        acc += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// ---- scanners ------------------------------------------------------------

/**
 * Scan the BACK of a driver's license (the PDF417 barcode).
 * Returns {fields, source} or throws with a friendly message.
 */
// Decode a PDF417 from any input zxing accepts (Blob/ImageData), trying two
// binarizers (LocalAverage for uneven light, GlobalHistogram for even light).
async function decodePdf417(input) {
  for (const binarizer of ["LocalAverage", "GlobalHistogram"]) {
    const results = await readBarcodes(input, { ...AAMVA_READ_OPTIONS, binarizer });
    const hit = results.find((r) => r.isValid && r.text);
    if (hit) return hit;
  }
  return null;
}

function licenseResult(hit) {
  const fields = parseAamva(hit.text);
  if (!fields) throw new Error("Barcode decoded but it does not look like license data.");
  return { fields, source: "Driver's license barcode" };
}

export async function scanLicense(imageFile) {
  const enhanced = await enhanceCanvas(imageFile, { target: 2600, upscaleOnly: true }).catch(() => null);
  const enhancedBlob = enhanced ? await canvasToBlob(enhanced) : null;
  for (const input of [imageFile, enhancedBlob].filter(Boolean)) {
    const hit = await decodePdf417(input);
    if (hit) return licenseResult(hit);
  }
  throw new Error(
    "No PDF417 barcode found. Get closer so the barcode fills the frame, tap to focus until the bars are sharp, and avoid glare. Or draw a box around the barcode below, or type the license details in by hand."
  );
}

// Decode the barcode from a user-selected region (the cropper). `source` is an
// image the canvas can draw (an ImageBitmap); sx/sy/sw/sh are the crop rect in
// source pixels. The crop is upscaled, contrast-stretched and sharpened so the
// dense bars get enough pixels to decode, which rescues a barcode that was
// small in frame.
export async function readLicenseRegion(source, sx, sy, sw, sh) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // Try several scales: sharpening at native resolution decodes some photos
  // that upscaling alone cannot, and vice versa, so neither one is sufficient.
  for (const scale of [Math.min(4, Math.max(1, 1600 / sw)), 1, 2, 3]) {
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    grayContrast(img.data);
    unsharp(img.data, canvas.width, canvas.height);
    ctx.putImageData(img, 0, 0);
    const blob = await canvasToBlob(canvas);
    const hit = blob && (await decodePdf417(blob));
    if (hit) return licenseResult(hit);
  }
  throw new Error("No barcode in the selected area. Draw the box tightly around just the striped barcode and try again.");
}

// OCR a user-drawn crop of just the name region, then parse it as a name (vs
// readLicenseRegion, which decodes the crop as a barcode). The crop is only
// upscaled, deliberately NOT contrast-stretched or sharpened: on these cards
// those steps amplify the security-pattern background and the tiny AAMVA field
// markers into letter-like noise (a "2" marker became "Rs" in testing) that the
// parser then mistakes for a name. Tesseract's own binarization handles a plain
// upscaled crop best. A tight crop of just the name reads far better than the
// whole card, whose busy background defeats OCR. `source` is a drawable image
// (ImageBitmap); sx/sy/sw/sh are the crop rect in source pixels.
export async function readNameRegion(source, sx, sy, sw, sh) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const scale = Math.min(3, Math.max(2, 1200 / sw));
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  // Grayscale only, NO contrast stretch: desaturating drops the colored
  // background without amplifying it the way a contrast stretch does.
  grayscale(ctx, canvas.width, canvas.height);
  const fields = parseNameRegion(await ocr(canvas));
  if (fields) return { fields, source: "Name crop (OCR)" };
  throw new Error(
    "Couldn't read a name from the selected area. Draw the box tightly around just the name lines, or type the name in."
  );
}

// Load a bitmap with EXIF orientation applied, so a phone photo taken sideways
// is analyzed upright (loadBitmap above deliberately does not, to leave the
// barcode path's pixels untouched).
async function loadOrientedBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return loadBitmap(file);
  }
}

// Locate individual lines of printed text in the right-hand data area of a
// license, with NO OCR and NO ML. The fields are dark ink on a pale, pastel
// security background, so a per-row count of dark pixels spikes on text rows and
// drops to near zero between lines, even on cards whose busy background defeats
// whole-card OCR. Measured on a real Colorado card: name rows run ~0.20-0.25
// dark, the big header ~0.46, inter-line gaps under 0.05 — hence the 0.08 cut,
// which is above the gaps but well below any real text row. Only tiny gaps are
// bridged (anti-aliasing within one line); separate lines stay separate, and the
// height filter drops the oversized header. Returns rects in SOURCE pixels, top
// to bottom. `source` must be upright (see loadOrientedBitmap).
function detectTextLines(source) {
  const W = 1000;
  const s = W / source.width;
  const H = Math.round(source.height * s);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const dark = (x, y) => {
    const i = (y * W + x) * 4;
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 110;
  };
  const x0 = Math.round(0.3 * W); // skip the photo column on the left
  const wdt = W - x0;
  const rowOn = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = x0; x < W; x++) if (dark(x, y)) c++;
    rowOn[y] = c / wdt > 0.08 ? 1 : 0;
  }
  const bridge = Math.max(2, Math.round(H * 0.005));
  const runs = [];
  let start = -1;
  let lastOn = -1;
  for (let y = 0; y <= H; y++) {
    const on = y < H && rowOn[y];
    if (on) {
      if (start < 0) start = y;
      lastOn = y;
    } else if (start >= 0 && y - lastOn > bridge) {
      runs.push([start, lastOn]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, lastOn]);

  const pad = 8;
  const rects = [];
  for (const [y1, y2] of runs) {
    const lh = y2 - y1 + 1;
    if (lh < H * 0.015 || lh > H * 0.07) continue; // one line of field text
    let minX = W;
    let maxX = x0;
    for (let y = y1; y <= y2; y++)
      for (let x = x0; x < W; x++)
        if (dark(x, y)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
    if (maxX - minX < W * 0.08) continue;
    rects.push({
      x: Math.max(0, minX - pad) / s,
      y: Math.max(0, y1 - pad) / s,
      w: (maxX - minX + 2 * pad) / s,
      h: (lh + 2 * pad) / s,
    });
  }
  return rects;
}

const union = (a, b) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
  h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
});

// An automatically chosen crop has no human vouching for it, so hold it to a
// higher bar than a hand-drawn one: a real name has a substantial word, OCR
// noise off the security background ("Oos", "Hou") does not.
function isPlausibleAutoName(f) {
  if (!f || !f.first || !f.last) return false;
  const a = f.first.replace(/[^A-Za-z]/g, "");
  const b = f.last.replace(/[^A-Za-z]/g, "");
  return a.length + b.length >= 8 && Math.max(a.length, b.length) >= 4;
}

// An auto-chosen crop is padded, so OCR can catch a sliver of the neighbouring
// line as a short trailing token ("Lynne Sa"). Drop those. A lone single letter
// is kept: that is a middle initial, not noise.
function trimNoisyMiddle(f) {
  if (!f?.middle) return f;
  const toks = f.middle.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && toks[toks.length - 1].length <= 2) toks.pop();
  const middle = toks.join(" ");
  return middle ? { ...f, middle } : { first: f.first, last: f.last };
}

// Automatically read a name off a license front: detect the text lines, then OCR
// the most promising crops (a tight crop OCRs far better than the whole card).
// A name is usually two adjacent, left-aligned lines (family above given), so
// those pairs are tried first; on a real Colorado card the name sits at the left
// edge of the data column while DOB / DL# / expiry sit further right, so
// left-aligned candidates are preferred. Capped at a handful of OCR passes so a
// scan stays responsive. Returns the name fields, or null.
async function autoReadName(source) {
  const lines = detectTextLines(source);
  if (!lines.length) return null;
  const leftEdge = Math.min(...lines.map((l) => l.x));
  const nearLeft = (r) => r.x - leftEdge < source.width * 0.06;
  const pairs = [];
  const singles = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    if (b && b.y - (a.y + a.h) < a.h * 1.2 && Math.abs(a.x - b.x) < source.width * 0.03)
      pairs.push(union(a, b));
    singles.push(a);
  }
  const cands = [
    ...pairs.filter(nearLeft),
    ...singles.filter(nearLeft),
    ...pairs.filter((r) => !nearLeft(r)),
    ...singles.filter((r) => !nearLeft(r)),
  ];
  for (const r of cands.slice(0, 8)) {
    try {
      const { fields } = await readNameRegion(source, r.x, r.y, r.w, r.h);
      if (isPlausibleAutoName(fields)) return trimNoisyMiddle(fields);
    } catch {
      /* not a name; try the next crop */
    }
  }
  return null;
}

/**
 * OCR the FRONT of a driver's license for the name, date of birth, and address
 * (the fields the barcode would give, when the barcode won't scan). Best-effort:
 * front layouts vary by state, so the result must be verified. The name is read
 * more reliably from the back-of-license barcode or the Social Security card.
 */
export async function scanLicenseFront(imageFile) {
  const input = (await enhanceCanvas(imageFile).catch(() => null)) ?? imageFile;
  const text = await ocr(input);
  const fields = parseLicenseFront(text) ?? {};
  // Whole-card OCR rarely gets the name off a modern card (the security
  // background swamps it), so when it doesn't, locate the text lines and OCR the
  // name block on its own, which reads far better. Same trick the manual
  // "box the name" cropper uses, applied automatically.
  if (!fields.first && !fields.last) {
    const upright = await loadOrientedBitmap(imageFile).catch(() => null);
    if (upright) {
      const auto = await autoReadName(upright).catch(() => null);
      if (auto) Object.assign(fields, auto);
    }
  }
  if (Object.keys(fields).length) return { fields, source: "Driver's license front (OCR)" };
  if (text.replace(/\s/g, "").length <= 3)
    throw new Error("OCR read no text from the image. The OCR model may not have loaded; check the browser console (F12), or re-run npm run setup.");
  throw new Error(
    "Couldn't read the date of birth or address from the front. Retake straight on, filling the frame, with no glare. You may need to type some fields."
  );
}

/** Scan the photo page of a passport (reads the MRZ lines at the bottom). */
export async function scanPassport(imageFile) {
  const input = (await enhanceCanvas(imageFile).catch(() => null)) ?? imageFile;
  const text = await ocr(input);
  const fields = parseMrz(text);
  if (fields) return { fields, source: "Passport MRZ" };
  if (text.replace(/\s/g, "").length <= 3)
    throw new Error("OCR read no text from the image. The OCR model may not have loaded; check the browser console (F12), or re-run npm run setup.");
  throw new Error(
    "Could not read the passport MRZ (the two <<< lines). Retake straight-on with the whole page in frame and even lighting."
  );
}

/** Scan a Social Security card. */
export async function scanSsnCard(imageFile) {
  const input = (await enhanceCanvas(imageFile).catch(() => null)) ?? imageFile;
  // Normal pass for the name, digits-only pass for the number; search both.
  // The two passes are not independent checks: same engine, same preprocessed
  // image, so they misread the same character the same way. Comparing them
  // would give false confidence, not verification.
  const text = (await ocr(input)) + "\n" + (await ocrDigits(input));
  const fields = parseSsnCard(text);
  if (fields) return { fields, source: "Social Security card" };
  if (text.replace(/\s/g, "").length <= 3)
    throw new Error("OCR read no text from the image. The OCR model may not have loaded; check the browser console (F12), or re-run npm run setup.");
  throw new Error(
    "Could not find an SSN in the image. Make sure the nine digits are sharp and fill the frame, or just type them into the SSN field."
  );
}

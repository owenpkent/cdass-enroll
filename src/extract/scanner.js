// Document scanning entry points. All decoding happens in this browser via
// WASM that is served from this app's own origin. No image ever leaves the machine.

import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { createWorker } from "tesseract.js";
import { parseAamva, AAMVA_READ_OPTIONS } from "./aamva.js";
import { parseMrz } from "./mrz.js";
import { parseSsnCard } from "./ssncard.js";
import { parseLicenseFront } from "./dlfront.js";

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

/**
 * OCR the FRONT of a driver's license for the date of birth and address (the
 * fields the barcode would give, when the barcode won't scan). Best-effort:
 * front layouts vary by state, so the result must be verified. The name comes
 * from the Social Security card scan, so it is not read here.
 */
export async function scanLicenseFront(imageFile) {
  const input = (await enhanceCanvas(imageFile).catch(() => null)) ?? imageFile;
  const text = await ocr(input);
  const fields = parseLicenseFront(text);
  if (fields) return { fields, source: "Driver's license front (OCR)" };
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

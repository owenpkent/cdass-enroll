// Document scanning entry points. All decoding happens in this browser via
// WASM that is served from this app's own origin. No image ever leaves the machine.

import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { createWorker } from "tesseract.js";
import { parseAamva } from "./aamva.js";
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
// reliable OCR / barcode decoding. Upscaling and converting to high-contrast
// grayscale improves both. Each scanner tries the original first (so a good
// photo is never made worse) and falls back to this enhanced version.

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
    const results = await readBarcodes(input, {
      formats: ["PDF417"],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      maxNumberOfSymbols: 1,
      binarizer,
    });
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
// source pixels. The crop is upscaled and contrast-stretched so the dense bars
// get enough pixels to decode, which rescues a barcode that was small in frame.
export async function readLicenseRegion(source, sx, sy, sw, sh) {
  const scale = Math.min(4, Math.max(1, 1600 / sw));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  grayContrast(img.data);
  ctx.putImageData(img, 0, 0);
  const blob = await canvasToBlob(canvas);
  const hit = blob && (await decodePdf417(blob));
  if (!hit) throw new Error("No barcode in the selected area. Draw the box tightly around just the striped barcode and try again.");
  return licenseResult(hit);
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
  const text = (await ocr(input)) + "\n" + (await ocrDigits(input));
  const fields = parseSsnCard(text);
  if (fields) return { fields, source: "Social Security card" };
  if (text.replace(/\s/g, "").length <= 3)
    throw new Error("OCR read no text from the image. The OCR model may not have loaded; check the browser console (F12), or re-run npm run setup.");
  throw new Error(
    "Could not find an SSN in the image. Make sure the nine digits are sharp and fill the frame, or just type them into the SSN field."
  );
}

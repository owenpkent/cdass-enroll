// Document scanning entry points. All decoding happens in this browser via
// WASM that is served from this app's own origin. No image ever leaves the machine.

import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { createWorker } from "tesseract.js";
import { parseAamva } from "./aamva.js";
import { parseMrz } from "./mrz.js";
import { parseSsnCard } from "./ssncard.js";

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
export async function scanLicense(imageFile) {
  const read = async (input) => {
    const results = await readBarcodes(input, { formats: ["PDF417"], tryHarder: true, maxNumberOfSymbols: 1 });
    return results.find((r) => r.isValid && r.text);
  };
  let hit = await read(imageFile);
  if (!hit) {
    const blob = await canvasToBlob(await enhanceCanvas(imageFile, { target: 2400, upscaleOnly: true }));
    if (blob) hit = await read(blob);
  }
  if (!hit) {
    throw new Error(
      "No PDF417 barcode found. Photograph the BACK of the license (the wide striped barcode), flat and filling the frame, with even light and no glare."
    );
  }
  const fields = parseAamva(hit.text);
  if (!fields) throw new Error("Barcode decoded but it does not look like license data.");
  return { fields, source: "Driver's license barcode" };
}

/** Scan the photo page of a passport (reads the MRZ lines at the bottom). */
export async function scanPassport(imageFile) {
  for (const input of [await enhanceCanvas(imageFile), imageFile]) {
    const fields = parseMrz(await ocr(input));
    if (fields) return { fields, source: "Passport MRZ" };
  }
  throw new Error(
    "Could not read the passport MRZ (the two <<< lines). Retake straight-on with the whole page in frame and even lighting."
  );
}

/** Scan a Social Security card. */
export async function scanSsnCard(imageFile) {
  for (const input of [await enhanceCanvas(imageFile), imageFile]) {
    const fields = parseSsnCard(await ocr(input));
    if (fields) return { fields, source: "Social Security card" };
  }
  throw new Error(
    "Could not find an SSN in the image. Retake the front of the card straight on, filling the frame, with even lighting and no glare."
  );
}

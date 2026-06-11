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

async function ocr(imageFile) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(imageFile);
  return data.text ?? "";
}

/**
 * Scan the BACK of a driver's license (the PDF417 barcode).
 * Returns {fields, source} or throws with a friendly message.
 */
export async function scanLicense(imageFile) {
  const results = await readBarcodes(imageFile, {
    formats: ["PDF417"],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  const hit = results.find((r) => r.isValid && r.text);
  if (!hit) {
    throw new Error(
      "No PDF417 barcode found. Photograph the BACK of the license, flat, well lit, filling the frame."
    );
  }
  const fields = parseAamva(hit.text);
  if (!fields) throw new Error("Barcode decoded but it does not look like license data.");
  return { fields, source: "Driver's license barcode" };
}

/** Scan the photo page of a passport (reads the MRZ lines at the bottom). */
export async function scanPassport(imageFile) {
  const text = await ocr(imageFile);
  const fields = parseMrz(text);
  if (!fields) {
    throw new Error(
      "Could not read the passport MRZ (the two <<< lines). Retake the photo straight-on with the full page visible."
    );
  }
  return { fields, source: "Passport MRZ" };
}

/** Scan a Social Security card. */
export async function scanSsnCard(imageFile) {
  const text = await ocr(imageFile);
  const fields = parseSsnCard(text);
  if (!fields) throw new Error("Could not find an SSN in the image. Retake with better lighting.");
  return { fields, source: "Social Security card" };
}

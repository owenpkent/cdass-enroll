// Vendors OCR/barcode runtime assets into public/ so the app makes zero
// network requests at runtime. Runs automatically on `npm install`.
//
// The only download is the Tesseract English model (one time, ~4 MB, from
// the official tesseract-ocr GitHub repo). No user data is ever involved.

import {
  mkdirSync, copyFileSync, existsSync, readdirSync, createWriteStream,
  readFileSync, renameSync, rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");

function copy(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log("vendored", dest.slice(root.length + 1));
}

// zxing-wasm reader (PDF417 barcode decoding for driver's licenses)
copy(
  join(nm, "zxing-wasm", "dist", "reader", "zxing_reader.wasm"),
  join(root, "public", "vendor", "zxing", "zxing_reader.wasm")
);

// tesseract.js worker + core (OCR for passports and Social Security cards)
copy(
  join(nm, "tesseract.js", "dist", "worker.min.js"),
  join(root, "public", "vendor", "tesseract", "worker.min.js")
);
const coreDir = join(nm, "tesseract.js-core");
for (const f of readdirSync(coreDir)) {
  if (f.startsWith("tesseract-core") && (f.endsWith(".js") || f.endsWith(".wasm"))) {
    copy(join(coreDir, f), join(root, "public", "vendor", "tesseract", f));
  }
}

// English OCR model (downloaded once; runtime then needs no network at all).
// Pinned to a specific tessdata_fast commit (the 4.1.0 tag) and verified by
// SHA-256, so a truncated or tampered download is never kept.
const TESSDATA_URL =
  "https://github.com/tesseract-ocr/tessdata_fast/raw/65727574dfcd264acbb0c3e07860e4e9e9b22185/eng.traineddata";
const TESSDATA_SHA256 = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2";

const lang = join(root, "public", "tessdata", "eng.traineddata");
const tmp = lang + ".part";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (existsSync(lang) && sha256File(lang) === TESSDATA_SHA256) {
  console.log("tessdata already present and verified, skipping download");
} else {
  if (existsSync(lang)) {
    console.warn("existing eng.traineddata has the wrong hash (truncated?), replacing it");
  }
  mkdirSync(dirname(lang), { recursive: true });
  console.log("downloading", TESSDATA_URL);
  download(TESSDATA_URL, tmp, 5)
    .then(() => {
      const got = sha256File(tmp);
      if (got !== TESSDATA_SHA256) throw new Error("SHA-256 mismatch (got " + got + ")");
      renameSync(tmp, lang);
      console.log("saved", lang.slice(root.length + 1));
    })
    .catch((e) => {
      rmSync(tmp, { force: true });
      console.error("Could not download eng.traineddata:", e.message);
      console.error("OCR will not work until you place it at public/tessdata/eng.traineddata");
      // Don't fail the install; the app works without OCR.
    });
}

function download(url, dest, redirectsLeft) {
  return new Promise((res, rej) => {
    get(url, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirectsLeft > 0) {
        r.resume();
        return res(download(r.headers.location, dest, redirectsLeft - 1));
      }
      if (r.statusCode !== 200) {
        r.resume();
        return rej(new Error("HTTP " + r.statusCode));
      }
      const out = createWriteStream(dest);
      r.on("error", (e) => out.destroy(e));
      r.on("aborted", () => out.destroy(new Error("download interrupted")));
      r.pipe(out);
      out.on("finish", () => out.close(() => res()));
      out.on("error", rej);
    }).on("error", rej);
  });
}

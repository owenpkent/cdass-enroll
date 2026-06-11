# Architecture

## Stack

Static single-page app, no framework, no backend.

| Concern | Choice |
| --- | --- |
| Build/dev server | Vite (vanilla JS template), port pinned to 5180 |
| PDF form filling | pdf-lib (pure JS, runs in the browser) |
| License barcode | zxing-wasm reading PDF417, parsed as AAMVA |
| Passport / SSN card | tesseract.js OCR with locally vendored model |
| Persistence | browser localStorage |

## Privacy enforcement, in layers

1. **No code path uploads anything.** The only `fetch` calls load same-origin
   templates and WASM.
2. **All third-party runtime assets are vendored.** `scripts/setup-assets.mjs`
   (runs on `npm install`) copies the zxing WASM and tesseract worker/core
   from `node_modules` into `public/vendor/`, and downloads the Tesseract
   English model once into `public/tessdata/`. Without this, tesseract.js
   would fetch models from a CDN at runtime.
3. **Content-Security-Policy** in `index.html` restricts connections to
   same-origin (plus the Vite HMR websocket), so even a compromised
   dependency could not phone home from the page.
4. **Dev server binds 127.0.0.1 only**, never the LAN.

Known trade-off: profiles (including SSNs) sit unencrypted in localStorage.
Acceptable for a single-user locked Windows account with disk encryption;
a passphrase-encrypted store (WebCrypto) is the natural upgrade if that
assumption changes.

## Data flow

```
   ID photo (File)                       manual typing
        |                                      |
  src/extract/scanner.js                       |
  - license: zxing-wasm PDF417 -> aamva.js     |
  - passport: tesseract OCR    -> mrz.js       |
  - SSN card: tesseract OCR    -> ssncard.js   |
        \                                      /
         profile object (keys defined in src/schema.js)
                          |
                 src/store.js (localStorage)
                          |
            Generate tab (src/main.js)
                          |
        src/fill/packet2026.js | packet2025.js | w4.js
              (shared I-9 section: src/fill/i9.js)
                          |
              pdf-lib fills template from public/forms/
                          |
                 browser download (Blob URL)
```

## Module map

```
index.html               Shell + CSP header
src/main.js              All UI: tabs, schema-driven form rendering, scan
                         handling, generate + download, privacy tab
src/style.css            Styling (plain CSS, no framework)
src/schema.js            Single source of truth for profile/employer fields;
                         both the UI and the fill mappings key off it
src/store.js             localStorage load/save, JSON export/import, wipe
src/extract/scanner.js   Entry points; lazily boots the OCR worker, points
                         zxing/tesseract at the vendored assets
src/extract/aamva.js     PDF417 payload -> profile fields (whitelisted AAMVA
                         element IDs; handles MMDDCCYY vs CCYYMMDD dates)
src/extract/mrz.js       Passport TD3 MRZ parser with check-digit validation
src/extract/ssncard.js   SSN + name out of OCR text
src/fill/util.js         Tolerant pdf-lib helpers (missing field = console
                         warning, not a crash), date/SSN formatting
src/fill/packet2026.js   Mapping for the current PPL packet
src/fill/packet2025.js   Mapping for the previous packet
src/fill/i9.js           I-9 Section 1 + 2 (identical fields in both packets)
src/fill/w4.js           W-4 with 2020-2023 vs 2024+ layout detection
scripts/setup-assets.mjs Vendors WASM/OCR assets at install time
tests/smoke.mjs          Parser unit tests + fills every form with sample data
run.py                   Launcher: install-if-needed, dev/test/build/serve
```

## Design decisions worth remembering

- **Barcode over OCR for licenses.** The PDF417 on the back is the DMV's own
  structured record (AAMVA format). OCR of the front is guesswork by
  comparison. The AAMVA parser matches against a whitelist of element IDs
  because the `DL` subfile marker can butt up against the first element
  (`...DLDAQ123` is element `DAQ`, not `DLD`).
- **Schema-driven UI.** `src/schema.js` declares sections and fields; the UI
  renders from it. Adding a profile field is one entry there plus a line in
  the relevant fill mapping.
- **Fill mappings are deliberately dumb.** Flat lists of
  `setText(form, "exact field name", value)` per form revision. Easy to diff
  against a field dump when PPL revises a template, and a renamed field
  degrades to a console warning instead of an exception.
- **Conservative attestations.** Checkboxes that assert facts (live-in
  status, under-18, relationship to employer) are only checked when the
  profile data unambiguously supports them; otherwise they are left for the
  human. See forms.md.
- **Smoke test is the regression net.** No framework; it fills real templates
  and the output is independently verified with pypdf during development.

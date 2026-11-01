# Architecture

## Stack

Static single-page app, no framework, no backend.

| Concern | Choice |
| --- | --- |
| Build/dev server | Vite (vanilla JS template), port pinned to 5180 |
| PDF form filling | pdf-lib (pure JS, runs in the browser) |
| Persistence | browser localStorage |
| Encryption at rest (optional) | Argon2id (hash-wasm) key derivation + AES-256-GCM (WebCrypto) |

## Privacy enforcement, in layers

1. **No code path uploads anything.** The only `fetch` calls load same-origin
   templates and WASM.
2. **No third-party runtime assets.** The only WASM is `hash-wasm` (the
   passphrase vault), which inlines its module, so nothing is fetched.
3. **Content-Security-Policy** in `index.html` restricts connections to
   same-origin (plus the Vite HMR websocket) and allows no workers
   (`worker-src 'none'`) or `blob:` scripts, so even a compromised
   dependency could not phone home from the page.
4. **Dev server binds 127.0.0.1 only**, never the LAN.

By default, profiles (including SSNs) sit unencrypted in localStorage, which is
acceptable for a single-user locked account with disk encryption. Optionally,
the user can turn on **passphrase encryption at rest** (⚙ Your details): a key
derived by Argon2id (`src/crypto/vault.js`, using the vendored `hash-wasm`)
encrypts the profile and standing details with AES-256-GCM. The key is held
only in memory as a non-extractable `CryptoKey`; the passphrase is entered once
per session at an unlock gate. `src/store.js` keeps a synchronous load/save API
by decrypting once into an in-memory cache at unlock and writing ciphertext
asynchronously (serialized per key). Clearing the saved person needs no
passphrase either: a `pagehide` handler wipes it on close, and
`clearProfileOnStart()` wipes it again at boot as a backstop. Both just remove
the envelope as an opaque blob, so no cleartext metadata (a timestamp or
otherwise) needs to be kept alongside the ciphertext to make that work. This covers offline access
to the stored bytes (theft, disk image, backup,
another OS account); it is not sufficient on its own for the case where one
person holds another's data. See [threat-model.md](threat-model.md).

## Data flow

```
   typed by hand                 previous packet PDF (optional)
        |                                      |
        |                  src/extract/filledpacket.js (AcroForm read)
        \                                      /
         profile object (keys defined in src/schema.js)
                          |
                 src/store.js (localStorage)
                          |
            generate step (src/main.js)
                          |
            src/fill/packet2026.js | w4.js
              (shared I-9 section: src/fill/i9.js)
                          |
              pdf-lib fills template from public/forms/
                          |
                 browser download (Blob URL)
```

## Module map

```
index.html               Shell + CSP header
src/main.js              All UI: single-page type -> review -> generate flow,
                         schema-driven form rendering, the Your details panel
src/style.css            Styling (plain CSS, no framework)
src/schema.js            Single source of truth for profile/employer fields;
                         both the UI and the fill mappings key off it. Also the
                         money validators (moneyError/moneyErrors) the form and
                         Generate share
src/store.js             localStorage load/save, JSON export/import, wipe
src/extract/filledpacket.js (AcroForm read)
        \                                      /
         profile object (keys defined in src/schema.js)
                          |
                 src/store.js (localStorage)
                          |
            generate step (src/main.js)
                          |
            src/fill/packet2026.js | w4.js
              (shared I-9 section: src/fill/i9.js)
                          |
              pdf-lib fills template from public/forms/
                          |
                 browser download (Blob URL)
```

## Module map

```
index.html               Shell + CSP header
src/main.js              All UI: single-page type -> review -> generate flow,
                         schema-driven form rendering, the Your details panel
src/style.css            Styling (plain CSS, no framework)
src/schema.js            Single source of truth for profile/employer fields;
                         both the UI and the fill mappings key off it. Also the
                         money validators (moneyError/moneyErrors) the form and
                         Generate share
src/store.js             localStorage load/save, JSON export/import, wipe
src/extract/filledpacket.js
                         A filled packet PDF -> profile/employer, by running
                         packet2026's PACKET2026_TEXT table backwards. It reads
                         the AcroForm. Skips every attestation
src/fill/util.js         Tolerant pdf-lib helpers (missing field = console
                         warning, not a crash), date/SSN formatting and their
                         inverses, signature image overlay
src/fill/packet2026.js   Mapping for the current PPL packet (+ employer
                         signature). Exports PACKET2026_TEXT, the one table both
                         filling and importing read
src/fill/i9.js           I-9 Section 1 + 2 (shared by the packet and standalone)
src/fill/w4.js           W-4 with 2020-2023 vs 2024+ layout detection
tests/smoke.mjs          Fills every form with sample data and checks the output
tests/fixtures/complete-packet.mjs  One fictional attendant + expected packet
                         field values, shared by smoke.mjs and the e2e test
tests/vault.test.mjs     Passphrase vault round trip
e2e/                     Playwright browser UI tests (see Testing below)
playwright.config.js     Runs the production build on 127.0.0.1:5181
run.py                   Launcher: install-if-needed, dev/test/build/serve
```

## Design decisions worth remembering

- **Type once, no ID scanning.** Driver's license barcode, passport MRZ, and
  SSN card OCR were built and then removed in favor of typing the details in
  once. They added a large offline asset set and a looser CSP for a worker, to
  save a few minutes on a form the user must review field by field anyway.
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
- **Standing data needs per-packet consent when it signs something.** The
  employer signature is stored once and reused, which means it outlives the
  person it was uploaded for and will happily go out on the next one's forms.
  The fillers stay dumb (they draw whatever `emp.signature` holds); `main.js`
  owns the decision through `genOptions.stampSignature`, which lives in memory
  only, so it is false again on every launch and every new person, and passes a
  blanked `signature` when it is off. Reuse is the whole point of standing
  details, but reuse of a signature is a claim about who signed.
- **A rate is never auto-corrected.** Money fields validate through
  `moneyError` and a bad one blocks Generate with the field named. Formatting is
  tidied (`$1,234.00` to `1234.00`); the amount never is. Rounding `33.517` to
  `33.52` on someone's behalf would change what they get paid on a form they
  sign, so the value stays as typed until a human resolves it.
- **Smoke test is the regression net.** No framework; it fills real templates
  and the output is independently verified with pypdf during development.

## Testing

- `node tests/smoke.mjs` fills the real templates into `tests/out/` from the
  shared fixture `tests/fixtures/complete-packet.mjs` (EXPECTED_PACKET, 109
  field values; the e2e test checks the same table);
  `node tests/vault.test.mjs` round-trips the vault. `npm test` runs both.
- `npx playwright test` (also `npm run test:e2e` or `python run.py e2e`) runs
  the browser UI tests in `e2e/` against the production build served by
  `vite preview` on 127.0.0.1:5181 (5180 stays free for the app). It drives
  installed Microsoft Edge; set `CDASS_UI_BROWSER` to use another channel.
- Every UI test automatically fails if a request leaves 127.0.0.1 or the page
  logs a console error or uncaught exception, so the no-network rule is
  checked on every run. `seed.local.json` is answered with 404, so tests only
  ever see the fictional Jane Doe.
- Coverage: no scan UI exists; type once, generate, and read the packet and W-4
  back with pdf-lib; a malformed rate blocks Generate; Your details persist
  across reload while the attendant does not; the signature is not stamped
  without the tick; the previous-packet import round trip; axe WCAG 2.2 AA on
  each view; keyboard reach of the import picker.

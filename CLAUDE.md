# CDASS Enroll

Local-only browser app that fills Colorado CDASS/PPL attendant enrollment
PDFs. Privacy is the core constraint: no runtime network access, no server,
no telemetry. Do not add code that makes outbound requests at runtime; the
CSP in index.html enforces this and should stay.

## Commands

- `python run.py` - preferred launcher: installs if needed, starts the dev
  server at http://127.0.0.1:5180, opens the browser. Also `run.py test`,
  `run.py build`, `run.py serve`, `run.py install`
- The port is pinned to 5180; 5173 belongs to MacroVox's webview on this
  machine, never use it
- `node tests/smoke.mjs` (or `python run.py test`) - run after any change to
  src/extract/ or src/fill/; it fills the real templates into tests/out/
- `npm run setup` - re-vendor WASM/OCR assets into public/ (also runs on
  install)

## Where things live

- `src/schema.js` defines all profile/employer fields; the UI renders from it
- `src/fill/*.js` map exact PDF field names to values, one module per form
  revision; `i9.js` holds the embedded I-9 section. Only the current 2026
  packet is supported (the 2025 mapping was removed; it is in git history)
- `docs/forms.md` documents every mapping, template quirk, and the form
  revision workflow; update it when mappings change
- `src/store.js` persists to localStorage; `src/crypto/vault.js` adds optional
  passphrase encryption at rest (Argon2id via `hash-wasm` + AES-256-GCM,
  opt-in under ⚙ Your details). `docs/threat-model.md` explains what it does
  and does not defend; `node tests/vault.test.mjs` round-trips it
- Blank templates: `public/forms/`. Never commit filled forms or anything
  with real employee data (tests use the fictional Jane Doe)
- `public/seed.local.json` holds Owen's real member/employer details and is
  gitignored; it auto-fills empty employer settings at startup. Never commit
  it or copy its contents into tracked files

## Conventions

- Fill mappings stay flat and dumb (literal field-name strings) so they can
  be diffed against pypdf field dumps when PPL revises a template
- Missing PDF fields degrade to console warnings, never exceptions
- Checkboxes that assert facts (live-in, under-18, relationship) are only
  checked when profile data unambiguously supports them
- Signatures are never fabricated. Only the employer signature is placed, from
  an image the user uploads in Your details (`emp.signature`), overlaid on the
  employer signature lines. The attendant and all other parties (Member, FMS
  vendor, HCPF, preparer) sign by hand
- The signature is standing data, so it outlives the person it was uploaded
  for. Consent is per packet and lives in the UI, not the fillers:
  `genOptions.stampSignature` (memory only, false on every launch and every new
  person) decides, and `generate()` hands the fillers an employer with
  `signature` blanked when it is off. Fillers stay dumb and draw whatever they
  are given; keep the decision in `main.js`
- Rates print onto a form the attendant signs, so money fields are validated
  (`moneyError` in schema.js) and a bad one blocks Generate. Never round or
  auto-correct an amount: tidying `$18.50` to `18.50` is fine, turning `33.517`
  into `33.52` changes someone's pay and is the human's call
- pypdf (Python) is the dev-side tool for dumping/verifying PDF fields

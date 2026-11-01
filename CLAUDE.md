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
- `npx playwright test` (or `python run.py e2e`) - browser UI tests in e2e/,
  run after any UI change. They build and serve on 127.0.0.1:5181, drive the
  installed Edge, and fail on any request off 127.0.0.1 or any console error.
  Results: `npx playwright show-report`; `CDASS_UI_SHOTS=1` screenshots every
  test
- There is no ID scanning (barcode/OCR was removed): the attendant's details
  are typed in once. Do not reintroduce camera or image-reading features

## Where things live

- `src/schema.js` defines all profile/employer fields; the UI renders from it
- `src/fill/*.js` map exact PDF field names to values, one module per form
  revision; `i9.js` holds the embedded I-9 section. Only the current 2026
  packet is filled: the July 2026 update, enrollment form V.3, 29 pages. Its
  page 2 fields are named `TextN`/`Check BoxN`, so they are mapped by position
  (`PAGE2` in packet2026.js). The importer still reads packets filled from the
  July 2025 V.2 form (the 2025 mapping itself was removed; it is in git history)
- `tests/fixtures/complete-packet.mjs` is the fictional complete packet: one
  attendant plus every expected field value. Smoke and e2e tests both check
  against it, so a mapping change starts by updating its expectations
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
- Signatures are never fabricated: each is made by its own signer in the app
  (typed in a system handwriting font or drawn, `src/sigpad.js`) or uploaded,
  and placed only on that signer's lines. Two signers can sign in the app: the
  employer (`emp.signature`, standing data, overlaid on the employer lines) and
  the attendant (`state.attendantSignature`, memory only, never saved, dropped
  for a new person; overlaid on the attendant lines, I-9 Section 1 and W-4
  Step 5). The Member, FMS vendor, HCPF and any preparer sign by hand
- Consent is per signature and per packet, and lives in the UI, not the
  fillers: `genOptions.stampSignature` and `genOptions.stampAttendant` (memory
  only, false on every launch, every new person, and every new signature)
  decide. `generate()` blanks `emp.signature` and passes
  `opts.attendantSignature` as "" when its box is off. Fillers stay dumb and
  draw whatever they are given; keep the decision in `main.js`
- Rates print onto a form the attendant signs, so money fields are validated
  (`moneyError` in schema.js) and a bad one blocks Generate. Never round or
  auto-correct an amount: tidying `$18.50` to `18.50` is fine, turning `33.517`
  into `33.52` changes someone's pay and is the human's call
- pypdf (Python) is the dev-side tool for dumping/verifying PDF fields

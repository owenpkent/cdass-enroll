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
- Signature fields are never auto-filled
- pypdf (Python) is the dev-side tool for dumping/verifying PDF fields

# CDASS Enroll

A local-only web app for filling out Colorado CDASS attendant enrollment
paperwork. Built for household employers who hire their own attendants
through Public Partnerships LLC (PPL), the program's fiscal employer agent.

Enrolling one new attendant means a 28-page PPL packet plus an IRS W-4:
name, address, SSN, and date of birth copied by hand half a dozen times.
This app asks for everything once (or reads it straight off the new hire's
driver's license, passport, or Social Security card), then fills every form
in one click.

**Privacy first.** Everything runs in your browser on this computer. There is
no server, no account, no analytics, and no network access at runtime. ID
photos are decoded in memory and never stored. See
[Privacy model](#privacy-model).

## Quick start

```
python run.py
```

That installs dependencies on first run (including the offline OCR/barcode
assets, ~20 MB), starts the local server, and opens the app at
http://127.0.0.1:5180. Plain npm works too (`npm install`, `npm run dev`).

The app is a single page that handles one person at a time:

1. **One-time, under ⚙ Your details**: enter the Member and employer of record;
   they are reused on every packet.
2. **Step 1, upload documents**: photograph the **back** of the attendant's
   driver's license (the barcode) and their Social Security card; the app
   fills in their details. (Or type them in.)
3. **Step 2, complete their information**: fill what the scans can't know,
   such as banking and the standard hourly rate (the emergency rate defaults
   to $45). Review everything.
4. **Step 3, generate**: set the dates, click Generate. Filled PDFs land in
   your Downloads folder.
5. Print, review every page, sign and date by hand, submit to PPL.

The full walkthrough, including scanning tips and what each form needs, is in
[docs/usage.md](docs/usage.md).

## What it fills

| Form | Template | Notes |
| --- | --- | --- |
| PPL CDASS Attendant Packet 2026 CFC & Waiver | `public/forms/CO-CDASS-Attendant-Packet-2026.pdf` | The current packet: enrollment + agreement, direct deposit, services & rates, tax exemptions, EVV exemption, I-9 |
| IRS W-4 (2026 revision, the file PPL links) | `public/forms/w4.pdf` | Auto-detects the 2020-2023 vs 2024+ field layouts, so a future-year W-4 dropped over this file keeps working |
| Standalone USCIS I-9 | `public/forms/i9.pdf` | Off by default; the packet already embeds an I-9, so use this only if PPL asks for one separately |

Signatures are never fabricated. The app places only your employer signature,
from an image you upload in Your details, on the employer lines; the attendant
and everyone else sign by hand. The app also deliberately leaves a checkbox
blank wherever an attestation is ambiguous (details in
[docs/forms.md](docs/forms.md)).

## Document scanning

All on-device:

- **Driver's license**: photograph the **back**. The PDF417 barcode carries
  name, address, DOB, license number, and expiration in machine-readable
  form, which is far more reliable than OCR of the front.
- **Passport**: photo page. The MRZ (the two `<<<` lines at the bottom) is
  parsed with check-digit validation; values that fail their check digit are
  flagged instead of silently accepted.
- **Social Security card**: OCR for the SSN and printed name.

Extracted values flash yellow in the form so you can review them. Always
review them.

## Privacy model

- **No server.** The app is a static page; nothing is uploaded anywhere.
- **Zero network requests at runtime.** OCR models and barcode-reader WASM
  are vendored to disk by `npm install`. A Content-Security-Policy header
  blocks outbound connections as a second layer of enforcement.
- **ID photos are never stored.** They are decoded in memory and discarded.
- **The person's data stays on this machine**, in browser localStorage,
  unencrypted. Two cleanup layers keep SSNs from lingering: after each
  generation the app **offers to clear sensitive fields** immediately, and the
  saved person **auto-clears after a retention period** (30 days since last
  edit by default; configurable under ⚙ Your details). Your standing details
  survive and re-seed automatically. Treat generated PDFs in Downloads like
  any document with an SSN on it.
- **⚙ Your details** has export (JSON backup), import, and wipe-everything
  buttons alongside the Member/employer fields.
- **Optional seed file.** If a gitignored `public/seed.local.json` exists
  (shape: `{"employer": { ...standing details... }}`), the app loads it into
  Your details the first time it runs in a browser profile. It never
  overwrites existing settings and must never be committed.

## Documentation

| Doc | What's in it |
| --- | --- |
| [docs/usage.md](docs/usage.md) | Step-by-step enrollment walkthrough, scanning tips, submitting to PPL |
| [docs/architecture.md](docs/architecture.md) | How it works: stack, data flow, module map, design decisions |
| [docs/forms.md](docs/forms.md) | Per-form field mappings, template quirks, and how to handle form revisions |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Scan failures, setup problems, data recovery |
| [docs/whitepaper.md](docs/whitepaper.md) | The reusable local-first form-autofill pattern, and how to extend it to other forms (Medicaid, SNAP) |

## Development

```
python run.py          # dev server + browser at http://127.0.0.1:5180
python run.py test     # parser tests + fills every form with sample data
python run.py build    # static build to dist/
python run.py serve    # build, then serve the production build
python run.py install  # npm install / re-vendor assets only
```

The smoke test writes filled PDFs to `tests/out/` (gitignored) so mapping
changes can be spot-checked visually. The dev port is pinned to 5180 because
MacroVox's Tauri webview loads its own dev UI from `localhost:5173` and will
render whatever answers there.

## Disclaimer

This tool fills forms with data you provide. It is not legal, tax, or
immigration advice. Review every generated page before signing or submitting.

Program reference: [PPL Colorado CDASS](https://pplfirst.com/programs/colorado/colorado-consumer-directed-attendant-support-services-cdass/)

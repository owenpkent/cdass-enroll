# CDASS Enroll

A local-only web app for filling out Colorado CDASS attendant enrollment
paperwork. Built for household employers who hire their own attendants
through Public Partnerships LLC (PPL), the program's fiscal employer agent.

Enrolling one new attendant means a 29-page PPL packet plus an IRS W-4:
name, address, SSN, and date of birth copied by hand half a dozen times.
This app asks for everything once, typed by hand, then fills every form
in one click.

**Privacy first.** Everything runs in your browser on this computer. There is
no server, no account, no analytics, and no network access at runtime. It never
reads ID documents; you type the details in. See
[Privacy model](#privacy-model).

## Quick start

```
python run.py
```

That installs dependencies on first run, starts the local server, and opens the app at
http://127.0.0.1:5180. Plain npm works too (`npm install`, `npm run dev`).

The app is a single page that handles one person at a time:

1. **One-time, under ⚙ Your details**: enter the Member and employer of record;
   they are reused on every packet.
2. **Step 1, their information**: type the attendant's details in once, down
   the form sections (banking, the standard hourly rate; the emergency rate
   defaults to $45). Optionally start from a packet you already filled for
   this person. Review everything.
3. **Step 2, generate the PDF**: set the dates, confirm whether your saved
   signature belongs on this packet, add the attendant's signature if they are
   with you, click Generate. Filled PDFs land in your Downloads folder.
4. Print, review every page, sign and date by hand wherever a line is still
   blank, submit to PPL.

The full walkthrough, including what each form needs, is in
[docs/usage.md](docs/usage.md).

## What it fills

| Form | Template | Notes |
| --- | --- | --- |
| PPL CDASS Attendant Packet 2026 CFC & Waiver | `public/forms/CO-CDASS-Attendant-Packet-2026.pdf` | The current packet: enrollment + agreement, direct deposit, services & rates, tax exemptions, EVV exemption, I-9 |
| IRS W-4 (2026 revision, the file PPL links) | `public/forms/w4.pdf` | Auto-detects the 2020-2023 vs 2024+ field layouts, so a future-year W-4 dropped over this file keeps working |
| Standalone USCIS I-9 | `public/forms/i9.pdf` | Off by default; the packet already embeds an I-9, so use this only if PPL asks for one separately |

Signatures are never fabricated. The app places only a signature someone made
for that signer: the employer's (typed or drawn in the app, or uploaded) on the
employer lines, and the attendant's (typed or drawn with the attendant present)
on the attendant lines. Typed signatures use a handwriting font the computer
already has; nothing is downloaded. The Member, the FMS vendor, HCPF and any
preparer always sign by hand. Signatures are per-packet consent: the saved
employer signature is stamped only when you tick the box in Step 2 confirming it
belongs on *this* packet, and that tick clears on every restart and every new
person. The attendant's signature is never saved: it lives in memory, needs its
own "agrees to sign" tick, and is dropped by Start over. The app also deliberately leaves a checkbox
blank wherever an attestation is ambiguous (details in
[docs/forms.md](docs/forms.md)).

## Previous packets

The app does not read ID documents (that was removed in favor of typing the
details in once). The one import is a **previous packet**: hand it a packet you
already filled for this person (under "Optional: start from a packet you already
filled" in Step 1) and it reads the values straight back out of the PDF's form
fields. It brings over identity, contact, address, payment, and rates; the tax,
live-in, and work-authorization answers are attestations, so it leaves those for
you. Imported values flash yellow in the form so you can review them.

## Privacy model

- **No server.** The app is a static page; nothing is uploaded anywhere.
- **Zero network requests at runtime.** A Content-Security-Policy header
  blocks outbound connections as a second layer of enforcement.
- **No ID images are handled.** The app has no photo or scan input; you type
  the details in.
- **The person's data stays on this machine**, in browser localStorage.
  Two cleanup layers keep SSNs from lingering: after each generation the app
  **offers to clear sensitive fields** immediately, and the saved person is
  **cleared when you close the app** (and again on the next launch as a
  backstop). Your standing details survive and re-seed automatically. Treat generated PDFs in Downloads like any document
  with an SSN on it.
- **Optional passphrase encryption at rest.** ⚙ Your details has a "Protect
  saved data with a passphrase" switch. When on, the profile and standing
  details are encrypted with AES-256-GCM under a key derived by Argon2id
  (memory-hard, via the vendored `hash-wasm`); the key lives only in memory and
  the passphrase is entered once per session at an unlock screen. It defends the
  stored bytes against offline access (theft, disk image, backup, another OS
  account); it is not a substitute for OS access control on a shared machine.
  There is no recovery if the passphrase is lost. See
  [docs/threat-model.md](docs/threat-model.md).
- **⚙ Your details** has export (JSON backup), import, and wipe-everything
  buttons alongside the Member/employer fields.
- **Optional seed file.** If a gitignored `public/seed.local.json` exists
  (shape: `{"employer": { ...standing details... }}`), the app loads it into
  Your details the first time it runs in a browser profile. It never
  overwrites existing settings and must never be committed. `signature` is a
  standing detail like any other, so a seed file can carry the signature image
  as a PNG data URL; add `signatureFor` and `signatureUploadedAt` beside it if
  you want Step 2 to name whose signature it is rather than asking.

## Documentation

| Doc | What's in it |
| --- | --- |
| [docs/usage.md](docs/usage.md) | Step-by-step enrollment walkthrough, submitting to PPL |
| [docs/architecture.md](docs/architecture.md) | How it works: stack, data flow, module map, design decisions |
| [docs/forms.md](docs/forms.md) | Per-form field mappings, template quirks, and how to handle form revisions |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Setup problems, signature and rate issues, data recovery |
| [docs/editing-completed-pdfs.md](docs/editing-completed-pdfs.md) | Surgically editing a value on an already-filled (Adobe Fill & Sign) PDF outside the app |
| [docs/whitepaper.md](docs/whitepaper.md) | The reusable local-first form-autofill pattern, and how to extend it to other forms (Medicaid, SNAP) |
| [CHANGELOG.md](CHANGELOG.md) | Notable changes, newest first |

## Development

```
python run.py          # dev server + browser at http://127.0.0.1:5180
python run.py test     # smoke test (fills every form) + vault round trip
python run.py e2e      # browser UI tests (Playwright)
python run.py build    # static build to dist/
python run.py serve    # build, then serve the production build
python run.py install  # npm install only
```

The smoke test writes filled PDFs to `tests/out/` (gitignored) so mapping
changes can be spot-checked visually. It fills the packet from the shared
fictional fixture `tests/fixtures/complete-packet.mjs` and checks 109 field
values against it, and that each signature lands only on its signer's pages; the
browser tests (14) type the same profile in by hand.

The browser UI tests (`npx playwright test`, `npm run test:e2e`, or
`python run.py e2e`) run the production build with `vite preview` on
127.0.0.1:5181 and drive installed Microsoft Edge (override with
`CDASS_UI_BROWSER`). They cover typing the details once and reading the
generated packet and W-4 back, rate validation, persistence, signature making
and consent (employer and attendant), the previous-packet round trip, and axe WCAG 2.2 AA checks on each
view. Every test fails if any request leaves 127.0.0.1 or the console reports an
error. Output goes to `test-results/` and `playwright-report/` (gitignored).

The dev port is pinned to 5180 because
MacroVox's Tauri webview loads its own dev UI from `localhost:5173` and will
render whatever answers there.

## Disclaimer

This tool fills forms with data you provide. It is not legal, tax, or
immigration advice. Review every generated page before signing or submitting.

Program reference: [PPL Colorado CDASS](https://pplfirst.com/programs/colorado/colorado-consumer-directed-attendant-support-services-cdass/)

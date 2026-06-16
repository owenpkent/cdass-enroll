# Changelog

All notable changes to CDASS Enroll are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). No tagged release has
been cut yet; the version in `package.json` is 0.1.0. The initial build is dated
below as 0.1.0, and work since then sits under Unreleased.

## [Unreleased]

### Added
- **Employer signature.** Upload an image of your signature in Your details. It
  is placed on the packet's three employer signature lines and the I-9 Section 2
  employer line. A photo on white paper works; the app knocks out the
  background. Other parties (attendant, Member, FMS vendor, HCPF, preparer) sign
  by hand, and nothing is fabricated.
- **License front scan.** When the barcode will not read, OCR the front of the
  license for date of birth and address (best-effort, verify the values).
- **Crop-to-barcode tool.** When a license barcode does not auto-decode, the
  photo appears with a draw-a-box tool; box just the barcode and the app
  enlarges that region and retries.
- **White paper.** `docs/whitepaper.md` describes the reusable local-first
  form-autofill pattern and relates it to the CCDC Medicaid tool (Coverage
  Compass).
- **Editing completed PDFs.** `docs/editing-completed-pdfs.md` documents how to
  surgically change a value (a rate, a date) on an already-filled Adobe Fill &
  Sign PDF outside the app: redact the old text only so table borders survive,
  then redraw on the same baseline. Includes a change log of such edits.

### Changed
- **Single-person, single-page workflow.** The app now does one person at a time
  on one page: upload documents, review the auto-filled form, generate. The
  reused Member and employer details moved into a "Your details" settings panel.
  This replaces the multi-employee list and tabs; existing data migrates
  automatically to the single profile.
- **Simpler pay rates.** One CDASS standard rate per attendant, with the
  emergency rate defaulting to $45. The Health Maintenance rate fields were
  dropped.
- **Mailing address.** Shown by default and pre-filled from the home address, so
  only a genuinely different mailing address needs editing.
- **Sturdier scanning.** Photos are enhanced (upscaled, high-contrast) before
  decoding, the SSN gets a digits-only OCR pass, and the barcode reader also
  tries rotation, inversion, and a second binarizer. Clearer messages
  distinguish "OCR read nothing" (a load problem) from "no match" (a poor
  photo).
- **Line endings** pinned to LF via `.gitattributes`.

### Fixed
- **W-4 printed blank.** The IRS W-4 is an XFA form; pdf-lib wrote every value
  but Adobe ignored the generated appearances. Setting `NeedAppearances` makes
  the filled W-4 render in every viewer.
- **Social Security card names** with a single-letter middle initial (for
  example "JANE M DOE") now read instead of filling no name.

## [0.1.0] - 2026-06-11

Initial local-only build.

### Added
- Browser app that fills the Colorado CDASS/PPL 2026 attendant enrollment
  packet, the IRS W-4 (2026 revision), and an optional standalone USCIS I-9.
- In-browser document scanning with zero runtime network: driver's license
  PDF417 barcode (AAMVA), passport machine-readable zone with check-digit
  validation, and Social Security card OCR. The barcode and OCR engines are
  vendored to disk, and a Content-Security-Policy blocks outbound requests.
- Schema-driven form UI and PDF field mappings from one source of truth; a
  missing PDF field degrades to a console warning rather than a crash.
- Output is an exact, editable copy of each official template: the form fields
  are filled and never flattened, so any field can still be corrected in a PDF
  reader. Signatures are not fabricated.
- Privacy: data is kept in browser localStorage only; employer settings
  auto-seed from a gitignored seed file; profiles auto-clear after a retention
  period; and the app offers to scrub SSN, date of birth, bank, and ID-document
  data right after generating.
- `run.py` launcher (install, dev, test, build, serve), with the dev server
  pinned to port 5180.
- Smoke test that fills the real templates and verifies the output, plus
  documentation (README, usage, architecture, forms, troubleshooting) and
  CLAUDE.md.

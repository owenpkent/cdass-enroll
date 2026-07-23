# Changelog

All notable changes to CDASS Enroll are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). No tagged release has
been cut yet; the version in `package.json` is 0.1.0. The initial build is dated
below as 0.1.0, and work since then sits under Unreleased.

## [Unreleased]

### Added
- **The license front is now read line by line, not as a whole card.** Whole-card
  OCR gets almost nothing off a modern REAL-ID card: measured on a real Colorado
  license, the holographic security background reduces tesseract's output to
  noise (the name never appeared at all, and the only date it caught was the
  expiry). The same engine reads a *tight crop* of a single line correctly, so
  when fields come back missing `scanLicenseFront` locates the printed text
  lines with a dark-pixel row profile (no OCR, no ML: dark ink spikes over the
  pale background even where OCR fails) and OCRs each line as its own crop, then
  parses the combined text. On the test card that recovers both the full name
  and the true date of birth. The name is picked from adjacent left-aligned line
  pairs (family above given; DOB / DL# / expiry sit further right). Manually, a
  second cropper mode ("Draw a box around the name") OCRs a boxed region via
  `readNameRegion` + the lenient `parseNameRegion`, which strips the punctuation
  OCR makes of the tiny AAMVA field markers. Crops are upscaled and grayscaled
  but deliberately NOT contrast-stretched or sharpened; those steps amplify the
  background and the field markers into letter-like noise (a "2" became "Rs" in
  testing). Auto-chosen crops are held to a higher plausibility bar than
  hand-drawn ones, since no human vouched for them. The address still often will
  not read when it is printed over background artwork; that is left to type.
- **Optional passphrase encryption at rest.** ⚙ Your details has a "Protect
  saved data with a passphrase" switch. When on, the profile and standing
  details are stored as AES-256-GCM envelopes under a key derived by Argon2id
  (memory-hard, m=64 MiB/t=3/p=1, via the newly vendored `hash-wasm`); the
  non-extractable key lives only in memory and the passphrase is entered once
  per session at an unlock gate. `store.js` decrypts once into an in-memory
  cache so its load/save API stays synchronous, and writes ciphertext
  asynchronously; the only cleartext left on disk is the `{ _enc, iv, ct }`
  envelope shell itself, no metadata rides alongside the ciphertext. Wrong
  passphrases are caught by the GCM auth tag (no passphrase hash is stored), and
  a strength floor refuses weak
  passphrases because entropy, not the KDF, dominates. It defends the stored
  bytes against offline access (theft, disk image, backup, another OS account),
  not a live session or a shared unlocked login; `docs/threat-model.md` accounts
  for it vector by vector. No CSP change: `'wasm-unsafe-eval'` was already
  present for OCR, and hash-wasm inlines its WASM so nothing is fetched.
- **Start from a previous packet.** Step 1 takes a filled packet PDF and reads it
  straight back into the form. A filled AcroForm is the most accurate input this
  app has: the agency's own field names against values a human already checked
  and signed, with no OCR or barcode in the way, so it beats every scan. It
  brings over identity, contact, address, payment, and rates, and fills empty
  standing details (Member, employer of record) without overwriting ones already
  set. It deliberately imports nothing the packet phrases as a first-person
  attestation: the tax-exemption statements, the under-18 statements, the EVV
  live-in attestation, and I-9 citizenship stay for the human, because
  re-asserting an old form's word onto a new one is the one thing this pattern
  must not do. Imported values flash yellow for review like any scan.
  `PACKET2026_TEXT` in `src/fill/packet2026.js` is now the single table both
  directions read, and a round-trip smoke test is the contract that keeps them
  agreeing.
- **Member program picks the rate table.** The rates page has three tables and
  the rate belongs in exactly one: CDASS (most members), SLS waiver only, or
  Community First Choice only. A new "Member's program" setting in Your details
  chooses; unset keeps the previous behaviour (the CDASS table). Previously the
  rate always went into the CDASS table, so a CFC member's packet named a rate
  in the wrong table.
- **Employer signature.** Upload an image of your signature in Your details. It
  is placed on the packet's three employer signature lines and the I-9 Section 2
  employer line. A photo on white paper works; the app knocks out the
  background. Crop it close to the writing: the overlay scales the image to the
  height of the signature line and scales any blank margin with it, so a mark
  floating in a border comes out a fraction of the size. Other parties
  (attendant, Member, FMS vendor, HCPF, preparer) sign by hand, and nothing is
  fabricated.
- **License front scan.** When the barcode will not read, OCR the front of the
  license for date of birth and address (best-effort, verify the values).
- **Crop-to-barcode tool.** When a license barcode does not auto-decode, the
  photo appears with a draw-a-box tool; box just the barcode and the app
  enlarges that region and retries.
- **White paper.** `docs/whitepaper.md` describes the reusable local-first
  form-autofill pattern and relates it to the CCDC Medicaid tool (Coverage
  Compass). Section 5.0 covers filling new forms from old ones (form to profile
  to form, mappings as tables that run backwards, and why authoring is the real
  ceiling). Section 5.2 covers what reuse costs the privacy model: the reusable
  artifact holds no personal data, so the two are only in tension if you let
  them be; `default-src 'self'` guarantees same origin, and "nothing leaves the
  device" depends on the origin being the device, so hosting re-opens what
  localhost closed; the leak that matters is metadata (which mapping you
  fetched names the benefit you are applying for), so ship the whole mapping
  library and let people bring the blank form; and a mapping must be data
  rather than a JS module, because an imported module is code execution on a
  page holding SSNs. Section 7 adds the limits reuse exposes: once the operator
  is not the subject, encryption at rest is one prerequisite among several (it
  covers offline access to the stored bytes and the consent point, not a live
  session, the in-memory key, the seed file, or the output PDF), documented
  vector by vector in `docs/threat-model.md`.
- **Editing completed PDFs.** `docs/editing-completed-pdfs.md` documents how to
  surgically change a value (a rate, a date) on an already-filled Adobe Fill &
  Sign PDF outside the app: redact the old text only so table borders survive,
  then redraw on the same baseline. Includes a change log of such edits.

### Changed
- **The saved person is cleared when the app closes and on the next launch, not
  after a retention period.** A `pagehide` handler in `src/main.js` wipes the
  profile the moment the tab closes or navigates away, and
  `clearProfileOnStart()` (`src/store.js`, replacing `purgeStaleProfile`) runs
  once at boot regardless of lock state as the guaranteed backstop if the
  close-time wipe is skipped (a crash, or a straggling async encrypt write).
  There is no more "keep for 7 / 30 / 90 days / until cleared
  manually" dropdown: `getRetentionDays`, `setRetention`, `getRetentionSetting`,
  and `RETENTION_CHOICES` are gone. Your standing details (Member and employer
  of record) still persist and re-seed exactly as before, only the person's
  sensitive per-session data is affected. This also removes the cleartext
  `touchedAt` timestamp that used to sit in envelope metadata to let the
  retention purge run while locked: with nothing left to time, there is nothing
  left to stamp, so the encrypted store now exposes only the `{ _enc, iv, ct }`
  envelope shell in cleartext.
- **Fields that went nowhere were removed.** Gender, municipality, "use the same
  account for all Members", "list in the Attendant directory", and the Step 3
  "Rate effective date" were mapped by the 2025 packet and left orphaned when
  that packet was removed; the 2026 packet does not ask any of them. They were
  collected and written to no form. The license barcode and passport MRZ
  parsers also stop returning sex and issuing country for the same reason:
  whatever a parser returns is stored in the profile, so extracting an unused
  attribute only persists data nothing asks for.
- **Smoke test asserts values, not just that a file came out.** It now reads
  filled values back out of the PDFs and fails on any unresolved field name.
  Previously a renamed field was skipped with a console warning, so a template
  revision could ship a half-empty PDF while every test still passed.
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
- **A license front could fill the expiry date as the date of birth.** The
  "earliest date on the card wins" rule assumed OCR saw every date. When the
  background defeats it and only the expiry survives (exactly what happens on a
  real Colorado card), the earliest date *was* the expiry, so a 2029 expiry was
  silently written into the date of birth. Candidate dates are now filtered to
  those already in the past, since a birth date never is in the future; when
  nothing qualifies the field stays blank for the user to type.
- **The Tax Exemptions Form went out with Part 1 blank.** The form requires one
  of its four statements ("check the box for the one that is true for you"), but
  the profile's relation-to-employer dropdown started empty and every page-11
  checkbox is gated on it, so an untouched dropdown produced an incomplete form
  that had to be checked by hand after generating. It now defaults to "Not
  spouse, parent, or child of the employer", which is true of any attendant who
  is not family. Hiring a relative means changing the dropdown; see
  [docs/forms.md](docs/forms.md).
- **A missing profile key checked the box it was supposed to leave blank.**
  `check(form, name, on = true)` defaulted `on` to `true`, and the age-gated
  guards evaluate to `undefined` (not `false`) when the key is absent, so
  `undefined` took the default and checked the box. A profile without
  `fullTimeStudent` attested "I am under 18 years old" on an adult's signed tax
  form, and one without `paperPayStub` asked for a mailed pay stub. Reachable by
  anything calling the fill modules directly; the app itself was shielded
  because `blankProfile()` seeds checkboxes to `false`, which is also why the
  existing test passed (it set `fullTimeStudent: true` explicitly and never
  exercised the undefined path). `on` no longer has a default.
- **State ID cards lost the ID number.** A non-DL card uses the subfile type
  `ID` (AAMVA D.12.4), so its payload reads `IDDAQ<number>`, and `DDA` (itself
  a valid element ID) matched one character early and swallowed the number,
  which runs to the end of its line. Every state ID was affected and every
  driver's licence was not (`DLDAQ` has no such collision), so the DL-only test
  fixture never saw it. Element IDs are now anchored where AAMVA puts them
  (start of line, or after the subfile type on the header line) instead of
  being searched for at any offset. A state-ID fixture now covers it. This
  matters beyond the licence field: the I-9 List B document number comes from
  it.
- **The license barcode would not decode from ordinary phone photos.** The
  preprocessing upscaled and stretched contrast but never sharpened, which is
  the one thing that matters: on a real 1553px ID photo (~1.3 pixels per
  barcode module) no binarizer decoded it, while an unsharp mask decoded it
  even without upscaling. Phone optics and JPEG leave the bars soft but intact.
  The enhanced pass now sharpens, and the crop tool tries several scales rather
  than one.
- **License barcode scanning was broken end to end.** A decode reported success
  but filled only the license number, with the entire barcode payload as its
  value. zxing defaults to `textMode: "HRI"`, which renders control characters
  as literal placeholders, so the newlines AAMVA uses to separate its elements
  arrived as the four characters `<LF>` and every field after the first was
  swallowed into the first one. Reading with `textMode: "Plain"` fills all 11
  fields (name, DOB, address, license number, expiration). The parser and the
  decoder were each fine and separately tested; nothing covered the seam
  between them, so `tests/smoke.mjs` now decodes a real PDF417 fixture
  (`tests/fixtures/license-barcode-jane-doe.png`) and parses the result.
- **Paper-check Apt/Ste line never filled.** The Direct Deposit mailing address
  field is named `Address 2 (Apt., Ste., or other)`, but the mapping used
  `, or other)`: pypdf splits field names on `.`, so its dump showed only the
  tail. pdf-lib found no such field, warned, and moved on. Only affected packets
  generated with direct deposit turned off.
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

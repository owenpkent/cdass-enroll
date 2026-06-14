# Local-First Form Autofill: A Reusable Pattern for Government Paperwork

A white paper based on **CDASS Enroll**, a local-only tool that fills Colorado
CDASS/PPL attendant enrollment PDFs from documents the applicant already holds.

## Abstract

Government enrollment and renewal forms ask, over and over, for the same
underlying facts: who a person is, where they live, who is in their household,
what they earn, and how they are paid. People fill these forms by hand,
re-typing the same data across programs and across years. It is slow,
intimidating, and error prone. Because the data is highly sensitive (Social
Security numbers, dates of birth, bank and income details), the usual cloud
software model is a poor fit: it asks vulnerable people to hand personal data
to a third party.

This paper describes a different approach, proven in production on Colorado
CDASS attendant enrollment and designed to generalize to Medicaid renewals,
SNAP applications, and similar programs. The idea is simple. Capture a person's
information once, on their own device, from the documents and records they
already have. Then map that information onto any number of official PDFs,
producing exact, still-editable filled copies. Nothing leaves the machine. The
same stored profile and the same extraction pipeline serve every form. Only a
small, per-form field mapping is new each time.

## 1. The problem

Three properties make government paperwork uniquely painful, and uniquely
suited to this pattern:

- **High overlap.** A Medicaid renewal, a SNAP application, and a home-care
  enrollment packet all ask for name, date of birth, address, household
  members, income, and identification. The same person answers the same
  questions for each program, and again every renewal cycle.
- **High sensitivity.** The data includes SSNs, dates of birth, immigration
  status, bank routing and account numbers, and income. A data breach or a
  quiet sale to a data broker is a serious harm, and the people filling these
  forms are often the least able to absorb it.
- **High friction and fragility.** The forms are long, the fields are
  cryptically named, the layouts change between revisions, and a small mistake
  can delay benefits for weeks. Manual transcription is exactly the kind of
  work computers should remove.

The conventional answer is a web service: upload your documents, we fill the
forms. That answer trades the user's privacy for convenience and creates a
breach surface that should not exist. The approach here keeps the convenience
and removes the trade.

## 2. Design principles

These are the principles that made CDASS Enroll work, stated so they can be
carried to any other form.

1. **Local-first, zero runtime network.** All work happens in the browser on
   the user's machine: form filling, barcode decoding, and OCR. There is no
   server, no account, and no telemetry. Third-party engines (the barcode and
   OCR WebAssembly modules and the OCR model) are vendored to disk so the page
   never calls out at runtime, and a Content-Security-Policy header enforces
   that even if a dependency tried.
2. **One data model, many forms.** A single schema is the source of truth for
   every field. The input UI renders from it and the PDF mappings key off it.
   Adding a field is one schema entry plus one line in the relevant mapping.
3. **Capture once, reuse everywhere.** Standing information that is the same on
   every form (in CDASS, the member receiving care and the employer of record)
   is entered once and reused. Per-subject information is captured from the
   documents the person already holds.
4. **Exact, editable output.** The tool fills the real template's form fields
   and never flattens them. The generated PDF is byte-for-byte the same form,
   same pages, same live fields, with values filled in, so the user can still
   correct any field in a normal PDF reader before printing. Signatures are
   never fabricated: the app places only a signature image the signer supplies,
   and every other party's signature line stays blank.
5. **Conservative correctness.** Checkboxes that assert facts (a live-in
   relationship, an age threshold, a tax status) are only checked when the
   stored data unambiguously supports them. Extracted values are shown for
   review, never trusted blindly. Anything uncertain is left for the human.
6. **Privacy hygiene by default.** Sensitive data is cleared on a schedule and
   offered for immediate clearing right after the forms are generated. The tool
   holds the minimum it needs for the minimum time.
7. **Dumb, diffable mappings.** Each form's mapping is a flat list of
   `setField("exact PDF field name", value)`. It is trivial to diff against a
   field dump when the issuer revises a template, and a renamed field degrades
   to a logged warning instead of a crash.

## 3. Architecture

The system is a small set of layers. The first five are a reusable engine; only
the form mapping changes per form.

```
   Documents (ID, SS card)        Standing info        Manual entry / import
   barcode + OCR extraction       (entered once)        (anything not captured)
            \                          |                        /
             \                         |                       /
              ------------>  Person / household profile  <-----
                            (one schema, the source of truth)
                                       |
                         Per-form field mapping module
                       (literal PDF field names -> values)
                                       |
                    Fill the official template's form fields
                      (AcroForm, never flattened, editable)
                                       |
                         Local download (no upload)
```

- **Data model layer.** One schema declares sections and fields with types
  (text, date, SSN, money, select, checkbox). The UI and the fill mappings both
  derive from it, so the model can grow without touching rendering code.
- **Capture layer.** Extraction reads structured and semi-structured documents
  (see Section 4), with manual entry and file import as first-class fallbacks.
  Every captured value is highlighted for the user to verify.
- **Fill layer.** One module per form revision maps exact PDF field names to
  profile values, using tolerant helpers so a missing or renamed field is a
  warning, not an exception. Layout differences between revisions are detected
  by probing for a known field.
- **Output layer.** The template is loaded, its form fields are filled, and it
  is saved without flattening, then handed to the browser as a download. The
  output is verified by an automated test that reloads it and asserts the page
  count and field count match the blank template (proof it stayed an exact,
  editable copy).
- **Persistence and privacy layer.** Data lives in the browser's local storage
  on the device. A retention setting auto-clears it after a chosen period, and
  the app offers to scrub sensitive fields immediately after generating. A
  gitignored seed file can pre-fill the standing information on a fresh setup.
- **UI layer.** A single page renders the schema as a form, with a linear flow:
  upload documents, review the auto-filled fields, generate the PDF.

## 4. Extraction: getting data in without typing

Not all document data is equally easy to capture. The pattern prefers exact
sources and treats everything else as assistive, with the human as the final
check.

- **Structured and exact.** The PDF417 barcode on the back of a US driver's
  license is the DMV's own machine record in the AAMVA format. One decode
  yields name, address, date of birth, and license details exactly. This is the
  gold standard: prefer it whenever a structured source exists.
- **Semi-structured with validation.** A passport's machine-readable zone is
  two fixed-format lines with check digits. The parser validates each field's
  check digit and flags any value that fails, rather than silently filling a
  wrong number.
- **Unstructured OCR, best-effort.** Social Security cards and the front of a
  driver's license have no standard layout, so optical character recognition is
  inherently approximate. Several techniques raise the hit rate without
  pretending to be exact:
  - Image enhancement before OCR (upscale small photos, convert to
    high-contrast grayscale).
  - A second OCR pass constrained to digits when reading a number such as an
    SSN, because the engine is far more accurate when it cannot try to fit
    letters.
  - Tolerant parsing that corrects common character confusions and then
    validates the result against the field's real rules (for example, an SSN
    never starts with certain ranges, so an implausible match is rejected).
  - A user-guided crop, so when a barcode or number is small in the frame the
    person can box just that region and the tool enlarges it before decoding.

The rule across all of these: extraction is a convenience, the stored profile
is the source of truth, and manual entry always remains available. Captured
values are shown highlighted so the person checks them against the document.

## 5. Generalizing to other programs

The engine does not change. What changes for a Medicaid renewal or a SNAP
application is the shape of the data and the set of forms.

- **The profile grows.** CDASS needs identity, address, relationship, pay
  rates, and work authorization. Medicaid and SNAP add household composition,
  income sources and amounts, recurring expenses (rent, utilities, medical
  costs), and assets. These become new schema sections. Because the UI renders
  from the schema, they appear automatically.
- **Forms are added, not rebuilt.** Each new form is a new flat mapping module
  plus, where needed, new schema fields. Existing forms are untouched.
- **Reuse compounds across forms.** A household that qualifies for several
  programs answers the shared questions once. Enter or scan the identity and
  household data a single time, then generate the Medicaid renewal and the SNAP
  application from the same profile. Renewals especially benefit, since the
  prior year's profile can simply be reviewed and regenerated.
- **New capture opportunities, same discipline.** Pay stubs and award letters
  can be OCR'd best-effort for income figures, and a prior export of the
  profile can be imported directly. As with SSN cards, treat OCR of financial
  documents as assistive and verify every number.

Program specifics still require per-form analysis: which fields a given state's
form exposes, how it gates conditional pages, and which attestations it asks
for. That analysis produces a mapping module. The surrounding machinery is
reused as-is.

### 5.1 A live sibling: Coverage Compass (the CCDC Medicaid tool)

This is not hypothetical. **Coverage Compass** is a separate, in-progress
project, built with CCDC (the Colorado Cross-Disability Coalition), that helps
disabled Coloradans keep their Medicaid under Colorado's 2027 work-reporting
rules. It is the same pattern arriving from the other direction, and the two
projects are complementary halves of one kit.

They share the non-negotiable foundation. Both run entirely in the user's
browser with no server, no accounts, and no telemetry, both do OCR locally with
tesseract.js, and in both the documents never leave the device. CDASS Enroll is,
in effect, a running proof of the privacy-by-architecture constraint that
Coverage Compass sets for itself.

They share the central data idea. Coverage Compass is organized around one
personal archive (award letters, waiver paperwork, tax returns, diagnosis
letters) that serves all three of its Medicaid life events: Reporting,
Reapplication, and Appeals. That archive is the same thing this paper calls the
capture-once profile.

Where they meet is the form work, and they approach it from opposite ends.
Coverage Compass starts on the **read** side: a person drops in a letter from
the state, and it classifies the letter, extracts the deadline, and explains it
in plain language (pdf.js plus tesseract.js, matched against an advocate-editable
rule library). Its later phases need the **write** side: generating an exemption
packet (its v0.2) and completing renewals and new applications (its Reapplication
event) is precisely the act of filling official PDFs from the archive. That is
the engine this paper describes, and CDASS Enroll already implements it: load the
real template, fill the AcroForm without flattening, keep every field editable,
gate attestations conservatively, and verify the output is an exact copy. pdf.js
reads PDFs; pdf-lib (used in CDASS Enroll) writes them. The fill layer, the flat
per-form mappings, and the exact-and-editable output discipline are the part
CDASS Enroll contributes to the shared kit.

The division of labor is clean:

| Capability | Where it is proven |
| --- | --- |
| Privacy-by-architecture, local-only, in-browser OCR | both |
| Capture-once personal archive | both as concept; CDASS Enroll has it running |
| Document extraction (barcode, passport MRZ, OCR with verification) | CDASS Enroll |
| Fill official PDFs into exact, editable copies | CDASS Enroll |
| Conservative attestation gating | CDASS Enroll |
| Notice triage: letter classification and deadline extraction | Coverage Compass |
| Advocate-in-the-loop review before anything reaches the state | Coverage Compass |
| Per-state rule library an advocate can edit (YAML) | Coverage Compass |
| WCAG 2.2 AA accessibility, English and Spanish from day one | Coverage Compass |

Read together, the two are one system. CDASS Enroll proves the extraction and
fill engine on a real packet today. Coverage Compass adds the triage, the rules
library, the advocate review, and the accessibility and language work that a
benefits tool for this population requires. The reusable move is to lift the
CDASS Enroll fill engine into Coverage Compass's Reapplication and
exemption-packet flows rather than rebuild it, and to adopt Coverage Compass's
accessibility and plain-language standards back into tools like CDASS Enroll.

One practical note on portability: CDASS Enroll is vanilla JavaScript over
pdf-lib; Coverage Compass is TypeScript and React over pdf.js. The fill layer
moves cleanly between them because it is pure functions over pdf-lib (load a
template, set named fields, save without flattening) with no UI coupling. The
schema and the per-form mapping modules port directly; only the rendering and
storage shells differ.

## 6. Playbook: adding a new form

This is the concrete, repeatable process, the same one used to support each
CDASS template.

1. **Obtain the official fillable PDF** from the issuing agency. Keep the blank
   template in the project; never commit a filled copy or real data.
2. **Dump the field names** so the mapping can be written against exact strings.
   With pypdf:

   ```python
   from pypdf import PdfReader
   r = PdfReader("forms/NEW-FORM.pdf")
   for name, f in (r.get_fields() or {}).items():
       print(f.get("/FT"), name, f.get("/_States_", ""))
   ```

   For placement and the human labels next to each field, walk each page's
   annotations and extract the page text.
3. **Map fields to the schema.** Reuse existing schema fields wherever the form
   asks for data the profile already holds. Add new fields only for genuinely
   new data. The UI renders the additions for free.
4. **Write a flat fill module.** One literal `setField(...)` per PDF field.
   Keep it dumb so it diffs cleanly against the field dump on the next revision.
   Gate fact-asserting checkboxes on unambiguous data.
5. **Add a smoke test.** Fill the real template with sample (fictional) data,
   then reload the output and assert it kept every page and every live field, so
   the result stays an exact, editable copy. Spot-check a few filled values.
6. **Document the quirks.** Shared field names across pages, conditional pages,
   intentionally blank date or signature fields, and attestation gating.
7. **Plan for revisions.** When the issuer renames fields, the flat mapping plus
   a fresh field dump make re-mapping mechanical. Detect layout eras by probing
   for a field that only exists in one of them, and keep superseded mappings in
   version history.

## 7. Risk, compliance, and limits

- **The tool assists; a human signs.** It fills and the person reviews, signs by
  hand, and submits. It does not submit on anyone's behalf. Automated
  submission, if ever added, would need explicit, careful design and consent.
- **Accuracy and liability.** Conservative filling and verify-everything OCR
  reduce the chance of a wrong value reaching an official form, but the person
  is responsible for what they sign. The review step is not optional.
- **Privacy and security.** Local-first removes the breach surface of a server,
  which is the central benefit. The remaining trade-off is that data sits in
  browser storage unencrypted on the device; a passphrase-encrypted store is the
  natural upgrade where the threat model warrants it. Generated PDFs contain the
  same sensitive data and should be stored or shredded accordingly.
- **OCR is approximate.** Structured sources should always be preferred, and the
  human verification step is what makes OCR safe to offer at all.
- **Forms and jurisdictions vary.** State forms differ and revise on their own
  schedules. The flat-mapping discipline is what keeps that maintainable.

## 8. Why local-first is the right default here

For programs that serve people in difficult circumstances, trust is not a
detail. A tool that runs entirely on the user's device, makes no network
requests, and keeps no account is one a caseworker or family member can adopt
without asking anyone to surrender personal data. It works offline, costs
almost nothing to run, has no breach surface, and can be audited by reading the
page source. Those properties are worth as much as the time the autofill saves.

## 9. Conclusion

The pattern is short to state: capture a person's information once, from what
they already have, and map it onto many official PDFs while keeping everything
local and editable. CDASS Enroll is the existence proof. The same engine, with
a grown profile schema and a handful of new mapping modules, extends to Medicaid
renewals, SNAP applications, and the long tail of forms that ask the same
questions again and again. The work that is new per form is small and
mechanical. The work that matters, doing it privately and getting it right, is
already built.

## Appendix: CDASS Enroll components mapped to the generic architecture

| Generic layer | CDASS Enroll implementation |
| --- | --- |
| Data model | `src/schema.js` (sections and fields; UI and mappings derive from it) |
| Capture: barcode | `src/extract/aamva.js` (AAMVA PDF417 from the license back) |
| Capture: OCR | `src/extract/mrz.js`, `ssncard.js`, `dlfront.js` (passport, SS card, license front) |
| Capture: orchestration | `src/extract/scanner.js` (image enhancement, digit-only pass, crop) |
| Fill: per-form mapping | `src/fill/packet2026.js`, `w4.js`, shared `i9.js` |
| Fill: tolerant helpers | `src/fill/util.js` (missing field warns, never throws) |
| Output | template load, AcroForm fill without flattening, local download |
| Persistence and privacy | `src/store.js` (local storage, retention, scrub, seed, export/import) |
| UI | `src/main.js` (single-page upload, review, generate) |
| Verification | `tests/smoke.mjs` (fills real templates, asserts exact editable output) |

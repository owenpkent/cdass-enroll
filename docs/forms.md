# Form templates and field mappings

Each supported form has a mapping module in `src/fill/` that pairs exact PDF
field names with profile/employer values. Field names are the contract:
when PPL or the IRS revises a template, names change and mappings must be
re-checked. This file records what each mapping covers, the quirks baked
into the original PDFs, and the revision workflow.

## CO-CDASS-Attendant-Packet-2026 (current) — `src/fill/packet2026.js`

Source: "CO-CDASS-Attendant-Packet-2026-CFC-and-Waiver" from the PPL program
page. 28 pages, 272 fields, descriptive field names (a full rebuild compared
to 2025; nothing carried over except the embedded I-9).

What gets filled:

| Pages | Form | Filled from |
| --- | --- | --- |
| 2-7 | Attendant Enrollment and Agreement | name, DOB, SSN, addresses, contact, relationship to Member, printed names, signature dates |
| 8-9 | Direct Deposit | bank info as one digit per box; paper-check address block when direct deposit is off |
| 10 | Services and Rates | new-service vs rate-change, CDASS + SLS Health Maintenance rates, signature dates |
| 11 | Tax Exemptions | relation-to-employer and age-gated attestations |
| 13-15 | EVV Attestation of Exemption | only when the profile marks the attendant as live-in |
| 19-22 | USCIS I-9 | Section 1 + Section 2 documents (via `src/fill/i9.js`) |

Quirks of the original PDF (not bugs in this app):

- **Shared "Date" field.** The attendant signature date on the Direct Deposit
  page is the same PDF field as the FMS-vendor signature date on the EVV
  exemption form, so the app leaves it blank. Date it by hand when signing.
- **Per-digit bank boxes.** Routing/account numbers are 9 and 13 individual
  one-character fields ("Routing number 1".."9", "Account number 1".."13").
- **EVV exemption City/State/ZIP are shared with the I-9 employee address.**
  Harmless: a live-in attendant's address is the shared residence anyway.
- **Age-gated attestations.** "I am under 18 years old and a full-time
  student", "...under the age of 21" etc. are only checked when the date of
  birth confirms the age, regardless of the profile toggles.

## CO-CDASS-Attendant-Packet-2025 (legacy) — `src/fill/packet2025.js`

17 pages, 211 fields, mostly auto-generated field names ("First_3",
"undefined_2"). Kept for completeness; off by default in the Generate tab.

Quirks:

- **One shared signature-date field** ("Date") across the enrollment,
  agreement, rate, FLSA, EVV, and difficulty-of-care pages: one value dates
  them all.
- **"Document Title 1" is shared** between I-9 Section 2 List A and the
  Supplement B (rehire) row 1, so a List A title (e.g. "U.S. Passport") also
  shows on the rehire page. Supplement B is only used for rehires; disregard
  for new hires.
- **The "mailing same as home" checkbox is broken in the PDF** (one field
  shared across three unrelated checkboxes on pages 2, 7, and 8), so the app
  copies the home address into the mailing section instead of checking it.
- **Routing/account fields are literally named** `undefined_2`/`undefined_3`.

## IRS W-4 — `src/fill/w4.js`

The bundled template is the 2024 revision (the one PPL links). The IRS kept
Steps 1-2 field names stable since the 2020 redesign but renumbered the rest
in 2024:

| Value | 2020-2023 | 2024+ |
| --- | --- | --- |
| Step 3 total | f1_09 | f1_08 |
| 4(a) other income | f1_10 | f1_09 |
| 4(b) deductions | f1_11 | f1_10 |
| 4(c) extra withholding | f1_12 | f1_11 |
| Employer name/address | f1_13 | f1_12 |
| First date of employment | f1_14 | f1_13 |
| EIN | f1_15 | f1_14 |

The filler detects the layout by whether `f1_08` exists, so either era of
W-4 dropped onto `public/forms/w4.pdf` fills correctly. Filing status is
three sibling checkboxes (`c1_1[0..2]`), not a radio group.

## I-9 (embedded in both packets) — `src/fill/i9.js`

Both PPL packets embed the same USCIS I-9 build with identical field names,
so the mapping is shared. Document logic:

- Profile has a **passport number**: List A gets "U.S. Passport" with number
  and expiration.
- Otherwise a **driver's license**: List B (title, issuing state, number,
  expiration), and if an SSN is present, List C gets the Social Security
  card.
- The I-9 SSN field has `maxLength=9`, so it gets digits without dashes.

## When a form is revised

1. Download the new PDF from the PPL program page and drop it into
   `public/forms/` (keep the old one until the new mapping is verified).
2. Dump its field names and compare with the current mapping:

   ```python
   from pypdf import PdfReader
   r = PdfReader("public/forms/NEW.pdf")
   for name, f in (r.get_fields() or {}).items():
       print(f.get("/FT"), name, f.get("/_States_", ""))
   ```

   For page placement and the labels next to each field, walk
   `page["/Annots"]` for widget rectangles and use `page.extract_text()`.
3. Update or clone the mapping module. Unmatched fields are skipped with a
   console warning rather than crashing, so a partial mapping still fills
   what it can while you work.
4. Watch for shared fields (same name, widgets on multiple pages): filling
   one fills them all, which is sometimes a feature (repeated name headers)
   and sometimes a trap (the 2026 "Date" field above).
5. Run `node tests/smoke.mjs`, then open the PDFs in `tests/out/` and check
   every page visually.

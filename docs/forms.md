# Form templates and field mappings

Each supported form has a mapping module in `src/fill/` that pairs exact PDF
field names with profile/employer values. Field names are the contract:
when PPL or the IRS revises a template, names change and mappings must be
re-checked. This file records what each mapping covers, the quirks baked
into the original PDFs, and the revision workflow.

## CO-CDASS-Attendant-Packet-2026 (current): `src/fill/packet2026.js`

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
- **The shared State field also surfaces on the Direct Deposit page**, so the
  paper-check mailing State box shows the attendant's state even when direct
  deposit is selected. Cosmetic only.
- **Age-gated attestations.** "I am under 18 years old and a full-time
  student", "...under the age of 21" etc. are only checked when the date of
  birth confirms the age, regardless of the profile toggles.

## CO-CDASS-Attendant-Packet-2025 (removed)

The previous packet (17 pages, 211 auto-generated field names like "First_3"
and "undefined_2") was supported until June 2026 and then removed since PPL
only accepts the current packet. If it is ever needed again, the mapping
lives in git history (`src/fill/packet2025.js`, removed in the same commit
that deleted the template).

## IRS W-4: `src/fill/w4.js`

The bundled template is the 2026 revision (downloaded from PPL's link, whose
filename still says 2024). The IRS kept Steps 1-2 field names stable since
the 2020 redesign but renumbered the rest in 2024:

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

## I-9: `src/fill/i9.js`

The I-9 mapping is its own module because the same USCIS build appears in
two places with identical field names: embedded in the PPL packet (pages
19-22) and as the standalone `public/forms/i9.pdf` that PPL links (off by
default in the Generate tab, for when PPL requests a separate copy). The
only difference found so far: the standalone's employee State field is a
dropdown, which `setText` in `util.js` handles transparently.

Document logic:

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

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
| 10 | Services and Rates | new-service vs rate-change, CDASS standard + emergency rate into the table the Member's program selects, signature dates |
| 11 | Tax Exemptions | relation-to-employer (defaults to "not a relative") and age-gated attestations |
| 12-17 | EVV Attestation of Exemption | six printed pages, but fillable fields only on 13-15; filled only when the profile marks the attendant as live-in |
| 19-22 | USCIS I-9 | Section 1 + Section 2 documents (via `src/fill/i9.js`) |

The employer signature lines on pages 7, 10, 11 have no form field, so when
`emp.signature` (an uploaded PNG data URL) is present it is drawn onto those
pages and the I-9 Section 2 line as an image overlay. Coordinates are the
`EMPLOYER_SIGNATURE` table in `packet2026.js`; nudge them there if a signature
sits off its line. Other parties' signature lines are never filled.

### The three rate tables (page 10)

The rates page carries three tables with parallel field names, and a rate
belongs in exactly one of them:

| Table | Applies to | Field names |
| --- | --- | --- |
| 1 | Most members (any waiver except SLS) | `CDASS Standard Rate`, `CDASS Emergency Rate` |
| 2 | Members on the Supported Living Services (SLS) waiver only | `SLS CDASS ...` (plus `SLS Health Maintenance ...`) |
| 3 | Members in Community First Choice (CFC) only | `CFC CDASS ...` (plus `CFC Legally Responsible Person Homemaker ...`) |

Which table to use is a property of the **Member**, not the attendant, so it
comes from `emp.memberProgram` (set under ⚙ Your details) via the `RATE_TABLE`
map in `packet2026.js`. Unset means Table 1. Writing the rate into the wrong
table produces a wrong form rather than a blank one, so the smoke test asserts
that each program fills its own table and leaves the other two empty.

The Other Rate boxes, SLS Health Maintenance, and CFC Legally Responsible
Person Homemaker are left blank: the app sets a single CDASS rate. Fill them by
hand if those services are added.

Quirks of the original PDF (not bugs in this app):

- **Field names can contain periods.** The Direct Deposit paper-check line is
  `Address 2 (Apt., Ste., or other)`. pypdf builds its field tree by splitting
  on `.`, so a dump shows only the tail (`, or other)`) and the parent stubs
  (`Address 2 (Apt`). pdf-lib wants the full name. Cross-check any dotted name
  against pdf-lib's `getForm().getFields().map(f => f.getName())` before
  mapping it.
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
- **Tax Exemptions Part 1 has a default, unlike every other attestation.** The
  form requires exactly one of its four statements, so leaving it blank is not
  a conservative choice, it is an incomplete form that PPL bounces. The profile
  field `relationToEmployer` therefore defaults to `none`, which checks "I am
  not the spouse, parent, or child of the employer". **Hiring a relative means
  changing that dropdown**, or the packet gives up a FICA/FUTA exemption the
  attendant is entitled to and has them sign a statement that isn't true.
- **`check()` takes no default for its `on` argument.** Guards read like
  `p.fullTimeStudent && years < 18`, which is `undefined` (not `false`) when the
  key is missing from the profile. `check(form, name, on = true)` turned that
  missing data into a checked box, so a sparse profile silently attested "I am
  under 18 years old". `blankProfile()` masks this in the app because it seeds
  every checkbox to `false`; anything calling the fill modules directly does not
  get that protection. Pass `true` explicitly when you mean "always check".
- **Part 1 statement 2 has three sub-conditions (a/b/c) that are never filled.**
  When `relationToEmployer` is `parent`, the qualifying grandchild-care boxes go
  to PPL blank because the schema collects nothing that could drive them. Only
  affects employers hiring their own parent.

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

**XFA quirk.** The W-4 is an XFA form. pdf-lib strips the XFA and writes the
values, but Adobe then ignores the generated appearance streams and shows the
form blank. The filler sets `NeedAppearances` true so the viewer draws the
values; Chrome and similar keep using the appearance streams, so both render.
Without that flag the W-4 looks empty even though every field is filled.

## I-9: `src/fill/i9.js`

The I-9 mapping is its own module because the same USCIS build appears in
two places with identical field names: embedded in the PPL packet (pages
19-22) and as the standalone `public/forms/i9.pdf` that PPL links (off by
default under Step 3, for when PPL requests a separate copy). The
only difference found so far: the standalone's employee State field is a
dropdown, which `setText` in `util.js` handles transparently.

Document logic:

- Profile has a **passport number**: List A gets "U.S. Passport" with number
  and expiration.
- Otherwise a **driver's license**: List B (title, issuing state, number,
  expiration), and if an SSN is present, List C gets the Social Security
  card.
- The I-9 SSN field has `maxLength=9`, so it gets digits without dashes.

## The license barcode (AAMVA PDF417)

Not a PPL form, but the same shape of problem: an external format whose contract
this app depends on, where a spec revision or a wrong assumption silently
produces a half-filled form. It has its own document, because the payload
structure and the three defects it has already produced need more room than a
section: **[id-barcode.md](id-barcode.md)**.

The short version, if you are only passing through:

- Element IDs are anchored at the start of their line, never searched for. A
  state ID's subfile type spells `IDDAQ`, whose `DDA` is a valid element ID one
  character early, and it eats the license number. Test both card types.
- zxing must read with `textMode: "Plain"`. Its default mangles the newlines
  AAMVA separates elements with.
- Only elements the forms ask for are extracted; whatever a parser returns is
  persisted into the profile.

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
   Remember that pypdf splits names on `.`, so any field whose own name
   contains a period shows up truncated; confirm those against pdf-lib's
   `getFields()` names, which is what the mappings actually pass.
3. Update or clone the mapping module. Unmatched fields are skipped with a
   console warning rather than crashing, so a partial mapping still fills
   what it can while you work.
4. Watch for shared fields (same name, widgets on multiple pages): filling
   one fills them all, which is sometimes a feature (repeated name headers)
   and sometimes a trap (the 2026 "Date" field above).
5. Run `node tests/smoke.mjs`, then open the PDFs in `tests/out/` and check
   every page visually.

The smoke test is built around step 3's tolerance being a double-edged sword.
Because a renamed field is skipped with a console warning rather than an
exception, a revision can silently ship a half-empty PDF that still has the
right page count and byte size. So the test does two things beyond filling:

- It captures those warnings and fails on any of them, which asserts that
  every name the mappings write still exists in the templates.
- It reads representative values back out of the filled bytes (names, SSN
  formatting, per-digit bank boxes, rate table routing, I-9 List A vs List B/C,
  age-gated attestations, the W-4 employer block), so a field that resolves but
  receives the wrong value is caught too.

Keep both when adding a mapping: a new field name with no readback assertion is
only half covered.

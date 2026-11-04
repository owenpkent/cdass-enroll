# Form templates and field mappings

Each supported form has a mapping module in `src/fill/` that pairs exact PDF
field names with profile/employer values. Field names are the contract:
when PPL or the IRS revises a template, names change and mappings must be
re-checked. This file records what each mapping covers, the quirks baked
into the original PDFs, and the revision workflow.

Every filler saves through `saveAsNewDocument` (`src/fill/util.js`), which
gives the output a fresh random trailer `/ID`. pdf-lib otherwise keeps the
template's ID, so every person's W-4 shared one identity with the blank form,
and PDF viewers that key saved state by it (PDF.js fingerprints, Folio's
per-document signatures and edits) laid one person's signature over the next
person's form. Keep it on any new filler.

## CO-CDASS-Attendant-Packet-2026 (current): `src/fill/packet2026.js`

Source: "CO-CDASS-Attendant-Packet-2026-CFC-and-Waiver-Update" from the PPL
program page (PDF ModDate 2026-07-02). 29 pages, 265 template fields. The
Attendant Enrollment and Agreement Form is V.3, June 2026 (V.2, July 2025, was
6 pages); everything after it is unchanged but one page later. Most names are
descriptive; V.3 page 2 is the exception (below).

What gets filled:

| Pages | Form | Filled from |
| --- | --- | --- |
| 2-8 | Attendant Enrollment and Agreement (V.3) | name, DOB, SSN, addresses, contact, relationship to Member, printed names, signature dates |
| 9-10 | Direct Deposit | bank info as one digit per box; paper-check address block when direct deposit is off |
| 11 | Services and Rates | new-service vs rate-change, CDASS standard + emergency rate into the table the Member's program selects, signature dates |
| 12 | Tax Exemptions | relation-to-employer (defaults to "not a relative") and age-gated attestations |
| 13-18 | EVV Attestation of Exemption | six printed pages, but fillable fields only on 14-16; filled only when the profile marks the attendant as live-in |
| 20-23 | USCIS I-9 | Section 1 + Section 2 documents (via `src/fill/i9.js`) |

### V.3 page 2 positional names

V.3 page 2 lost its descriptive field names; they are `Text1`..`Text24` and
`Check Box25`..`Check Box33`, mapped by position (the `PAGE2` table in
`packet2026.js`; each `PACKET2026_TEXT` entry also carries `v2:`, the V.2 name,
which the previous-packet importer uses). Diff a new template against this map,
not against names.

| V.3 name | What it is | V.2 name |
| --- | --- | --- |
| `Text1` | Employer Name (new on page 2) | none |
| `Text2` | Member Name | `Member Name: first and last` |
| `Text3` | Member PPL ID | `Member PPL ID` |
| `Text4` | Attendant full name (first, middle, last) | `Attendant Name: first, middle and last` |
| `Text5` | Maiden or previous name | `Attendant maiden or previous name` |
| `Text6` | Date of birth | `Attendant date of birth` |
| `Text7` | SSN | `Attendant Social Security Number` |
| `Text8`-`Text13` | Physical address: street, Apt/Ste, city, state, county (`Text12`), ZIP (`Text13`) | `Attendant physical address ...` |
| `Text14`-`Text18` | Mailing address: street, Apt/Ste, city, state, ZIP | `Attendant mailing address ...` (five fields) |
| `Text19` | Mailing county (left blank, no profile key) | `Attendant mailing address county` (also unfilled) |
| `Text20`-`Text24` | Email, cell phone, home/other phone, primary language, best contact times | `Attendant email` ... `Best contact times for the attendant` |
| `Check Box25`-`28` | Preferred contact: email, cell, home, mail | `The attendant prefers to be contacted by ...` |
| `Check Box29` | Mailing address same as physical | `Check the box if the address where you live is the same as your mailing address` |
| `Check Box30`-`33` | Relationship: spouse, parent, other relative, non-relative | `Spouse`, `Parent`, `Other Relative`, `NonRelative` |

### Fields V.3 dropped, recreated by the app

V.3 printed the "Do you want PPL to text you" Yes/No boxes as glyphs and removed
the whole page-8 signature block's fields. `addV3Fields()` recreates them as
real fields with invisible borders so the output stays fillable and the
importer and smoke test keep working: the two text-me checkboxes (same V.2
names) exactly over the printed boxes, `Employer Printed Name: first and last`
as a new text field, and extra widgets on page 8 for the existing shared fields
`Attendant signature date`, `Attendant Printed Name: first and last` and
`Employer signature date` (the last shared with Tax Exemptions page 12, as V.2
shared it with its page 7). Widgets are 14pt tall so auto-size text fits.
Output field count = template + 1 (page 9 mailing State split) + 3
(`V3_ADDED_FIELDS`).

Signature lines have no form field, so signatures are drawn as image overlays
(a transparent PNG cropped to the ink) at the coordinates in the
`EMPLOYER_SIGNATURE` and `ATTENDANT_SIGNATURE` tables in `packet2026.js` (and the
overlays in `i9.js` and `w4.js`); nudge them there if a signature sits off its
line. A signature is only ever placed on its own signer's lines:

| Signer | Where | Source |
| --- | --- | --- |
| Employer | packet pages 8, 11, 12 and I-9 Section 2 (page 20); standalone I-9 Section 2 | `emp.signature`, standing data |
| Attendant | packet pages 8, 10 (direct deposit), 11, 12 and I-9 Section 1 (page 20); standalone I-9 Section 1; W-4 Step 5 | made in Step 2, memory only |
| Member, FMS vendor, HCPF, preparer | never | sign by hand |

The EVV caregiver lines are not filled: that form marks the caregiver signature
optional.

Signatures can be made in the app by typing (rendered in a handwriting font the
computer already has: Segoe Script, Ink Free, Lucida Handwriting, Brush Script
MT, then the browser's `cursive`; nothing is bundled or downloaded) or by
drawing on a pad (`src/sigpad.js`). Either way the output is the same shape as a
cleaned uploaded image.

The fillers stay dumb about consent: they draw whatever signature they are
given. Deciding whether this packet gets it is `main.js`'s job. The employer's
saved signature is blanked unless the Step 2 stamp box was ticked for this
packet. The attendant's made signature is passed only while its own "agrees to
sign this packet" tick is set; it is never stored, and the tick clears whenever
a new signature is made. Keep it that way, or a signature made for one person
starts riding along on the next one's forms.

**Crop the signature image to the ink, or the mark comes out small.**
`overlaySignature` scales the image to the placement box's *height* (22pt on the
packet lines), and it scales the whole image, blank margin included. So a margin
baked into the file eats the box and the writing shrinks to whatever fraction is
left. The same signature, measured on a 300x22 line:

| Image | Aspect | Drawn | Ink height |
| --- | --- | --- | --- |
| Cropped to the writing | ~5.8:1 | 128pt wide | ~19pt |
| Same mark, 2:1 with margin | 2:1 | 44pt wide | ~7pt |

Width only becomes the constraint past about 13.6:1, where the image is clamped
to the line's width and the height shrinks instead. An image lifted out of
another PDF is the usual offender, since it carries that document's placement box
with it as padding; crop to the alpha bounding box first.

### The three rate tables (page 11)

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
  page (10) is the same PDF field as the FMS-vendor signature date on the EVV
  exemption form (page 15). `fillPacket2026` splits the page 10 widget into
  its own field, `Direct deposit attendant signature date`, and prints the
  signature date there; the vendor's date on page 15 stays blank.
- **Per-digit bank boxes.** Routing/account numbers are 9 and 13 individual
  one-character fields ("Routing number 1".."9", "Account number 1".."13").
- **EVV exemption City/State/ZIP are shared with the I-9 employee address.**
  Harmless: a live-in attendant's address is the shared residence anyway.
- **Page 9 "State" is the same PDF field as the I-9 and EVV State.** One
  field, three widgets (Direct Deposit page 9, EVV page 14, I-9 page 20, the
  last a dropdown). Writing it for the paper-check mailing address would
  overwrite the I-9 state, and leaving it alone made the page 9 box show the
  home state beside an out-of-state mailing city/ZIP. `fillPacket2026` calls
  `splitWidgetToOwnField` (util.js) before `getForm()` to detach the page 9
  widget into its own text field, `Payment mailing State`, which is written with
  the mailing state (home state when the mailing address is the same). The
  other two widgets stay shared. Page 9 `Zip Code` and `City` are separate
  fields (the I-9 ones are `ZIP Code` and `City or Town`).
- **MaxLen boxes.** I-9 `ZIP Code` is MaxLen 6, `USCIS ANumber` 10, `Form I94
  Admission Number` 11, SSN 9. pdf-lib rejects a longer value and the box stays
  blank, so the mapping sends the 5-digit ZIP (not ZIP+4), A-Number digits only
  (no "A", hyphens, spaces), and I-94 alphanumerics only. `setText` logs a
  warning naming the field, value length and MaxLen if anything still overflows.
- **EVV "legally responsible" question** asks about the caregiver's
  relationship to the Member (`relationship`), not the employer. A spouse
  checks Yes and writes "Spouse"; a parent is left for the human, since parents
  are only legally responsible for a minor or ward.
- **I-9 List C (Social Security card)** is listed only when the profile's
  "Social Security card was examined" box (`ssnCardPresented`, default off) is
  checked, alongside the driver's license. The license issuer comes from
  `dlState` only and is blank when unknown.
- **W-4 amounts** are normalized (punctuation only) before writing; the Step 3
  total is summed in integer cents and left blank if any entered part is not a
  valid amount. Only `rate: true` fields get the $1-$200 bounds.
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

**Step 5 has no fields.** Neither the employee signature nor its Date is a
form field. The attendant signature is overlaid at (104, 92), and the
signature date is drawn as text at (465, 93) on the Date line (x 460-576,
y 90) whenever a signature date is set, like the packet's printed dates.

**XFA quirk.** The W-4 is an XFA form. pdf-lib strips the XFA and writes the
values, but Adobe then ignores the generated appearance streams and shows the
form blank. The filler sets `NeedAppearances` true so the viewer draws the
values; Chrome and similar keep using the appearance streams, so both render.
Without that flag the W-4 looks empty even though every field is filled.

## I-9: `src/fill/i9.js`

The I-9 mapping is its own module because the same USCIS build appears in
two places with identical field names: embedded in the PPL packet (pages
20-23) and as the standalone `public/forms/i9.pdf` that PPL links (off by
default under Step 2, for when PPL requests a separate copy). The
only difference found so far: the standalone's employee State field is a
dropdown, which `setText` in `util.js` handles transparently.

Document logic:

- Profile has a **passport number**: List A gets "U.S. Passport" with number
  and expiration.
- Otherwise a **driver's license**: List B (title, issuing state, number,
  expiration), and if an SSN is present, List C gets the Social Security
  card.
- The I-9 SSN field has `maxLength=9`, so it gets digits without dashes.

Section 2's signer line (`Last Name First Name and Title of Employer or
Authorized Representative`) is written `Last, First, Title` of the employer,
who in CDASS is the Member. If the employer name is empty it degrades to just
the title (`Employer`) with no name, an incomplete form PPL bounces, so the
smoke test now reads it back on both the embedded and standalone copies.

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
5. Update the expectations in `tests/fixtures/complete-packet.mjs`
   (`EXPECTED_PACKET`, field -> value pairs, blanks and unchecked boxes
   included), then run `node tests/smoke.mjs`, then open the PDFs in `tests/out/` and check
   every page visually.

The smoke test is built around step 3's tolerance being a double-edged sword.
Because a renamed field is skipped with a console warning rather than an
exception, a revision can silently ship a half-empty PDF that still has the
right page count and byte size. So the test does two things beyond filling:

- It captures those warnings and fails on any of them, which asserts that
  every name the mappings write still exists in the templates.
- It reads representative values back out of the filled bytes (names, SSN
  formatting, per-digit bank boxes, rate table routing, I-9 List A vs List B/C,
  the I-9 Section 2 employer name, age-gated attestations, the W-4 employer
  block), so a field that resolves but receives the wrong value is caught too.

The fixture is shared: `tests/smoke.mjs` fills the packet from its fictional
attendant and checks all 109 pairs, and `e2e/enroll.spec.mjs` types the same
profile into the app and checks the downloaded PDF against the same table, so
a renamed field or moved page needs one edit there, not two. Smoke also builds
a synthetic V.2-shaped AcroForm to prove old packets still import.

Keep both when adding a mapping: a new field name with no readback assertion is
only half covered.

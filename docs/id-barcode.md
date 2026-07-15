# Reading the barcode on a driver's license or state ID

The fastest, most accurate way to fill an attendant's name, address, and date of
birth is to not type them. The back of every US driver's license and state ID
carries a PDF417 barcode holding those fields as exact, machine-readable text
with error correction. This app decodes it in the browser, on this machine, with
no network. It is the only capture path that cannot silently misread a value:
the barcode has error correction, so it either decodes correctly or not at all.
(Contrast the SSN card, where OCR can hand you a plausible wrong number and
nothing can tell. See [troubleshooting.md](troubleshooting.md).)

This document is the whole contract: the payload format, the traps that broke it
in production, the measured limits of what a photo can decode, and how to
reproduce any of it. Read it before changing `src/extract/aamva.js` or the
barcode path of `src/extract/scanner.js`.

**Primary source.** AAMVA *DL/ID Card Design Standard*, section D.12 ("Data
encoding structures"). It is copyright AAMVA and is not committed here
(`.gitignore` covers the filename); download it from
[aamva.org](https://www.aamva.org/) if you need to check a claim below. Every
citation is to that section.

---

## The payload

A compliant symbol is a **file header**, a list of **subfile designators**, then
the **subfiles** carrying the data. Here is a real Colorado state ID's header,
with the ID number masked, exactly as it decodes:

```
<RS><CR>ANSI 636020100102ID00410259ZC03000010IDDAQ#########
```

Broken apart:

| Bytes | Field | Example | Notes |
| --- | --- | --- | --- |
| 1 | Compliance indicator | `@` | Always the first character (D.12.3) |
| 1 | Data element separator | `LF` (0x0a) | Also separates every element |
| 1 | Record separator | `RS` (0x1e) | Third character, always present |
| 1 | Segment terminator | `CR` (0x0d) | Fourth character |
| 5 | File type | `ANSI ` | Trailing space is part of it |
| 6 | Issuer ID (IIN) | `636020` | Colorado |
| 2 | AAMVA version | `10` | |
| 2 | Jurisdiction version | `01` | |
| 2 | Number of entries | `02` | How many subfile designators follow |
| 10 each | Subfile designators | `ID00410259`, `ZC03000010` | type(2) + offset(4) + length(4) |
| 2 | Subfile type | `ID` | Each subfile *restates* its type here |
| rest | Elements | `DAQ` + value, `LF`, `DCS` + value, ... | One per line |

Two consequences fall out, and both have bitten:

1. **The first element has no line of its own.** It trails the subfile type on
   the header line. Every other element starts a line.
2. **The subfile type is `DL` or `ID`.** `DL` for a driver's license, `ID` for a
   non-driver state ID (D.12.4). Jurisdictions add their own as `Z` plus the
   first letter of the jurisdiction, so `ZC` is Colorado's. We read none of those.

Elements used: `DAQ` license number, `DCS` last, `DAC` first, `DAD` middle,
`DBB` date of birth, `DBA` expiration, `DAG` street, `DAI` city, `DAJ` state,
`DAK` ZIP. Dates are `MMDDCCYY` in the US and `CCYYMMDD` in Canada, which
`aamvaDate()` disambiguates.

---

## Trap 1: the phantom `DDA` (state IDs lose their license number)

**Symptom.** A state ID scans, fills name, address and date of birth, and
silently omits the license number. Driver's licenses are perfect.

**Cause.** The subfile type runs straight into the first element with no
separator. On a driver's license that spells `DLDAQ`; on a state ID, **`IDDAQ`**.
One character in:

```
I D D A Q 1 2 3 ...
  ^^^^^          "DDA" is a real AAMVA element ID (compliance type)
    ^^^^^        "DAQ" is the element that is actually there
```

Any code that searches for element IDs at arbitrary offsets finds `DDA` first,
one character early. Because a value runs to the end of its line, that phantom
`DDA` swallows `DAQ` and the whole license number with it. A driver's license is
immune only by luck: `DLD` happens not to be a valid element ID.

**Fix.** Anchor element IDs where the spec puts them, never search for them.
`elementStart()` returns 0 for a normal line, and on the header line the offset
just past the subfile type.

**Why it survived.** Every fixture was a driver's license. This affects **every
state ID in the country** and is not a Colorado quirk. It also silently drops the
I-9 List B document number, which is the field the form actually needs.
`tests/fixtures/state-id-barcode-jane-doe.png` now covers it.

---

## Trap 2: zxing's default text mode mangles the separators

**Symptom.** A perfect decode fills exactly one field: the license number, whose
value is the entire barcode payload.

**Cause.** zxing's `textMode` defaults to **`HRI`** (Human Readable
Interpretation), which renders control characters as literal placeholders, so a
newline arrives as the four characters `<LF>`. AAMVA separates every element
with a real `LF` (D.12.3), so the payload collapses onto one line and every
element after the first is absorbed into the first one's value:

```
Plain: "...DLDAQ123456789\nDCSDOE\nDACJANE\n..."   -> 11 fields
HRI:   "...DLDAQ123456789<LF>DCSDOE<LF>DACJANE..." -> 1 junk field
```

**Fix.** `AAMVA_READ_OPTIONS` in `aamva.js` pins `textMode: "Plain"`. It lives
beside the parser that requires it, not at the call site: importing
`scanner.js` in Node poisons zxing (its `locateFile` override reaches for
`document`), so the contract would not otherwise be testable.

### The subtlety: Text vs Binary content

zxing only escapes under HRI when it classifies content as `Binary`, and it
classifies on the presence of control characters:

| Payload | contentType | Under HRI |
| --- | --- | --- |
| Real card (has `@`, `LF`, `RS`, `CR` per D.12.3) | `Binary` | escaped, **breaks** |
| A sample missing `RS`/`CR` | `Text` | untouched, works fine |

**A sample barcode that is not byte-compliant with D.12.3 does not represent a
real card and hides this entire class of bug.** Both fixtures here carry the full
header.

---

## Trap 3: soft photos need sharpening, not upscaling

**Symptom.** "No PDF417 barcode found" on a photo that looks perfectly readable.

**Measured, on a real 1553px state ID photo** whose PDF417 sits at ~1.3 pixels
per module (the theoretical floor is ~2):

| Preprocessing | Decodes? |
| --- | --- |
| Raw | no |
| Upscale x2 | no |
| Contrast stretch (autocontrast) | no |
| Otsu threshold | no |
| **Unsharp mask, no upscale** | **yes** |
| Unsharp + upscale | yes |

Sharpening is the only thing that matters, and the app had every step except
sharpening. Phone optics and JPEG leave the bars soft but *intact*; an unsharp
mask restores the edges. `unsharp()` in `scanner.js` runs after the
grayscale/contrast pass, and the crop tool tries several scales.

**Do not use synthetic blur to evaluate this.** Gaussian blur destroys
information by construction and nothing recovers it, so a synthetic test will
tell you sharpening is useless. Real softness is recoverable. That distinction
cost a wrong conclusion once already.

**Sharpness beats resolution.** A sharp photo decodes with the whole card at
~900px; a blurred one fails at 1800px. So the user-facing advice is "tap to
focus and hold still", not "get closer".

---

## Fixtures

Both are the fictional Jane Doe, matching the sample profile the rest of the
suite uses. Never commit a real document.

| File | Card type | Covers |
| --- | --- | --- |
| `tests/fixtures/license-barcode-jane-doe.png` | Driver's license (`DL`) | Decode to parse, and the textMode contract |
| `tests/fixtures/state-id-barcode-jane-doe.png` | State ID (`ID`) | Trap 1, which a `DL` fixture cannot see |

`node tests/smoke.mjs` decodes both with the real `AAMVA_READ_OPTIONS` and
asserts the parsed fields. Each assertion has been checked to fail when its fix
is reverted; a test that cannot fail is worth nothing.

---

## Diagnosing "it will not scan"

Work in this order. Steps 1-2 cost seconds and answer most reports.

1. **Is it decodable at all?** Crop to the barcode and try a matrix: scales 1-3,
   binarizers `LocalAverage` and `GlobalHistogram`, with and without an unsharp
   mask. If something decodes and the app does not, that is our bug.
2. **Measure pixels per module.** Take a scanline across the barcode, run-length
   encode it, and look at the narrowest run. Below ~2px, no amount of code helps
   and the honest answer is "retake it in focus".
3. **Check the content type.** `readBarcodes(...)` returns `contentType`. A real
   card must be `Binary`. A fixture that reads `Text` is not compliant and is
   lying to you.
4. **Look at element IDs, not values.** Print the code at the start of each line
   and the value's *length*. Never print the values.
5. **Confirm the seam.** Decode to parse is where the bugs were. Each half can be
   perfect while the pair is broken.

---

## Rules for changing this code

- **Never print a decoded payload** into a log, a test name, or a bug report. It
  is someone's identity document. Element IDs and value lengths diagnose
  anything above.
- **Only extract elements a form asks for.** The barcode also carries sex,
  height, eye and hair colour. Whatever a parser returns is written into the
  profile and persisted, so extracting an unused element is a privacy cost with
  no benefit.
- **Test both card types.** A change that passes on a `DL` fixture tells you
  nothing about state IDs, as trap 1 proves.
- **Trust the spec over the sample.** Both parsing traps were invisible because
  the only end-to-end artifact was a non-compliant sample. When they disagree,
  the sample is wrong.

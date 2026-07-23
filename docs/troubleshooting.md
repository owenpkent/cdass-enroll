# Troubleshooting

## Scanning

The barcode path has its own reference, including a step-by-step recipe for
diagnosing a scan that will not read: [id-barcode.md](id-barcode.md).

**"No PDF417 barcode found" on a driver's license**

- You need the **back** of the card (the wide striped rectangle), not the
  front.
- **Focus matters more than getting close.** A sharp photo decodes even when
  the whole card is only ~900px wide, while a soft one can fail at 1800px. If
  it will not read, tap the screen to focus and hold still rather than moving
  nearer. The app sharpens before decoding, which rescues the ordinary softness
  of phone optics and JPEG, but it cannot undo real motion blur.
- Lay the card flat, square-on, no glare across the barcode. Indirect daylight
  works better than a flash.
- Crop the photo to roughly the card before uploading if the background is
  busy.
- The app automatically retries with an upscaled, high-contrast version of the
  photo (and a second binarizer), so if it still fails the barcode is likely out
  of focus, too small in the frame, or you photographed the front by mistake.
- When auto-decoding fails, the photo appears with a draw-a-box tool. Box just
  the striped barcode tightly and the app enlarges that region and retries,
  which rescues a barcode that was small in the frame.
- No luck with the barcode? Use the **License front** scan instead: it OCRs the
  front for name, date of birth, and address (best-effort, verify it). Or type the
  details in (license number, state, expiration, address, and DOB are all
  editable). Very worn cards sometimes have unreadable barcodes.

**The barcode scan says it worked but only filled the license number**

Fixed. This was a bug, not your photo: zxing was returning the payload with
newlines rendered as the literal text `<LF>`, so the AAMVA parser read the
entire barcode as one giant license number. If you see this again, the
`textMode` in `AAMVA_READ_OPTIONS` (`src/extract/aamva.js`) has regressed;
`node tests/smoke.mjs` covers it.

**A state ID card scanned, but the ID number is missing**

Fixed, and it was specific to ID cards rather than driver's licenses. A non-DL
card uses the subfile type `ID` (AAMVA D.12.4), so its payload reads
`IDDAQ<number>`, and `DDA` is itself a valid element ID that starts one
character early and swallowed the number. `DL` cards were unaffected because
`DLDAQ` contains no such collision, which is why it went unnoticed. Both card
types now have a barcode fixture in `tests/fixtures/`.

**The SSN came out wrong (one digit off) and nothing warned me**

Possible, and undetectable by the app. An SSN has no check digit, so a misread
of `1` as `4` produces an equally valid-looking number. The digits-only second
OCR pass is not a safeguard here: it shares an engine and image with the first
pass and misreads the same character the same way. **Always read the SSN back
against the card**, or just type it. The passport MRZ is different: it carries
check digits, so a bad read is flagged rather than accepted.

**Passport MRZ won't read or values look wrong**

- Photograph the whole photo page straight-on; the two `<<<` lines at the
  bottom must be sharp and unwarped (a curled page is the usual culprit).
- The parser validates check digits. A value that fails its check digit is
  reported as unverified in the status line rather than filled; fix it by
  hand from the document.
- The first OCR run after opening the app takes a few seconds while the
  worker boots. Later scans are fast.

**SSN card OCR misses the number or name**

- Even lighting, no shadows across the card, fill the frame.
- The app retries with an enhanced (upscaled, high-contrast) image and
  tolerates common digit misreads (I for 1, S for 5, and so on), but OCR on
  these cards is still the least reliable of the three scans.
- If it keeps missing, just type the nine digits into the SSN field; verify
  every digit either way.

## Setup

**OCR says it can't load, or scans hang**

`public/tessdata/eng.traineddata` is probably missing (the one-time download
during `npm install` may have been blocked). Re-run:

```
npm run setup
```

or manually place an `eng.traineddata` (from the tesseract-ocr
`tessdata_fast` repo) at `public/tessdata/eng.traineddata`.

**Dev server won't start: port in use**

The port is pinned to 5180 with `strictPort`, so it fails instead of moving.
Find the squatter with `Get-NetTCPConnection -LocalPort 5180` and stop it, or
change the port in `vite.config.js`. Do not move it to 5173: MacroVox's
webview loads its own dev UI from there and will display this app instead.

**The app appears inside the MacroVox window**

Same cause as above: something served this app on port 5173 while MacroVox
was in dev mode. Stop that server; this repo's config avoids 5173 on purpose.

## Generated PDFs

**A field is empty that should be filled**

Open the browser console during Generate. Every field the filler could not
find logs a warning like `text field not set: <name>`. That usually means a
template revision renamed it; see "When a form is revised" in
[forms.md](forms.md).

**A date box near a signature is blank**

Some are intentional. The 2026 packet's Direct Deposit date shares a PDF
field with the EVV vendor date, so it is left for hand-dating. Signature
fields are never filled by design.

**The employer signature prints tiny**

The overlay scales your image to the height of the signature line and scales the
blank margin with it, so a signature floating in a wide border shrinks to a
fraction of the line. Re-upload it cropped tight to the writing; roughly 6:1 fills
a packet line the way a real signature does. This bites hardest on an image
lifted out of another PDF, which carries that document's placement box as
padding. Details in [forms.md](forms.md).

**Values look right in the app but the printed PDF shows old data**

Regenerate after editing; PDFs are snapshots. Also confirm you opened the
newest download, not an earlier one with the same name plus ` (1)`.

## Data

**The saved person disappeared**

First check: the app clears the saved person when you close it, and again when
you reopen it; there is no setting to keep it longer. A note at the top of the
page says when this happened. This is by design, so SSNs don't sit on disk
indefinitely.

Otherwise: the profile lives in browser localStorage, scoped to browser +
origin (`127.0.0.1:5180`). Causes: a different browser or profile, "clear
browsing data" including site data, or a changed dev port (a different origin
means empty storage). Recover by importing the JSON backup from Your details;
if you never exported one and the data was cleared, it is gone, which is the
flip side of local-only storage. Export a backup after entering real data.

If there is no backup but you still have a packet you generated for that person,
**Previous packet** in Step 1 reads most of it back: identity, contact, address,
payment, and rates, plus any Member/employer details still blank. It does not
recover the tax, live-in, or work-authorization answers, which are attestations
and are never imported, and it does not recover the signature, because it reads
form fields and the signature is drawn onto the page as an image rather than
stored in a field.

**Recovering a signature from a packet you already signed**

The signature is not a form field, but it is still embedded in the PDF, so a
signed packet is a usable source when the browser storage that held it is gone.
Pull the image out with any PDF tool (with PyMuPDF, find the signature-sized
image on page 11 and composite it with its soft mask so the transparency
survives), **crop it to the writing**, flatten it onto white, and re-upload it
under Your details. Cropping is not optional: see "The employer signature prints
tiny" above. This works whether the app placed the image or you signed the packet
in Adobe.

**Moving to a new computer**

Under Your details: Export on the old machine, Import on the new one, then Wipe
all data on the old machine. The export JSON contains SSNs; transfer it on
something you control and delete it after importing. This is the only in-app path
that carries the **signature image**, since Previous packet cannot.

Two other routes exist when the old machine is gone. `public/seed.local.json`
takes a `signature` key like any other standing detail (a PNG data URL), so a
seed file can pre-load it on a fresh browser profile, subject to the usual rule
that the seed only applies when every standing field is still empty. Failing
that, recover it from a signed packet as above.

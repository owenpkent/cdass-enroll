# Troubleshooting

## Scanning

**"No PDF417 barcode found" on a driver's license**

- You need the **back** of the card (the wide striped rectangle), not the
  front.
- Lay the card flat, fill the frame, square-on, no glare across the barcode.
  Indirect daylight works better than a flash.
- Crop the photo to roughly the card before uploading if the background is
  busy.
- Very worn cards sometimes have unreadable barcodes; type the details in
  manually.

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
- OCR on these cards is the least reliable of the three scans. Verify every
  digit; correcting by hand is expected sometimes.

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

**Values look right in the app but the printed PDF shows old data**

Regenerate after editing; PDFs are snapshots. Also confirm you opened the
newest download, not an earlier one with the same name plus ` (1)`.

## Data

**Profiles disappeared**

Profiles live in browser localStorage, scoped to browser + origin
(`127.0.0.1:5180`). Causes: a different browser or profile, "clear browsing
data" including site data, or a changed dev port (different origin = empty
storage). Recover by importing the JSON backup from the Privacy & data tab;
if you never exported one and the data was cleared, it is gone, which is the
flip side of local-only storage. Export a backup after entering real data.

**Moving to a new computer**

Privacy & data tab: Export on the old machine, Import on the new one, then
Wipe all data on the old machine. The export JSON contains SSNs; transfer it
on something you control and delete it after importing.

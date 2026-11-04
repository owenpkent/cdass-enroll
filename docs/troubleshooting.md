# Troubleshooting

## Setup

**`npm run setup` is gone**

The app no longer vendors OCR or barcode assets, so there is nothing to
download after `npm install`. If an old note tells you to run it, skip it. A
leftover `public/vendor/` or `public/tessdata/` folder from an older checkout
can be deleted.

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

Every attendant and employer signature line is dated with the **Signature
date** from Step 2, including the Direct Deposit date (page 10) and the W-4
Step 5 Date, which the W-4 has no field for. Packets made before 2026-11-03
left those two blank: regenerate them. Lines for the Member, FMS vendor
(including its date on the EVV form, page 15), HCPF and a preparer are never
filled by design.

**The attendant signature is missing from the packet**

It is placed only when the attendant signature was made in Step 2 and its
**agrees to sign this packet** tick is set; making a new signature clears the
tick. It is never saved, so a reload, **Start over**, a new person or a
previous-packet import drops it. The status line after generating says when a
made signature was left off for want of the tick. The EVV caregiver lines stay
blank by design.

**A typed signature looks like plain text**

The app draws it in a handwriting font the computer already has (Segoe Script,
Ink Free, Lucida Handwriting, Brush Script MT) and falls back to the browser's
generic cursive when none is installed. Nothing is downloaded, so a machine
without one of those fonts gets a plainer result. Draw it on the pad instead.

**The employer signature is missing from the packet**

It is stamped only when **Stamp this signature on the employer signature lines**
is ticked in Step 2, and that tick is off again every time the app restarts and
every time you start a new person. This is deliberate: the signature is standing
data that outlives the person it was made for, and an unnoticed reuse means a
packet signed by someone who never agreed to sign it. The status line after
generating says which happened, and the Step 2 box shows the image, whose
signature it is, and when it was made.

**Step 2 says the signature was uploaded for someone else**

The employer of record under Your details no longer matches the name recorded
when the signature was uploaded. Upload the right signature, or leave the box
unticked and sign the employer lines by hand, or make a new signature. A signature saved before the app
recorded provenance says so instead of naming anyone; clear and re-upload it to
get the name attached.

**Generate refuses and points at a rate**

A rate has to be a plain dollars-and-cents amount in a plausible hourly range,
because it prints onto a form the attendant signs. `33.517`, `18.5o`, and
`0.25` all stop the packet with the field named. The app will not round for you:
`33.517` could be `33.51` or `33.52`, and picking one would change what someone
gets paid. A leading `$` or thousands commas are fine and get tidied away when
you leave the box.

**The employer signature prints tiny**

The overlay scales your image to the height of the signature line and scales the
blank margin with it, so a signature floating in a wide border shrinks to a
fraction of the line. Re-upload it cropped tight to the writing; roughly 6:1 fills
a packet line the way a real signature does. This bites hardest on an image
lifted out of another PDF, which carries that document's placement box as
padding. Details in [forms.md](forms.md).

**Another person's signature shows on a form in Folio or another viewer**

The PDF itself is clean; the viewer is drawing something saved for a different
file. Some viewers (Folio, anything built on PDF.js) keep signatures and edits
you add in them under the PDF's internal document ID. Forms generated before
2026-11-03 all kept the blank template's ID, so a signature placed on one
person's W-4 in the viewer reappeared on every later W-4. Each generated form
now gets its own random ID. Regenerate older forms, and clear the stale
annotations in the viewer if it offers that.

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

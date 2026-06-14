# Enrolling an attendant, step by step

This is the full workflow for filling a CDASS attendant's enrollment packet
with this app. It does one person at a time. Total time once you have their
documents: about ten minutes.

To start the app: `python run.py` in the project folder. It installs anything
missing on first run and opens http://127.0.0.1:5180 in your browser.

The whole app is a single page: upload documents at the top, review the
auto-filled form in the middle, generate the PDF at the bottom. Your own
reused details live behind the **⚙ Your details** button in the top right.

## One-time: set up "Your details"

Open **⚙ Your details** (top right). This information is the same on every
packet, so enter it once:

- **Member**: the person receiving care (first/last name, PPL ID, and
  Medicaid ID; the Medicaid ID is only used on the EVV exemption form for
  live-in attendants).
- **Employer of record**: whoever signs as the employer. For the I-9 and W-4
  employer blocks, also fill the business/organization name (something like
  "Jane Smith, Household Employer" works), business address, and EIN.
- **Employer signature** (optional): upload an image of your signature (a phone
  photo of it on white paper is fine; the app knocks out the background). It is
  placed on the employer signature lines of every packet and the I-9. The
  attendant and all other parties still sign by hand.

Everything saves as you type. If `public/seed.local.json` exists (it does on
the original machine), these fields arrive pre-filled the first time the app
runs in a browser profile. Click **← Back to enrollment** when done.

## Step 1: Upload identification documents

The scan card is at the top of the page. Use a phone photo or any image file:

- **License barcode**: photograph the **back** of the card. The app reads
  the PDF417 barcode (the wide striped rectangle), which contains their full
  name, address, date of birth, license number, and expiration exactly as the
  DMV recorded them. Tips: lay the card flat, fill the frame, avoid glare. This
  is the most accurate license scan. If it won't decode, the app shows the
  photo and lets you drag a box around just the barcode to retry.
- **License front**: if the barcode won't read, photograph the **front** of
  the card. OCR best-effort fills the date of birth and address (the name comes
  from the Social Security card). Front layouts vary by state, so verify these
  fields; the license number and expiration still need typing.
- **Passport**: photograph the photo page straight-on with the whole page in
  frame. The app reads the two machine-readable `<<<` lines and validates
  their check digits. The first OCR run takes a few seconds to warm up.
- **Social Security card**: photograph the front, well lit. The app extracts
  the SSN and printed name.

Which documents you need depends on the I-9:

- A **U.S. passport** alone satisfies the I-9 (List A).
- Otherwise use a **driver's license** (List B) **plus** a **Social Security
  card** (List C). This is the most common combination.

Every value a scan fills in flashes yellow. Check each one against the
physical document, especially OCR results from the SSN card.

## Step 2: Complete their information

The form is auto-filled from the scans and from Your details. Work down the
sections and fill what the scans cannot know:

- Contact details, preferred contact method, texting consent.
- **Mailing address**: the scan fills the address printed on the license. If
  mail should go somewhere else, uncheck "Mailing address is the same"; the
  mailing fields unlock pre-filled from that address so you can change just
  what differs (a different street, a PO Box, etc.).
- **Payment**: bank name, routing and account numbers for direct deposit
  (or uncheck direct deposit for paper checks).
- **Work details**: relationship to the Member, the living situation (this
  drives the EVV exemption pages), and the relation-to-employer question
  (this drives the tax exemption attestations).
- **Pay rates**: the CDASS standard rate is per attendant (for reference,
  past hires were $15 in 2021 and $18 in late 2024). The emergency rate is
  pre-filled at $45; change it only if a specific attendant differs. Health
  Maintenance rate boxes on the form are left blank.
- **I-9 work authorization**: citizenship status; extra numbers only if they
  are a permanent resident or visa holder.
- **W-4 withholding**: filing status and any Step 2-4 amounts. When in doubt
  leave the money fields blank; the attendant can always file a new W-4.

## Step 3: Generate the PDF

At the bottom of the page:

- **Signature date**: printed next to every signature line (default today).
- **First day of employment**: goes on the I-9 and W-4.
- Leave "new service" checked for a new hire.
- Click **Generate & download**. One PDF per selected form lands in
  Downloads, named like `Doe-Jane-CDASS-packet-2026.pdf`.

Each PDF is an exact, editable copy of the official packet with the fields
filled in, so you can still adjust anything in your PDF reader before
printing.

## Step 4: Print, sign, submit

- Review **every page**. The app fills conservatively, but you are the one
  signing.
- Sign and date by hand wherever a signature is required. If you uploaded an
  employer signature in Your details, the employer lines are already signed; the
  attendant and other parties still sign by hand. A few date boxes are
  intentionally left blank because of template quirks; see [forms.md](forms.md).
- Pages that don't apply (I-9 Supplement A/B, rehire sections) stay blank.
- Submit per PPL's current instructions. CO CDASS customer service:
  1-888-752-8250, ppcdass@pplfirst.com. EVV help desk: 833-204-9041,
  ppl_cs_evv@pplfirst.com.
- The attendant cannot start working until PPL issues a Good-to-Go notice.

## Afterwards

- Right after generating, the app offers to **clear the attendant's
  sensitive data** (SSN, date of birth, bank details, ID document numbers)
  while keeping their name, contact, and rates. Take it once the forms are
  printed and you won't need to regenerate.
- **Start over (new person)** at the bottom clears the current person so you
  can enroll the next one.
- Generated PDFs contain the attendant's SSN. Store or shred them the way
  you would any tax document.
- Anything you keep still auto-clears after the retention period (30 days
  since last edit by default, adjustable under ⚙ Your details). Your standing
  details persist and re-seed.
- ⚙ Your details can export a JSON backup before the data expires. Keep it
  somewhere encrypted if you keep it at all.

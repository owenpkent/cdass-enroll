# Enrolling a new attendant, step by step

This is the full workflow for onboarding a new CDASS attendant with this app.
Total time once you have their documents: about ten minutes.

## Before the first hire: set up the Employer & rates tab

This information is the same for every attendant you hire, so enter it once:

- **Member**: the person receiving care (first/last name, PPL ID, and
  Medicaid ID; the Medicaid ID is only used on the EVV exemption form for
  live-in attendants).
- **Employer of record**: whoever signs as the employer. For the I-9 and W-4
  employer blocks, also fill the business/organization name (something like
  "Jane Smith, Household Employer" works), business address, and EIN.
- **Default pay rates**: the standard and emergency hourly rates for CDASS
  and Health Maintenance. These come from your task worksheet / budget.

Everything saves as you type.

If `public/seed.local.json` exists (it does on the original machine), this
tab arrives pre-filled with the standing member/employer details the first
time the app runs in a browser profile; only the current pay rates need
checking.

## Step 1: Add the employee

Employees tab, "+ Add employee". You land in the editor.

## Step 2: Scan their documents

The fastest path is the scan card at the top of the employee editor. Use a
phone photo or any image file:

- **Driver's license**: photograph the **back** of the card. The app reads
  the PDF417 barcode (the wide striped rectangle), which contains their full
  name, address, date of birth, license number, and expiration exactly as the
  DMV recorded them. Tips: lay the card flat, fill the frame, avoid glare.
  The front of the card is not used.
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

## Step 3: Complete the rest of the profile

Work down the sections. Things the scans cannot know:

- Contact details, preferred contact method, texting consent.
- **Payment**: bank name, routing and account numbers for direct deposit
  (or uncheck direct deposit for paper checks).
- **Work details**: relationship to the Member, the living situation (this
  drives the EVV exemption pages), and the relation-to-employer question
  (this drives the tax exemption attestations).
- **I-9 work authorization**: citizenship status; extra numbers only if they
  are a permanent resident or visa holder.
- **W-4 withholding**: filing status and any Step 2-4 amounts. When in doubt
  leave the money fields blank; the attendant can always file a new W-4.

## Step 4: Generate

Generate forms tab:

- Pick the employee.
- **Signature date**: printed next to every signature line (default today).
- **First day of employment**: goes on the I-9 and W-4.
- Leave "new service" checked for a new hire.
- Click **Generate & download**. One PDF per selected form lands in
  Downloads, named like `Doe-Jane-CDASS-packet-2026.pdf`.

## Step 5: Print, sign, submit

- Review **every page**. The app fills conservatively, but you are the one
  signing.
- Sign and date by hand wherever a signature is required. A few date boxes
  are intentionally left blank because of template quirks; see
  [forms.md](forms.md).
- Pages that don't apply (I-9 Supplement A/B, rehire sections) stay blank.
- Submit per PPL's current instructions. CO CDASS customer service:
  1-888-752-8250, ppcdass@pplfirst.com. EVV help desk: 833-204-9041,
  ppl_cs_evv@pplfirst.com.
- The attendant cannot start working until PPL issues a Good-to-Go notice.

## Afterwards

- Generated PDFs contain the attendant's SSN. Store or shred them the way
  you would any tax document.
- The Privacy & data tab can export a JSON backup of all profiles. Keep it
  somewhere encrypted if you keep it at all.

# Enrolling an attendant, step by step

This is the full workflow for filling a CDASS attendant's enrollment packet
with this app. It does one person at a time. Total time once you have their
documents: about ten minutes.

To start the app: `python run.py` in the project folder. It installs anything
missing on first run and opens http://127.0.0.1:5180 in your browser.

The whole app is a single page: type the attendant's information in the
middle, generate the PDF at the bottom. Your own
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
  photo of it on white paper is fine; the app knocks out the background). **Crop
  it close to the writing.** The image is scaled to the height of the signature
  line, margin and all, so a wide border around the mark shrinks the mark. The
  app records whose signature it is (the employer of record at the time of
  upload) and shows that back in Step 2 before anything is stamped. The
  attendant and all other parties still sign by hand.

Everything saves as you type. If `public/seed.local.json` exists (it does on
the original machine), these fields arrive pre-filled the first time the app
runs in a browser profile. Click **← Back to enrollment** when done.

## Step 1: Their information

The app does not read ID documents. Type the attendant's details in once,
working down the form sections, from their driver's license, Social Security
card, or passport in your hand. Which documents you need depends on the I-9:

- A **U.S. passport** alone satisfies the I-9 (List A).
- Otherwise use a **driver's license** (List B) **plus** a **Social Security
  card** (List C). This is the most common combination. The license number,
  state, and expiration, the SSN card, and any passport details go under
  **Identity documents (I-9 Lists B and C)**.

Optional: a collapsed section at the top, **Start from a packet you already
filled for this person**, takes a **previous packet** PDF (a re-hire, a
correction, or a packet from your old computer). The app reads the values out of
the PDF's own form fields, so nothing is guessed. It fills identity, contact,
address, payment, and rates, plus any Member/employer details you have not set
yet, and it never overwrites standing details you already entered. It does not
import the tax, live-in, or work-authorization answers: those are attestations
the signer makes, so set them yourself each time. Imported values flash yellow;
check each one.

Then work down the rest of the sections. The Member and employer fields come
from Your details:

- Contact details, preferred contact method, texting consent.
- **Mailing address**: the residence address. If
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
  Maintenance rate boxes on the form are left blank. Dollars and cents only: a
  stray third decimal (`33.517`) is flagged under the box and stops Generate,
  since rounding it for you would change what the attendant is paid.
- **I-9 work authorization**: citizenship status; extra numbers only if they
  are a permanent resident or visa holder.
- **W-4 withholding**: filing status and any Step 2-4 amounts. When in doubt
  leave the money fields blank; the attendant can always file a new W-4.

## Step 2: Generate the PDF

At the bottom of the page:

- **Signature date**: printed next to every signature line (default today).
- **First day of employment**: goes on the I-9 and W-4.
- Leave "new service" checked for a new hire.
- **Employer signature**: a saved signature is stamped only when you tick
  **Stamp this signature on the employer signature lines**, and the tick clears
  every time the app restarts and whenever you start a new person. The box shows
  the signature, whose it is, and when it was uploaded, and warns if the
  employer of record has changed since. Left unticked, every signature line
  comes out blank for hand signing.
- Click **Generate & download**. One PDF per selected form lands in
  Downloads, named like `Doe-Jane-CDASS-packet-2026.pdf`. Rates are checked
  first: a rate that is not a plain dollars-and-cents amount (`33.517`) stops
  the packet with a message rather than printing. The app never rounds it for
  you, because that would change what someone gets paid.

Each PDF is an exact, editable copy of the official packet with the fields
filled in, so you can still adjust anything in your PDF reader before
printing.

## Step 3: Print, sign, submit

- Review **every page**. The app fills conservatively, but you are the one
  signing.
- Sign and date by hand wherever a signature is required. If you ticked the
  stamp box in Step 2, the employer lines are already signed; the attendant and
  other parties still sign by hand. A few date boxes are
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
- Anything you keep still clears when you close the app, and again the next time
  you open it; there is no setting to keep it longer. Your standing details
  persist and re-seed.
- ⚙ Your details can export a JSON backup before the data expires. The export
  is plaintext even when at-rest encryption is on, so keep it somewhere
  encrypted if you keep it at all.

## Passphrase encryption (optional)

- Under ⚙ Your details, **Protect saved data with a passphrase** encrypts the
  saved person and standing details at rest. Choose a passphrase of at least
  four random words; there is no recovery if you lose it.
- Once on, opening the app shows an **unlock screen**. Enter the passphrase to
  decrypt for the session. Closing the tab re-locks it; **Lock now** re-locks
  without closing.
- **Change passphrase** re-keys the stored data; **Turn off encryption** writes
  it back as plaintext. The saved person is still cleared on close and on the
  next launch whether or not encryption is on, and even while locked.
- It protects the stored bytes if the device or its storage is taken. It does
  not protect a session you leave unlocked, and it is not a substitute for a
  locked OS account on a shared computer. See
  [threat-model.md](threat-model.md).

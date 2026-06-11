# CDASS Enroll

A local-only app for filling out Colorado CDASS / PPL attendant enrollment
paperwork. Built for household employers enrolling new attendants through
Public Partnerships LLC (PPL).

Program reference: [PPL Colorado CDASS](https://pplfirst.com/programs/colorado/colorado-consumer-directed-attendant-support-services-cdass/)

## Privacy model

- **No server, no accounts, no analytics.** The app is a static page that runs
  entirely in your browser on this machine.
- **Zero network requests at runtime.** OCR models and barcode-reader WASM are
  vendored locally at install time. A Content-Security-Policy header blocks
  outbound connections as a second layer.
- **ID photos are never stored.** Driver's license / passport / Social
  Security card images are decoded in memory and discarded.
- Employee profiles are stored in browser localStorage, unencrypted, on this
  computer only. Use a locked Windows account and consider BitLocker. The
  Privacy tab has export, import, and wipe-everything buttons.

## What it fills

| Form | Source file | Notes |
| --- | --- | --- |
| PPL CDASS Attendant Packet 2026 CFC & Waiver (enrollment + agreement, direct deposit, services & rates, tax exemptions, EVV attestation of exemption, I-9) | `public/forms/CO-CDASS-Attendant-Packet-2026.pdf` | Current packet, downloaded from the PPL program page |
| PPL CDASS Attendant Packet 2025 | `public/forms/CO-CDASS-Attendant-Packet-2025.pdf` | Older version, off by default |
| IRS W-4 (2024 revision, the one PPL links) | `public/forms/w4.pdf` | The filler auto-detects the 2020-2023 vs 2024+ field layouts, so a future-year fillable W-4 dropped over this file keeps working |

## Document scanning

All on-device:

- **Driver's license:** photograph the **back**. The PDF417 barcode carries
  name, address, DOB, license number, and expiration in machine-readable form
  (far more reliable than OCR of the front).
- **Passport:** photo page; the MRZ (the two `<<<` lines) is parsed with
  check-digit validation.
- **Social Security card:** OCR for the SSN and name.

Always review extracted values; they highlight in yellow after a scan.

## Setup

```
npm install   # also vendors WASM/OCR assets and downloads the OCR model (one time)
npm run dev   # opens on http://127.0.0.1:5173
```

`npm run build` produces a static `dist/` you can serve from anywhere local.

## Known quirks of the PPL packet PDFs

2026 packet:

- The attendant signature-date box on the Direct Deposit page shares a field
  with the FMS-vendor date on the EVV exemption form, so the app leaves it
  blank; date it by hand when signing.
- The EVV Attestation of Exemption pages are only filled when the profile
  marks the attendant as living with the Member.
- The under-18 / under-21 tax-exemption checkboxes are only checked when the
  date of birth actually confirms the age, regardless of the profile toggles.

2025 packet:

- The signature-date box is one shared field across all packet pages, so one
  signature date fills all of them.
- I-9 Section 2 "List A Document Title" shares a field with the Supplement B
  (rehire) page, so a List A title also appears there. Supplement B is only
  used for rehires; disregard it for new hires.
- The "mailing address same as home" checkbox is a broken shared field in the
  original PDF, so the app copies the home address into the mailing section
  instead of checking the box.

Signatures are intentionally never auto-filled. Print, review, sign.

## Submitting

CO CDASS customer service: 1-888-752-8250, ppcdass@pplfirst.com.
EVV help desk: 833-204-9041, ppl_cs_evv@pplfirst.com.

## Disclaimer

This tool fills forms with data you provide. It is not legal, tax, or
immigration advice. Review every generated page before signing or submitting.

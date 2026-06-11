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

| Form | Source file | Method |
| --- | --- | --- |
| PPL CDASS Attendant Packet 2025 (enrollment, employment agreement, rate form, FLSA live-in exemption, EVV attestation, difficulty-of-care, I-9) | `public/forms/CO-CDASS-Attendant-Packet-2025.pdf` | Native PDF form fields |
| IRS W-4 | `public/forms/w4.pdf` | Native PDF form fields |

The bundled W-4 is the 2022 revision (the one PPL distributed). The IRS keeps
internal field names stable, so you can drop a current-year fillable W-4 over
`public/forms/w4.pdf` and it should still fill. Verify the output.

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

## Known quirks of the PPL packet PDF

- The signature-date box is one shared field across all packet pages, so one
  signature date fills all of them.
- I-9 Section 2 "List A Document Title" shares a field with the Supplement B
  (rehire) page, so a List A title also appears there. Supplement B is only
  used for rehires; disregard it for new hires.
- The "mailing address same as home" checkbox is a broken shared field in the
  original PDF, so the app copies the home address into the mailing section
  instead of checking the box.
- Signatures are intentionally never auto-filled. Print, review, sign.

## Disclaimer

This tool fills forms with data you provide. It is not legal, tax, or
immigration advice. Review every generated page before signing or submitting.

# Threat model: data at rest and the encryption question

This doc exists to keep one claim honest: *encryption at rest becomes necessary
once the operator is not the subject.* That is true but partial. Encryption at
rest defends a specific, bounded set of vectors. This page enumerates the
assets, the deployment modes, and which mitigation actually covers which vector,
so that "add a passphrase-encrypted store" is never mistaken for "the
multi-client case is now safe."

It is a design and reasoning aid, not a compliance attestation.

## Assets to protect

| Asset | Where it lives today | Sensitivity |
| --- | --- | --- |
| Person profile (name, DOB, address, **SSN**, bank/income) | one `localStorage` key, `JSON.stringify`'d in the clear ([src/store.js](../src/store.js)) | High |
| Employer details | `localStorage`, in the clear ([src/store.js](../src/store.js)) | Medium |
| Seed file | `public/seed.local.json`, plaintext on disk, gitignored, auto-seeds empty settings at startup | High |
| Generated PDFs | Downloads folder, plaintext, every SSN the form asked for | High |
| Derived key + decrypted profile (only if an encrypted store is added) | JS heap while the app is open; can reach swap/hibernation | High |

The last three are the ones an encryption-at-rest change tends to forget.

## Deployment modes

The code is identical across all three. The exposure is not.

1. **Single-user, own device.** The operator is the subject. Data is theirs, on
   their machine, behind a locked OS account with full-disk encryption. This is
   the design target and the defensible unencrypted case.
2. **Multi-client, shared machine, separate OS accounts.** An advocate holds
   many clients; each advocate has their own OS login. Offline access by another
   account is a real vector; the live session is protected by OS account
   separation.
3. **Multi-client, shared login.** Many people use one OS account and one
   browser profile. This is the weakest mode and the one the whitepaper's
   "fifty clients on a shared desktop" example actually describes if the login
   is literally shared.

## Vector-by-vector

Legend: **Y** covers it, **P** partial, **N** does not.

| Vector | Full-disk encryption | Auto-clear retention ([src/main.js](../src/main.js)) | Passphrase store (WebCrypto) | Per-client isolation + OS access control | Output handling |
| --- | :---: | :---: | :---: | :---: | :---: |
| Stolen powered-off laptop / disk image | Y | P | Y | N | N |
| Cloud/USB backup of the profile dir | N | P | Y | N | N |
| Another OS account reads browser storage | N | N | Y | P | N |
| Same shared login, app locked | N | P | Y (if per-user passphrase) | N | N |
| Same shared login, walk up to unlocked session | N | N | N | Y | N |
| Malware / script running as the logged-in user | N | N | N | N | N |
| Derived key read from heap/swap during a session | N | N | N | N | N |
| Plaintext `seed.local.json` read off disk | Y | N | N (store does not cover it) | N | N |
| Output PDF emailed, or read from Downloads | N | N | N | N | Y |

Reading the passphrase-store column: it covers the offline-bytes vectors well,
covers the shared-login-while-locked vector only if each user has a private
passphrase, and covers nothing about a live session, an in-memory key, the seed
file, or the output PDF.

## What a passphrase store does and does not do

**Does:**

- Removes plaintext SSNs from `localStorage` on disk, so theft, a disk image, a
  backup, or another OS account gets ciphertext.
- Removes the operator's ability to *unilaterally* store someone else's SSN in
  the clear, which is the real change once operator and subject differ. That is
  a duty/consent point, not only a risk-reduction point.

**Does not:**

- Protect a live, unlocked session. Once the passphrase is entered the profile
  is plaintext in memory and on screen. On a shared login, anyone at that login
  during a session sees everything.
- Protect the derived key. It sits in the JS heap and can reach swap or a
  hibernation image; the browser, not the app, decides that.
- Cover `public/seed.local.json`. A plaintext PII file next to an encrypted
  store is still plaintext PII at rest. Any real multi-client build must
  eliminate or encrypt this path too.
- Cover the output PDF, which carries every SSN the form asked for straight to
  the Downloads folder. This remains the likeliest real-world leak and no
  storage encryption touches it.
- Provide isolation. One encrypted blob for fifty clients is one unlock away
  from all fifty. Isolation between clients is a separate, structural change.

## Mechanism notes, if it gets built

- **KDF.** WebCrypto (`crypto.subtle`) gives PBKDF2 natively but not Argon2 or
  scrypt. A human passphrase guarding SSNs is an offline-cracking target and
  wants a memory-hard KDF; that means shipping WASM (feasible here, since the
  app already vendors WASM for OCR, but it is a real dependency, not a
  `crypto.subtle` one-liner). If PBKDF2 is used, iteration count should be as
  high as the slowest supported machine tolerates, and revisited over time.
- **Cipher.** AES-GCM with a per-record random IV is the straightforward choice
  and is native to WebCrypto.
- **Key custody is the whole problem.** The passphrase must be stored nowhere,
  so the user retypes it each session. The moment the key or passphrase is
  cached in `localStorage`/`sessionStorage` for convenience, plaintext at rest
  is back with extra steps. Session-only in-memory custody with an explicit lock
  is the only custody that keeps the property.
- **CSP stays.** Nothing here loosens the no-network posture in
  [index.html](../index.html); all crypto is local.

## Prerequisites for the operator-holds-others'-data case

Encryption at rest is on this list, not above it:

1. **Per-client isolation.** Multiple profiles with safe selection, so one
   unlock or one mistake does not expose everyone. Today the profile is a single
   `localStorage` key by design; this is a redesign, not a flag.
2. **OS-level access control.** Separate OS accounts, screen lock, no shared
   login. This is where the live-session vectors are actually addressed.
3. **Encrypted store with session-only key custody.** For the offline-bytes
   vectors, and for the consent point.
4. **Seed-path cleanup.** No plaintext `seed.local.json` equivalent in a
   multi-client deployment.
5. **Output handling.** Tell the operator exactly what is in each generated PDF,
   offer to clear the data behind it, and treat the Downloads copy as the
   sensitive artifact it is.

The single-user design target needs only full-disk encryption and the existing
retention auto-clear. The gap between that and the multi-client case is this
whole list, which is why the multi-client case is a redesign and not a setting.

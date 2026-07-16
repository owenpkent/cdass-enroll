// Passphrase-derived encryption for data at rest, entirely in the browser.
//
// Argon2id (hash-wasm) derives a 256-bit key from the passphrase; AES-256-GCM
// (WebCrypto) encrypts the JSON. hash-wasm's Argon2 is single-threaded and
// ships its WASM inlined as base64, so there is no runtime fetch and no
// SharedArrayBuffer / cross-origin-isolation requirement: it runs untouched
// under the no-network CSP.
//
// What this defends: an attacker who obtains the localStorage bytes (theft,
// disk image, backup, another OS account) and mounts an OFFLINE guess against
// the passphrase. What it does NOT defend: a live unlocked session, the key in
// heap/swap (browsers offer no mlock and cannot zero immutable Strings), or
// script running in the origin (XSS). The no-network CSP carries that surface.
// See docs/threat-model.md. Passphrase entropy dominates: the KDF is a linear
// multiplier, entropy is the exponent, so the UI enforces a strength floor.

import { argon2id } from "hash-wasm";

// Argon2id parameters. Memory-hard and comfortably above the OWASP minimum
// (19 MiB / t=2). Stored in every vault so they can be raised later without
// stranding existing data (bump these, and re-keying rewrites under the new
// set). ~100-400ms once per unlock on a typical machine.
export const KDF = { name: "argon2id", m: 65536, t: 3, p: 1 };

const SALT_BYTES = 16; // 128-bit salt, per NIST SP 800-132
const IV_BYTES = 12; // 96-bit GCM nonce, the NIST SP 800-38D native length

// ---- base64 <-> bytes, no Buffer so it runs in the browser and in Node ----
export function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function newSalt() {
  return randomBytes(SALT_BYTES);
}

/**
 * Derive a non-extractable AES-256-GCM key from a passphrase and salt.
 * extractable:false means exportKey() can never return the raw bytes, even to
 * later-compromised script. The passphrase arrives as an (immutable) String
 * from the input field; we copy it to a byte buffer and zero that buffer, which
 * is best-effort only. The intermediate raw key is zeroed after import.
 */
export async function deriveKey(passphrase, salt, kdf = KDF) {
  const pwBytes = new TextEncoder().encode(passphrase);
  const raw = await argon2id({
    password: pwBytes,
    salt,
    parallelism: kdf.p,
    iterations: kdf.t,
    memorySize: kdf.m,
    hashLength: 32,
    outputType: "binary",
  });
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  raw.fill(0);
  pwBytes.fill(0);
  return key;
}

/**
 * Encrypt a JS value to an envelope { iv, ct } (both base64). A fresh random IV
 * is drawn every call: GCM (key, IV) reuse is catastrophic, and since the whole
 * value is rewritten on each save, one new IV per save is trivial and correct.
 */
export async function encrypt(value, key) {
  const iv = randomBytes(IV_BYTES);
  const pt = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt));
  pt.fill(0);
  return { iv: bytesToB64(iv), ct: bytesToB64(ct) };
}

/**
 * Rough passphrase-strength estimate, used to enforce a floor in the UI.
 * Password-entropy estimation is inherently imprecise, so this is deliberately
 * conservative and framed as guidance, not a precise meter. Because entropy
 * dominates the KDF entirely, refusing a weak passphrase matters more than any
 * parameter choice. A whitespace-separated passphrase of several random words
 * is the reliable way to clear the floor.
 */
export function estimateStrength(pw) {
  if (!pw) return { bits: 0, label: "empty", ok: false };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
  const unique = new Set(pw).size;
  // Discount runs of repeated characters; a long string of one char is not long.
  const effLen = Math.min(pw.length, unique + 4);
  let bits = Math.round(effLen * Math.log2(pool || 1));
  // Credit a multi-word passphrase at a diceware-ish ~12 bits/word floor.
  const words = pw.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 3) bits = Math.max(bits, words.length * 12);
  const ok = bits >= 50 && pw.length >= 10;
  const label = bits < 40 ? "weak" : bits < 60 ? "fair" : bits < 80 ? "strong" : "very strong";
  return { bits, label, ok };
}

/**
 * Decrypt an { iv, ct } envelope back to a JS value. A wrong key or tampered
 * ciphertext fails the GCM auth tag and rejects with OperationError; callers
 * treat that rejection as "wrong passphrase or corrupt data". The tag is the
 * verifier, so no separate passphrase hash is stored (that would only add a
 * second, weaker offline-crackable target).
 */
export async function decrypt(env, key) {
  const iv = b64ToBytes(env.iv);
  const ct = b64ToBytes(env.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

// All persistence is browser localStorage on this machine. Nothing leaves it.
//
// The enrolled person's profile never survives a restart: it is cleared on
// every launch (see clearProfileOnStart), so an SSN entered in one session is
// gone the next. Only the standing "Your details" (member + employer of record)
// persist, since they are reused on every packet.
//
// Optionally, the person and standing details are encrypted at rest with a
// passphrase (see src/crypto/vault.js and docs/threat-model.md). Encryption is
// opt-in: with it off, values are stored as plain JSON exactly as before; with
// it on, each value is an { _enc, iv, ct } envelope and a single passphrase-
// derived key (held only in memory, never persisted) unlocks them. The derived
// data is decrypted once at unlock into an in-memory cache so the load/save API
// stays synchronous for callers; writes encrypt asynchronously in the
// background, serialized per key so rapid edits cannot race.

import { blankEmployer, blankProfile } from "./schema.js";
import * as vault from "./crypto/vault.js";

const PROFILE_KEY = "cdass.profile.v1";
const LEGACY_PROFILES_KEY = "cdass.profiles.v1"; // pre-simplification array of people
const EMPLOYER_KEY = "cdass.employer.v1";
const VAULT_KEY = "cdass.vault.v1"; // presence of this key == encryption is on
const CHECK_MARKER = "cdass-vault-v1-ok"; // encrypted under the key to verify the passphrase

// ---- encryption state (in memory only) ----
let vaultKey = null; // CryptoKey when unlocked; null when encryption is off or locked
const cache = { profile: null, employer: null }; // decrypted objects while unlocked
const writeChains = new Map(); // storageKey -> Promise, serializes async writes

export function isEncrypted() {
  return localStorage.getItem(VAULT_KEY) != null;
}

export function isUnlocked() {
  return vaultKey != null;
}

/** True while encryption is on but the passphrase has not been entered. */
export function isLocked() {
  return isEncrypted() && !isUnlocked();
}

function readVaultMeta() {
  try {
    return JSON.parse(localStorage.getItem(VAULT_KEY));
  } catch {
    return null;
  }
}

function isEnvelope(v) {
  return v && typeof v === "object" && v._enc === 1 && typeof v.ct === "string";
}

// Encrypt `value` and write it under `storageKey`. Everything sensitive lives
// inside the ciphertext; the only cleartext is the { _enc, iv, ct } envelope
// shell. Serialized per key so overlapping saves apply last-write-wins in call
// order.
function queueWrite(storageKey, value) {
  const prev = writeChains.get(storageKey) || Promise.resolve();
  const next = prev
    .then(async () => {
      const env = await vault.encrypt(value, vaultKey);
      localStorage.setItem(storageKey, JSON.stringify({ _enc: 1, ...env }));
    })
    .catch((e) => {
      // Missing/failed writes degrade to a warning, never an exception.
      console.warn("encrypted write failed for", storageKey, e);
    });
  writeChains.set(storageKey, next);
  return next;
}

async function readEncrypted(storageKey) {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
  if (!isEnvelope(raw)) return null;
  try {
    return await vault.decrypt(raw, vaultKey);
  } catch (e) {
    console.warn("decrypt failed for", storageKey, e);
    return null;
  }
}

/**
 * The single person currently being enrolled. The first time this runs after
 * the multi-profile simplification, it migrates the most recently touched
 * person out of the old array so existing data is not lost. When encryption is
 * on, reads come from the decrypted cache populated at unlock.
 */
export function loadProfile() {
  if (isEncrypted()) {
    if (!isUnlocked()) return blankProfile();
    return { ...blankProfile(), ...(cache.profile || {}) };
  }
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (p && typeof p === "object") return { ...blankProfile(), ...p };
  } catch {
    /* fall through */
  }
  const legacy = mostRecentLegacy();
  if (legacy) return { ...blankProfile(), ...legacy };
  return blankProfile();
}

function mostRecentLegacy() {
  try {
    const arr = JSON.parse(localStorage.getItem(LEGACY_PROFILES_KEY));
    if (Array.isArray(arr) && arr.length)
      return [...arr].sort((a, b) => (b.touchedAt ?? 0) - (a.touchedAt ?? 0))[0];
  } catch {
    /* none */
  }
  return null;
}

export function saveProfile(profile) {
  profile.touchedAt = Date.now();
  if (isEncrypted()) {
    if (!isUnlocked()) {
      console.warn("store is locked; profile save ignored");
      return;
    }
    cache.profile = profile;
    queueWrite(PROFILE_KEY, profile);
    return;
  }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearProfile() {
  localStorage.removeItem(PROFILE_KEY);
  cache.profile = null;
}

/**
 * Privacy default: the enrolled person's profile never survives a restart.
 * Called once at boot to remove it (and any legacy multi-profile array).
 * Returns true if there was something to clear, so the UI can note it. Works
 * even while the store is locked: the encrypted envelope is removed as an
 * opaque blob, no passphrase required.
 */
export function clearProfileOnStart() {
  const had =
    localStorage.getItem(PROFILE_KEY) != null ||
    localStorage.getItem(LEGACY_PROFILES_KEY) != null;
  clearProfile();
  localStorage.removeItem(LEGACY_PROFILES_KEY);
  return had;
}

export function loadEmployer() {
  if (isEncrypted()) {
    if (!isUnlocked()) return blankEmployer();
    return { ...blankEmployer(), ...(cache.employer || {}) };
  }
  try {
    return { ...blankEmployer(), ...JSON.parse(localStorage.getItem(EMPLOYER_KEY)) };
  } catch {
    return blankEmployer();
  }
}

export function saveEmployer(employer) {
  if (isEncrypted()) {
    if (!isUnlocked()) {
      console.warn("store is locked; employer save ignored");
      return;
    }
    cache.employer = employer;
    // Returned so a caller that wants to report the save (the Save button) can
    // wait for the ciphertext to actually land, not just for it to be queued.
    return queueWrite(EMPLOYER_KEY, employer);
  }
  localStorage.setItem(EMPLOYER_KEY, JSON.stringify(employer));
}

export function wipeAll() {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(LEGACY_PROFILES_KEY);
  localStorage.removeItem(EMPLOYER_KEY);
  localStorage.removeItem(VAULT_KEY);
  lock();
}

export function exportAll() {
  return JSON.stringify(
    { exported: new Date().toISOString(), employer: loadEmployer(), profile: loadProfile() },
    null,
    2
  );
}

// ---- encryption lifecycle ----

/**
 * Enter the passphrase and decrypt the store into the in-memory cache.
 * Returns true on success, false on a wrong passphrase (the GCM auth tag on the
 * check marker fails to verify). No-op-returns false if encryption is off.
 */
export async function unlock(passphrase) {
  const meta = readVaultMeta();
  if (!meta) return false;
  const salt = vault.b64ToBytes(meta.kdf.salt);
  const key = await vault.deriveKey(passphrase, salt, meta.kdf);
  try {
    const marker = await vault.decrypt(meta.check, key);
    if (marker !== CHECK_MARKER) return false;
  } catch {
    return false; // wrong passphrase, or a corrupt/tampered vault
  }
  vaultKey = key;
  cache.profile = await readEncrypted(PROFILE_KEY);
  cache.employer = await readEncrypted(EMPLOYER_KEY);
  return true;
}

/** Drop the key and decrypted data from memory. Encryption stays on. */
export function lock() {
  vaultKey = null;
  cache.profile = null;
  cache.employer = null;
}

/**
 * Turn encryption on: derive a key from a new passphrase, then rewrite the
 * current (plaintext) profile and employer as encrypted envelopes. The caller
 * is left unlocked.
 */
export async function enableEncryption(passphrase) {
  if (isEncrypted()) throw new Error("Already encrypted");
  const currentProfile = loadProfile(); // plaintext read
  const currentEmployer = loadEmployer();
  const salt = vault.newSalt();
  const key = await vault.deriveKey(passphrase, salt, vault.KDF);
  const check = await vault.encrypt(CHECK_MARKER, key);
  vaultKey = key;
  cache.profile = currentProfile;
  cache.employer = currentEmployer;
  localStorage.setItem(
    VAULT_KEY,
    JSON.stringify({ v: 1, kdf: { ...vault.KDF, salt: vault.bytesToB64(salt) }, check })
  );
  await queueWrite(PROFILE_KEY, currentProfile);
  await queueWrite(EMPLOYER_KEY, currentEmployer);
}

/**
 * Turn encryption off: write the current (decrypted) data back as plaintext and
 * remove the vault. Requires being unlocked first.
 */
export async function disableEncryption() {
  if (!isUnlocked()) throw new Error("Unlock before turning off encryption");
  const p = { ...blankProfile(), ...(cache.profile || {}) };
  const e = { ...blankEmployer(), ...(cache.employer || {}) };
  localStorage.removeItem(VAULT_KEY);
  lock();
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  localStorage.setItem(EMPLOYER_KEY, JSON.stringify(e));
}

/**
 * Change the passphrase: verify the old one, then re-key with a fresh salt and
 * rewrite everything under the new key. Returns false if the old passphrase is
 * wrong.
 */
export async function changePassphrase(oldPass, newPass) {
  if (!(await unlock(oldPass))) return false;
  const salt = vault.newSalt();
  const key = await vault.deriveKey(newPass, salt, vault.KDF);
  const check = await vault.encrypt(CHECK_MARKER, key);
  vaultKey = key;
  localStorage.setItem(
    VAULT_KEY,
    JSON.stringify({ v: 1, kdf: { ...vault.KDF, salt: vault.bytesToB64(salt) }, check })
  );
  await queueWrite(PROFILE_KEY, cache.profile ?? blankProfile());
  await queueWrite(EMPLOYER_KEY, cache.employer ?? blankEmployer());
  return true;
}

/** Wait for any pending encrypted writes to flush (used by tests). */
export async function flushWrites() {
  await Promise.all([...writeChains.values()]);
}

/**
 * Load public/seed.local.json (gitignored, same origin) into the standing
 * details, but only when they are still empty, so a fresh browser profile
 * starts pre-filled without ever clobbering edits. Skipped while the store is
 * locked, so it never writes plaintext into an encrypted vault.
 */
export async function applySeedIfEmpty() {
  if (isLocked()) return false;
  const current = loadEmployer();
  if (Object.values(current).some((v) => v)) return false;
  try {
    const res = await fetch(new URL("seed.local.json", document.baseURI), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return false;
    const seed = await res.json();
    if (!seed || typeof seed.employer !== "object") return false;
    const merged = { ...blankEmployer() };
    for (const k of Object.keys(merged)) if (seed.employer[k]) merged[k] = seed.employer[k];
    saveEmployer(merged);
    return true;
  } catch {
    return false;
  }
}

/**
 * Import a backup. Accepts the current single-profile shape ({profile}) and
 * the legacy multi-profile shape ({profiles:[...]}, taking the most recent).
 */
export function importAll(json) {
  const data = JSON.parse(json);
  let profile = null;
  if (data.profile && typeof data.profile === "object") profile = data.profile;
  else if (Array.isArray(data.profiles) && data.profiles.length)
    profile = [...data.profiles].sort((a, b) => (b.touchedAt ?? 0) - (a.touchedAt ?? 0))[0];
  if (!profile && !data.employer) throw new Error("Not a valid export file");
  if (profile) saveProfile(profile);
  if (data.employer) saveEmployer(data.employer);
  return profile ? 1 : 0;
}

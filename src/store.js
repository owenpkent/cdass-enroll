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
// Bumped whenever the key the stored vault is encrypted under changes or the
// vault goes away (enable, rekey, disable, wipe), so a write encrypted under
// the old key is dropped. Locking does not bump it: the stored vault still
// opens with the same passphrase, so a write accepted before the lock lands.
let epoch = 0;
// Counts accepted saves, so a rekey can tell whether an edit landed while it
// was awaiting and re-encrypt the latest state instead of a stale snapshot.
let saves = 0;

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
// order. Resolves true once the ciphertext landed, false if it failed or was
// dropped; never rejects. A write queued before the stored vault changed key
// (rekey, encryption turned off, wipe) is dropped rather than landing an
// envelope the vault can no longer open; a lock alone does not drop it.
function queueWrite(storageKey, value) {
  const key = vaultKey;
  const at = epoch;
  const prev = writeChains.get(storageKey) || Promise.resolve();
  const next = prev
    .then(async () => {
      if (epoch !== at) return false;
      const env = await vault.encrypt(value, key);
      if (epoch !== at) return false;
      localStorage.setItem(storageKey, envelopeJson(env));
      return true;
    })
    .catch((e) => {
      // Failed writes degrade to a warning plus a false result, never an exception.
      console.warn("encrypted write failed for", storageKey, e);
      return false;
    });
  writeChains.set(storageKey, next);
  return next;
}

// Snapshot raw values so a multi-key write can be rolled back if any setItem
// throws (quota, storage disabled).
function snapshot(keys) {
  return keys.map((k) => [k, localStorage.getItem(k)]);
}

function restore(snap) {
  for (const [k, v] of snap) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) {
      console.warn("rollback failed for", k, e);
    }
  }
}

const envelopeJson = (env) => JSON.stringify({ _enc: 1, ...env });

async function readEncrypted(storageKey, key) {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
  if (!isEnvelope(raw)) return null;
  try {
    return await vault.decrypt(raw, key);
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

/** Resolves true once saved, false if it could not be (locked, quota). Never rejects. */
export function saveProfile(profile) {
  profile.touchedAt = Date.now();
  saves++;
  if (isEncrypted()) {
    if (!isUnlocked()) {
      console.warn("store is locked; profile save ignored");
      return Promise.resolve(false);
    }
    cache.profile = profile;
    return queueWrite(PROFILE_KEY, profile);
  }
  return Promise.resolve(setPlain(PROFILE_KEY, profile));
}

function setPlain(storageKey, value) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn("save failed for", storageKey, e);
    return false;
  }
}

export function clearProfile() {
  saves++;
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

/**
 * Resolves true once saved, false if it could not be (locked, quota). Never
 * rejects. When encrypted it settles after the ciphertext has actually landed,
 * so a caller reporting the save (the Save button) can wait on it.
 */
export function saveEmployer(employer) {
  saves++;
  if (isEncrypted()) {
    if (!isUnlocked()) {
      console.warn("store is locked; employer save ignored");
      return Promise.resolve(false);
    }
    cache.employer = employer;
    return queueWrite(EMPLOYER_KEY, employer);
  }
  return Promise.resolve(setPlain(EMPLOYER_KEY, employer));
}

export function wipeAll() {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(LEGACY_PROFILES_KEY);
  localStorage.removeItem(EMPLOYER_KEY);
  localStorage.removeItem(VAULT_KEY);
  epoch++;
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
  const key = await verifyPassphrase(passphrase);
  if (!key) return false;
  const profile = await readEncrypted(PROFILE_KEY, key);
  const employer = await readEncrypted(EMPLOYER_KEY, key);
  // Set together with no await between, so a save made while the data was
  // decrypting is not overwritten by the older copy read from storage.
  vaultKey = key;
  cache.profile = profile;
  cache.employer = employer;
  return true;
}

// The derived key if `passphrase` opens the stored vault, else null.
async function verifyPassphrase(passphrase) {
  const meta = readVaultMeta();
  if (!meta) return null;
  const salt = vault.b64ToBytes(meta.kdf.salt);
  const key = await vault.deriveKey(passphrase, salt, meta.kdf);
  try {
    const marker = await vault.decrypt(meta.check, key);
    return marker === CHECK_MARKER ? key : null;
  } catch {
    return null; // wrong passphrase, or a corrupt/tampered vault
  }
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
 * is left unlocked. Every envelope is built in memory first, then the vault
 * meta and both envelopes are written in one synchronous block that rolls back
 * together if any write throws, so a failure leaves plaintext intact and
 * encryption off (the error is rethrown).
 */
export async function enableEncryption(passphrase) {
  if (isEncrypted()) throw new Error("Already encrypted");
  await flushWrites();
  const salt = vault.newSalt();
  const key = await vault.deriveKey(passphrase, salt, vault.KDF);
  const check = await vault.encrypt(CHECK_MARKER, key);
  // Plaintext saves keep landing while the key derives; read the data after,
  // and again if a save landed mid-encrypt, so the newest edit is the one kept.
  let seq, currentProfile, currentEmployer, profileEnv, employerEnv;
  do {
    seq = saves;
    currentProfile = loadProfile(); // plaintext read
    currentEmployer = loadEmployer();
    profileEnv = await vault.encrypt(currentProfile, key);
    employerEnv = await vault.encrypt(currentEmployer, key);
  } while (seq !== saves);
  const meta = JSON.stringify({ v: 1, kdf: { ...vault.KDF, salt: vault.bytesToB64(salt) }, check });
  const snap = snapshot([VAULT_KEY, PROFILE_KEY, EMPLOYER_KEY]);
  // No await from here to the end of the block, so a tab close cannot split it.
  try {
    localStorage.setItem(VAULT_KEY, meta);
    localStorage.setItem(PROFILE_KEY, envelopeJson(profileEnv));
    localStorage.setItem(EMPLOYER_KEY, envelopeJson(employerEnv));
  } catch (e) {
    restore(snap);
    throw e;
  }
  epoch++;
  vaultKey = key;
  cache.profile = currentProfile;
  cache.employer = currentEmployer;
}

/**
 * Turn encryption off: write the current (decrypted) data back as plaintext and
 * remove the vault. Requires being unlocked first. Pending encrypted writes are
 * flushed first; the plaintext and the vault removal then happen in one
 * synchronous block that rolls back if a write throws (the error is rethrown).
 */
export async function disableEncryption() {
  if (!isUnlocked()) throw new Error("Unlock before turning off encryption");
  await flushWrites();
  if (!isUnlocked()) throw new Error("Unlock before turning off encryption");
  const p = { ...blankProfile(), ...(cache.profile || {}) };
  const e = { ...blankEmployer(), ...(cache.employer || {}) };
  const snap = snapshot([VAULT_KEY, PROFILE_KEY, EMPLOYER_KEY]);
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    localStorage.setItem(EMPLOYER_KEY, JSON.stringify(e));
    localStorage.removeItem(VAULT_KEY);
  } catch (err) {
    restore(snap);
    throw err;
  }
  epoch++;
  lock();
}

/**
 * Change the passphrase: verify the old one, then re-key with a fresh salt and
 * rewrite everything under the new key. Returns false if the old passphrase is
 * wrong. The new vault meta and both re-encrypted envelopes are written in one
 * synchronous block that rolls back together if any write throws, so the data
 * is never left under a key the stored check marker does not match (the error
 * is rethrown and the old passphrase keeps working). The form stays editable
 * meanwhile, so the envelopes are rebuilt until a pass completes with no save
 * in between: the commit carries the latest edit, not a snapshot from before it.
 */
export async function changePassphrase(oldPass, newPass) {
  await flushWrites();
  const lockedErr = () => new Error("Locked during the passphrase change; nothing was changed");
  if (isUnlocked()) {
    // Verify only: unlocking again would replace the cache with fresh copies
    // and orphan the objects the form is editing. Capture the key first: a
    // lock during verification empties the cache, and must abort, not
    // re-encrypt blank records over the real ones.
    const before = vaultKey;
    if (!(await verifyPassphrase(oldPass))) return false;
    if (vaultKey !== before) throw lockedErr();
  } else if (!(await unlock(oldPass))) return false;
  const heldKey = vaultKey;
  if (!heldKey) throw lockedErr();
  const salt = vault.newSalt();
  const key = await vault.deriveKey(newPass, salt, vault.KDF);
  const check = await vault.encrypt(CHECK_MARKER, key);
  let seq, profileEnv, employerEnv;
  do {
    // A lock empties the cache; encrypting it would erase the data.
    if (vaultKey !== heldKey) throw lockedErr();
    seq = saves;
    profileEnv = await vault.encrypt(cache.profile ?? blankProfile(), key);
    employerEnv = await vault.encrypt(cache.employer ?? blankEmployer(), key);
  } while (seq !== saves || vaultKey !== heldKey);
  const meta = JSON.stringify({ v: 1, kdf: { ...vault.KDF, salt: vault.bytesToB64(salt) }, check });
  const snap = snapshot([VAULT_KEY, PROFILE_KEY, EMPLOYER_KEY]);
  try {
    localStorage.setItem(VAULT_KEY, meta);
    localStorage.setItem(PROFILE_KEY, envelopeJson(profileEnv));
    localStorage.setItem(EMPLOYER_KEY, envelopeJson(employerEnv));
  } catch (e) {
    restore(snap);
    throw e;
  }
  epoch++;
  vaultKey = key;
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
 * Resolves to the number of profiles imported (0 or 1). Throws an Error with a
 * short human message on a malformed file, while locked, or if a save fails.
 */
export async function importAll(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Not a valid export file");
  }
  if (!isPlainObject(data)) throw new Error("Not a valid export file");
  if (data.profile != null && !isPlainObject(data.profile))
    throw new Error("Not a valid export file: profile must be an object");
  if (data.employer != null && !isPlainObject(data.employer))
    throw new Error("Not a valid export file: employer must be an object");
  let profile = data.profile ?? null;
  if (!profile && Array.isArray(data.profiles)) {
    const people = data.profiles.filter(isPlainObject);
    if (people.length) profile = people.sort((a, b) => (b.touchedAt ?? 0) - (a.touchedAt ?? 0))[0];
  }
  const employer = data.employer ?? null;
  if (!profile && !employer) throw new Error("Not a valid export file");
  if (isLocked()) throw new Error("Unlock before importing");
  if (profile && !(await saveProfile(profile)))
    throw new Error("Could not save the imported profile (storage full?)");
  if (employer && !(await saveEmployer(employer)))
    throw new Error("Could not save the imported details (storage full?)");
  return profile ? 1 : 0;
}

const isPlainObject = (o) => o != null && typeof o === "object" && !Array.isArray(o);

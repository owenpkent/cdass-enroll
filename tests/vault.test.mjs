// Round-trip test for the passphrase-encrypted store. Runs in Node against a
// localStorage shim; WebCrypto and hash-wasm both work under Node, the same as
// in the browser. Exercises the full lifecycle plus wrong-passphrase rejection
// and, crucially, that no plaintext SSN survives in storage once encrypted.
//
//   node tests/vault.test.mjs

import assert from "node:assert/strict";

// ---- localStorage shim (must exist before importing the store) ----
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const store = await import("../src/store.js");
const vault = await import("../src/crypto/vault.js");

const SSN = "123-45-6789";
const PASS = "correct horse battery staple";
const NEWPASS = "seven tomatoes wander gladly uphill";
let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok -", name);
};

// 1. Starts unencrypted, plaintext round-trips as before.
assert.equal(store.isEncrypted(), false);
store.saveProfile({ id: "p1", ssn: SSN, firstName: "Jane" });
store.saveEmployer({ memberName: "Jane Doe" });
assert.equal(store.loadProfile().ssn, SSN);
assert.equal(store.loadEmployer().memberName, "Jane Doe");
assert.ok(localStorage.getItem("cdass.profile.v1").includes(SSN), "plaintext holds the SSN");
ok("plaintext mode round-trips");

// 2. Turn encryption on. The stored bytes must no longer contain the SSN.
await store.enableEncryption(PASS);
await store.flushWrites();
assert.equal(store.isEncrypted(), true);
assert.equal(store.isUnlocked(), true);
const rawProfile = localStorage.getItem("cdass.profile.v1");
assert.ok(!rawProfile.includes(SSN), "ciphertext must not contain the SSN");
assert.equal(JSON.parse(rawProfile)._enc, 1, "stored value is an envelope");
assert.ok(JSON.parse(rawProfile).touchedAt > 0, "touchedAt stays cleartext for retention");
assert.equal(store.loadProfile().ssn, SSN, "decrypts back to the SSN while unlocked");
ok("enabling encryption removes plaintext and round-trips");

// 3. Lock: no plaintext reachable without the passphrase.
store.lock();
assert.equal(store.isLocked(), true);
assert.equal(store.loadProfile().ssn, "", "locked store yields a blank profile");
ok("lock hides the data");

// 4. Wrong passphrase is rejected; right one unlocks.
assert.equal(await store.unlock("wrong passphrase entirely"), false);
assert.equal(store.isUnlocked(), false, "a failed unlock does not set the key");
assert.equal(await store.unlock(PASS), true);
assert.equal(store.loadProfile().ssn, SSN);
ok("wrong passphrase rejected, correct one accepted");

// 5. Edits persist across a lock/unlock cycle.
store.saveProfile({ ...store.loadProfile(), lastName: "Attendant" });
await store.flushWrites();
store.lock();
await store.unlock(PASS);
assert.equal(store.loadProfile().lastName, "Attendant");
ok("edits persist across lock/unlock");

// 6. Change passphrase: old fails afterward, new works, data intact.
assert.equal(await store.changePassphrase(PASS, NEWPASS), true);
await store.flushWrites();
store.lock();
assert.equal(await store.unlock(PASS), false, "old passphrase no longer works");
assert.equal(await store.unlock(NEWPASS), true);
assert.equal(store.loadProfile().ssn, SSN, "data survives re-keying");
ok("passphrase change re-keys without data loss");

// 7. Turn encryption off: plaintext returns, vault removed.
await store.disableEncryption();
assert.equal(store.isEncrypted(), false);
assert.ok(localStorage.getItem("cdass.profile.v1").includes(SSN), "plaintext restored");
assert.equal(store.loadProfile().ssn, SSN);
ok("disabling encryption restores plaintext");

// 8. Strength floor rejects weak passphrases, accepts real ones.
assert.equal(vault.estimateStrength("").ok, false);
assert.equal(vault.estimateStrength("password").ok, false);
assert.equal(vault.estimateStrength("aaaaaaaaaaaaaaaa").ok, false, "repetition is not entropy");
assert.equal(vault.estimateStrength(PASS).ok, true);
assert.equal(vault.estimateStrength(NEWPASS).ok, true);
ok("strength floor behaves");

console.log(`\nvault.test: ${pass} checks passed`);

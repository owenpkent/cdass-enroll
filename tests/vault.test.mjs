// Round-trip test for the passphrase-encrypted store. Runs in Node against a
// localStorage shim; WebCrypto and hash-wasm both work under Node, the same as
// in the browser. Exercises the full lifecycle plus wrong-passphrase rejection
// and, crucially, that no plaintext SSN survives in storage once encrypted.
//
//   node tests/vault.test.mjs

import assert from "node:assert/strict";

// ---- localStorage shim (must exist before importing the store) ----
const mem = new Map();
let failAfter = null; // N = let N more writes succeed, then the next one throws (quota)
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => {
    if (failAfter !== null && failAfter-- <= 0) {
      failAfter = null; // one failure; the rollback rewrites old, same-size values
      throw new Error("QuotaExceededError");
    }
    mem.set(k, String(v));
  },
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
assert.equal(JSON.parse(rawProfile).touchedAt, undefined, "no cleartext metadata leaks alongside the ciphertext");
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

// 9. A write that throws mid-enable rolls back: plaintext stays, encryption off.
failAfter = 1; // the vault meta lands, the first envelope throws
await assert.rejects(store.enableEncryption(PASS), /Quota/);
failAfter = null;
assert.equal(store.isEncrypted(), false, "failed enable leaves encryption off");
assert.ok(localStorage.getItem("cdass.profile.v1").includes(SSN), "plaintext still readable");
assert.equal(store.loadProfile().ssn, SSN);
ok("failed enableEncryption leaves plaintext intact");

// 10. A write that throws mid-changePassphrase leaves the old passphrase working.
await store.enableEncryption(PASS);
store.lock();
failAfter = 2; // meta and profile land, the employer envelope throws
await assert.rejects(store.changePassphrase(PASS, NEWPASS), /Quota/);
failAfter = null;
store.lock();
assert.equal(await store.unlock(NEWPASS), false, "new passphrase must not have taken effect");
assert.equal(await store.unlock(PASS), true, "old passphrase still works");
assert.equal(store.loadProfile().ssn, SSN, "data intact under the old key");
assert.equal(store.loadEmployer().memberName, "Jane Doe");
ok("failed changePassphrase keeps the old passphrase and data");

// 11. A write queued before disableEncryption cannot clobber the plaintext.
store.saveProfile({ ...store.loadProfile(), firstName: "Queued" }); // not awaited
await store.disableEncryption();
await store.flushWrites();
assert.equal(store.isEncrypted(), false);
assert.equal(JSON.parse(localStorage.getItem("cdass.profile.v1"))._enc, undefined, "plaintext, not an envelope");
assert.equal(store.loadProfile().firstName, "Queued");
ok("queued write does not clobber plaintext on disable");

// 12. Save results and import validation.
assert.equal(await store.saveEmployer({ memberName: "Jane Doe" }), true);
failAfter = 0;
assert.equal(await store.saveEmployer({ memberName: "X" }), false, "quota failure reports false");
failAfter = null;
await assert.rejects(store.importAll(JSON.stringify({ employer: "oops" })), /employer/);
await assert.rejects(store.importAll(JSON.stringify({ profile: [1, 2] })), /profile/);
await assert.rejects(store.importAll("not json"), /valid/);
assert.equal(store.loadEmployer().memberName, "Jane Doe", "rejected import changed nothing");
assert.equal(await store.importAll(JSON.stringify({ employer: { memberName: "Imp" } })), 0);
assert.equal(store.loadEmployer().memberName, "Imp");
ok("save results and import validation");

// Hold the (skip+1)th call of a WebCrypto method open, so a test can act inside
// the async window it creates. One-shot: later calls go straight through.
function gate(method, skip = 0) {
  const subtle = crypto.subtle;
  let hit, release;
  const reached = new Promise((r) => (hit = r));
  const open = new Promise((r) => (release = r));
  subtle[method] = async function (...args) {
    if (skip-- > 0) return Object.getPrototypeOf(subtle)[method].apply(subtle, args);
    delete subtle[method];
    hit();
    await open;
    return subtle[method](...args);
  };
  return { reached, release };
}

// 13. Locking while an autosave is encrypting does not drop it: the stored
// vault's key did not change, so the ciphertext is still readable.
await store.enableEncryption(PASS);
await store.saveEmployer({ memberName: "Before" });
let g = gate("encrypt");
const inFlight = store.saveEmployer({ memberName: "Last edit" });
await g.reached;
store.lock();
g.release();
assert.equal(await inFlight, true, "an accepted save finishes after a lock");
assert.equal(await store.unlock(PASS), true);
assert.equal(store.loadEmployer().memberName, "Last edit");
ok("lock keeps an in-flight autosave");

// 14. Edits made while the passphrase changes survive the commit, whether
// they land during the new key's derivation or while the envelopes encrypt.
const ui = store.loadEmployer(); // the form's object, as main.js holds it
ui.memberName = "Before";
await store.saveEmployer(ui);
g = gate("importKey", 1); // call 0 verifies the old passphrase; 1 derives the new key
let changing = store.changePassphrase(PASS, NEWPASS);
await g.reached;
ui.memberName = "During derive";
assert.equal(await store.saveEmployer(ui), true);
g.release();
assert.equal(await changing, true);
await store.flushWrites();
store.lock();
assert.equal(await store.unlock(NEWPASS), true);
assert.equal(store.loadEmployer().memberName, "During derive", "rekey kept the edit made while deriving");
const ui2 = store.loadEmployer();
await store.saveEmployer(ui2);
g = gate("encrypt", 2); // check marker, profile, then hold the employer envelope
changing = store.changePassphrase(NEWPASS, PASS);
await g.reached;
ui2.memberName = "During encrypt";
store.saveEmployer(ui2);
g.release();
assert.equal(await changing, true);
await store.flushWrites();
store.lock();
assert.equal(await store.unlock(PASS), true);
assert.equal(store.loadEmployer().memberName, "During encrypt", "rekey kept the latest edit");
ok("passphrase change keeps edits made while it runs");

// 15. Locking while the old passphrase is being verified aborts the change
// instead of re-encrypting the emptied cache as blank records.
await store.saveProfile({ ...store.loadProfile(), firstName: "Jane" });
await store.flushWrites();
g = gate("importKey", 0); // call 0 verifies the old passphrase
changing = store.changePassphrase(PASS, NEWPASS);
await g.reached;
store.lock();
g.release();
await assert.rejects(changing, /Locked/);
assert.equal(await store.unlock(NEWPASS), false, "new passphrase must not have taken effect");
assert.equal(await store.unlock(PASS), true, "old passphrase still works");
assert.equal(store.loadProfile().firstName, "Jane");
assert.equal(store.loadEmployer().memberName, "During encrypt");
ok("lock during verification aborts the passphrase change");

console.log(`\nvault.test: ${pass} checks passed`);

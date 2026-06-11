// End-to-end smoke test in Node: parses synthetic ID documents, fills both
// PDFs with a sample profile, writes them to tests/out/ for inspection.
// Run: node tests/smoke.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fillPacket2026 } from "../src/fill/packet2026.js";
import { fillI9Standalone } from "../src/fill/i9.js";
import { fillW4 } from "../src/fill/w4.js";
import { parseAamva } from "../src/extract/aamva.js";
import { parseMrz } from "../src/extract/mrz.js";
import { parseSsnCard } from "../src/extract/ssncard.js";

let failures = 0;
function expect(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "  " + detail}`);
  if (!cond) failures++;
}

// ---- AAMVA (driver's license barcode) ----
const aamvaRaw = [
  "@\n\x1e\rANSI 636020090002DL00410278ZC03190008DLDAQ123456789",
  "DCSDOE",
  "DACJANE",
  "DADMARIE",
  "DBD08242015",
  "DBB06061986",
  "DBA09302030",
  "DBC2",
  "DAU068 in",
  "DAG1234 MAIN ST",
  "DAIDENVER",
  "DAJCO",
  "DAK802030000  ",
].join("\n");
const dl = parseAamva(aamvaRaw);
expect("AAMVA name", dl.first === "Jane" && dl.last === "Doe" && dl.middle === "Marie", JSON.stringify(dl));
expect("AAMVA dob MMDDCCYY", dl.dob === "1986-06-06", dl.dob);
expect("AAMVA address", dl.street === "1234 Main St" && dl.city === "Denver" && dl.state === "CO" && dl.zip === "80203", JSON.stringify(dl));
expect("AAMVA license", dl.dlNumber === "123456789" && dl.dlExpiration === "2030-09-30", JSON.stringify(dl));
expect("AAMVA gender", dl.gender === "female", dl.gender);

// ---- MRZ (passport) ----  (valid check digits: number 0, dob 2, expiry 7)
const mrzText = `
P<USADOE<<JANE<MARIE<<<<<<<<<<<<<<<<<<<<<<<<
5400123450USA8606062F3105157<<<<<<<<<<<<<<04
`;
const mrz = parseMrz(mrzText);
expect("MRZ parsed", !!mrz, JSON.stringify(mrz));
expect("MRZ name", mrz?.first === "Jane" && mrz?.last === "Doe", JSON.stringify(mrz));
expect("MRZ passport number", mrz?.passportNumber === "540012345", JSON.stringify(mrz));
expect("MRZ dob", mrz?.dob === "1986-06-06", mrz?.dob);
expect("MRZ expiry", mrz?.passportExpiration === "2031-05-15", mrz?.passportExpiration);

// ---- SSN card OCR text ----
const ssnFields = parseSsnCard("SOCIAL SECURITY\n123-45-6789\nJane Marie Doe\nSIGNATURE");
expect("SSN extracted", ssnFields?.ssn === "123-45-6789", JSON.stringify(ssnFields));
expect("SSN card name", ssnFields?.first === "Jane" && ssnFields?.last === "Doe", JSON.stringify(ssnFields));

// ---- Fill both PDFs ----
const profile = {
  first: "Jane", middle: "Marie", last: "Doe", maidenOrPrevious: "Smith",
  dob: "1986-06-06", ssn: "123456789", gender: "female",
  street: "1234 Main St", street2: "Apt 2", city: "Denver", state: "CO", zip: "80203",
  county: "Denver", municipality: "Denver", mailingSame: true,
  email: "jane@example.com", cellPhone: "303-555-0100", otherPhone: "", allowText: "yes",
  contactPreference: "email", primaryLanguage: "English", bestContactTimes: "Weekday mornings",
  directDeposit: true, sameAccountAllMembers: false, accountType: "checking",
  bankName: "First Bank", routing: "102000021", account: "9876543210",
  paperPayStub: false, directoryOptIn: "no",
  pplId: "ATT-001", relationship: "nonrelative", liveIn: "doesNotLive",
  relationToEmployer: "none", fullTimeStudent: false, primaryJob: true,
  citizenship: "citizen", uscisNumber: "", workAuthExpiration: "", i94Number: "", foreignPassport: "",
  dlNumber: "123456789", dlState: "CO", dlExpiration: "2030-09-30",
  passportNumber: "", passportExpiration: "",
  filingStatus: "single", multipleJobs: true,
  childrenCredit: "2000", otherDependentsCredit: "500",
  otherIncome: "", deductions: "", extraWithholding: "50",
};
const employer = {
  memberFirst: "Owen", memberLast: "Kent", memberPplId: "MEM-001", memberMedicaidId: "A123456",
  employerFirst: "Owen", employerLast: "Kent", employerTitle: "Employer",
  businessName: "Owen Kent, Household Employer", businessAddress: "1234 Main St, Denver, CO 80203",
  ein: "12-3456789",
  rateStandardCdass: "20.00", rateEmergencyCdass: "25.00",
  rateStandardHm: "22.00", rateEmergencyHm: "27.00",
};
const opts = { signatureDate: "2026-06-11", firstDay: "2026-06-15", rateEffectiveDate: "2026-06-15", newService: true };

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });

const w4Bytes = await fillW4(readFileSync(new URL("../public/forms/w4.pdf", import.meta.url)), profile, employer, opts);
writeFileSync(new URL("./out/w4-filled.pdf", import.meta.url), w4Bytes);
expect("w4 filled and saved", w4Bytes.length > 50000, String(w4Bytes.length));

const packet2026Src = readFileSync(new URL("../public/forms/CO-CDASS-Attendant-Packet-2026.pdf", import.meta.url));
const p26 = await fillPacket2026(packet2026Src, profile, employer, opts);
writeFileSync(new URL("./out/packet2026-filled.pdf", import.meta.url), p26);
expect("2026 packet filled and saved", p26.length > 100000, String(p26.length));

const i9Bytes = await fillI9Standalone(readFileSync(new URL("../public/forms/i9.pdf", import.meta.url)), profile, employer, opts);
writeFileSync(new URL("./out/i9-filled.pdf", import.meta.url), i9Bytes);
expect("standalone I-9 filled and saved", i9Bytes.length > 50000, String(i9Bytes.length));

// Live-in variant exercises the EVV exemption pages.
const liveInProfile = { ...profile, liveIn: "fullTime", relationToEmployer: "parent", relationship: "parent" };
const p26li = await fillPacket2026(packet2026Src, liveInProfile, employer, opts);
writeFileSync(new URL("./out/packet2026-livein-filled.pdf", import.meta.url), p26li);
expect("2026 live-in packet filled and saved", p26li.length > 100000, String(p26li.length));

// ---- Retention purge (localStorage stubbed for Node) ----
{
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
  const store = await import("../src/store.js");
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  store.saveProfiles([
    { id: "fresh", first: "A", touchedAt: now - 1 * day },
    { id: "stale", first: "B", touchedAt: now - 40 * day },
    { id: "unstamped", first: "C" },
  ]);
  const purged = store.purgeStaleProfiles(now);
  const left = store.loadProfiles().map((p) => p.id).sort();
  expect("retention purges stale profile", purged === 1, String(purged));
  expect(
    "retention keeps fresh + stamps legacy",
    left.join(",") === "fresh,unstamped",
    left.join(",")
  );
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);

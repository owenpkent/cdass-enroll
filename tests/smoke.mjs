// End-to-end smoke test in Node: parses synthetic ID documents, fills both
// PDFs with a sample profile, writes them to tests/out/ for inspection.
// Run: node tests/smoke.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";

// blankProfile() uses crypto.randomUUID; provide it on older Node globals.
if (!globalThis.crypto) globalThis.crypto = { randomUUID };
import { fillPacket2026 } from "../src/fill/packet2026.js";
import { fillI9Standalone } from "../src/fill/i9.js";
import { fillW4 } from "../src/fill/w4.js";
import { parseAamva } from "../src/extract/aamva.js";
import { parseMrz } from "../src/extract/mrz.js";
import { parseSsnCard } from "../src/extract/ssncard.js";
import { parseLicenseFront } from "../src/extract/dlfront.js";

let failures = 0;
function expect(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "  " + detail}`);
  if (!cond) failures++;
}

// util.js degrades a missing or renamed PDF field to a console warning instead
// of throwing, so a mapping typo silently fills nothing. Collect those warnings
// (pdf-lib's own chatter, such as the XFA notice, is not ours and is ignored)
// so the fills below can assert that every mapped name still resolved.
const MAPPING_WARNING = /^(field not set|checkbox not set|dropdown has no option|W-4 field not found|W-4 filing status checkbox not found)/;
const mappingWarnings = [];
const realWarn = console.warn;
console.warn = (...args) => {
  const msg = args.join(" ");
  if (MAPPING_WARNING.test(msg)) mappingWarnings.push(msg);
  else realWarn(...args);
};

// Read named fields back out of filled bytes. Text fields return their string,
// checkboxes true/false, and a name the template does not have returns undefined.
async function readFields(bytes, names) {
  const form = (await PDFDocument.load(bytes)).getForm();
  const out = {};
  for (const n of names) {
    try {
      out[n] = form.getTextField(n).getText() ?? "";
      continue;
    } catch {
      /* not a text field */
    }
    try {
      out[n] = form.getCheckBox(n).isChecked();
    } catch {
      out[n] = undefined;
    }
  }
  return out;
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
// No form asks for sex/height/eye colour, so the parser must not return them:
// whatever it returns is written into the profile and persisted to localStorage.
expect("AAMVA extracts no fields the forms do not ask for", dl.gender === undefined, JSON.stringify(dl));

// ---- AAMVA end to end: a real PDF417 image through zxing into the parser ----
// The parser tests above hand it text with real newlines, which is exactly the
// assumption that broke: zxing's default textMode ("HRI") renders a newline as
// the four characters "<LF>", so every element after the first was swallowed
// into the first element's value and a good scan yielded one junk field. Decode
// the fixture with the options the scanner actually uses, so a regression in
// AAMVA_READ_OPTIONS fails here instead of silently on a real license.
{
  const { AAMVA_READ_OPTIONS } = await import("../src/extract/aamva.js");
  const { readBarcodes } = await import("zxing-wasm/reader");
  const png = readFileSync(new URL("./fixtures/license-barcode-jane-doe.png", import.meta.url));
  const results = await readBarcodes(new Blob([png]), AAMVA_READ_OPTIONS);
  const hit = results.find((r) => r.isValid && r.text);
  expect("barcode fixture decodes", !!hit, JSON.stringify(results.map((r) => r.error ?? r.format)));

  const decoded = parseAamva(hit?.text ?? "");
  expect(
    "decoded barcode parses into every field (not one junk field)",
    decoded?.first === "Jane" &&
      decoded?.last === "Doe" &&
      decoded?.dob === "1986-06-06" &&
      decoded?.street === "1234 Main St" &&
      decoded?.city === "Denver" &&
      decoded?.state === "CO" &&
      decoded?.zip === "80203" &&
      decoded?.dlNumber === "123456789" &&
      decoded?.dlExpiration === "2030-09-30",
    JSON.stringify(decoded)
  );
  // Pin the specific failure: the default text mode must not reach the parser.
  const hri = (await readBarcodes(new Blob([png]), { ...AAMVA_READ_OPTIONS, textMode: "HRI" })).find((r) => r.text);
  expect(
    "the zxing default (HRI) is what breaks it, and we do not use it",
    AAMVA_READ_OPTIONS.textMode === "Plain" && !hri.text.includes("\n") && Object.keys(parseAamva(hri.text) ?? {}).length === 1,
    `HRI parsed to ${JSON.stringify(parseAamva(hri.text))}`
  );

  // A state ID card, not a driver's licence. Per AAMVA D.12.4 its subfile type
  // is "ID", so the payload reads "IDDAQ..." -- and "DDA" (a valid element ID)
  // starts one character early, swallowing the licence number if element IDs
  // are matched at arbitrary offsets instead of at the start of their element.
  // Every state ID in the country hits this; a DL fixture alone cannot see it.
  const idPng = readFileSync(new URL("./fixtures/state-id-barcode-jane-doe.png", import.meta.url));
  const idHit = (await readBarcodes(new Blob([idPng]), AAMVA_READ_OPTIONS)).find((r) => r.isValid && r.text);
  expect("state-ID fixture decodes", !!idHit, "no decode");
  const idFields = parseAamva(idHit?.text ?? "");
  expect(
    "state ID keeps its licence number (the 'IDDAQ' / phantom-DDA trap)",
    idFields?.dlNumber === "123456789" && idFields?.last === "Doe" && idFields?.dob === "1986-06-06",
    JSON.stringify(idFields)
  );
  expect(
    "state ID does not invent a DDA element from the subfile marker",
    !("DDA" in (idFields ?? {})) && idFields?.city === "Denver" && idFields?.state === "CO",
    JSON.stringify(idFields)
  );
}

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

// ---- Driver's license FRONT (OCR text) ----
const frontText = [
  "COLORADO DRIVER LICENSE",
  "DOE JANE MARIE",
  "1234 MAIN ST",
  "DENVER CO 80203",
  "DOB 06/06/1986",
  "4b EXP 09/30/2030",
  "4a ISS 09/30/2021",
].join("\n");
const front = parseLicenseFront(frontText);
expect("DL front DOB (labeled / earliest)", front?.dob === "1986-06-06", JSON.stringify(front));
expect(
  "DL front address",
  front?.street === "1234 Main St" && front?.city === "Denver" && front?.state === "CO" && front?.zip === "80203",
  JSON.stringify(front)
);
expect("DL front: no address in junk text", parseLicenseFront("CLASS C\nEYES BRO\nHGT 5-06") === null, "");

// ---- SSN card OCR text ----
const ssnFields = parseSsnCard("SOCIAL SECURITY\n123-45-6789\nJane Marie Doe\nSIGNATURE");
expect("SSN extracted", ssnFields?.ssn === "123-45-6789", JSON.stringify(ssnFields));
expect("SSN card name", ssnFields?.first === "Jane" && ssnFields?.last === "Doe", JSON.stringify(ssnFields));
const ssnMid = parseSsnCard("123-45-6789\nJANE M DOE\nVALID FOR WORK ONLY");
expect("SSN card name with middle initial", ssnMid?.first === "Jane" && ssnMid?.middle === "M" && ssnMid?.last === "Doe", JSON.stringify(ssnMid));
expect("SSN OCR look-alikes corrected", parseSsnCard("I23-4S-6789")?.ssn === "123-45-6789", JSON.stringify(parseSsnCard("I23-4S-6789")));
expect("SSN spaces tolerated", parseSsnCard("SSN 123 45 6789")?.ssn === "123-45-6789", JSON.stringify(parseSsnCard("SSN 123 45 6789")));
expect("implausible SSN rejected", parseSsnCard("000-12-3456") === null, JSON.stringify(parseSsnCard("000-12-3456")));
expect("phone number is not read as an SSN", parseSsnCard("Call 303-555-0100") === null, JSON.stringify(parseSsnCard("Call 303-555-0100")));

// ---- Fill both PDFs ----
const profile = {
  first: "Jane", middle: "Marie", last: "Doe", maidenOrPrevious: "Smith",
  dob: "1986-06-06", ssn: "123456789",
  street: "1234 Main St", street2: "Apt 2", city: "Denver", state: "CO", zip: "80203",
  county: "Denver", mailingSame: true,
  email: "jane@example.com", cellPhone: "303-555-0100", otherPhone: "", allowText: "yes",
  contactPreference: "email", primaryLanguage: "English", bestContactTimes: "Weekday mornings",
  directDeposit: true, accountType: "checking",
  bankName: "First Bank", routing: "102000021", account: "9876543210",
  paperPayStub: false,
  pplId: "ATT-001", relationship: "nonrelative", liveIn: "doesNotLive",
  relationToEmployer: "none", fullTimeStudent: false, primaryJob: true,
  citizenship: "citizen", uscisNumber: "", workAuthExpiration: "", i94Number: "", foreignPassport: "",
  dlNumber: "123456789", dlState: "CO", dlExpiration: "2030-09-30",
  passportNumber: "", passportExpiration: "",
  filingStatus: "single", multipleJobs: true,
  rateStandardCdass: "20.00", rateEmergencyCdass: "45",
  childrenCredit: "2000", otherDependentsCredit: "500",
  otherIncome: "", deductions: "", extraWithholding: "50",
};
const employer = {
  memberFirst: "Owen", memberLast: "Kent", memberPplId: "MEM-001", memberMedicaidId: "A123456",
  employerFirst: "Owen", employerLast: "Kent", employerTitle: "Employer",
  businessName: "Owen Kent, Household Employer", businessAddress: "1234 Main St, Denver, CO 80203",
  ein: "12-3456789",
};
const opts = { signatureDate: "2026-06-11", firstDay: "2026-06-15", newService: true };

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });

const w4Bytes = await fillW4(readFileSync(new URL("../public/forms/w4.pdf", import.meta.url)), profile, employer, opts);
writeFileSync(new URL("./out/w4-filled.pdf", import.meta.url), w4Bytes);
expect("w4 filled and saved", w4Bytes.length > 50000, String(w4Bytes.length));

const packet2026Src = readFileSync(new URL("../public/forms/CO-CDASS-Attendant-Packet-2026.pdf", import.meta.url));
const p26 = await fillPacket2026(packet2026Src, profile, employer, opts);
writeFileSync(new URL("./out/packet2026-filled.pdf", import.meta.url), p26);
expect("2026 packet filled and saved", p26.length > 100000, String(p26.length));

// The output must stay an exact, editable copy of the packet: same pages, same
// live form fields (not flattened), just with values filled in.
{
  const tmpl = await PDFDocument.load(packet2026Src);
  const out = await PDFDocument.load(p26);
  expect("packet output keeps every page (exact copy)", out.getPageCount() === tmpl.getPageCount(), `${out.getPageCount()} vs ${tmpl.getPageCount()}`);
  const nOut = out.getForm().getFields().length, nTmpl = tmpl.getForm().getFields().length;
  expect("packet fields stay editable (not flattened)", nOut === nTmpl && nOut > 0, `${nOut} vs ${nTmpl}`);
}

// An uploaded employer signature must overlay without changing pages or fields.
{
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const signed = await fillPacket2026(packet2026Src, profile, { ...employer, signature: tinyPng }, opts);
  const out = await PDFDocument.load(signed);
  const tmpl = await PDFDocument.load(packet2026Src);
  expect(
    "signed packet keeps pages and fields (stays an exact editable copy)",
    out.getPageCount() === tmpl.getPageCount() && out.getForm().getFields().length === tmpl.getForm().getFields().length,
    `${out.getPageCount()} pages / ${out.getForm().getFields().length} fields`
  );
}

// Values must actually land in the named boxes. Structural checks above pass
// even when every mapped name has drifted, so assert the real content too.
{
  const f = await readFields(p26, [
    "Member Name: first and last",
    "Attendant Name: first, middle and last",
    "Attendant date of birth",
    "Attendant Social Security Number",
    "Attendant physical address",
    "Attendant email",
    "Bank or money app name",
    "Routing number 1",
    "Routing number 9",
    "CDASS Standard Rate",
    "CDASS Emergency Rate",
    "NonRelative",
    "Direct Deposit to Bank Account or Third Party Money App",
    "Checking Account",
    "List B Document Number 1",
    "Last Name (Family Name)",
    "CB_1",
    "Last Name First Name and Title of Employer or Authorized Representative",
  ]);
  expect("packet: member and attendant names land", f["Member Name: first and last"] === "Owen Kent" && f["Attendant Name: first, middle and last"] === "Jane Marie Doe", JSON.stringify(f));
  expect("packet: DOB and SSN are formatted", f["Attendant date of birth"] === "06/06/1986" && f["Attendant Social Security Number"] === "123-45-6789", JSON.stringify(f));
  expect("packet: contact and bank land", f["Attendant email"] === "jane@example.com" && f["Bank or money app name"] === "First Bank", JSON.stringify(f));
  expect("packet: routing spreads one digit per box", f["Routing number 1"] === "1" && f["Routing number 9"] === "1", JSON.stringify(f));
  expect("packet: rates land", f["CDASS Standard Rate"] === "20.00" && f["CDASS Emergency Rate"] === "45", JSON.stringify(f));
  expect("packet: relationship and payment boxes check", f["NonRelative"] === true && f["Direct Deposit to Bank Account or Third Party Money App"] === true && f["Checking Account"] === true, JSON.stringify(f));
  expect("packet: embedded I-9 fills (List B + citizenship)", f["Last Name (Family Name)"] === "Doe" && f["List B Document Number 1"] === "123456789" && f["CB_1"] === true, JSON.stringify(f));
  // I-9 Section 2 signer line is "Last, First, Title" of the employer (the Member).
  // With no employer name it silently degrades to just the title ("Employer"), an
  // incomplete form PPL bounces, so assert the name actually lands.
  expect("packet: I-9 Section 2 names the employer, not just the title", f["Last Name First Name and Title of Employer or Authorized Representative"] === "Kent, Owen, Employer", JSON.stringify(f));
}

// The rate belongs in exactly one of the three tables on page 10, chosen by the
// Member's program. Writing it into the wrong table is a wrong form, not a typo.
{
  const RATE_FIELDS = ["CDASS Standard Rate", "SLS CDASS Standard Rate", "CFC CDASS Standard Rate"];
  const forProgram = async (memberProgram) =>
    readFields(await fillPacket2026(packet2026Src, profile, { ...employer, memberProgram }, opts), RATE_FIELDS);

  const dflt = await forProgram("");
  expect("rates: default program uses Table 1 (CDASS) only", dflt["CDASS Standard Rate"] === "20.00" && !dflt["SLS CDASS Standard Rate"] && !dflt["CFC CDASS Standard Rate"], JSON.stringify(dflt));

  const sls = await forProgram("sls");
  expect("rates: SLS member uses Table 2 only", sls["SLS CDASS Standard Rate"] === "20.00" && !sls["CDASS Standard Rate"] && !sls["CFC CDASS Standard Rate"], JSON.stringify(sls));

  const cfc = await forProgram("cfc");
  expect("rates: CFC member uses Table 3 only", cfc["CFC CDASS Standard Rate"] === "20.00" && !cfc["CDASS Standard Rate"] && !cfc["SLS CDASS Standard Rate"], JSON.stringify(cfc));
}

// Paper check instead of direct deposit: the mailing address block fills.
{
  const check = await fillPacket2026(packet2026Src, { ...profile, directDeposit: false }, employer, opts);
  const f = await readFields(check, ["Payment by Paper Check", "Address", "Address 2 (Apt., Ste., or other)", "City", "Zip Code", "Routing number 1"]);
  expect("paper check: box checks and the mailing address fills", f["Payment by Paper Check"] === true && f["Address"] === "1234 Main St" && f["Address 2 (Apt., Ste., or other)"] === "Apt 2" && f["City"] === "Denver" && f["Zip Code"] === "80203", JSON.stringify(f));
  expect("paper check: no bank digits are written", !f["Routing number 1"], JSON.stringify(f));
}

const i9Bytes = await fillI9Standalone(readFileSync(new URL("../public/forms/i9.pdf", import.meta.url)), profile, employer, opts);
writeFileSync(new URL("./out/i9-filled.pdf", import.meta.url), i9Bytes);
expect("standalone I-9 filled and saved", i9Bytes.length > 50000, String(i9Bytes.length));

// I-9 Section 2 document logic: license + SSN card (List B/C) above, passport
// (List A) here. The List A branch is what PPL sees for passport holders.
{
  const f = await readFields(i9Bytes, [
    "Last Name (Family Name)",
    "US Social Security Number",
    "List B Document Number 1",
    "List C Document Number 1",
    "List B Issuing Authority 1",
    "Employers Business or Org Name",
    "Last Name First Name and Title of Employer or Authorized Representative",
    "FirstDayEmployed mmddyyyy",
  ]);
  expect("I-9: name and SSN (digits only, maxLength 9)", f["Last Name (Family Name)"] === "Doe" && f["US Social Security Number"] === "123456789", JSON.stringify(f));
  expect("I-9: license is List B, SSN card is List C", f["List B Document Number 1"] === "123456789" && f["List C Document Number 1"] === "123-45-6789" && f["List B Issuing Authority 1"] === "Colorado DMV", JSON.stringify(f));
  expect("I-9: employer block fills", f["Employers Business or Org Name"] === "Owen Kent, Household Employer" && f["FirstDayEmployed mmddyyyy"] === "06/15/2026", JSON.stringify(f));
  expect("I-9: Section 2 names the employer, not just the title", f["Last Name First Name and Title of Employer or Authorized Representative"] === "Kent, Owen, Employer", JSON.stringify(f));

  const withPassport = { ...profile, passportNumber: "540012345", passportExpiration: "2031-05-15" };
  const pp = await readFields(
    await fillI9Standalone(readFileSync(new URL("../public/forms/i9.pdf", import.meta.url)), withPassport, employer, opts),
    ["Document Title 1", "Document Number 0 (if any)", "Expiration Date if any", "List B Document Number 1"]
  );
  expect(
    "I-9: a passport uses List A alone (no List B/C)",
    pp["Document Title 1"] === "U.S. Passport" && pp["Document Number 0 (if any)"] === "540012345" && pp["Expiration Date if any"] === "05/15/2031" && !pp["List B Document Number 1"],
    JSON.stringify(pp)
  );
}

// Age-gated attestations: these assert a fact about the attendant, so they only
// check when the date of birth backs them up.
{
  const minor = { ...profile, dob: "2010-06-06", fullTimeStudent: true, primaryJob: true, relationToEmployer: "child" };
  const names = [
    "I am under 18 years old and I am a fulltime student",
    "I am under 18 years old and this job of performing household services (respite) is my primary job",
    "I am the biological or legally adopted child of the employer and I am under the age of 21",
  ];
  const young = await readFields(await fillPacket2026(packet2026Src, minor, employer, opts), names);
  expect("tax exemptions: under-18 attestations check when the DOB agrees", names.every((n) => young[n] === true), JSON.stringify(young));

  const adult = { ...profile, fullTimeStudent: true, primaryJob: true, relationToEmployer: "child" }; // born 1986
  const old = await readFields(await fillPacket2026(packet2026Src, adult, employer, opts), names);
  expect("tax exemptions: the same toggles stay blank for an adult", names.every((n) => !old[n]), JSON.stringify(old));
}

// ---- Reading a filled packet back in ----
// The round trip is the contract that keeps PACKET2026_TEXT honest: fill writes
// through the table, import reads through it, so a field name that drifts in one
// direction fails here rather than silently importing nothing.
{
  const { readFilledPacket } = await import("../src/extract/filledpacket.js");
  const { PACKET2026_TEXT } = await import("../src/fill/packet2026.js");
  const back = await readFilledPacket(p26);

  const drifted = PACKET2026_TEXT.map((f) => {
    const want = (f.on === "emp" ? employer : profile)[f.key] ?? "";
    const got = (f.on === "emp" ? back.employer : back.profile)[f.key] ?? "";
    return want === got ? null : `${f.key}: ${JSON.stringify(want)} -> ${JSON.stringify(got)}`;
  }).filter(Boolean);
  expect("import: every shared-table field round-trips", drifted.length === 0, drifted.join("; "));

  expect(
    "import: name, relationship, payment and rates come back",
    back.profile.first === "Jane" &&
      back.profile.middle === "Marie" && // the I-9 holds only "M"; the composite line has the rest
      back.profile.last === "Doe" &&
      back.profile.relationship === "nonrelative" &&
      back.profile.contactPreference === "email" &&
      back.profile.allowText === "yes" &&
      back.profile.mailingSame === true &&
      back.profile.directDeposit === true &&
      back.profile.accountType === "checking" &&
      back.profile.routing === "102000021" &&
      back.profile.account === "9876543210" &&
      back.profile.rateStandardCdass === "20.00" &&
      back.employer.memberFirst === "Owen" &&
      back.employer.memberLast === "Kent",
    JSON.stringify(back.profile)
  );

  // Attestations are the signer's word, not data. Importing them would re-assert
  // an old form's statement onto a new one without the human saying so.
  const attestations = ["relationToEmployer", "fullTimeStudent", "primaryJob", "citizenship", "liveIn"];
  expect(
    "import: attestations are never imported",
    attestations.every((k) => !(k in back.profile)),
    JSON.stringify(Object.keys(back.profile))
  );

  let rejected = false;
  try {
    await readFilledPacket(w4Bytes);
  } catch {
    rejected = true;
  }
  expect("import: a PDF that is not this packet is rejected", rejected);
}

// Part 1 of the Tax Exemptions Form requires one of its four statements, so a
// blank Part 1 is an incomplete form. A profile straight from the schema has to
// answer it without the user remembering to open the dropdown.
{
  const { blankProfile } = await import("../src/schema.js");
  const fresh = { ...blankProfile(), first: "Jane", last: "Doe", dob: "1986-02-14" };
  const part1 = [
    "I am the spouse of the employer",
    "I am the parent of the employer",
    "I am the biological or legally adopted child of the employer and I am under the age of 21",
    "I am not the spouse parent or child of the employer",
  ];
  const f = await readFields(await fillPacket2026(packet2026Src, fresh, employer, opts), part1);
  expect("tax exemptions: a fresh profile answers Part 1 'not a relative'", f[part1[3]] === true, JSON.stringify(f));
  expect(
    "tax exemptions: exactly one Part 1 statement is ever checked",
    part1.filter((n) => f[n]).length === 1,
    JSON.stringify(f)
  );
}

// An absent profile key makes a guard like `p.fullTimeStudent && age < 18`
// evaluate to undefined. check() must read that as "leave it alone"; when its
// `on` parameter defaulted to true, undefined attested "I am under 18 years
// old" on an adult's signed form.
{
  const sparse = { first: "Jane", last: "Doe", dob: "1986-02-14", relationToEmployer: "none" };
  const names = [
    "I am under 18 years old and I am a fulltime student",
    "I am under 18 years old and this job of performing household services (respite) is my primary job",
    "Send my pay stub in the mail",
  ];
  const f = await readFields(await fillPacket2026(packet2026Src, sparse, employer, opts), names);
  expect("check(): a guard that is undefined leaves the box blank", names.every((n) => !f[n]), JSON.stringify(f));
}

// ---- W-4 values (fields are XFA-style suffixes, so match by tail) ----
{
  const form = (await PDFDocument.load(w4Bytes)).getForm();
  const val = (suffix) => {
    const f = form.getFields().find((x) => x.getName().endsWith(suffix));
    try {
      return f?.getText() ?? "";
    } catch {
      return f?.isChecked?.() ?? undefined;
    }
  };
  expect("W-4: name, address, SSN", val(".f1_01[0]") === "Jane M" && val(".f1_02[0]") === "Doe" && val(".f1_05[0]") === "123-45-6789", JSON.stringify([val(".f1_01[0]"), val(".f1_02[0]"), val(".f1_05[0]")]));
  expect("W-4: single filing status checks", val(".c1_1[0]") === true, String(val(".c1_1[0]")));
  expect("W-4: Step 2(c) multiple-jobs box checks", val(".c1_2[0]") === true, String(val(".c1_2[0]")));
  expect("W-4: Step 3 totals the two credits (2000 + 500)", val(".f1_08[0]") === "2500", val(".f1_08[0]"));
  expect("W-4: Step 4(c) extra withholding", val(".f1_11[0]") === "50", val(".f1_11[0]"));
  expect("W-4: employer block and EIN (2024+ layout)", val(".f1_12[0]") === "Owen Kent, 1234 Main St, Denver, CO 80203" && val(".f1_13[0]") === "06/15/2026" && val(".f1_14[0]") === "12-3456789", JSON.stringify([val(".f1_12[0]"), val(".f1_13[0]"), val(".f1_14[0]")]));
}


// Live-in variant exercises the EVV exemption pages.
const liveInProfile = { ...profile, liveIn: "fullTime", relationToEmployer: "parent", relationship: "parent" };
const p26li = await fillPacket2026(packet2026Src, liveInProfile, employer, opts);
writeFileSync(new URL("./out/packet2026-livein-filled.pdf", import.meta.url), p26li);
expect("2026 live-in packet filled and saved", p26li.length > 100000, String(p26li.length));
{
  const f = await readFields(p26li, [
    "Livein Caregiver Enter the shared residential address then skip to section 7",
    "Medicaid ID",
    "Last 5 SSN",
    "Billing Provider or FMS Vendor name",
    "Street Address",
  ]);
  expect(
    "live-in: the EVV exemption pages fill",
    f["Livein Caregiver Enter the shared residential address then skip to section 7"] === true &&
      f["Medicaid ID"] === "A123456" &&
      f["Last 5 SSN"] === "56789" &&
      f["Billing Provider or FMS Vendor name"] === "Public Partnerships LLC" &&
      f["Street Address"] === "1234 Main St",
    JSON.stringify(f)
  );
  const away = await readFields(await fillPacket2026(packet2026Src, profile, employer, opts), ["Medicaid ID", "Last 5 SSN"]);
  expect("live-in: EVV pages stay blank when the attendant does not live in", !away["Medicaid ID"] && !away["Last 5 SSN"], JSON.stringify(away));
}

// Every field name the mappings write must still exist in the templates. This
// is the check that catches a PPL/IRS revision: the fills above would otherwise
// skip the renamed fields, ship a half-empty PDF, and still pass every assertion.
console.warn = realWarn;
expect("no unresolved field names in any mapping", mappingWarnings.length === 0, mappingWarnings.join(" | "));

// ---- Mailing override: unchecking "same" seeds mailing from the home address ----
{
  const { PROFILE_SECTIONS } = await import("../src/schema.js");
  const mailingSame = PROFILE_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === "mailingSame");
  const p = {
    mailingSame: false, street: "1234 Main St", street2: "Apt 2",
    city: "Denver", state: "CO", zip: "80203",
    mailStreet: "", mailStreet2: "", mailCity: "", mailState: "", mailZip: "",
  };
  const seeded = mailingSame.onToggle(p);
  expect(
    "uncheck mailing-same seeds mailing from home",
    p.mailStreet === "1234 Main St" && p.mailCity === "Denver" && p.mailZip === "80203" && seeded.includes("mailStreet"),
    JSON.stringify(p)
  );
  // A mailing address already entered must not be clobbered on a later toggle.
  const q = { mailingSame: false, street: "1234 Main St", city: "Denver", zip: "80203", mailStreet: "PO Box 9", mailCity: "Aspen", mailZip: "81611" };
  mailingSame.onToggle(q);
  expect("existing mailing address is preserved", q.mailStreet === "PO Box 9" && q.mailCity === "Aspen", JSON.stringify(q));
}

// ---- Sensitive-data scrub ----
{
  const { scrubSensitive } = await import("../src/schema.js");
  const p = { ...profile };
  const cleared = scrubSensitive(p);
  const stillSensitive = ["ssn", "dob", "routing", "account", "bankName", "dlNumber", "passportNumber"]
    .filter((k) => p[k]);
  expect("scrub clears all sensitive fields", stillSensitive.length === 0, stillSensitive.join(","));
  expect("scrub keeps name and rates", p.first === "Jane" && p.rateStandardCdass === "20.00", JSON.stringify({ first: p.first }));
  expect("scrub reports cleared keys", cleared.includes("ssn") && cleared.includes("account"), cleared.join(","));
}

// ---- Single-profile store: retention + legacy migration (localStorage stubbed) ----
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

  // A fresh profile is kept.
  m.set("cdass.profile.v1", JSON.stringify({ first: "A", touchedAt: now - 1 * day }));
  expect("retention keeps a fresh profile", store.purgeStaleProfile(now) === false && store.loadProfile().first === "A", "fresh");

  // A stale profile is cleared.
  m.set("cdass.profile.v1", JSON.stringify({ first: "B", touchedAt: now - 40 * day }));
  expect("retention clears a stale profile", store.purgeStaleProfile(now) === true && store.loadProfile().first === "", "stale");

  // The old multi-profile array migrates to the most recently touched person.
  m.clear();
  m.set(
    "cdass.profiles.v1",
    JSON.stringify([
      { first: "Older", touchedAt: now - 10 * day },
      { first: "Newer", touchedAt: now - 1 * day },
    ])
  );
  expect("legacy array migrates to most-recent person", store.loadProfile().first === "Newer", store.loadProfile().first);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);

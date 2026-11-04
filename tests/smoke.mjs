// End-to-end smoke test in Node: fills every PDF with a sample profile and
// writes them to tests/out/ for inspection.
// Run: node tests/smoke.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PDFDocument, PDFName } from "pdf-lib";

// blankProfile() uses crypto.randomUUID; provide it on older Node globals.
if (!globalThis.crypto) globalThis.crypto = { randomUUID };
import { fillPacket2026 } from "../src/fill/packet2026.js";
import { fillI9Standalone } from "../src/fill/i9.js";
import { fillW4 } from "../src/fill/w4.js";
import { V3_ADDED_FIELDS } from "../src/fill/packet2026.js";
import { PROFILE, EMPLOYER, OPTS, EXPECTED_PACKET } from "./fixtures/complete-packet.mjs";

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

// ---- Fill every PDF from the complete-packet fixture ----
const profile = PROFILE;
const employer = EMPLOYER;
const opts = OPTS;

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });

const w4Bytes = await fillW4(readFileSync(new URL("../public/forms/w4.pdf", import.meta.url)), profile, employer, opts);
writeFileSync(new URL("./out/w4-filled.pdf", import.meta.url), w4Bytes);
expect("w4 filled and saved", w4Bytes.length > 50000, String(w4Bytes.length));

const packet2026Src = readFileSync(new URL("../public/forms/CO-CDASS-Attendant-Packet-2026.pdf", import.meta.url));
const p26 = await fillPacket2026(packet2026Src, profile, employer, opts);
writeFileSync(new URL("./out/packet2026-filled.pdf", import.meta.url), p26);
expect("2026 packet filled and saved", p26.length > 100000, String(p26.length));

// The output must stay an exact, editable copy of the packet: same pages, same
// live form fields (not flattened), just with values filled in. ADDED counts the
// fields the filler adds: the page 9 mailing State split off its shared field,
// and the V.2 fields V.3 dropped (text-me boxes, employer printed name).
const ADDED = 1 + V3_ADDED_FIELDS.length;
{
  const tmpl = await PDFDocument.load(packet2026Src);
  const out = await PDFDocument.load(p26);
  expect("packet output keeps every page (exact copy)", out.getPageCount() === tmpl.getPageCount(), `${out.getPageCount()} vs ${tmpl.getPageCount()}`);
  const nOut = out.getForm().getFields().length, nTmpl = tmpl.getForm().getFields().length;
  expect("packet fields stay editable (not flattened)", nOut === nTmpl + ADDED && nOut > 0, `${nOut} vs ${nTmpl} (+${ADDED}: page 9 mailing State split off its shared field, plus the fields V.3 dropped)`);
}

// An uploaded employer signature must overlay without changing pages or fields.
{
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const signed = await fillPacket2026(packet2026Src, profile, { ...employer, signature: tinyPng }, opts);
  const out = await PDFDocument.load(signed);
  const tmpl = await PDFDocument.load(packet2026Src);
  expect(
    "signed packet keeps pages and fields (stays an exact editable copy)",
    out.getPageCount() === tmpl.getPageCount() && out.getForm().getFields().length === tmpl.getForm().getFields().length + ADDED,
    `${out.getPageCount()} pages / ${out.getForm().getFields().length} fields`
  );
}

// Each signature lands on its own signer's lines and nowhere else: the employer
// on pages 8, 11, 12 and the I-9 Section 2 (20); the attendant on 8, 10, 11, 12
// and the I-9 Section 1 (20). Counted as images drawn per page against an
// unsigned fill, so a placement on the wrong page fails.
{
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const xobjects = async (bytes) =>
    (await PDFDocument.load(bytes)).getPages().map((pg) => pg.node.Resources()?.lookup(PDFName.of("XObject"))?.keys().length ?? 0);
  const pagesWithNew = (base, signed) => signed.map((n, i) => (n > base[i] ? i + 1 : 0)).filter(Boolean);
  const base = await xobjects(p26);
  const emp = pagesWithNew(base, await xobjects(await fillPacket2026(packet2026Src, profile, { ...employer, signature: tinyPng }, opts)));
  expect("employer signature: pages 8, 11, 12, 20 only", JSON.stringify(emp) === "[8,11,12,20]", JSON.stringify(emp));
  const att = pagesWithNew(base, await xobjects(await fillPacket2026(packet2026Src, profile, employer, { ...opts, attendantSignature: tinyPng })));
  expect("attendant signature: pages 8, 10, 11, 12, 20 only", JSON.stringify(att) === "[8,10,11,12,20]", JSON.stringify(att));
  const w4Base = await xobjects(w4Bytes);
  const w4Att = pagesWithNew(w4Base, await xobjects(await fillW4(readFileSync(new URL("../public/forms/w4.pdf", import.meta.url)), profile, employer, { ...opts, attendantSignature: tinyPng })));
  expect("attendant signature: W-4 Step 5 on page 1", JSON.stringify(w4Att) === "[1]", JSON.stringify(w4Att));
}

// Values must actually land in the named boxes. Structural checks above pass
// even when every mapped name has drifted, so check every field the fixture
// lists, blanks included.
{
  const f = await readFields(p26, Object.keys(EXPECTED_PACKET));
  const wrong = Object.entries(EXPECTED_PACKET)
    .filter(([name, want]) => f[name] !== want)
    .map(([name, want]) => `${name}: want ${JSON.stringify(want)}, got ${JSON.stringify(f[name])}`);
  expect(`packet: all ${Object.keys(EXPECTED_PACKET).length} fixture fields match`, wrong.length === 0, wrong.join(" | "));
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

// Each filled form gets its own trailer /ID. PDF viewers (PDF.js, Folio) key
// placed signatures and edits by it, so a template's ID carried into every
// person's form made one person's signature reappear on the next one's W-4.
{
  const docId = async (bytes) =>
    (await PDFDocument.load(bytes)).context.trailerInfo.ID?.asArray().map((s) => s.asString()).join("|") ?? "";
  const forms = [
    ["W-4", "w4.pdf", w4Bytes, () => fillW4(readFileSync(new URL("../public/forms/w4.pdf", import.meta.url)), profile, employer, opts)],
    ["packet", "CO-CDASS-Attendant-Packet-2026.pdf", p26, () => fillPacket2026(packet2026Src, profile, employer, opts)],
    ["I-9", "i9.pdf", i9Bytes, () => fillI9Standalone(readFileSync(new URL("../public/forms/i9.pdf", import.meta.url)), profile, employer, opts)],
  ];
  for (const [label, template, bytes, again] of forms) {
    const tpl = await docId(readFileSync(new URL(`../public/forms/${template}`, import.meta.url)));
    const a = await docId(bytes);
    const b = await docId(await again());
    const firstHalves = new Set([tpl, a, b].map((id) => id.split("|")[0]));
    expect(`${label}: every fill has its own document ID, unrelated to the template's`, a && b && firstHalves.size === 3, `${tpl} / ${a} / ${b}`);
  }
}

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

  // Packets filled before the V.3 revision still import. A V.2-shaped AcroForm
  // (its descriptive page 2 names) built here stands in for an old packet.
  {
    const old = await PDFDocument.create();
    const page = old.addPage();
    const form = old.getForm();
    let y = 10;
    const put = (name, value) => {
      const t = form.createTextField(name);
      t.addToPage(page, { x: 10, y: (y += 12), width: 100, height: 10 });
      t.setText(value);
    };
    const tick = (name) => {
      const c = form.createCheckBox(name);
      c.addToPage(page, { x: 120, y: (y += 12), width: 8, height: 8 });
      c.check();
    };
    put("Attendant Name: first, middle and last", "Jane Marie Doe");
    put("Attendant date of birth", "06/06/1986");
    put("Attendant Social Security Number", "123-45-6789");
    put("Attendant physical address, not PO Box", "1234 Main St");
    put("Attendant cell phone", "303-555-0100");
    put("Member Name: first and last", "Owen Kent");
    put("First Name Given Name", "Jane");
    put("Last Name (Family Name)", "Doe");
    put("Bank or money app name", "First Bank");
    put("CDASS Standard Rate", "$20.00");
    tick("Parent");
    tick("The attendant prefers to be contacted by cell phone");
    tick("Check the box if the address where you live is the same as your mailing address");
    const v2 = await readFilledPacket(await old.save());
    const want = {
      first: "Jane", middle: "Marie", last: "Doe", dob: "1986-06-06", ssn: "123456789",
      street: "1234 Main St", cellPhone: "303-555-0100", relationship: "parent",
      contactPreference: "cell", mailingSame: true, bankName: "First Bank", rateStandardCdass: "20.00",
    };
    const off = Object.entries(want).filter(([k, v]) => v2.profile[k] !== v).map(([k, v]) => `${k}: want ${v}, got ${v2.profile[k]}`);
    expect("import: a packet filled from the July 2025 (V.2) revision still reads", off.length === 0 && v2.employer.memberFirst === "Owen", off.join("; "));
  }

  // A V.3 packet finished by hand may fill only page 2's own Member ID and
  // Member/Employer name boxes and leave the repeated headers on later pages
  // blank. Those page 2 values must still import.
  {
    const doc = await PDFDocument.load(packet2026Src);
    const form = doc.getForm();
    form.getTextField("Text1").setText("Taylor Smith");
    form.getTextField("Text2").setText("Alex Johnson");
    form.getTextField("Text3").setText("MEM-123");
    const got = (await readFilledPacket(await doc.save())).employer;
    expect(
      "import: V.3 page 2 Member ID and Member/Employer names read without the later headers",
      got.memberPplId === "MEM-123" && got.memberFirst === "Alex" && got.memberLast === "Johnson" && got.employerFirst === "Taylor" && got.employerLast === "Smith",
      JSON.stringify(got)
    );
  }

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

// ---- Money validation: a rate is never silently rounded or silently dropped ----
{
  const { moneyError, moneyErrors, normalizeMoney } = await import("../src/schema.js");

  expect("money: a clean rate passes", moneyError("18.50") === null && moneyError("20") === null, moneyError("18.50") ?? "");
  expect("money: blank is allowed", moneyError("") === null && moneyError(undefined) === null, "");
  expect("money: formatting is stripped, not the amount", normalizeMoney(" $1,234.00 ") === "1234.00", normalizeMoney(" $1,234.00 "));
  expect("money: a dollar sign still validates", moneyError("$18.50") === null, moneyError("$18.50") ?? "");

  // The reported bug: a third decimal reaches the rate form.
  const overPrecise = moneyError("33.517");
  expect(
    "money: 33.517 is rejected, offering both readings",
    overPrecise?.includes("33.51") && overPrecise.includes("33.52"),
    String(overPrecise)
  );
  expect("money: an exact third decimal offers one reading", moneyError("33.500") === "Rates are dollars and cents. Did you mean 33.50?", String(moneyError("33.500")));
  expect("money: junk is rejected", moneyError("18.5o") !== null && moneyError("about 18") !== null, "");
  expect("money: an implausible rate is rejected", moneyError("0.25") !== null && moneyError("3351.70") !== null, "");

  // Nothing rewrites the value: the typist resolves it.
  const p = { rateStandardCdass: "33.517", rateEmergencyCdass: "45" };
  const bad = moneyErrors(p);
  expect("money: Generate is blocked on the bad field only", bad.length === 1 && bad[0].key === "rateStandardCdass", JSON.stringify(bad));
  expect("money: the value is left exactly as typed", p.rateStandardCdass === "33.517", p.rateStandardCdass);
}

// ---- Bug-fix block: money scoping, W-4 totals, mailing State, MaxLen, I-9 gating, EVV relationship ----
{
  const { moneyError, moneyErrors, normalizeMoney, PROFILE_SECTIONS } = await import("../src/schema.js");
  const field = (k) => PROFILE_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === k);
  expect("money: W-4 $2000 and $0 pass (no rate bounds)", moneyError("2000", field("childrenCredit")) === null && moneyError("0", field("extraWithholding")) === null, "");
  expect("money: W-4 amount error does not say rate", !/rate/i.test(moneyError("abc", field("deductions"))), String(moneyError("abc", field("deductions"))));
  expect("money: rate bounds still apply to rate fields", moneyError("500", field("rateStandardCdass")) !== null, "");
  expect("money: moneyErrors passes a profile with W-4 $2000", moneyErrors({ childrenCredit: "2000", extraWithholding: "0", rateStandardCdass: "20" }).length === 0, "");
  expect("money: decimal comma is not 185", normalizeMoney("18,5") === "18,5" && moneyError("18,5") !== null, normalizeMoney("18,5"));
  expect("money: thousands commas still stripped", normalizeMoney("$1,234,567.50") === "1234567.50" && normalizeMoney("12,34") === "12,34", "");

  const read = async (bytes, names) => readFields(bytes, names);
  const w4 = await fillW4(readFileSync(new URL("../public/forms/w4.pdf", import.meta.url)), { ...profile, childrenCredit: "$1,000", otherDependentsCredit: "500.50", otherIncome: "", extraWithholding: "$0" }, employer, opts);
  const w4f = (await PDFDocument.load(w4)).getForm();
  const w4vals = Object.fromEntries(w4f.getFields().filter((f) => typeof f.getText === "function").map((f) => [f.getName().split(".").pop(), f.getText()]));
  expect("W-4: Step 3 total sums normalized amounts in cents", w4vals["f1_08[0]"] === "1500.5" || w4vals["f1_08[0]"] === "1500.50", JSON.stringify(w4vals));
  expect("W-4: $1,000 written as 1000", w4vals["f1_06[0]"] === "1000", String(w4vals["f1_06[0]"]));

  // Mailing State on a paper-check packet must not touch the I-9 State.
  const away = { ...profile, directDeposit: false, mailingSame: false, mailStreet: "PO Box 9", mailCity: "Aspen", mailState: "NM", mailZip: "81611" };
  const pk = await fillPacket2026(packet2026Src, away, employer, opts);
  const pf = (await PDFDocument.load(pk)).getForm();
  expect("packet: page 8 mailing State is its own field", pf.getTextField("Payment mailing State").getText() === "NM", "");
  expect("packet: I-9 State keeps the home state", pf.getTextField("State").getText() === "CO", String(pf.getTextField("State").getText()));

  // MaxLen: ZIP+4 and A-Number.
  const zipA = { ...profile, zip: "80203-1234", citizenship: "alien", uscisNumber: "A-123 456 789" };
  const zf = await read(await fillI9Standalone(readFileSync(new URL("../public/forms/i9.pdf", import.meta.url)), zipA, employer, opts), ["ZIP Code", "USCIS ANumber"]);
  expect("I-9: ZIP+4 fills the 5-digit ZIP, A-Number digits only", zf["ZIP Code"] === "80203" && zf["USCIS ANumber"] === "123456789", JSON.stringify(zf));

  // List C needs the explicit choice; issuer never falls back to the home state.
  const noCard = await read(await fillI9Standalone(readFileSync(new URL("../public/forms/i9.pdf", import.meta.url)), { ...profile, ssnCardPresented: false, dlState: "" }, employer, opts), ["List C Document Number 1", "List B Issuing Authority 1", "List B Document Number 1"]);
  expect("I-9: List C blank without ssnCardPresented; no home-state DL issuer", noCard["List C Document Number 1"] === "" && noCard["List B Issuing Authority 1"] === "" && noCard["List B Document Number 1"] === "123456789", JSON.stringify(noCard));

  // EVV relationship follows the Member relationship.
  const evv = async (pr) => (await PDFDocument.load(await fillPacket2026(packet2026Src, { ...profile, liveIn: "fullTime", ...pr }, employer, opts))).getForm();
  const sp = await evv({ relationship: "spouse", relationToEmployer: "none" });
  expect("EVV: spouse of the Member -> Yes + Spouse", sp.getTextField("If yes describe their relationship parent spouse sibling etc").getText() === "Spouse" && sp.getRadioGroup("Is the caregiver legally responsible for the member").getSelected() === "Yes", "");
  const nr = await evv({ relationship: "nonrelative", relationToEmployer: "parent" });
  expect("EVV: employer relation no longer leaks into the relationship box", (nr.getTextField("If yes describe their relationship parent spouse sibling etc").getText() ?? "") === "", "");
}

// ---- Employer signature: only stamped for the packet it was confirmed for ----
{
  const { blankEmployer } = await import("../src/schema.js");
  expect(
    "signature provenance keys exist on a blank employer",
    "signatureFor" in blankEmployer() && "signatureUploadedAt" in blankEmployer(),
    JSON.stringify(Object.keys(blankEmployer()))
  );

  // main.js hands the fillers an employer whose signature is blanked unless the
  // stamp was confirmed for this packet. Blank means no image is embedded at
  // all, so an unconfirmed signature cannot reach the page by any route.
  const sigPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const countImages = async (bytes) => {
    const doc = await PDFDocument.load(bytes);
    let n = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects())
      if (obj?.dict?.get(PDFName.of("Subtype"))?.toString() === "/Image") n++;
    return n;
  };

  const confirmed = { ...employer, signature: sigPng };
  const withheld = { ...confirmed, signature: "" };
  const i9Src = readFileSync(new URL("../public/forms/i9.pdf", import.meta.url));

  // Withholding the signature has to be indistinguishable from never having
  // uploaded one: same image objects in the file, nothing left behind.
  for (const [label, src, fill] of [
    ["packet", packet2026Src, fillPacket2026],
    ["standalone I-9", i9Src, fillI9Standalone],
  ]) {
    const none = await countImages(await fill(src, profile, employer, opts));
    const blanked = await countImages(await fill(src, profile, withheld, opts));
    const stamped = await countImages(await fill(src, profile, confirmed, opts));
    expect(
      `${label}: an unconfirmed signature embeds nothing`,
      blanked === none && stamped > blanked,
      `none ${none}, withheld ${blanked}, stamped ${stamped}`
    );
  }
}

// ---- Single-profile store: clear-on-start + legacy migration (localStorage stubbed) ----
{
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
  const store = await import("../src/store.js");
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // The saved person is cleared on start, and the clear is reported.
  m.set("cdass.profile.v1", JSON.stringify({ first: "A" }));
  expect("clear-on-start clears the saved person", store.clearProfileOnStart() === true && store.loadProfile().first === "", "cleared");

  // Nothing to clear reports false (so the UI shows no note).
  expect("clear-on-start is a no-op when empty", store.clearProfileOnStart() === false, "empty");

  // Before it is cleared, the old multi-profile array migrates to the most recent.
  m.clear();
  m.set(
    "cdass.profiles.v1",
    JSON.stringify([
      { first: "Older", touchedAt: now - 10 * day },
      { first: "Newer", touchedAt: now - 1 * day },
    ])
  );
  expect("legacy array migrates to most-recent person", store.loadProfile().first === "Newer", store.loadProfile().first);

  // Clear-on-start also removes the legacy array so it cannot resurrect.
  expect("clear-on-start removes the legacy array", store.clearProfileOnStart() === true && store.loadProfile().first === "", "legacy cleared");
}

// ---- main.js per-person reset wiring (DOM-bound, so checked on the source) ----
{
  const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const count = (re) => (src.match(re) || []).length;
  const body = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf(`function ${name}(`) + 400);
  expect("genOptions come from one defaults function", /const newGenOptions = \(\) =>/.test(src) && count(/genOptions: \{/g) === 0, "defaults");
  expect(
    "newPerson resets all genOptions and bumps the person counter",
    /state\.person\+\+/.test(body("newPerson")) && /state\.genOptions = newGenOptions\(\)/.test(body("newPerson")),
    "newPerson"
  );
  expect("Start over, Wipe all and backup import all call newPerson", count(/\bnewPerson\(\);/g) >= 3, String(count(/\bnewPerson\(\);/g)));
  expect("packet import discards stale results", count(/who !== state\.person/g) >= 2, String(count(/who !== state\.person/g)));
  expect("signature upload and clear untick stampSignature", count(/state\.genOptions\.stampSignature = false/g) >= 3, "sig");
  expect("generate() is guarded and works from a snapshot", /if \(generating\) return;/.test(src) && /structuredClone\(state\.profile\)/.test(src), "generate");
  expect("checkboxes carry data-key and refreshInputs sets them", /cb\.dataset\.key = f\.key/.test(src) && /el\.type === "checkbox"/.test(src), "checkbox");
  expect("Save details reads the boolean result", /const ok = await store\.saveEmployer/.test(src), "save");
  expect("backup export warns when encrypted", /store\.isEncrypted\(\) &&\s*!confirm/.test(src), "export");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);

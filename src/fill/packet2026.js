// Field mapping for forms/CO-CDASS-Attendant-Packet-2026.pdf, the packet PPL
// currently distributes ("CO-CDASS-Attendant-Packet-2026-CFC-and-Waiver-Update",
// July 2026, 29 pages). Its Attendant Enrollment and Agreement Form is V.3 (June
// 2026); the rest of the packet is unchanged from the July 2025 release (V.2
// enrollment form, 28 pages), one page later.
//
// Quirks of this template:
// - V.3 page 2 lost its descriptive field names: every box is "TextN" or
//   "Check BoxN", identified by position (docs/forms.md has the table). The
//   PACKET2026_TEXT entries carry the V.2 name as `v2` so a packet filled from
//   the old revision still imports.
// - V.3 dropped fields that V.2 had: the "Do you want PPL to text you" Yes/No
//   boxes (now printed glyphs) and the whole signature block on page 8.
//   addV3Fields() puts them back as real fields at the old positions, so the
//   output stays an editable form and the importer reads them like any other.
// - Routing and account numbers on the Direct Deposit page are one box per
//   digit ("Routing number 1".."9", "Account number 1".."13").
// - The direct-deposit attendant signature date field ("Date") is shared with
//   the FMS-vendor signature date on the EVV exemption form, so we leave it
//   blank; the attendant dates it by hand when signing.
// - The EVV Attestation of Exemption (pages 13-18, fields only on 14-16) is
//   only relevant for
//   live-in caregivers; we fill it only when the profile says live-in, and
//   its City/State/ZIP fields are shared with the I-9 employee address
//   (consistent, since a live-in attendant shares the Member's address).

import { PDFDocument } from "pdf-lib";
import { setText, check, selectButton, splitWidgetToOwnField, fmtDate, fmtSsn, isoDate, ssnDigits, overlaySignature, saveAsNewDocument } from "./util.js";
import { fillI9 } from "./i9.js";

// The packet's text fields that map to exactly one profile ("p") or employer
// ("emp") key, directly or through a reversible transform. Both directions read
// this table: fillPacket2026 writes these fields, and src/extract/filledpacket.js
// reads a filled packet back through it, so the field name is written down once.
//
// Deliberately not in here, because they do not invert cleanly and each
// direction states them explicitly instead:
// - composites built from several keys (the "first, middle and last" name lines;
//   the reader recovers the name from the I-9's separate first/middle/last boxes)
// - anything gated on a condition (the mailing block, direct deposit, the
//   live-in EVV pages, which of the three rate tables applies)
// - every checkbox, because a checkbox here asserts a fact
export const PACKET2026_TEXT = [
  // Repeating headers
  { field: "Member PPL ID", on: "emp", key: "memberPplId" },
  { field: "Attendant PPL ID", on: "p", key: "pplId" },
  // Page 2: enrollment (V.3 names by position; v2 is the July 2025 name)
  { field: "Text6", v2: "Attendant date of birth", on: "p", key: "dob", to: fmtDate, from: isoDate },
  { field: "Text5", v2: "Attendant maiden or previous name", on: "p", key: "maidenOrPrevious" },
  { field: "Text7", v2: "Attendant Social Security Number", on: "p", key: "ssn", to: fmtSsn, from: ssnDigits },
  { field: "Text8", v2: "Attendant physical address, not PO Box", on: "p", key: "street" },
  { field: "Text9", v2: "Attendant physical address 2 Apt Ste or other", on: "p", key: "street2" },
  { field: "Text10", v2: "Attendant physical address city", on: "p", key: "city" },
  { field: "Text11", v2: "Attendant physical address State", on: "p", key: "state" },
  { field: "Text13", v2: "Attendant physical address Zip Code", on: "p", key: "zip" },
  { field: "Text12", v2: "Attendant physical address county", on: "p", key: "county" },
  { field: "Text20", v2: "Attendant email", on: "p", key: "email" },
  { field: "Text21", v2: "Attendant cell phone", on: "p", key: "cellPhone" },
  { field: "Text22", v2: "Attendant home or other phone", on: "p", key: "otherPhone" },
  { field: "Text23", v2: "Attendant primary language", on: "p", key: "primaryLanguage" },
  { field: "Text24", v2: "Best contact times for the attendant", on: "p", key: "bestContactTimes" },
];

// Page 2 composites and checkboxes: V.3 name, with what it is (and V.2 name).
export const PAGE2 = {
  employerName: "Text1", // Employer Name (first and last); new in V.3
  memberName: "Text2", // Member Name (first and last); V.2 "Member Name: first and last"
  memberPplId: "Text3", // PPL ID beside the Member name; V.2 "Member PPL ID"
  fullName: "Text4", // V.2 "Attendant Name: first, middle and last"
  spouse: "Check Box30",
  parent: "Check Box31",
  relative: "Check Box32",
  nonrelative: "Check Box33",
  mailingSame: "Check Box29",
  mailStreet: "Text14",
  mailStreet2: "Text15",
  mailCity: "Text16",
  mailState: "Text17",
  mailZip: "Text18",
  // Text19 is the mailing County; there is no profile key for it, as in V.2.
  prefEmail: "Check Box25",
  prefCell: "Check Box26",
  prefHome: "Check Box27",
  prefMail: "Check Box28",
};

// Fields V.3 no longer has, recreated where V.2 had them (0-indexed pages, PDF
// points). The text-me boxes sit exactly over the printed glyph boxes. The
// page 8 signature block is V.2's page 7 block moved up 557pt; three of its four
// lines join the same-named fields on the Tax Exemptions page (12), which is how
// V.2 shared them, and the employer printed name is a field of its own. They
// are one printed line tall (14pt) so auto-sized text fits the short date line.
export const TEXT_ME_YES = "Do you want PPL to text you: Yes";
export const TEXT_ME_NO = "Do you want PPL to text you: No";
export const V3_ADDED_FIELDS = [
  { name: TEXT_ME_YES, kind: "check", page: 1, x: 348, y: 61, w: 11, h: 9 },
  { name: TEXT_ME_NO, kind: "check", page: 1, x: 389, y: 61, w: 10, h: 9 },
  { name: "Employer Printed Name: first and last", kind: "text", page: 7, x: 261, y: 659, w: 207, h: 14 },
];
const V3_SHARED_WIDGETS = [
  { name: "Attendant signature date", page: 7, x: 501, y: 743, w: 74, h: 14 },
  { name: "Attendant Printed Name: first and last", page: 7, x: 263, y: 715, w: 200, h: 14 },
  { name: "Employer signature date", page: 7, x: 501, y: 687, w: 74, h: 14 },
];

// No border or background: the printed lines and boxes show through.
const INVISIBLE = { borderWidth: 0, backgroundColor: undefined, borderColor: undefined };

function addV3Fields(doc, form) {
  for (const f of V3_ADDED_FIELDS) {
    const rect = { x: f.x, y: f.y, width: f.w, height: f.h, ...INVISIBLE };
    const field = f.kind === "check" ? form.createCheckBox(f.name) : form.createTextField(f.name);
    field.addToPage(doc.getPage(f.page), rect);
  }
  for (const f of V3_SHARED_WIDGETS) {
    form.getTextField(f.name).addToPage(doc.getPage(f.page), { x: f.x, y: f.y, width: f.w, height: f.h, ...INVISIBLE });
  }
}

// Page 11 carries three parallel rate tables and the rate goes in exactly one:
// Table 1 (CDASS) for most members, Table 2 for SLS waiver members, Table 3 for
// Community First Choice. Which one is a property of the Member, not the
// attendant, so it is keyed by emp.memberProgram; "" (unset) means Table 1,
// where a member on any waiver other than SLS belongs.
export const RATE_TABLE = {
  "": { standard: "CDASS Standard Rate", emergency: "CDASS Emergency Rate" },
  sls: { standard: "SLS CDASS Standard Rate", emergency: "SLS CDASS Emergency Rate" },
  cfc: { standard: "CFC CDASS Standard Rate", emergency: "CFC CDASS Emergency Rate" },
};

// Employer signature image placements (0-indexed pages). The signature lines on
// pages 8/11/12 have no form field, so the image is drawn onto the page; the
// I-9 Section 2 line on page 20 has a field but the image overlays it cleanly.
// The attendant and all other parties sign by hand, so only employer lines fill.
const EMPLOYER_SIGNATURE = [
  { page: 7, x: 145, y: 690, w: 295, h: 22 }, // p8 Employer Signature
  { page: 10, x: 145, y: 67, w: 300, h: 22 }, // p11 Employer Signature
  { page: 11, x: 145, y: 51, w: 300, h: 22 }, // p12 Employer Signature
  { page: 19, x: 297, y: 82, w: 185, h: 15 }, // p20 I-9 Signature of Employer or AR
];

// Attendant signature placements, used only when the attendant typed or drew a
// signature in the app and agreed to it for this packet (opts.attendantSignature
// is "" otherwise). Same rule as the employer lines: on the line, right of the
// label, clear of the Date box at x 468. I-9 Section 1's box sits under its label.
const ATTENDANT_SIGNATURE = [
  { page: 7, x: 150, y: 746, w: 300, h: 22 }, // p8 Attendant Signature
  { page: 9, x: 150, y: 353, w: 300, h: 22 }, // p10 Direct Deposit Attendant Signature
  { page: 10, x: 150, y: 96, w: 300, h: 22 }, // p11 Attendant Signature
  { page: 11, x: 150, y: 103, w: 300, h: 22 }, // p12 Attendant Signature
  { page: 19, x: 45, y: 417, w: 320, h: 15 }, // p20 I-9 Signature of Employee
];

export async function fillPacket2026(templateBytes, p, emp, opts) {
  const doc = await PDFDocument.load(templateBytes);
  // Page 9's "State" widget is one field with the I-9 and EVV State widgets, so
  // writing it would overwrite the I-9 state. Give it its own field first (this
  // must happen before getForm() so the form sees the new field).
  splitWidgetToOwnField(doc, 8, "State", "Payment mailing State");
  const form = doc.getForm();
  addV3Fields(doc, form);
  const sig = fmtDate(opts.signatureDate);

  const fullName = [p.first, p.middle, p.last].filter(Boolean).join(" ");
  const firstLast = [p.first, p.last].filter(Boolean).join(" ");
  const employerName = [emp.employerFirst, emp.employerLast].filter(Boolean).join(" ");
  const memberName = [emp.memberFirst, emp.memberLast].filter(Boolean).join(" ");

  // ---- Every field that maps to a single key, both directions ----
  for (const f of PACKET2026_TEXT) {
    const v = (f.on === "emp" ? emp : p)[f.key];
    setText(form, f.field, f.to ? f.to(v) : v);
  }

  // ---- Repeating headers (composites) ----
  setText(form, "Member Name: first and last", memberName);
  setText(form, "Member Name, first and last", memberName);
  setText(form, "Employer Name: first and last", employerName);
  setText(form, "Employer Name, first and last", employerName);

  // ---- Page 2: Enrollment ----
  setText(form, PAGE2.employerName, employerName);
  setText(form, PAGE2.memberName, memberName);
  setText(form, PAGE2.memberPplId, emp.memberPplId);
  setText(form, PAGE2.fullName, fullName);
  setText(form, "Attendant Name: first and last", firstLast);

  check(form, PAGE2.spouse, p.relationship === "spouse");
  check(form, PAGE2.parent, p.relationship === "parent");
  check(form, PAGE2.relative, p.relationship === "relative");
  check(form, PAGE2.nonrelative, p.relationship === "nonrelative");

  if (p.mailingSame) {
    check(form, PAGE2.mailingSame, true);
  } else {
    setText(form, PAGE2.mailStreet, p.mailStreet);
    setText(form, PAGE2.mailStreet2, p.mailStreet2);
    setText(form, PAGE2.mailCity, p.mailCity);
    setText(form, PAGE2.mailState, p.mailState);
    setText(form, PAGE2.mailZip, p.mailZip);
  }

  check(form, PAGE2.prefEmail, p.contactPreference === "email");
  check(form, PAGE2.prefCell, p.contactPreference === "cell");
  check(form, PAGE2.prefHome, p.contactPreference === "home");
  check(form, PAGE2.prefMail, p.contactPreference === "mail");
  check(form, TEXT_ME_YES, p.allowText === "yes");
  check(form, TEXT_ME_NO, p.allowText === "no");

  // ---- Page 8: Enrollment/agreement signatures (fields from addV3Fields) ----
  setText(form, "Attendant signature date", sig);
  setText(form, "Attendant Printed Name: first and last", firstLast);
  setText(form, "Employer signature date", sig);
  setText(form, "Employer Printed Name: first and last", employerName);

  // ---- Page 9: Direct deposit ----
  if (p.directDeposit) {
    check(form, "Direct Deposit to Bank Account or Third Party Money App", true);
    check(form, "Checking Account", p.accountType === "checking");
    check(form, "Savings Account", p.accountType === "savings");
    setText(form, "Bank or money app name", p.bankName);
    spreadDigits(form, "Routing number", p.routing, 9);
    spreadDigits(form, "Account number", p.account, 13);
  } else {
    check(form, "Payment by Paper Check", true);
    const mail = p.mailingSame
      ? { street: p.street, street2: p.street2, city: p.city, state: p.state, zip: p.zip, county: p.county }
      : { street: p.mailStreet, street2: p.mailStreet2, city: p.mailCity, state: p.mailState, zip: p.mailZip, county: "" };
    setText(form, "Address", mail.street);
    // Periods in this name make pypdf's dump show only the tail (", or other)");
    // pdf-lib wants the whole thing.
    setText(form, "Address 2 (Apt., Ste., or other)", mail.street2);
    setText(form, "City", mail.city);
    setText(form, "Payment mailing State", mail.state);
    setText(form, "Zip Code", mail.zip);
    setText(form, "County", mail.county);
  }
  check(form, "Send my pay stub in the mail", p.paperPayStub);
  // Page 10 "Date" is shared with the EVV vendor-signature date; left blank on purpose.
  setText(form, "Attendant Printed Name, first and last", firstLast);

  // ---- Page 11: Services and rates ----
  check(form, "New Service", opts.newService);
  check(form, "Change Hourly Rate: only mark if the attendant is already working", !opts.newService);
  const rate = RATE_TABLE[emp.memberProgram] ?? RATE_TABLE[""];
  setText(form, rate.standard, p.rateStandardCdass);
  setText(form, rate.emergency, p.rateEmergencyCdass);
  // The Other Rate boxes, SLS Health Maintenance, and CFC Legally Responsible
  // Person Homemaker are intentionally left blank: this app sets one CDASS
  // rate. Fill them by hand if those services are added.
  setText(form, "Attendant Signature Date", sig);
  setText(form, "Employer Signature Date", sig);

  // ---- Page 12: Tax exemptions ----
  // The student/minor boxes attest "I am under 18", so they are only checked
  // when the date of birth confirms it.
  const years = age(p.dob);
  check(form, "I am the spouse of the employer", p.relationToEmployer === "spouse");
  check(form, "I am the parent of the employer", p.relationToEmployer === "parent");
  check(
    form,
    "I am the biological or legally adopted child of the employer and I am under the age of 21",
    p.relationToEmployer === "child" && years != null && years < 21
  );
  check(form, "I am not the spouse parent or child of the employer", p.relationToEmployer === "none");
  check(form, "I am under 18 years old and I am a fulltime student", p.fullTimeStudent && years != null && years < 18);
  check(
    form,
    "I am under 18 years old and this job of performing household services (respite) is my primary job",
    p.primaryJob && years != null && years < 18
  );

  // ---- Pages 13-18: EVV Attestation of Exemption (live-in caregivers only) ----
  // The form runs to six printed pages but only 14-16 carry fields.
  if (p.liveIn === "fullTime" || p.liveIn === "extended") {
    setText(form, "First Name", emp.memberFirst);
    setText(form, "Last Name", emp.memberLast);
    setText(form, "Medicaid ID", emp.memberMedicaidId);
    setText(form, "First Name_2", p.first);
    setText(form, "Last Name_2", p.last);
    setText(form, "Last 5 SSN", (p.ssn ?? "").replace(/\D/g, "").slice(-5));
    // "Is the caregiver legally responsible for the member?" is about the
    // caregiver's relationship to the Member (p.relationship), not to the
    // employer. A spouse is legally responsible, so Yes + "Spouse". A parent is
    // only responsible for a minor or a ward, which the profile cannot tell, so
    // that stays for the human to answer; neither box nor text is touched.
    if (p.relationship === "spouse") {
      selectButton(form, "Is the caregiver legally responsible for the member", "Yes");
      setText(form, "If yes describe their relationship parent spouse sibling etc", "Spouse");
    }
    setText(form, "Billing Provider or FMS Vendor name", "Public Partnerships LLC");
    check(form, "Livein Caregiver Enter the shared residential address then skip to section 7", true);
    setText(form, "Street Address", p.street);
    // City or Town / State / ZIP Code are shared with the I-9 employee address
    // and get filled by fillI9 below with the same (shared) address.
  }

  // ---- Pages 20-23: I-9 ----
  fillI9(form, p, emp, opts, sig);

  form.updateFieldAppearances();
  await overlaySignature(doc, emp.signature, EMPLOYER_SIGNATURE);
  await overlaySignature(doc, opts.attendantSignature, ATTENDANT_SIGNATURE);
  return saveAsNewDocument(doc);
}

// Fill per-digit boxes named "<prefix> 1".."<prefix> N".
function spreadDigits(form, prefix, value, count) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return;
  // The boxes are left-aligned, so fill from box 1; trailing boxes stay empty
  // for a number shorter than the row.
  for (let i = 0; i < Math.min(digits.length, count); i++) {
    setText(form, `${prefix} ${i + 1}`, digits[i]);
  }
}

function age(dobIso) {
  if (!dobIso) return null;
  const dob = new Date(dobIso + "T00:00:00");
  if (isNaN(dob)) return null;
  const now = new Date();
  let a = now.getFullYear() - dob.getFullYear();
  if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) a--;
  return a;
}

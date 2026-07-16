// Field mapping for forms/CO-CDASS-Attendant-Packet-2026.pdf, the packet PPL
// currently distributes ("CO-CDASS-Attendant-Packet-2026-CFC-and-Waiver").
// It is a full rebuild with descriptive field names, so it shares nothing with
// the 2025 mapping except the embedded I-9.
//
// Quirks of this template:
// - Routing and account numbers on the Direct Deposit page are one box per
//   digit ("Routing number 1".."9", "Account number 1".."13").
// - The direct-deposit attendant signature date field ("Date") is shared with
//   the FMS-vendor signature date on the EVV exemption form, so we leave it
//   blank; the attendant dates it by hand when signing.
// - The EVV Attestation of Exemption (pages 12-17, fields only on 13-15) is
//   only relevant for
//   live-in caregivers; we fill it only when the profile says live-in, and
//   its City/State/ZIP fields are shared with the I-9 employee address
//   (consistent, since a live-in attendant shares the Member's address).

import { PDFDocument } from "pdf-lib";
import { setText, check, selectButton, fmtDate, fmtSsn, isoDate, ssnDigits, overlaySignature } from "./util.js";
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
  // Page 2: enrollment
  { field: "Attendant date of birth", on: "p", key: "dob", to: fmtDate, from: isoDate },
  { field: "Attendant maiden or previous name", on: "p", key: "maidenOrPrevious" },
  { field: "Attendant Social Security Number", on: "p", key: "ssn", to: fmtSsn, from: ssnDigits },
  { field: "Attendant physical address, not PO Box", on: "p", key: "street" },
  { field: "Attendant physical address 2 Apt Ste or other", on: "p", key: "street2" },
  { field: "Attendant physical address city", on: "p", key: "city" },
  { field: "Attendant physical address State", on: "p", key: "state" },
  { field: "Attendant physical address Zip Code", on: "p", key: "zip" },
  { field: "Attendant physical address county", on: "p", key: "county" },
  { field: "Attendant email", on: "p", key: "email" },
  { field: "Attendant cell phone", on: "p", key: "cellPhone" },
  { field: "Attendant home or other phone", on: "p", key: "otherPhone" },
  { field: "Attendant primary language", on: "p", key: "primaryLanguage" },
  { field: "Best contact times for the attendant", on: "p", key: "bestContactTimes" },
];

// Page 10 carries three parallel rate tables and the rate goes in exactly one:
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
// pages 7/10/11 have no form field, so the image is drawn onto the page; the
// I-9 Section 2 line on page 19 has a field but the image overlays it cleanly.
// The attendant and all other parties sign by hand, so only employer lines fill.
const EMPLOYER_SIGNATURE = [
  { page: 6, x: 145, y: 133, w: 295, h: 22 }, // p7 Employer Signature
  { page: 9, x: 145, y: 67, w: 300, h: 22 }, // p10 Employer Signature
  { page: 10, x: 145, y: 51, w: 300, h: 22 }, // p11 Employer Signature
  { page: 18, x: 297, y: 82, w: 185, h: 15 }, // p19 I-9 Signature of Employer or AR
];

export async function fillPacket2026(templateBytes, p, emp, opts) {
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();
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
  setText(form, "Attendant Name: first, middle and last", fullName);
  setText(form, "Attendant Name: first and last", firstLast);

  check(form, "Spouse", p.relationship === "spouse");
  check(form, "Parent", p.relationship === "parent");
  check(form, "Other Relative", p.relationship === "relative");
  check(form, "NonRelative", p.relationship === "nonrelative");

  if (p.mailingSame) {
    check(form, "Check the box if the address where you live is the same as your mailing address", true);
  } else {
    setText(form, "Attendant mailing address not PO Box", p.mailStreet);
    setText(form, "Attendant mailing address 2 Apt Ste or other", p.mailStreet2);
    setText(form, "Attendant mailing address city", p.mailCity);
    setText(form, "Attendant mailing address State", p.mailState);
    setText(form, "Attendant mailing address Zip Code", p.mailZip);
  }

  check(form, "The attendant prefers to be contacted by email", p.contactPreference === "email");
  check(form, "The attendant prefers to be contacted by cell phone", p.contactPreference === "cell");
  check(form, "The attendant prefers to be contacted by home phone", p.contactPreference === "home");
  check(form, "The attendant prefers to be contacted by mail", p.contactPreference === "mail");
  if (p.allowText === "yes") selectButton(form, "Do you want PPL to text you: Yes", "Yes");
  if (p.allowText === "no") selectButton(form, "Do you want PPL to text you: No", "No");

  // ---- Page 7: Enrollment/agreement signatures ----
  setText(form, "Attendant signature date", sig);
  setText(form, "Attendant Printed Name: first and last", firstLast);
  setText(form, "Employer signature date", sig);
  setText(form, "Employer Printed Name: first and last", employerName);

  // ---- Page 8: Direct deposit ----
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
    setText(form, "Zip Code", mail.zip);
    setText(form, "County", mail.county);
  }
  check(form, "Send my pay stub in the mail", p.paperPayStub);
  // Page 9 "Date" is shared with the EVV vendor-signature date; left blank on purpose.
  setText(form, "Attendant Printed Name, first and last", firstLast);

  // ---- Page 10: Services and rates ----
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

  // ---- Page 11: Tax exemptions ----
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

  // ---- Pages 12-17: EVV Attestation of Exemption (live-in caregivers only) ----
  // The form runs to six printed pages but only 13-15 carry fields.
  if (p.liveIn === "fullTime" || p.liveIn === "extended") {
    setText(form, "First Name", emp.memberFirst);
    setText(form, "Last Name", emp.memberLast);
    setText(form, "Medicaid ID", emp.memberMedicaidId);
    setText(form, "First Name_2", p.first);
    setText(form, "Last Name_2", p.last);
    setText(form, "Last 5 SSN", (p.ssn ?? "").replace(/\D/g, "").slice(-5));
    if (["spouse", "parent", "child"].includes(p.relationToEmployer))
      setText(form, "If yes describe their relationship parent spouse sibling etc", p.relationToEmployer);
    setText(form, "Billing Provider or FMS Vendor name", "Public Partnerships LLC");
    check(form, "Livein Caregiver Enter the shared residential address then skip to section 7", true);
    setText(form, "Street Address", p.street);
    // City or Town / State / ZIP Code are shared with the I-9 employee address
    // and get filled by fillI9 below with the same (shared) address.
  }

  // ---- Pages 19-22: I-9 ----
  fillI9(form, p, emp, opts, sig);

  form.updateFieldAppearances();
  await overlaySignature(doc, emp.signature, EMPLOYER_SIGNATURE);
  return doc.save();
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

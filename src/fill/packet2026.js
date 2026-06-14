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
// - The EVV Attestation of Exemption (pages 13-15) is only relevant for
//   live-in caregivers; we fill it only when the profile says live-in, and
//   its City/State/ZIP fields are shared with the I-9 employee address
//   (consistent, since a live-in attendant shares the Member's address).

import { PDFDocument } from "pdf-lib";
import { setText, check, selectButton, fmtDate, fmtSsn, overlaySignature } from "./util.js";
import { fillI9 } from "./i9.js";

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

  // ---- Repeating headers ----
  setText(form, "Member Name: first and last", memberName);
  setText(form, "Member Name, first and last", memberName);
  setText(form, "Member PPL ID", emp.memberPplId);
  setText(form, "Employer Name: first and last", employerName);
  setText(form, "Employer Name, first and last", employerName);
  setText(form, "Attendant PPL ID", p.pplId);

  // ---- Page 2: Enrollment ----
  setText(form, "Attendant Name: first, middle and last", fullName);
  setText(form, "Attendant Name: first and last", firstLast);
  setText(form, "Attendant date of birth", fmtDate(p.dob));
  setText(form, "Attendant maiden or previous name", p.maidenOrPrevious);
  setText(form, "Attendant Social Security Number", fmtSsn(p.ssn));

  check(form, "Spouse", p.relationship === "spouse");
  check(form, "Parent", p.relationship === "parent");
  check(form, "Other Relative", p.relationship === "relative");
  check(form, "NonRelative", p.relationship === "nonrelative");

  setText(form, "Attendant physical address, not PO Box", p.street);
  setText(form, "Attendant physical address 2 Apt Ste or other", p.street2);
  setText(form, "Attendant physical address city", p.city);
  setText(form, "Attendant physical address State", p.state);
  setText(form, "Attendant physical address Zip Code", p.zip);
  setText(form, "Attendant physical address county", p.county);

  if (p.mailingSame) {
    check(form, "Check the box if the address where you live is the same as your mailing address", true);
  } else {
    setText(form, "Attendant mailing address not PO Box", p.mailStreet);
    setText(form, "Attendant mailing address 2 Apt Ste or other", p.mailStreet2);
    setText(form, "Attendant mailing address city", p.mailCity);
    setText(form, "Attendant mailing address State", p.mailState);
    setText(form, "Attendant mailing address Zip Code", p.mailZip);
  }

  setText(form, "Attendant email", p.email);
  setText(form, "Attendant cell phone", p.cellPhone);
  setText(form, "Attendant home or other phone", p.otherPhone);
  setText(form, "Attendant primary language", p.primaryLanguage);
  check(form, "The attendant prefers to be contacted by email", p.contactPreference === "email");
  check(form, "The attendant prefers to be contacted by cell phone", p.contactPreference === "cell");
  check(form, "The attendant prefers to be contacted by home phone", p.contactPreference === "home");
  check(form, "The attendant prefers to be contacted by mail", p.contactPreference === "mail");
  setText(form, "Best contact times for the attendant", p.bestContactTimes);
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
    setText(form, ", or other)", mail.street2); // truncated label for "Address 2 (Apt., Ste., or other)"
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
  setText(form, "CDASS Standard Rate", p.rateStandardCdass);
  setText(form, "CDASS Emergency Rate", p.rateEmergencyCdass);
  // SLS Health Maintenance rate boxes are intentionally left blank: this app
  // only enrolls CDASS attendants. Fill them by hand if HM service is added.
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

  // ---- Pages 13-15: EVV Attestation of Exemption (live-in caregivers only) ----
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
  // Account boxes are right-justified on the form? No: left-aligned, so fill
  // from box 1. Trailing boxes stay empty for shorter numbers.
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

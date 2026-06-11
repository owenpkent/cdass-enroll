// Field mapping for forms/CO-CDASS-Attendant-Packet-2025.pdf (PPL Colorado CDASS
// attendant packet, 17 pages). Field names were extracted from the PDF itself.
//
// Notes on the template's own quirks:
// - The signature-date field "Date" is one shared field that appears on the
//   Enrollment, Employment Agreement, Rate, FLSA, EVV, and Difficulty-of-Care
//   pages, so a single value fills every signature date.
// - "Document Title 1" is reused by the PDF for both I-9 Section 2 List A and
//   the Supplement B (rehire) row 1, so a List A title also shows on page 13.
//   Supplement B is only used for rehires; ignore or white-out if not needed.
// - The "same as mailing address" checkbox is a broken shared field, so when
//   the mailing address is the same we copy it into the mailing section instead.

import { PDFDocument } from "pdf-lib";
import { setText, check, selectButton, fmtDate, fmtSsn } from "./util.js";

export async function fillPacket(templateBytes, p, emp, opts) {
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();

  // ---- Page 2: Attendant enrollment ----
  setText(form, "First", p.first);
  setText(form, "Middle", p.middle);
  setText(form, "Last", p.last);
  setText(form, "Maiden or Previous Last", p.maidenOrPrevious);

  setText(form, "Street no PO Box", p.street);
  setText(form, "Street 2 APT STE etc", p.street2);
  setText(form, "City", p.city);
  setText(form, "State", p.state);
  setText(form, "Zip Code", p.zip);
  setText(form, "County", p.county);
  setText(form, "Municipality", p.municipality);

  const mail = p.mailingSame
    ? { street: p.street, street2: p.street2, city: p.city, state: p.state, zip: p.zip }
    : { street: p.mailStreet, street2: p.mailStreet2, city: p.mailCity, state: p.mailState, zip: p.mailZip };
  setText(form, "Address", mail.street);
  setText(form, "Address 2 APT STE etc", mail.street2);
  setText(form, "City_2", mail.city);
  setText(form, "State_2", mail.state);
  setText(form, "Zip Code_2", mail.zip);

  setText(form, "Date of Birth", fmtDate(p.dob));
  setText(form, "Social Security Number", fmtSsn(p.ssn));
  check(form, "Gender", p.gender === "male"); // the male checkbox is named "Gender"
  check(form, "Female", p.gender === "female");
  check(form, "Prefer not to disclose", p.gender === "undisclosed");

  setText(form, "Email", p.email);
  setText(form, "Cell Phone", p.cellPhone);
  setText(form, "Home or Other Phone", p.otherPhone);
  if (p.allowText)
    selectButton(form, "PPL can text me using the cell phone number above", p.allowText === "yes" ? "Yes" : "No");

  // ---- Page 3: Payment ----
  check(form, "Direct Deposit to Bank Account", p.directDeposit);
  check(
    form,
    "Select this option if you would like all payments to be deposited in the same account for all Members you work for",
    p.sameAccountAllMembers
  );
  check(form, "Checking Account", p.accountType === "checking");
  check(form, "Savings Account", p.accountType === "savings");
  setText(form, "Banking Institution Name", p.bankName);
  setText(form, "undefined_2", p.routing); // labeled "Routing Number" on the form
  setText(form, "undefined_3", p.account); // labeled "Account Number" on the form
  check(form, "Please send my pay stub in the mail", p.paperPayStub);
  check(form, "Yes please list my name and basic contact details in an Attendant directory", p.directoryOptIn === "yes");
  check(form, "No I would prefer not to be listed in an Attendant directory", p.directoryOptIn === "no");

  // ---- Repeating page headers (employment agreement, rate, FLSA, EVV, DOC) ----
  // "First/Last" are the same fields as page 2 and propagate automatically.
  setText(form, "PPL ID", p.pplId);
  setText(form, "First_2", emp.memberFirst);
  setText(form, "Last_2", emp.memberLast);
  setText(form, "PPL ID_2", emp.memberPplId);
  setText(form, "First_3", emp.employerFirst);
  setText(form, "Last_3", emp.employerLast);
  setText(form, "First_4", emp.employerFirst);
  setText(form, "Last_4", emp.employerLast);

  // Shared signature-date fields across the packet.
  const sig = fmtDate(opts.signatureDate);
  setText(form, "Date", sig);
  setText(form, "Date_2", sig);

  // ---- Page 5: Employment agreement, relationship to Member ----
  check(form, "Spouse", p.relationship === "spouse");
  check(form, "Relative", p.relationship === "relative");
  check(form, "NonRelative", p.relationship === "nonrelative");

  // ---- Page 6: Rate form ----
  check(form, "New Service", opts.newService);
  check(form, "Change Hourly Rate", !opts.newService && opts.rateEffectiveDate);
  setText(form, "Rate Effective Date", fmtDate(opts.rateEffectiveDate));
  setText(form, "Standard RateCDASS", emp.rateStandardCdass);
  setText(form, "Emergency RateCDASS", emp.rateEmergencyCdass);
  setText(form, "Standard RateHealth Maintenance", emp.rateStandardHm);
  setText(form, "Emergency RateHealth Maintenance", emp.rateEmergencyHm);

  // ---- Page 7: FLSA live-in exemption (only checked when unambiguous) ----
  if (p.liveIn === "fullTime") {
    check(form, "I do not have a separate home where I live", true);
    check(
      form,
      "This is the home where I live and perform the routines of private life including shared meals and holidays",
      true
    );
  } else if (p.liveIn === "doesNotLive") {
    check(form, "None of the above", true);
  }

  // ---- Page 8: EVV live-in attestation ----
  check(
    form,
    "Attendant lives with the Member seven days a week This means they do not have another home",
    p.liveIn === "fullTime"
  );
  check(form, "Attendant lives with the Member for an extended period of time", p.liveIn === "extended");
  check(form, "Attendant does not live with the Member", p.liveIn === "doesNotLive");

  // ---- Page 9: Difficulty of care / FICA-FUTA exemptions ----
  check(form, "I am the spouse of the employer", p.relationToEmployer === "spouse");
  check(form, "I am the parent of the employer including legally adopted children", p.relationToEmployer === "parent");
  check(form, "I am the child of the employer including legally adopted children", p.relationToEmployer === "child");
  check(form, "I am not the spouse parent or child of the employer", p.relationToEmployer === "none");
  check(form, "I am a fulltime student", p.fullTimeStudent);
  check(form, "This job of performing household services respite is my primary job", p.primaryJob);

  // ---- Page 10: I-9 Section 1 ----
  setText(form, "Last Name (Family Name)", p.last);
  setText(form, "First Name Given Name", p.first);
  setText(form, "Employee Middle Initial (if any)", (p.middle ?? "").slice(0, 1));
  setText(form, "Employee Other Last Names Used (if any)", p.maidenOrPrevious);
  setText(form, "Address Street Number and Name", p.street);
  setText(form, "Apt Number (if any)", p.street2);
  setText(form, "City or Town", p.city);
  setText(form, "State", p.state);
  setText(form, "ZIP Code", p.zip);
  setText(form, "Date of Birth mmddyyyy", fmtDate(p.dob));
  setText(form, "US Social Security Number", (p.ssn ?? "").replace(/\D/g, "")); // field maxLength is 9
  setText(form, "Employees E-mail Address", p.email);
  setText(form, "Telephone Number", p.cellPhone || p.otherPhone);
  setText(form, "Today's Date mmddyyy", sig);

  check(form, "CB_1", p.citizenship === "citizen");
  check(form, "CB_2", p.citizenship === "national");
  check(form, "CB_3", p.citizenship === "lpr");
  check(form, "CB_4", p.citizenship === "alien");
  if (p.citizenship === "lpr")
    setText(form, "3 A lawful permanent resident Enter USCIS or ANumber", p.uscisNumber);
  if (p.citizenship === "alien") {
    setText(form, "Exp Date mmddyyyy", fmtDate(p.workAuthExpiration));
    setText(form, "USCIS ANumber", p.uscisNumber);
    setText(form, "Form I94 Admission Number", p.i94Number);
    setText(form, "Foreign Passport Number and Country of IssuanceRow1", p.foreignPassport);
  }

  // ---- Page 10: I-9 Section 2 documents ----
  // Prefer a US passport (List A alone); otherwise driver's license (List B)
  // plus Social Security card (List C).
  if (p.passportNumber) {
    setText(form, "Document Title 1", "U.S. Passport");
    setText(form, "Issuing Authority 1", "U.S. Department of State");
    setText(form, "Document Number 0 (if any)", p.passportNumber);
    setText(form, "Expiration Date if any", fmtDate(p.passportExpiration));
  } else if (p.dlNumber) {
    setText(form, "List B Document 1 Title", "Driver's License");
    setText(form, "List B Issuing Authority 1", p.dlState || p.state);
    setText(form, "List B Document Number 1", p.dlNumber);
    setText(form, "List B Expiration Date 1", fmtDate(p.dlExpiration));
    if (p.ssn) {
      setText(form, "List C Document Title 1", "Social Security Card");
      setText(form, "List C Issuing Authority 1", "Social Security Administration");
      setText(form, "List C Document Number 1", fmtSsn(p.ssn));
    }
  }

  setText(form, "FirstDayEmployed mmddyyyy", fmtDate(opts.firstDay));
  const employerLine = [emp.employerLast, emp.employerFirst, emp.employerTitle || "Employer"]
    .filter(Boolean)
    .join(", ");
  setText(form, "Last Name First Name and Title of Employer or Authorized Representative", employerLine);
  setText(form, "S2 Todays Date mmddyyyy", sig);
  setText(
    form,
    "Employers Business or Org Name",
    emp.businessName || [emp.employerFirst, emp.employerLast].filter(Boolean).join(" ")
  );
  setText(form, "Employers Business or Org Address", emp.businessAddress);

  form.updateFieldAppearances();
  return doc.save();
}

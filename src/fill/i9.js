// I-9 Section 1 and Section 2 mapping. The USCIS field names are identical in
// the 2025 and 2026 PPL packets (both embed the same I-9 build), so both
// packet fillers share this.

import { setText, check, fmtDate } from "./util.js";

export function fillI9(form, p, emp, opts, sig) {
  // Section 1: employee
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

  // Section 2: documents. Prefer a US passport (List A alone); otherwise
  // driver's license (List B) plus Social Security card (List C).
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
      setText(form, "List C Document Number 1", fmtSsnDashes(p.ssn));
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
}

function fmtSsnDashes(ssn) {
  const d = (ssn ?? "").replace(/\D/g, "");
  return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : ssn;
}

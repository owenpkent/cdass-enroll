// Field mapping for the IRS W-4 (forms/w4.pdf). The IRS has kept these
// internal names (f1_01, c1_1, ...) stable since the 2020 redesign, so a
// newer-year W-4 dropped into public/forms/w4.pdf should still fill.

import { PDFDocument } from "pdf-lib";
import { bySuffix, fmtDate, fmtSsn } from "./util.js";

const money = (v) => (v === "" || v == null ? "" : String(v));

export async function fillW4(templateBytes, p, emp, opts) {
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();

  const text = (suffix, value) => {
    if (value == null || value === "") return;
    const f = bySuffix(form, suffix);
    if (f && typeof f.setText === "function") f.setText(String(value));
    else console.warn("W-4 field not found:", suffix);
  };

  text(".f1_01[0]", [p.first, (p.middle ?? "").slice(0, 1)].filter(Boolean).join(" "));
  text(".f1_02[0]", p.last);
  text(".f1_03[0]", [p.street, p.street2].filter(Boolean).join(" "));
  text(".f1_04[0]", [p.city, p.state, p.zip].filter(Boolean).join(", "));
  text(".f1_05[0]", fmtSsn(p.ssn));

  // Filing status: three sibling checkboxes c1_1[0..2] (single/MFS, MFJ, HoH),
  // mutually exclusive by convention only, so check exactly one.
  const statusIndex = { single: 0, joint: 1, hoh: 2 }[p.filingStatus];
  if (statusIndex != null) {
    const cb = form
      .getFields()
      .find((f) => f.getName().endsWith(`.c1_1[${statusIndex}]`) && typeof f.check === "function");
    if (cb) cb.check();
    else console.warn("W-4 filing status checkbox not found");
  }

  if (p.multipleJobs) {
    const cb = form
      .getFields()
      .find((f) => f.getName().endsWith(".c1_2[0]") && typeof f.check === "function");
    cb?.check();
  }

  text(".f1_06[0]", money(p.childrenCredit));
  text(".f1_07[0]", money(p.otherDependentsCredit));
  const total = Number(p.childrenCredit || 0) + Number(p.otherDependentsCredit || 0);
  if (total > 0) text(".f1_09[0]", String(total));
  text(".f1_10[0]", money(p.otherIncome));
  text(".f1_11[0]", money(p.deductions));
  text(".f1_12[0]", money(p.extraWithholding));

  // Employer block
  const employerName =
    emp.businessName || [emp.employerFirst, emp.employerLast].filter(Boolean).join(" ");
  text(".f1_13[0]", [employerName, emp.businessAddress].filter(Boolean).join(", "));
  text(".f1_14[0]", fmtDate(opts.firstDay));
  text(".f1_15[0]", emp.ein);

  form.updateFieldAppearances();
  return doc.save();
}

// Field mapping for the IRS W-4 (forms/w4.pdf). Steps 1-2 names are stable
// since the 2020 redesign, but the 2024 revision renumbered the rest: Step 3
// total moved from f1_09 to f1_08, Steps 4(a-c) shifted up one, and the
// employer block became f1_12-f1_14 (no more f1_15). We detect the layout by
// whether f1_08 exists (2024+) and map accordingly, so a future-year W-4
// dropped into public/forms/w4.pdf keeps working either way.

import { PDFDocument, PDFName, PDFBool } from "pdf-lib";
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

  const is2024Layout = !!bySuffix(form, ".f1_08[0]");
  const n = (base) => `.f1_${String(base + (is2024Layout ? 0 : 1)).padStart(2, "0")}[0]`;

  const total = Number(p.childrenCredit || 0) + Number(p.otherDependentsCredit || 0);
  if (total > 0) text(n(8), String(total)); // Step 3 total
  text(n(9), money(p.otherIncome)); // 4(a)
  text(n(10), money(p.deductions)); // 4(b)
  text(n(11), money(p.extraWithholding)); // 4(c)

  // Employer block. A household employer writes their personal name here
  // (the "Household Employer" business label belongs on the I-9, not the W-4).
  const employerName =
    [emp.employerFirst, emp.employerLast].filter(Boolean).join(" ") || emp.businessName;
  text(n(12), [employerName, emp.businessAddress].filter(Boolean).join(", "));
  text(n(13), fmtDate(opts.firstDay));
  text(n(14), emp.ein);

  form.updateFieldAppearances();
  // The W-4 is an XFA form. pdf-lib strips the XFA and writes the values, but
  // Adobe then ignores the generated appearance streams and shows the form
  // blank. NeedAppearances tells the viewer to render the values it was given,
  // so the filled W-4 displays in every reader. Chrome and the like keep using
  // the appearance streams generated above, so both paths are covered.
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  return doc.save();
}

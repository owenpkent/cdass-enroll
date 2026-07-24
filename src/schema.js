// Employee profile schema. Drives both the form UI and the PDF field mapping.
// Section -> fields. Types: text, date, ssn, phone, email, select, checkbox, money.

export const PROFILE_SECTIONS = [
  {
    id: "name",
    title: "Name",
    fields: [
      { key: "first", label: "First name", type: "text" },
      { key: "middle", label: "Middle name", type: "text" },
      { key: "last", label: "Last name", type: "text" },
      { key: "maidenOrPrevious", label: "Maiden or previous last name", type: "text" },
    ],
  },
  {
    id: "personal",
    title: "Personal details",
    fields: [
      { key: "dob", label: "Date of birth", type: "date", sensitive: true },
      { key: "ssn", label: "Social Security Number", type: "ssn", sensitive: true },
    ],
  },
  {
    id: "address",
    title: "Home address (where they live, no PO Box)",
    fields: [
      { key: "street", label: "Street", type: "text" },
      { key: "street2", label: "Apt / Ste / Unit", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "state", label: "State", type: "text", width: "s" },
      { key: "zip", label: "ZIP code", type: "text", width: "s" },
      { key: "county", label: "County", type: "text" },
      {
        key: "mailingSame",
        label: "Mailing address is the same",
        type: "checkbox",
        default: true,
        // Unchecking means mail goes elsewhere than the home/license address.
        // Seed the mailing fields from the home address (when still empty) so
        // the user edits only what differs instead of retyping the whole thing.
        onToggle: (p) => {
          if (p.mailingSame || p.mailStreet || p.mailCity || p.mailZip) return [];
          p.mailStreet = p.street;
          p.mailStreet2 = p.street2;
          p.mailCity = p.city;
          p.mailState = p.state;
          p.mailZip = p.zip;
          return ["mailStreet", "mailStreet2", "mailCity", "mailState", "mailZip"];
        },
      },
    ],
  },
  {
    id: "mailing",
    title: "Mailing address",
    note: 'Mail goes to the home address while "Mailing address is the same" is checked above. Uncheck it to send mail elsewhere; these fields then unlock pre-filled from the home address, so you change only what differs.',
    disableIf: (p) => p.mailingSame,
    fields: [
      { key: "mailStreet", label: "Address", type: "text" },
      { key: "mailStreet2", label: "Apt / Ste / Unit", type: "text" },
      { key: "mailCity", label: "City", type: "text" },
      { key: "mailState", label: "State", type: "text", width: "s" },
      { key: "mailZip", label: "ZIP code", type: "text", width: "s" },
    ],
  },
  {
    id: "contact",
    title: "Contact",
    fields: [
      { key: "email", label: "Email", type: "email" },
      { key: "cellPhone", label: "Cell phone", type: "phone" },
      { key: "otherPhone", label: "Home or other phone", type: "phone" },
      {
        key: "allowText",
        label: "PPL may text the cell number",
        type: "select",
        options: [["", ""], ["yes", "Yes"], ["no", "No"]],
      },
      {
        key: "contactPreference",
        label: "Preferred contact method",
        type: "select",
        options: [
          ["", ""],
          ["email", "Email"],
          ["cell", "Cell phone"],
          ["home", "Home phone"],
          ["mail", "Mail"],
        ],
      },
      { key: "primaryLanguage", label: "Primary language", type: "text", placeholder: "English" },
      { key: "bestContactTimes", label: "Best times to contact", type: "text" },
    ],
  },
  {
    id: "payment",
    title: "Payment",
    fields: [
      { key: "directDeposit", label: "Direct deposit to bank account", type: "checkbox", default: true },
      {
        key: "accountType",
        label: "Account type",
        type: "select",
        options: [["", ""], ["checking", "Checking"], ["savings", "Savings"]],
      },
      { key: "bankName", label: "Banking institution name", type: "text", sensitive: true },
      { key: "routing", label: "Routing number", type: "text", sensitive: true },
      { key: "account", label: "Account number", type: "text", sensitive: true },
      { key: "paperPayStub", label: "Mail paper pay stubs (no internet access)", type: "checkbox" },
    ],
  },
  {
    id: "work",
    title: "Work details",
    fields: [
      { key: "pplId", label: "Attendant PPL ID (if assigned)", type: "text" },
      {
        key: "relationship",
        label: "Relationship to the Member",
        type: "select",
        options: [
          ["", ""],
          ["spouse", "Spouse"],
          ["parent", "Parent"],
          ["relative", "Other relative"],
          ["nonrelative", "Non-relative"],
        ],
      },
      {
        key: "liveIn",
        label: "Living situation (EVV attestation)",
        type: "select",
        options: [
          ["", ""],
          ["fullTime", "Lives with the Member 7 days a week (no other home)"],
          ["extended", "Lives with the Member for an extended period"],
          ["doesNotLive", "Does not live with the Member"],
        ],
      },
      {
        key: "relationToEmployer",
        label: "Relation to the employer (tax exemptions)",
        type: "select",
        // Part 1 of the Tax Exemptions Form requires exactly one of its four
        // statements, so blank is never a valid answer. It defaults to the one
        // that is true of any attendant who is not family; change it when
        // hiring a relative, or the packet understates the exemption.
        default: "none",
        options: [
          ["", ""],
          ["spouse", "Spouse of the employer"],
          ["parent", "Parent of the employer"],
          ["child", "Child of the employer"],
          ["none", "Not spouse, parent, or child of the employer"],
        ],
      },
      { key: "fullTimeStudent", label: "Full-time student", type: "checkbox" },
      { key: "primaryJob", label: "This household/respite job is their primary job", type: "checkbox" },
    ],
  },
  {
    id: "rates",
    title: "Pay rates (CDASS, $/hour)",
    fields: [
      { key: "rateStandardCdass", label: "Standard rate (per attendant)", type: "money", placeholder: "e.g. 18" },
      { key: "rateEmergencyCdass", label: "Emergency rate", type: "money", default: "45", placeholder: "45" },
    ],
  },
  {
    id: "i9",
    title: "I-9 work authorization",
    fields: [
      {
        key: "citizenship",
        label: "Citizenship / immigration status",
        type: "select",
        options: [
          ["", ""],
          ["citizen", "U.S. citizen"],
          ["national", "Noncitizen national of the U.S."],
          ["lpr", "Lawful permanent resident"],
          ["alien", "Noncitizen authorized to work"],
        ],
      },
      { key: "uscisNumber", label: "USCIS / A-Number (if LPR or authorized)", type: "text", sensitive: true },
      { key: "workAuthExpiration", label: "Work authorization expiration", type: "date", sensitive: true },
      { key: "i94Number", label: "Form I-94 admission number", type: "text", sensitive: true },
      { key: "foreignPassport", label: "Foreign passport number and country", type: "text", sensitive: true },
    ],
  },
  {
    id: "iddocs",
    title: "Identity documents (auto-filled from scans)",
    fields: [
      { key: "dlNumber", label: "Driver's license number", type: "text", sensitive: true },
      { key: "dlState", label: "License state", type: "text", width: "s" },
      { key: "dlExpiration", label: "License expiration", type: "date", sensitive: true },
      { key: "passportNumber", label: "U.S. passport number", type: "text", sensitive: true },
      { key: "passportExpiration", label: "Passport expiration", type: "date", sensitive: true },
    ],
  },
  {
    id: "w4",
    title: "W-4 withholding",
    fields: [
      {
        key: "filingStatus",
        label: "Filing status",
        type: "select",
        options: [
          ["", ""],
          ["single", "Single or married filing separately"],
          ["joint", "Married filing jointly / qualifying surviving spouse"],
          ["hoh", "Head of household"],
        ],
      },
      { key: "multipleJobs", label: "Step 2(c): two jobs total, similar pay", type: "checkbox" },
      { key: "childrenCredit", label: "Step 3: qualifying children credit ($)", type: "money" },
      { key: "otherDependentsCredit", label: "Step 3: other dependents credit ($)", type: "money" },
      { key: "otherIncome", label: "Step 4(a): other income ($)", type: "money" },
      { key: "deductions", label: "Step 4(b): deductions ($)", type: "money" },
      { key: "extraWithholding", label: "Step 4(c): extra withholding per period ($)", type: "money" },
    ],
  },
];

export const EMPLOYER_SECTIONS = [
  {
    id: "member",
    title: "Member (person receiving care)",
    fields: [
      { key: "memberFirst", label: "Member first name", type: "text" },
      { key: "memberLast", label: "Member last name", type: "text" },
      { key: "memberPplId", label: "Member PPL ID", type: "text" },
      { key: "memberMedicaidId", label: "Member Medicaid ID (EVV exemption form)", type: "text" },
      {
        key: "memberProgram",
        label: "Member's program (picks the rate table on the rates form)",
        type: "select",
        options: [
          ["", "CDASS (most members)"],
          ["sls", "Supported Living Services (SLS) waiver only"],
          ["cfc", "Community First Choice (CFC) only"],
        ],
      },
    ],
  },
  {
    id: "employer",
    title: "Employer of record",
    fields: [
      { key: "employerFirst", label: "Employer first name", type: "text" },
      { key: "employerLast", label: "Employer last name", type: "text" },
      { key: "employerTitle", label: "Employer title", type: "text", placeholder: "Employer" },
      { key: "businessName", label: "Business or organization name (I-9 / W-4)", type: "text" },
      { key: "businessAddress", label: "Business address (street, city, state, ZIP)", type: "text" },
      { key: "ein", label: "EIN (W-4)", type: "text" },
      {
        key: "signature",
        label: "Employer signature (uploaded once, placed on the employer signature lines)",
        type: "signature",
      },
    ],
  },
];

export function blankProfile() {
  const p = { id: crypto.randomUUID() };
  for (const s of PROFILE_SECTIONS)
    for (const f of s.fields) p[f.key] = f.type === "checkbox" ? (f.default ?? false) : (f.default ?? "");
  return p;
}

// Employer keys the app maintains but never renders as an input: provenance for
// the uploaded signature, recorded when it is uploaded so the Generate step can
// say whose signature it is about to stamp.
const EMPLOYER_META = ["signatureFor", "signatureUploadedAt"];

export function blankEmployer() {
  const e = {};
  for (const s of EMPLOYER_SECTIONS) for (const f of s.fields) e[f.key] = "";
  for (const k of EMPLOYER_META) e[k] = "";
  return e;
}

// A rate outside this range is a typo, not a wage: CDASS standard rates run in
// the teens to thirties and the emergency rate is 45.
const RATE_MIN = 1;
const RATE_MAX = 200;

/**
 * Accept a money value written the way people type it ("$33.51", " 1,234.00 ")
 * by dropping the formatting. Only punctuation goes; the amount is untouched.
 */
export function normalizeMoney(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/,/g, "")
    .trim();
}

/**
 * Describe what is wrong with a money value, or null when it is fine. Empty is
 * fine: leaving a rate box blank and writing it in by hand is a valid choice.
 *
 * This deliberately does not round. 33.517 is a typo, and quietly turning it
 * into 33.52 changes what someone gets paid, on a form they sign. The only
 * person who gets to resolve that is the one who typed it, so the value stays
 * exactly as entered and the packet does not generate until they fix it.
 */
export function moneyError(raw) {
  const v = normalizeMoney(raw);
  if (!v) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) {
    // An over-precise number gets both readings offered back, since only the
    // author knows whether 33.517 was meant to be 33.51 or 33.52.
    if (/^\d+\.\d{3,}$/.test(v)) {
      const down = v.slice(0, v.indexOf(".") + 3);
      const near = Number(v).toFixed(2);
      return down === near
        ? `Rates are dollars and cents. Did you mean ${down}?`
        : `Rates are dollars and cents. Did you mean ${down} or ${near}?`;
    }
    return "Enter a dollars-and-cents amount, like 18.50.";
  }
  const n = Number(v);
  if (n < RATE_MIN) return `$${v} an hour looks too low. Check the rate.`;
  if (n > RATE_MAX) return `$${v} an hour looks too high. Check the rate.`;
  return null;
}

/** Every money field on the profile that is currently invalid, for Generate. */
export function moneyErrors(profile) {
  const out = [];
  for (const s of PROFILE_SECTIONS)
    for (const f of s.fields) {
      if (f.type !== "money") continue;
      const msg = moneyError(profile[f.key]);
      if (msg) out.push({ key: f.key, label: f.label, message: msg });
    }
  return out;
}

/**
 * Blank out every field marked sensitive (SSN, DOB, bank and ID document
 * numbers). Name, address, contact, and rates stay so the profile remains
 * useful as a record. Returns the keys that were cleared.
 */
export function scrubSensitive(profile) {
  const cleared = [];
  for (const s of PROFILE_SECTIONS)
    for (const f of s.fields)
      if (f.sensitive && profile[f.key]) {
        profile[f.key] = "";
        cleared.push(f.key);
      }
  return cleared;
}

export function displayName(p) {
  const n = [p.first, p.last].filter(Boolean).join(" ");
  return n || "(unnamed employee)";
}

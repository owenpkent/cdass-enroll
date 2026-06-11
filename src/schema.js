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
      { key: "dob", label: "Date of birth", type: "date" },
      { key: "ssn", label: "Social Security Number", type: "ssn" },
      {
        key: "gender",
        label: "Gender",
        type: "select",
        options: [
          ["", ""],
          ["male", "Male"],
          ["female", "Female"],
          ["undisclosed", "Prefer not to disclose"],
        ],
      },
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
      { key: "municipality", label: "Municipality", type: "text" },
      { key: "mailingSame", label: "Mailing address is the same", type: "checkbox", default: true },
    ],
  },
  {
    id: "mailing",
    title: "Mailing address (only if different)",
    showIf: (p) => !p.mailingSame,
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
        key: "sameAccountAllMembers",
        label: "Use the same account for all Members they work for",
        type: "checkbox",
      },
      {
        key: "accountType",
        label: "Account type",
        type: "select",
        options: [["", ""], ["checking", "Checking"], ["savings", "Savings"]],
      },
      { key: "bankName", label: "Banking institution name", type: "text" },
      { key: "routing", label: "Routing number", type: "text" },
      { key: "account", label: "Account number", type: "text" },
      { key: "paperPayStub", label: "Mail paper pay stubs (no internet access)", type: "checkbox" },
      {
        key: "directoryOptIn",
        label: "List in the Attendant directory",
        type: "select",
        options: [["", ""], ["yes", "Yes"], ["no", "No"]],
      },
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
    title: "Pay rates ($/hour, for this attendant)",
    fields: [
      { key: "rateStandardCdass", label: "CDASS standard rate", type: "money", placeholder: "e.g. 18" },
      { key: "rateEmergencyCdass", label: "CDASS emergency rate", type: "money" },
      { key: "rateStandardHm", label: "Health maintenance standard rate", type: "money" },
      { key: "rateEmergencyHm", label: "Health maintenance emergency rate", type: "money" },
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
      { key: "uscisNumber", label: "USCIS / A-Number (if LPR or authorized)", type: "text" },
      { key: "workAuthExpiration", label: "Work authorization expiration", type: "date" },
      { key: "i94Number", label: "Form I-94 admission number", type: "text" },
      { key: "foreignPassport", label: "Foreign passport number and country", type: "text" },
    ],
  },
  {
    id: "iddocs",
    title: "Identity documents (auto-filled from scans)",
    fields: [
      { key: "dlNumber", label: "Driver's license number", type: "text" },
      { key: "dlState", label: "License state", type: "text", width: "s" },
      { key: "dlExpiration", label: "License expiration", type: "date" },
      { key: "passportNumber", label: "U.S. passport number", type: "text" },
      { key: "passportExpiration", label: "Passport expiration", type: "date" },
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
    ],
  },
];

export function blankProfile() {
  const p = { id: crypto.randomUUID() };
  for (const s of PROFILE_SECTIONS)
    for (const f of s.fields) p[f.key] = f.type === "checkbox" ? (f.default ?? false) : "";
  return p;
}

export function blankEmployer() {
  const e = {};
  for (const s of EMPLOYER_SECTIONS) for (const f of s.fields) e[f.key] = "";
  return e;
}

export function displayName(p) {
  const n = [p.first, p.last].filter(Boolean).join(" ");
  return n || "(unnamed employee)";
}

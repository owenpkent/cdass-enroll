// The complete-packet fixture: one fictional attendant, entered the way a real
// enrollment is, and every value the CDASS packet must carry for them.
//
// Modeled on a real completed and accepted packet: the same pages and boxes are
// filled (enrollment page 2, the page 8 signature block, direct deposit, rates
// table 1, the tax exemption, I-9 Section 1 and Section 2 with a license for
// List B and a Social Security card for List C), with Jane Doe's made-up values.
// Never put real employee data here.
//
// Both test layers check against EXPECTED_PACKET: tests/smoke.mjs fills the
// packet from PROFILE directly, and e2e/enroll.spec.mjs types PROFILE into the
// app by hand and reads the downloaded PDF. A value listed as "" or false must
// be blank or unchecked, which catches a box filled that should not be.

export const PROFILE = {
  first: "Jane", middle: "Marie", last: "Doe", maidenOrPrevious: "Smith",
  dob: "1986-06-06", ssn: "123456789",
  street: "1234 Main St", street2: "Apt 2", city: "Denver", state: "CO", zip: "80203",
  county: "Denver", mailingSame: true,
  email: "jane@example.com", cellPhone: "303-555-0100", otherPhone: "", allowText: "yes",
  contactPreference: "email", primaryLanguage: "English", bestContactTimes: "Weekday mornings",
  directDeposit: true, accountType: "checking",
  bankName: "First Bank", routing: "102000021", account: "9876543210",
  paperPayStub: false,
  pplId: "ATT-001", relationship: "nonrelative", liveIn: "doesNotLive",
  relationToEmployer: "none", fullTimeStudent: false, primaryJob: true,
  citizenship: "citizen", uscisNumber: "", workAuthExpiration: "", i94Number: "", foreignPassport: "",
  dlNumber: "123456789", dlState: "CO", dlExpiration: "2030-09-30", ssnCardPresented: true,
  passportNumber: "", passportExpiration: "",
  filingStatus: "single", multipleJobs: true,
  rateStandardCdass: "20.00", rateEmergencyCdass: "45",
  childrenCredit: "2000", otherDependentsCredit: "500",
  otherIncome: "", deductions: "", extraWithholding: "50",
};

// "Your details": the Member and the employer of record.
export const EMPLOYER = {
  memberFirst: "Owen", memberLast: "Kent", memberPplId: "MEM-001", memberMedicaidId: "A123456",
  employerFirst: "Owen", employerLast: "Kent", employerTitle: "Employer",
  businessName: "Owen Kent, Household Employer", businessAddress: "1234 Main St, Denver, CO 80203",
  ein: "12-3456789",
};

// The Generate options: signature date and first day of work.
export const OPTS = { signatureDate: "2026-06-11", firstDay: "2026-06-15", newService: true };

const digits = (prefix, value, boxes) =>
  Object.fromEntries(Array.from({ length: boxes }, (_, i) => [`${prefix} ${i + 1}`, value[i] ?? ""]));

// Field name -> value in the filled CO-CDASS-Attendant-Packet-2026.pdf (V.3
// enrollment form). Text fields are strings, checkboxes booleans.
export const EXPECTED_PACKET = {
  // ---- Page 2: Attendant Enrollment and Agreement, page 1 of 7 ----
  Text1: "Owen Kent", // Employer Name
  Text2: "Owen Kent", // Member Name
  Text3: "MEM-001", // Member PPL ID
  Text4: "Jane Marie Doe", // Attendant name, first middle last
  Text5: "Smith", // Maiden or previous last name
  Text6: "06/06/1986", // Date of birth
  Text7: "123-45-6789", // SSN
  "Check Box30": false, // Spouse
  "Check Box31": false, // Parent
  "Check Box32": false, // Other Relative
  "Check Box33": true, // Non-Relative
  Text8: "1234 Main St",
  Text9: "Apt 2",
  Text10: "Denver", // City
  Text11: "CO", // State
  Text13: "80203", // ZIP
  Text12: "Denver", // County
  "Check Box29": true, // Mailing address same as physical
  Text14: "", // Mailing address stays blank when it is the same
  Text16: "",
  Text20: "jane@example.com",
  Text21: "303-555-0100", // Cell phone
  Text22: "", // Home or other phone
  Text23: "English",
  Text24: "Weekday mornings",
  "Check Box25": true, // Prefers email
  "Check Box26": false,
  "Check Box27": false,
  "Check Box28": false,
  "Do you want PPL to text you: Yes": true,
  "Do you want PPL to text you: No": false,

  // ---- Page 8: enrollment signature block (attendant and employer sign by hand) ----
  "Attendant Printed Name: first and last": "Jane Doe",
  "Attendant signature date": "06/11/2026",
  "Employer Printed Name: first and last": "Owen Kent",
  "Employer signature date": "06/11/2026",

  // ---- Pages 9-10: Direct Deposit ----
  "Member Name, first and last": "Owen Kent",
  "Employer Name, first and last": "Owen Kent",
  "Member PPL ID": "MEM-001",
  "Direct Deposit to Bank Account or Third Party Money App": true,
  "Payment by Paper Check": false,
  "Checking Account": true,
  "Savings Account": false,
  "Bank or money app name": "First Bank",
  ...digits("Routing number", "102000021", 9),
  ...digits("Account number", "9876543210", 13),
  "Attendant Printed Name, first and last": "Jane Doe",
  "Attendant PPL ID": "ATT-001",
  Date: "", // shared with the EVV vendor date, so the attendant dates it by hand

  // ---- Page 11: Services and Rates, table 1 (CDASS) ----
  "Attendant Name: first and last": "Jane Doe",
  "Member Name: first and last": "Owen Kent",
  "Employer Name: first and last": "Owen Kent",
  "New Service": true,
  "Change Hourly Rate: only mark if the attendant is already working": false,
  "CDASS Standard Rate": "20.00",
  "CDASS Emergency Rate": "45",
  "SLS CDASS Standard Rate": "",
  "CFC CDASS Standard Rate": "",
  "Attendant Signature Date": "06/11/2026",
  "Employer Signature Date": "06/11/2026",

  // ---- Page 12: Tax Exemptions ----
  "I am not the spouse parent or child of the employer": true,
  "I am the spouse of the employer": false,
  "I am under 18 years old and I am a fulltime student": false,

  // ---- Pages 20-21: I-9 Section 1 ----
  "Last Name (Family Name)": "Doe",
  "First Name Given Name": "Jane",
  "Employee Middle Initial (if any)": "M",
  "Employee Other Last Names Used (if any)": "Smith",
  "Address Street Number and Name": "1234 Main St",
  "Apt Number (if any)": "Apt 2",
  "City or Town": "Denver",
  State: "CO",
  "ZIP Code": "80203",
  "Date of Birth mmddyyyy": "06/06/1986",
  "US Social Security Number": "123456789",
  "Employees E-mail Address": "jane@example.com",
  "Telephone Number": "303-555-0100",
  CB_1: true, // A citizen of the United States
  "Today's Date mmddyyy": "06/11/2026",

  // ---- I-9 Section 2: license (List B) + Social Security card (List C) ----
  "List B Document 1 Title": "Driver's License",
  "List B Issuing Authority 1": "Colorado DMV",
  "List B Document Number 1": "123456789",
  "List B Expiration Date 1": "09/30/2030",
  "List C Document Title 1": "Social Security Card",
  "List C Issuing Authority 1": "Social Security Administration",
  "List C Document Number 1": "123-45-6789",
  "FirstDayEmployed mmddyyyy": "06/15/2026",
  "Last Name First Name and Title of Employer or Authorized Representative": "Kent, Owen, Employer",
  "S2 Todays Date mmddyyyy": "06/11/2026",
  "Employers Business or Org Name": "Owen Kent, Household Employer",
  "Employers Business or Org Address": "1234 Main St, Denver, CO 80203",
};

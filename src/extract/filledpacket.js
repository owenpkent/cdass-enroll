// Read a previously filled CO CDASS attendant packet back into a profile.
//
// A filled AcroForm is the agency's own field names against values a human
// already checked and signed. Point it at last year's packet and the attendant's
// details come back exactly.
//
// It reads both revisions of the packet: the current one (V.3 enrollment form,
// page 2 fields named "TextN"/"Check BoxN") and the July 2025 one (V.2, with
// descriptive names), so packets filled before the revision still import.
//
// What it will not import, on purpose: anything the packet phrases as a
// first-person attestation. The tax-exemption statements ("I am not the spouse,
// parent, or child of the employer"), the under-18 statements, the EVV live-in
// attestation, and the I-9 citizenship attestation are the signer's word, not
// data, and re-asserting them onto a new form because an old one said so is the
// one thing this pattern must not do. Those stay for the human. Everything here
// is identity, contact, address, payment, and rates: the parts that are pure
// retyping.
//
// Values are returned for review, never trusted: main.js flashes each one yellow.

import { PDFDocument } from "pdf-lib";
import { PACKET2026_TEXT, PAGE2, RATE_TABLE, TEXT_ME_YES, TEXT_ME_NO } from "../fill/packet2026.js";
import { normalizeMoney } from "../schema.js";

const text = (form, name) => {
  try {
    return (form.getTextField(name).getText() ?? "").trim();
  } catch {
    return "";
  }
};

// Mirrors selectButton() on the fill side: this template uses real radio groups
// and same-name checkbox pairs interchangeably, so reading has to accept either.
const checked = (form, name) => {
  try {
    return form.getCheckBox(name).isChecked();
  } catch {
    /* not a checkbox */
  }
  try {
    return !!form.getRadioGroup(name).getSelected();
  } catch {
    return false;
  }
};

/** First value whose box is checked, or "" if none are. */
const pick = (form, pairs) => {
  for (const [name, value] of pairs) if (checked(form, name)) return value;
  return "";
};

/** Read per-digit boxes named "<prefix> 1".."<prefix> N" back into one number. */
const joinDigits = (form, prefix, count) => {
  let out = "";
  for (let i = 1; i <= count; i++) out += text(form, `${prefix} ${i}`).replace(/\D/g, "");
  return out;
};

/**
 * Split a "first last" line the packet stores as one field. Naive on purpose: it
 * takes the first word as the given name and the rest as the family name, which
 * is wrong for multi-word given names. The value is shown for review, and these
 * are standing details the user usually already has, so a bad split is visible
 * and costs a correction rather than a silent error.
 */
const splitName = (full) => {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts.slice(1).join(" ") };
};

/**
 * Read a filled packet. Returns { profile, employer } holding only the keys the
 * form actually carried, so importing never blanks data the form did not have.
 * Throws if the PDF is not this packet.
 */
export async function readFilledPacket(bytes) {
  const form = (await PDFDocument.load(bytes)).getForm();
  const has = (name) => !!form.getFieldMaybe(name);

  // Probe fields only this packet has, so an unrelated PDF fails loudly instead
  // of importing an empty profile over good data. "Text4" alone is too generic,
  // so V.3 also needs the packet's own direct-deposit and rate fields.
  const v2 = has("Attendant Name: first, middle and last");
  const v3 = !v2 && has(PAGE2.fullName) && has("Bank or money app name") && has("CDASS Standard Rate");
  if (!v2 && !v3) throw new Error("This is not a CO CDASS 2026 attendant packet.");
  // The page 2 field name for this revision.
  const pg2 = (v3Name, v2Name) => (v3 ? v3Name : v2Name);

  const profile = {};
  const employer = {};
  const put = (obj, key, value) => {
    if (value !== "" && value != null) obj[key] = value;
  };

  // ---- Everything that maps to a single key, straight from the shared table ----
  for (const f of PACKET2026_TEXT) {
    const raw = text(form, f.v2 ? pg2(f.field, f.v2) : f.field);
    put(f.on === "emp" ? employer : profile, f.key, f.from ? f.from(raw) : raw);
  }

  // ---- Name ----
  // The packet writes the attendant's name as one composite line, but the
  // embedded I-9 keeps first/middle/last in separate boxes. Read those instead
  // of guessing where a middle name ends.
  put(profile, "first", text(form, "First Name Given Name"));
  put(profile, "last", text(form, "Last Name (Family Name)"));
  put(profile, "middle", text(form, "Employee Middle Initial (if any)"));

  // The I-9 keeps only a middle *initial*, but page 2's composite line carries
  // the whole name. With first and last known from the I-9's own boxes, whatever
  // sits between them in the composite is the full middle name, which recovers
  // "Marie" instead of "M" without having to guess at word boundaries.
  const full = text(form, pg2(PAGE2.fullName, "Attendant Name: first, middle and last"));
  if (full && profile.first && profile.last && full.startsWith(profile.first) && full.endsWith(profile.last)) {
    const middle = full.slice(profile.first.length, full.length - profile.last.length).trim();
    if (middle) profile.middle = middle;
  }

  const member = splitName(text(form, pg2(PAGE2.memberName, "Member Name: first and last")));
  if (member) {
    put(employer, "memberFirst", member.first);
    put(employer, "memberLast", member.last);
  }
  const boss = splitName(text(form, "Employer Name: first and last"));
  if (boss) {
    put(employer, "employerFirst", boss.first);
    put(employer, "employerLast", boss.last);
  }

  // ---- Relationship to the Member (page 2) ----
  // This one is a data field, not a first-person attestation: the form asks the
  // employer to categorise the attendant, it does not ask the attendant to swear
  // to it. The page-11 tax statements are the attestation, and they stay out.
  put(profile, "relationship", pick(form, [
    [pg2(PAGE2.spouse, "Spouse"), "spouse"],
    [pg2(PAGE2.parent, "Parent"), "parent"],
    [pg2(PAGE2.relative, "Other Relative"), "relative"],
    [pg2(PAGE2.nonrelative, "NonRelative"), "nonrelative"],
  ]));

  // ---- Contact ----
  put(profile, "contactPreference", pick(form, [
    [pg2(PAGE2.prefEmail, "The attendant prefers to be contacted by email"), "email"],
    [pg2(PAGE2.prefCell, "The attendant prefers to be contacted by cell phone"), "cell"],
    [pg2(PAGE2.prefHome, "The attendant prefers to be contacted by home phone"), "home"],
    [pg2(PAGE2.prefMail, "The attendant prefers to be contacted by mail"), "mail"],
  ]));
  // Same names in both revisions: V.3 lost these boxes and the filler recreates
  // them under the V.2 names.
  put(profile, "allowText", pick(form, [
    [TEXT_ME_YES, "yes"],
    [TEXT_ME_NO, "no"],
  ]));

  // ---- Addresses ----
  const sameBox = "Check the box if the address where you live is the same as your mailing address";
  profile.mailingSame = checked(form, pg2(PAGE2.mailingSame, sameBox));
  if (!profile.mailingSame) {
    put(profile, "mailStreet", text(form, pg2(PAGE2.mailStreet, "Attendant mailing address not PO Box")));
    put(profile, "mailStreet2", text(form, pg2(PAGE2.mailStreet2, "Attendant mailing address 2 Apt Ste or other")));
    put(profile, "mailCity", text(form, pg2(PAGE2.mailCity, "Attendant mailing address city")));
    put(profile, "mailState", text(form, pg2(PAGE2.mailState, "Attendant mailing address State")));
    put(profile, "mailZip", text(form, pg2(PAGE2.mailZip, "Attendant mailing address Zip Code")));
  }

  // ---- Payment ----
  // Only decide when the form actually says; neither box checked leaves the
  // current setting alone rather than guessing a payment method.
  if (checked(form, "Direct Deposit to Bank Account or Third Party Money App")) profile.directDeposit = true;
  else if (checked(form, "Payment by Paper Check")) profile.directDeposit = false;

  put(profile, "accountType", pick(form, [
    ["Checking Account", "checking"],
    ["Savings Account", "savings"],
  ]));
  put(profile, "bankName", text(form, "Bank or money app name"));
  put(profile, "routing", joinDigits(form, "Routing number", 9));
  put(profile, "account", joinDigits(form, "Account number", 13));
  profile.paperPayStub = checked(form, "Send my pay stub in the mail");

  // ---- Rates ----
  // The rates page has three parallel rate tables and the rate sits in exactly one, so
  // whichever table carries a value also tells us the Member's program.
  for (const [program, t] of Object.entries(RATE_TABLE)) {
    const standard = text(form, t.standard);
    if (!standard) continue;
    // Packets in the wild carry "$33.51" as often as "33.51"; the dollar sign
    // is dropped on the way in so the amount lands in the box clean.
    put(profile, "rateStandardCdass", normalizeMoney(standard));
    put(profile, "rateEmergencyCdass", normalizeMoney(text(form, t.emergency)));
    put(employer, "memberProgram", program);
    break;
  }

  return { profile, employer };
}

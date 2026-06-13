// Parses the AAMVA data string from the PDF417 barcode on the back of a
// US driver's license or state ID into profile fields.

// Known AAMVA element IDs. Matching against this list (instead of any D??)
// matters because the subfile marker "DL" can directly precede the first
// element, e.g. "...DLDAQ12345" where the element is DAQ, not DLD.
const CODES =
  "DAA DAB DAC DAD DAE DAF DAG DAH DAI DAJ DAK DAL DAM DAN DAO DAP DAQ DAR DAS DAT DAU DAV DAW DAX DAY DAZ " +
  "DBA DBB DBC DBD DBE DBF DBG DBH DBI DBJ DBK DBL DBM DBN DBS DCA DCB DCD DCE DCF DCG DCI DCJ DCK DCL DCM " +
  "DCN DCO DCP DCQ DCR DCS DCT DCU DDA DDB DDC DDD DDE DDF DDG DDH DDI DDJ DDK DDL";
const ELEMENT = new RegExp(`(${CODES.split(" ").join("|")})([^\\n\\r]*)`, "g");

export function parseAamva(raw) {
  if (!raw || !raw.includes("ANSI ")) return null;
  const el = {};
  for (const m of raw.matchAll(ELEMENT)) el[m[1]] ??= m[2].trim();

  // Some pre-2000 licenses pack the whole name into DAA (LAST,FIRST,MIDDLE).
  let first = el.DAC ?? el.DCT ?? "";
  let middle = el.DAD ?? "";
  let last = el.DCS ?? "";
  if (!last && el.DAA) [last = "", first = "", middle = ""] = el.DAA.split(",");

  // Address. DAG-DAK is the mandatory card address. Some (older) cards also
  // carry the deprecated residence set DAL-DAP; per AAMVA, when both are
  // present DAG-DAK is the MAILING address and DAL-DAP is the residence. Use
  // residence as the home address and import the mailing address separately,
  // so a mailing address that differs from the license (e.g. a PO Box) carries
  // over instead of being silently treated as where they live.
  const carded = address(el.DAG, el.DAH, el.DAI, el.DAJ, el.DAK);
  const residence = el.DAL ? address(el.DAL, el.DAM, el.DAN, el.DAO, el.DAP) : null;
  const separateMailing =
    residence && complete(residence) && complete(carded) && !sameAddress(residence, carded);
  const home = separateMailing ? residence : carded;

  const out = {
    first: titleCase(first),
    middle: titleCase(stripNone(middle)),
    last: titleCase(last),
    dob: aamvaDate(el.DBB),
    ...home,
    gender: el.DBC === "1" ? "male" : el.DBC === "2" ? "female" : "",
    dlNumber: el.DAQ,
    dlState: el.DAJ,
    dlExpiration: aamvaDate(el.DBA),
  };
  if (separateMailing) {
    out.mailingSame = false;
    out.mailStreet = carded.street;
    out.mailStreet2 = carded.street2;
    out.mailCity = carded.city;
    out.mailState = carded.state;
    out.mailZip = carded.zip;
  }
  return clean(out);
}

function address(street, street2, city, state, zip) {
  return {
    street: titleCase(street),
    street2: titleCase(stripNone(street2)),
    city: titleCase(city),
    state: state ?? "",
    zip: zip ? formatZip(zip) : "",
  };
}

// A usable home/mailing address needs at least a street, city, and ZIP.
function complete(a) {
  return !!(a.street && a.city && a.zip);
}

function sameAddress(a, b) {
  return a.street === b.street && a.city === b.city && a.state === b.state && a.zip === b.zip;
}

// US AAMVA dates are MMDDCCYY; Canadian are CCYYMMDD. Returns ISO yyyy-mm-dd.
function aamvaDate(s) {
  if (!s || !/^\d{8}$/.test(s)) return "";
  const mmFirst = Number(s.slice(0, 2)) <= 12 && Number(s.slice(4, 8)) > 1900;
  const [y, m, d] = mmFirst
    ? [s.slice(4, 8), s.slice(0, 2), s.slice(2, 4)]
    : [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)];
  return `${y}-${m}-${d}`;
}

function formatZip(z) {
  const digits = z.replace(/\D/g, "");
  if (digits.length === 9 && digits.slice(5) !== "0000")
    return digits.slice(0, 5) + "-" + digits.slice(5);
  return digits.slice(0, 5);
}

function stripNone(s) {
  return !s || /^(NONE|NA|N\/A|UNAVL)$/i.test(s.trim()) ? "" : s;
}

function titleCase(s) {
  if (!s) return "";
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'])\w/g, (c) => c.toUpperCase());
}

function clean(obj) {
  const out = {};
  // Keep explicit false (mailingSame) and 0; drop only empty strings and nullish.
  for (const [k, v] of Object.entries(obj)) if (v !== "" && v != null) out[k] = v;
  return out;
}

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

  return clean({
    first: titleCase(first),
    middle: titleCase(stripNone(middle)),
    last: titleCase(last),
    dob: aamvaDate(el.DBB),
    street: titleCase(el.DAG),
    street2: titleCase(stripNone(el.DAH)),
    city: titleCase(el.DAI),
    state: el.DAJ,
    zip: el.DAK ? formatZip(el.DAK) : "",
    gender: el.DBC === "1" ? "male" : el.DBC === "2" ? "female" : "",
    dlNumber: el.DAQ,
    dlState: el.DAJ,
    dlExpiration: aamvaDate(el.DBA),
  });
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
  for (const [k, v] of Object.entries(obj)) if (v) out[k] = v;
  return out;
}

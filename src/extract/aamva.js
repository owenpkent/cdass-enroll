// Parses the AAMVA data string from the PDF417 barcode on the back of a
// US driver's license or state ID into profile fields.
//
// The format is the AAMVA DL/ID Card Design Standard, section D.12. Before
// changing anything here, read docs/id-barcode.md: it is the full contract, and
// the two traps below have each shipped broken once.

/**
 * zxing read options this parser requires, kept here (next to the parser that
 * depends on them) rather than at the call site, so the contract is testable
 * without importing the browser-only scanner module.
 *
 * textMode is the load-bearing one. zxing defaults to "HRI" (human readable
 * interpretation), which renders control characters as literal placeholders:
 * a newline arrives as the four characters "<LF>". AAMVA separates its
 * elements with real newlines, so under the default every element after the
 * first is swallowed into the first element's value and this parser returns a
 * single junk field. "Plain" returns the bytes as sent.
 *
 * The binarizer is deliberately absent; the scanner tries several.
 */
export const AAMVA_READ_OPTIONS = {
  formats: ["PDF417"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  maxNumberOfSymbols: 1,
  textMode: "Plain",
};

// Known AAMVA element IDs.
const CODES =
  "DAA DAB DAC DAD DAE DAF DAG DAH DAI DAJ DAK DAL DAM DAN DAO DAP DAQ DAR DAS DAT DAU DAV DAW DAX DAY DAZ " +
  "DBA DBB DBC DBD DBE DBF DBG DBH DBI DBJ DBK DBL DBM DBN DBS DCA DCB DCD DCE DCF DCG DCI DCJ DCK DCL DCM " +
  "DCN DCO DCP DCQ DCR DCS DCT DCU DDA DDB DDC DDD DDE DDF DDG DDH DDI DDJ DDK DDL";
const CODE_SET = new Set(CODES.split(" "));

// The subfile types this parser reads. Per AAMVA D.12.4, "DL" designates a
// driver's licence subfile and "ID" a non-DL (state ID card); jurisdictions add
// their own as "Z" plus the first letter of the jurisdiction ("ZC" for
// Colorado), which carry no element we need.
const SUBFILE_ELEMENT = /(?:DL|ID)([A-Z]{3})/g;

/**
 * Where this line's element begins. Elements sit one per line (AAMVA separates
 * them with LF), so normally 0. The exception is the first element, which
 * trails the header's subfile designators, because "the data related to the
 * first subfile designator follows the last Subfile Designator" and "each
 * subfile must begin with the two-character Subfile Type" (D.12.4):
 *
 *   ...ANSI 636020100102 ID00410259 ZC03000010 | ID | DAQ | value
 *                        designators           ^type ^first element
 *
 * Anchoring matters; scanning for element IDs at any offset does not work. On
 * an ID card the subfile type "ID" runs straight into "DAQ" to spell "IDDAQ",
 * whose middle three characters "DDA" are themselves a valid element ID. A free
 * scan matches that phantom DDA one character early, and since a value runs to
 * the end of its line, it swallows the licence number. Driver's licences hide
 * this: "DLDAQ" contains no valid element ID other than DAQ.
 */
function elementStart(line) {
  if (!line.includes("ANSI ")) return 0;
  let at = -1;
  for (const m of line.matchAll(SUBFILE_ELEMENT)) if (CODE_SET.has(m[1])) at = m.index + 2;
  return at; // -1 when the header carries no trailing element
}

export function parseAamva(raw) {
  if (!raw || !raw.includes("ANSI ")) return null;
  const el = {};
  for (const line of raw.split("\n")) {
    const start = elementStart(line);
    if (start < 0) continue;
    const code = line.slice(start, start + 3);
    if (CODE_SET.has(code)) el[code] ??= line.slice(start + 3).trim();
  }

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
    // The barcode also carries sex (DBC), eye colour, height and so on. None of
    // the forms ask for them, so they are not extracted: anything returned here
    // is written into the profile and persisted.
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

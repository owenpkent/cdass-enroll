// Best-effort extraction from OCR of the FRONT of a US driver's license.
// License fronts are not standardized across states, so this is heuristic and
// every value must be verified. It pulls the date of birth, the address, and a
// best-effort name. The name is still read more reliably from the Social
// Security card or the back-of-license barcode; the front reading here is a
// convenience and, like the rest of this file, must be double-checked.

export function parseLicenseFront(ocrText, now = Date.now()) {
  const out = {};
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Date of birth: the earliest plausible date on the card. Issue and expiry
  // dates are more recent, so the oldest is the birth date; a line that says
  // DOB/BIRTH wins outright. Only dates already in the past are eligible: a
  // birth date never is in the future, and when OCR reads the expiry but misses
  // the birth date (common on cards whose background defeats it) the old
  // "earliest wins" rule silently filled the expiry as the date of birth.
  // Leaving it blank for the user to type is the safe failure.
  const dates = [];
  for (const line of lines) {
    // Spaces around the separators are tolerated: OCR of a tight crop routinely
    // reads "08/ 23/2003" for "08/23/2003".
    for (const m of line.matchAll(/\b(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})\b/g)) {
      const mm = +m[1];
      const dd = +m[2];
      const yy = +m[3];
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yy < 1900 || yy > 2100) continue;
      if (Date.UTC(yy, mm - 1, dd) > now) continue;
      dates.push({ iso: `${yy}-${pad(mm)}-${pad(dd)}`, yy, labeled: /DOB|BIRTH/i.test(line) });
    }
  }
  if (dates.length) {
    const labeled = dates.find((d) => d.labeled);
    out.dob = (labeled ?? dates.reduce((a, b) => (b.yy < a.yy ? b : a))).iso;
  }

  // Name: best-effort, see parseName. Only fields it is confident about land.
  Object.assign(out, parseName(lines));

  // Address: find the "City ST 12345" line; the numbered line just above it is
  // the street.
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^(.*?)[, ]+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
    const city = m && m[1].replace(/[^A-Za-z .'-]/g, "").trim();
    if (m && city) {
      out.city = titleCase(city);
      out.state = m[2];
      out.zip = m[3];
      if (/\d/.test(lines[i - 1])) out.street = titleCase(lines[i - 1]);
      break;
    }
  }

  return Object.keys(out).length ? out : null;
}

// Tokens that are document chrome, field labels, address parts, or bare state
// headers, never a person's name. A candidate name line containing any of these
// is rejected. This costs the rare person whose given name is a state ("Georgia",
// "Virginia"), who then just types it in; that is safer than misreading a header.
const NAME_STOP = new Set(
  (
    "DRIVER DRIVERS LICENSE LICENCE IDENTIFICATION IDENT CARD USA REAL FEDERAL " +
    "LIMITS SAMPLE SPECIMEN DUPLICATE VOID STATE COMMONWEALTH OF " +
    "DOB BIRTH DATE EXP EXPIRES EXPIRATION ISS ISSUED ISSUE CLASS CLS SEX GENDER " +
    "EYES EYE HAIR HGT HT WGT WT HEIGHT WEIGHT DD DL LN FN REV END ENDORSEMENTS " +
    "REST RESTRICTIONS DONOR ORGAN VETERAN ADDRESS ADDR " +
    "ST STREET AVE AVENUE RD ROAD BLVD BOULEVARD DR DRIVE CT COURT PL PLACE WAY " +
    "HWY LANE CIR CIRCLE TER TERRACE PKWY APT UNIT STE FL " +
    "ALABAMA ALASKA ARIZONA ARKANSAS CALIFORNIA COLORADO CONNECTICUT DELAWARE " +
    "FLORIDA GEORGIA HAWAII IDAHO ILLINOIS INDIANA IOWA KANSAS KENTUCKY LOUISIANA " +
    "MAINE MARYLAND MASSACHUSETTS MICHIGAN MINNESOTA MISSISSIPPI MISSOURI MONTANA " +
    "NEBRASKA NEVADA NEW HAMPSHIRE JERSEY MEXICO YORK NORTH SOUTH CAROLINA DAKOTA " +
    "OHIO OKLAHOMA OREGON PENNSYLVANIA RHODE ISLAND TENNESSEE TEXAS UTAH VERMONT " +
    "VIRGINIA WASHINGTON WEST WISCONSIN WYOMING DISTRICT COLUMBIA PUERTO RICO GUAM"
  ).split(/\s+/)
);

// One token looks like a name part: letters (plus hyphen/apostrophe), and not a
// stopword. Single letters are allowed so a middle initial survives.
function isNameToken(t) {
  return /^[A-Za-z][A-Za-z'’\-]*$/.test(t) && !NAME_STOP.has(t.toUpperCase());
}

// A whole captured string is a plausible name: at least one token, all of them
// name tokens.
function looksLikeName(s) {
  const toks = s.trim().split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every(isNameToken);
}

// Split a given-names string ("JANE MARIE") into first + middle.
function assignGiven(name, s) {
  const toks = s.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return;
  name.first ??= titleCase(toks[0]);
  if (toks.length > 1) name.middle ??= titleCase(toks.slice(1).join(" "));
}

/**
 * Best-effort first/middle/last from front-of-license OCR. Three passes, most
 * reliable first, each filling only fields still empty:
 *   1. AAMVA numbered fields: "1 <family>" and "2 <given(s)>".
 *   2. Text labels: LN/FN, LAST/FIRST, FAMILY/GIVEN.
 *   3. Positional fallback: the first digit-free, all-name-token line of two to
 *      four words, read as LAST FIRST [MIDDLE...] (the common card layout).
 * Returns only the fields it is confident about, so a miss leaves the field
 * blank for the user to type rather than guessing.
 */
function parseName(lines) {
  const name = {};

  // 1. Numbered fields. "1234 MAIN ST" cannot match — it has no space after the
  //    leading digit; "2 ELM ST" is rejected because "ST" is a stopword.
  for (const line of lines) {
    const fam = line.match(/^1\s+([A-Za-z][A-Za-z'’\- ]{1,40})$/);
    if (fam && looksLikeName(fam[1])) name.last ??= titleCase(fam[1]);
    const giv = line.match(/^2\s+([A-Za-z][A-Za-z'’\- ]{1,40})$/);
    if (giv && looksLikeName(giv[1])) assignGiven(name, giv[1]);
  }

  // 2. Explicit text labels.
  for (const line of lines) {
    const fam = line.match(/^(?:LN|FAMILY(?:\s*NAME)?|LAST(?:\s*NAME)?)\b[.:\s]+([A-Za-z][A-Za-z'’\- ]{1,40})$/i);
    if (fam && looksLikeName(fam[1])) name.last ??= titleCase(fam[1]);
    const giv = line.match(/^(?:FN|GIVEN(?:\s*NAMES?)?|FIRST(?:\s*NAME)?)\b[.:\s]+([A-Za-z][A-Za-z'’\- ]{1,40})$/i);
    if (giv && looksLikeName(giv[1])) assignGiven(name, giv[1]);
  }

  // 3. Positional fallback, only if the labelled passes found nothing. This is
  //    the pass most exposed to OCR noise, so it is the most guarded: a real
  //    name line has a substantial word and enough letters overall, which
  //    rejects fragment lines like "Oe Aa Es" that pass the per-token test but
  //    are just the security-pattern background misread. Short tokens are only
  //    trusted from the numbered/labelled passes above, where structure vouches
  //    for them.
  if (!name.last && !name.first) {
    for (const line of lines) {
      if (/\d/.test(line)) continue;
      const toks = line.split(/\s+/).filter(Boolean);
      if (toks.length < 2 || toks.length > 4) continue;
      if (!toks.every(isNameToken)) continue;
      const maxLen = Math.max(...toks.map((t) => t.length));
      const letters = toks.join("").length;
      if (maxLen < 4 || letters < 8) continue;
      name.last = titleCase(toks[0]);
      name.first = titleCase(toks[1]);
      if (toks.length > 2) name.middle = titleCase(toks.slice(2).join(" "));
      break;
    }
  }

  return name;
}

/**
 * Parse a name from OCR of a TIGHT, user-drawn crop of just the name region.
 * Because the user deliberately boxed the name, this is far more permissive than
 * parseName above: it strips leading field-number noise and stray punctuation
 * ("1", ")", ">" that OCR makes of the tiny AAMVA field markers), then reads the
 * surviving name tokens. Two lines are taken as family-name-then-given (the card
 * layout: field 1 on top, field 2 below); a single line as LAST FIRST [MIDDLE].
 * Returns null if nothing name-like survives.
 */
export function parseNameRegion(text) {
  const nameLines = [];
  for (const raw of text.split(/\r?\n/)) {
    const cleaned = raw.replace(/[^A-Za-z'’ \-]+/g, " ").trim();
    if (!cleaned) continue;
    const toks = cleaned.split(/\s+/).filter((t) => t.length >= 2 && isNameToken(t));
    if (toks.length) nameLines.push(toks);
    if (nameLines.length >= 2) break;
  }
  if (!nameLines.length) return null;

  const name = {};
  if (nameLines.length >= 2) {
    name.last = titleCase(nameLines[0].join(" "));
    assignGiven(name, nameLines[1].join(" "));
  } else {
    const t = nameLines[0];
    if (t.length < 2) return null; // a lone token could be either name; make the user type it
    name.last = titleCase(t[0]);
    name.first = titleCase(t[1]);
    if (t.length > 2) name.middle = titleCase(t.slice(2).join(" "));
  }
  return name.first || name.last ? name : null;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function titleCase(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'])\w/g, (c) => c.toUpperCase());
}

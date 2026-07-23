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

// Document chrome, field labels, and address parts: never a person's name, in
// any position, so rejecting these costs nothing.
const CHROME_STOP = new Set(
  (
    "DRIVER DRIVERS LICENSE LICENCE IDENTIFICATION IDENT CARD USA REAL FEDERAL " +
    "LIMITS SAMPLE SPECIMEN DUPLICATE VOID STATE COMMONWEALTH OF " +
    "DOB BIRTH DATE EXP EXPIRES EXPIRATION ISS ISSUED ISSUE CLASS CLS SEX GENDER " +
    "EYES EYE HAIR HGT HT WGT WT HEIGHT WEIGHT DD DL LN FN REV END ENDORSEMENTS " +
    "REST RESTRICTIONS DONOR ORGAN VETERAN ADDRESS ADDR " +
    "ST STREET AVE AVENUE RD ROAD BLVD BOULEVARD DR DRIVE CT COURT PL PLACE WAY " +
    "HWY LANE CIR CIRCLE TER TERRACE PKWY APT UNIT STE FL"
  ).split(/\s+/)
);

// Place words are BOTH the header printed across the top of the card and real
// names: Washington is roughly the 140th most common US surname and West the
// 160th, and Georgia, Virginia, Dakota and Montana are ordinary given names. So
// they are rejected only where nothing vouches for the line's position. Where
// the AAMVA field number or an LN/FN label is intact, that structure says which
// field the line is and the word is taken as the name it is.
const PLACE_STOP = new Set(
  (
    "ALABAMA ALASKA ARIZONA ARKANSAS CALIFORNIA COLORADO CONNECTICUT DELAWARE " +
    "FLORIDA GEORGIA HAWAII IDAHO ILLINOIS INDIANA IOWA KANSAS KENTUCKY LOUISIANA " +
    "MAINE MARYLAND MASSACHUSETTS MICHIGAN MINNESOTA MISSISSIPPI MISSOURI MONTANA " +
    "NEBRASKA NEVADA NEW HAMPSHIRE JERSEY MEXICO YORK NORTH SOUTH CAROLINA DAKOTA " +
    "OHIO OKLAHOMA OREGON PENNSYLVANIA RHODE ISLAND TENNESSEE TEXAS UTAH VERMONT " +
    "VIRGINIA WASHINGTON WEST WISCONSIN WYOMING DISTRICT COLUMBIA PUERTO RICO GUAM"
  ).split(/\s+/)
);

// One token looks like a name part: letters (plus hyphen/apostrophe), and not a
// stopword. Single letters are allowed so a middle initial survives. Pass
// allowPlaces only where structure vouches for the line (see PLACE_STOP).
function isNameToken(t, allowPlaces = false) {
  const u = t.toUpperCase();
  if (!/^[A-Za-z][A-Za-z'’\-]*$/.test(t)) return false;
  return !CHROME_STOP.has(u) && (allowPlaces || !PLACE_STOP.has(u));
}

// A whole captured string is a plausible name: at least one token, all of them
// name tokens.
function looksLikeName(s, allowPlaces = false) {
  const toks = s.trim().split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every((t) => isNameToken(t, allowPlaces));
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
  //    leading digit; "2 ELM ST" is rejected because "ST" is a stopword. The
  //    field number says which name this is, so place words are allowed: "1
  //    WASHINGTON" is a surname, not the header.
  for (const line of lines) {
    const fam = line.match(/^1\s+([A-Za-z][A-Za-z'’\- ]{1,40})$/);
    if (fam && looksLikeName(fam[1], true)) name.last ??= titleCase(fam[1]);
    const giv = line.match(/^2\s+([A-Za-z][A-Za-z'’\- ]{1,40})$/);
    if (giv && looksLikeName(giv[1], true)) assignGiven(name, giv[1]);
  }

  // 2. Explicit text labels. Same reasoning: the label vouches for the line.
  for (const line of lines) {
    const fam = line.match(/^(?:LN|FAMILY(?:\s*NAME)?|LAST(?:\s*NAME)?)\b[.:\s]+([A-Za-z][A-Za-z'’\- ]{1,40})$/i);
    if (fam && looksLikeName(fam[1], true)) name.last ??= titleCase(fam[1]);
    const giv = line.match(/^(?:FN|GIVEN(?:\s*NAMES?)?|FIRST(?:\s*NAME)?)\b[.:\s]+([A-Za-z][A-Za-z'’\- ]{1,40})$/i);
    if (giv && looksLikeName(giv[1], true)) assignGiven(name, giv[1]);
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
 * Returns null if nothing name-like survives, or if a line is dropped in a way
 * that would make the remaining lines mean something different (see below).
 */
export function parseNameRegion(text, { requireTwoLines = false } = {}) {
  const nameLines = [];
  let anyMarked = false;
  for (const raw of text.split(/\r?\n/)) {
    // An intact AAMVA field number ("1 WEST", "2 MARIA") is structure: it says
    // which field the line is, so a place-word surname is safe here. OCR often
    // mangles the marker into punctuation (")", ">"), and then nothing vouches
    // for the line, so places stay rejected.
    const marked = /^\s*[12]\s+\S/.test(raw);
    const cleaned = raw.replace(/[^A-Za-z'’ \-]+/g, " ").trim();
    if (!cleaned) continue;
    const raws = cleaned.split(/\s+/).filter(Boolean);
    // A single letter counts only after a real token: trailing, it is a middle
    // initial; leading, it is a mangled field marker.
    const toks = raws.filter((t, i) => (t.length >= 2 || i > 0) && isNameToken(t, marked));
    // A name field holds a handful of words ("Van Der Berg" is already the long
    // end). A dozen short ones is the security-pattern background misread, which
    // is what a whole-card crop produces: pressing Read without drawing a box
    // once yielded a surname of "Ay A Ng Sy Is We Eai Os Fe Ee". Refuse the crop
    // rather than write that into a legal name.
    if (toks.length > 4) return null;
    if (toks.length) {
      if (marked) anyMarked = true;
      nameLines.push(toks);
      if (nameLines.length >= 2) break;
      continue;
    }
    // Every word on this line was rejected. Skipping it would slide the line
    // below into its slot, so a crop of "WEST / MARIA ELENA" would come back as
    // last "Maria", first "Elena": a confidently wrong name rather than a miss.
    // Stop instead and let the user redraw the box or type the name.
    if (raws.some((t) => t.length >= 2 && /^[A-Za-z][A-Za-z'’\-]*$/.test(t))) return null;
  }
  if (!nameLines.length) return null;

  const name = {};
  if (nameLines.length >= 2) {
    name.last = titleCase(nameLines[0].join(" "));
    assignGiven(name, nameLines[1].join(" "));
  } else {
    // One surviving line read as LAST FIRST [MIDDLE] is a pure guess about
    // which field is which, so callers with no human in the loop opt out (see
    // autoNameFromLines): "MARIA ELENA" is a given-names row as often as it is
    // a whole name.
    if (requireTwoLines) return null;
    const t = nameLines[0];
    if (t.length < 2) return null; // a lone token could be either name; make the user type it
    name.last = titleCase(t[0]);
    name.first = titleCase(t[1]);
    if (t.length > 2) name.middle = titleCase(t.slice(2).join(" "));
  }
  if (!name.first && !name.last) return null;
  // Short fragments ("Oe Aa Es", "Wan") clear the per-token test but are what
  // OCR makes of the background artwork, so a name with no substantial word in
  // it is not trusted. An intact AAMVA field number vouches for the line and
  // waives this, which is what keeps genuinely short names (Ng, Li) readable.
  if (!anyMarked && !Object.values(name).some((v) => /[A-Za-z]{4}/.test(v))) return null;
  return name;
}

// An automatically chosen crop has no human vouching for it, so hold it to a
// higher bar than a hand-drawn one: a real name has a substantial word, OCR
// noise off the security background ("Oos", "Hou") does not.
function isPlausibleAutoName(f) {
  if (!f || !f.first || !f.last) return false;
  const a = f.first.replace(/[^A-Za-z]/g, "");
  const b = f.last.replace(/[^A-Za-z]/g, "");
  return a.length + b.length >= 8 && Math.max(a.length, b.length) >= 4;
}

// An auto-chosen crop is padded, so OCR can catch a sliver of the neighbouring
// line as a short trailing token ("Lynne Sa"). Drop those. A trailing single
// letter is kept: that is a middle initial, not a sliver.
function trimNoisyMiddle(f) {
  if (!f?.middle) return f;
  const toks = f.middle.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && toks[toks.length - 1].length === 2) toks.pop();
  const middle = toks.join(" ");
  return middle ? { ...f, middle } : { first: f.first, last: f.last };
}

/**
 * Pick the name out of already-OCR'd text lines (no further OCR). A name is two
 * adjacent, left-aligned lines: family above given. On a real card the name sits
 * at the left edge of the data column while DOB / DL# / expiry sit further
 * right, so left-aligned pairs are considered first.
 *
 * ONLY pairs are considered. A single line has nothing saying which field it is,
 * and reading it as LAST FIRST would turn a given-names row ("MARIA ELENA")
 * into a whole name whenever the family row above it failed to read. Nobody
 * reviews an auto-chosen crop before it lands on an I-9, so the fallback here
 * is to give up and let the user box the name by hand. Two visual rows merged
 * into one detected rect still OCR as two lines, so the common case is
 * unaffected.
 *
 * `lines` is [{rect: {x, y, w, h}, text}] in document order, rects in source
 * pixels; `width` is the source image width. Returns name fields, or null.
 */
export function autoNameFromLines(lines, width) {
  if (!lines.length) return null;
  const leftEdge = Math.min(...lines.map((l) => l.rect.x));
  const nearLeft = (c) => c.rect.x - leftEdge < width * 0.06;
  const cands = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    if (
      b.rect.y - (a.rect.y + a.rect.h) < a.rect.h * 1.2 &&
      Math.abs(a.rect.x - b.rect.x) < width * 0.03
    )
      cands.push({ rect: a.rect, text: `${a.text}\n${b.text}` });
  }
  for (const c of [...cands.filter(nearLeft), ...cands.filter((x) => !nearLeft(x))]) {
    const fields = parseNameRegion(c.text, { requireTwoLines: true });
    if (isPlausibleAutoName(fields)) return trimNoisyMiddle(fields);
  }
  return null;
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

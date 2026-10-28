// Pulls the SSN (and name, when legible) from OCR text of a Social Security card.

export function parseSsnCard(ocrText) {
  const out = {};
  const ssn = findSsn(ocrText);
  if (ssn) out.ssn = ssn;

  // The cardholder name is printed below the number. Take the first line that
  // looks like a name: 2-4 capitalized words, allowing a single-letter middle
  // initial (with optional period), no digits, and not boilerplate.
  // Whole words only: "CARD" must not skip CARDENAS, nor "WORK" WORKMAN.
  const skip = /\b(?:SOCIAL|SECURITY|ADMINISTRATION|UNITED|STATES|AMERICA|NUMBER|SIGNATURE|THIS|CARD|VALID|WORK|EMPLOYMENT|ONLY|PURPOSE)\b/i;
  for (const line of ocrText.split(/\r?\n/)) {
    const t = line.trim().replace(/\s+/g, " ");
    if (!t || /\d/.test(t) || skip.test(t)) continue;
    if (/^[A-Z][A-Za-z'-]+(?:\s+(?:[A-Z]\.?|[A-Z][A-Za-z'-]+)){1,3}$/.test(t)) {
      const parts = t.replace(/\./g, "").split(/\s+/);
      Object.assign(out, splitCardName(parts));
      break;
    }
  }
  return Object.keys(out).length ? out : null;
}

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV"]);
// Surname particles: a name containing one has a multi-word surname whose start
// cannot be told from a middle name.
const PARTICLES = new Set(["DE", "LA", "LE", "EL", "DEL", "DELA", "DI", "DA", "DOS", "DAS", "DU", "VAN", "VON", "DER", "DEN", "SAN", "ST", "BIN", "BEN", "AL", "MAC", "O"]);

// The card prints FIRST [MIDDLE] LAST [SUFFIX]. Only unambiguous splits are
// returned; anything else yields just the first name (or nothing), never a
// guessed surname. The suffix is dropped: there is no profile field for it.
function splitCardName(parts) {
  const toks = [...parts];
  if (toks.length > 1 && SUFFIXES.has(toks[toks.length - 1].toUpperCase())) {
    toks.pop();
    // "JOHN JR" alone: a suffix with no surname before it.
    if (toks.length < 2) return {};
  }
  if (toks[0].length < 2 || PARTICLES.has(toks[0].toUpperCase())) return {};
  const first = titleCase(toks[0]);
  const last = toks[toks.length - 1];
  const middle = toks.slice(1, -1);
  const ambiguous =
    last.length < 2 || // a trailing initial is not a surname
    toks.slice(1).some((t) => PARTICLES.has(t.toUpperCase())) ||
    middle.length > 1;
  if (ambiguous) return { first };
  const out = { first, last: titleCase(last) };
  if (middle.length) out.middle = titleCase(middle[0]);
  return out;
}

// Strong OCR look-alikes for digits, applied only on the tolerant second pass.
const LOOKALIKE = { O: "0", o: "0", Q: "0", l: "1", I: "1", "|": "1", S: "5", B: "8", Z: "2" };
const CH = "0-9OoQlI|SBZ";

function findSsn(text) {
  // Real digits first (the common case): least chance of a false positive.
  for (const m of text.matchAll(/(?<![0-9])(\d{3})[\s.\-]?(\d{2})[\s.\-]?(\d{4})(?![0-9])/g)) {
    const d = m[1] + m[2] + m[3];
    if (plausibleSsn(d)) return fmtSsn(d);
  }
  // Then tolerate common OCR letter-for-digit confusions (I->1, S->5, ...).
  const re = new RegExp(`(?<![${CH}])([${CH}]{3})[\\s.\\-]?([${CH}]{2})[\\s.\\-]?([${CH}]{4})(?![${CH}])`, "g");
  for (const m of text.matchAll(re)) {
    const d = (m[1] + m[2] + m[3]).replace(/[A-Za-z|]/g, (c) => LOOKALIKE[c] ?? c);
    if (/^\d{9}$/.test(d) && plausibleSsn(d)) return fmtSsn(d);
  }
  return "";
}

// Reject groupings the SSA never issues, so a stray number (a date, a phone
// number) is not mistaken for an SSN.
function plausibleSsn(d) {
  const area = +d.slice(0, 3);
  const group = +d.slice(3, 5);
  const serial = +d.slice(5);
  return area !== 0 && area !== 666 && area < 900 && group !== 0 && serial !== 0;
}

function fmtSsn(d) {
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function titleCase(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'])\w/g, (c) => c.toUpperCase());
}

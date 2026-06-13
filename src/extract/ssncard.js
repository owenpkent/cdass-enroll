// Pulls the SSN (and name, when legible) from OCR text of a Social Security card.

export function parseSsnCard(ocrText) {
  const out = {};
  const ssn = findSsn(ocrText);
  if (ssn) out.ssn = ssn;

  // The cardholder name is printed in caps below the number. Look for the
  // first line that is 2+ capitalized words and not boilerplate.
  const skip = /SOCIAL|SECURITY|ADMINISTRATION|UNITED|STATES|AMERICA|NUMBER|SIGNATURE|THIS|CARD/i;
  for (const line of ocrText.split(/\r?\n/)) {
    const t = line.trim();
    if (/^[A-Z][A-Za-z.'-]+(\s+[A-Z][A-Za-z.'-]+)+$/.test(t) && !skip.test(t)) {
      const parts = t.split(/\s+/);
      out.first = titleCase(parts[0]);
      out.last = titleCase(parts[parts.length - 1]);
      if (parts.length > 2) out.middle = titleCase(parts.slice(1, -1).join(" "));
      break;
    }
  }
  return Object.keys(out).length ? out : null;
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

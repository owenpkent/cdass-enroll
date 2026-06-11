// Pulls the SSN (and name, when legible) from OCR text of a Social Security card.

export function parseSsnCard(ocrText) {
  const out = {};
  const ssn = ocrText.match(/\b(\d{3})[\s-]?(\d{2})[\s-]?(\d{4})\b/);
  if (ssn) out.ssn = `${ssn[1]}-${ssn[2]}-${ssn[3]}`;

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

function titleCase(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'])\w/g, (c) => c.toUpperCase());
}

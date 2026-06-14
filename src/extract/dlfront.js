// Best-effort extraction from OCR of the FRONT of a US driver's license.
// License fronts are not standardized across states, so this is heuristic and
// every value must be verified. It pulls the date of birth and the address; the
// name is read more reliably from the Social Security card and is left to that.

export function parseLicenseFront(ocrText) {
  const out = {};
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Date of birth: the earliest plausible date on the card. Issue and expiry
  // dates are more recent, so the oldest is the birth date; a line that says
  // DOB/BIRTH wins outright.
  const dates = [];
  for (const line of lines) {
    for (const m of line.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/g)) {
      const mm = +m[1];
      const dd = +m[2];
      const yy = +m[3];
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yy < 1900 || yy > 2100) continue;
      dates.push({ iso: `${yy}-${pad(mm)}-${pad(dd)}`, yy, labeled: /DOB|BIRTH/i.test(line) });
    }
  }
  if (dates.length) {
    const labeled = dates.find((d) => d.labeled);
    out.dob = (labeled ?? dates.reduce((a, b) => (b.yy < a.yy ? b : a))).iso;
  }

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

function pad(n) {
  return String(n).padStart(2, "0");
}

function titleCase(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'])\w/g, (c) => c.toUpperCase());
}

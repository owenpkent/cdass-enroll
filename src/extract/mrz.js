// Parses the two-line TD3 MRZ from the photo page of a passport
// (the two lines of <<< text at the bottom). Input is raw OCR text.

export function parseMrz(ocrText) {
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s/g, "").toUpperCase().replace(/«/g, "<<"))
    .filter((l) => l.length >= 40 && /[A-Z0-9<]{40,}/.test(l));

  const l1 = lines.find((l) => /^P[A-Z<]/.test(l));
  const l2i = lines.indexOf(l1);
  const l2 = lines.slice(l2i + 1).find((l) => /^[A-Z0-9<]{9}[0-9OIL]/.test(l));
  if (!l1 || !l2) return null;

  const line1 = pad44(l1);
  const line2 = pad44(fixNumericSpans(l2));

  const names = line1.slice(5).split("<<");
  const last = names[0]?.replace(/</g, " ").trim() ?? "";
  const givenParts = (names[1] ?? "").split("<").filter(Boolean);

  const passportNumber = line2.slice(0, 9).replace(/</g, "");
  const numberOk = checksum(line2.slice(0, 9)) === line2[9];
  const dob = mrzDate(line2.slice(13, 19), true);
  const dobOk = checksum(line2.slice(13, 19)) === line2[19];
  const expiry = mrzDate(line2.slice(21, 27), false);
  const expiryOk = checksum(line2.slice(21, 27)) === line2[27];

  // The MRZ also carries sex and issuing country. No form field asks for them,
  // so they are not returned: anything returned here is written into the
  // profile and persisted to localStorage.
  const out = {
    last: titleCase(last),
    first: titleCase(givenParts[0] ?? ""),
    middle: titleCase(givenParts.slice(1).join(" ")),
  };
  if (passportNumber && numberOk) out.passportNumber = passportNumber;
  if (dob && dobOk) out.dob = dob;
  if (expiry && expiryOk) out.passportExpiration = expiry;
  // Report unchecked values too, but flag them so the UI can warn.
  if (passportNumber && !numberOk) out.passportNumberUnverified = passportNumber;
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return Object.keys(out).length ? out : null;
}

function pad44(l) {
  return (l + "<".repeat(44)).slice(0, 44);
}

// Common OCR confusions, repaired ONLY in the spans that are purely numeric in
// TD3 line 2: the check digit after the document number (9), DOB and its check
// digit (13-19), expiry and its check digit (21-27), and the final two check
// digits (42-43). The document number, nationality and optional data are
// alphanumeric, so "fixing" them is a guess: L12345678 -> 112345678 passes the
// same check digit (L=21 and 1=1 are equal mod 10) and would mark a wrong
// passport number verified. Left as read, a misread there fails its check and
// is reported unverified instead.
function fixNumericSpans(l) {
  const chars = l.split("");
  const fix = (from, to) => {
    for (let i = from; i < to && i < chars.length; i++) {
      if (chars[i] === "O") chars[i] = "0";
      else if (chars[i] === "I" || chars[i] === "L") chars[i] = "1";
    }
  };
  fix(9, 10);
  fix(13, 20);
  fix(21, 28);
  fix(42, 44);
  return chars.join("");
}

function mrzDate(yymmdd, isDob) {
  if (!/^\d{6}$/.test(yymmdd)) return "";
  const yy = Number(yymmdd.slice(0, 2));
  const nowYY = new Date().getFullYear() % 100;
  // DOBs are in the past; expiry dates are within ~10 years either way.
  const century = isDob ? (yy > nowYY ? 1900 : 2000) : yy > nowYY + 15 ? 1900 : 2000;
  return `${century + yy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

function checksum(s) {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const v = c === "<" ? 0 : c >= "0" && c <= "9" ? Number(c) : c.charCodeAt(0) - 55;
    sum += v * w[i % 3];
  }
  return String(sum % 10);
}

function titleCase(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'])\w/g, (c) => c.toUpperCase());
}

// Parses the two-line TD3 MRZ from the photo page of a passport
// (the two lines of <<< text at the bottom). Input is raw OCR text.

export function parseMrz(ocrText) {
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s/g, "").toUpperCase().replace(/«/g, "<<"))
    .filter((l) => l.length >= 40 && /[A-Z0-9<]{40,}/.test(l));

  const l1 = lines.find((l) => /^P[A-Z<]/.test(l));
  const l2i = lines.indexOf(l1);
  const l2 = lines.slice(l2i + 1).find((l) => /^[A-Z0-9<]{9}\d/.test(l));
  if (!l1 || !l2) return null;

  const line1 = pad44(l1);
  const line2 = pad44(fixDigits(l2));

  const names = line1.slice(5).split("<<");
  const last = names[0]?.replace(/</g, " ").trim() ?? "";
  const givenParts = (names[1] ?? "").split("<").filter(Boolean);

  const passportNumber = line2.slice(0, 9).replace(/</g, "");
  const numberOk = checksum(line2.slice(0, 9)) === line2[9];
  const dob = mrzDate(line2.slice(13, 19), true);
  const dobOk = checksum(line2.slice(13, 19)) === line2[19];
  const sex = line2[20];
  const expiry = mrzDate(line2.slice(21, 27), false);
  const expiryOk = checksum(line2.slice(21, 27)) === line2[27];
  const country = line2.slice(10, 13).replace(/</g, "");

  const out = {
    last: titleCase(last),
    first: titleCase(givenParts[0] ?? ""),
    middle: titleCase(givenParts.slice(1).join(" ")),
    gender: sex === "M" ? "male" : sex === "F" ? "female" : "",
    passportCountry: country,
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

// Common OCR confusions in the numeric-ish middle of line 2.
function fixDigits(l) {
  return l.replace(/O/g, "0").replace(/(?<=\d)[IL]|[IL](?=\d)/g, "1");
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

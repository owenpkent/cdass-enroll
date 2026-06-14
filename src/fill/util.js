// Tolerant helpers around pdf-lib's form API: a missing or renamed field in a
// future template revision should degrade to a skipped field, not a crash.

export function setText(form, name, value) {
  if (value == null || value === "") return;
  const v = String(value);
  try {
    form.getTextField(name).setText(v);
    return;
  } catch {
    /* maybe a dropdown (e.g. the standalone I-9 State field) */
  }
  try {
    const dd = form.getDropdown(name);
    const match = dd.getOptions().find((o) => o.toLowerCase() === v.toLowerCase());
    if (match) dd.select(match);
    else console.warn("dropdown has no option:", name, v);
  } catch (e) {
    console.warn("field not set:", name, e.message);
  }
}

export function check(form, name, on = true) {
  if (!on) return;
  try {
    form.getCheckBox(name).check();
  } catch (e) {
    console.warn("checkbox not set:", name, e.message);
  }
}

// Handles both real radio groups and same-name checkbox pairs.
export function selectButton(form, name, option) {
  if (!option) return;
  try {
    const group = form.getRadioGroup(name);
    const match = group.getOptions().find((o) => o.toLowerCase() === option.toLowerCase());
    if (match) group.select(match);
    return;
  } catch {
    /* not a radio group */
  }
  check(form, name);
}

/** Find a field by the tail of its fully qualified name (for XFA-style names). */
export function bySuffix(form, suffix) {
  return form.getFields().find((f) => f.getName().endsWith(suffix));
}

export function fmtDate(iso) {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

export function fmtSsn(ssn) {
  const d = (ssn ?? "").replace(/\D/g, "");
  return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : ssn ?? "";
}

/**
 * Draw a signature image (a PNG data URL) onto the given placements. Each
 * placement is {page (0-indexed), x, y, w, h} in PDF points; the image is scaled
 * to the box height, capped to its width, preserving aspect ratio. No-op without
 * a data URL, and a non-PNG is skipped rather than crashing.
 */
export async function overlaySignature(doc, dataUrl, placements) {
  if (!dataUrl) return;
  let png;
  try {
    png = await doc.embedPng(dataUrl);
  } catch {
    return;
  }
  const ratio = png.width / png.height || 1;
  for (const pl of placements) {
    const page = doc.getPage(pl.page);
    let h = pl.h;
    let w = h * ratio;
    if (w > pl.w) {
      w = pl.w;
      h = w / ratio;
    }
    page.drawImage(png, { x: pl.x, y: pl.y, width: w, height: h });
  }
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

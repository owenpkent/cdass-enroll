// Tolerant helpers around pdf-lib's form API: a missing or renamed field in a
// future template revision should degrade to a skipped field, not a crash.

import { PDFName, PDFString, PDFArray, PDFDict, PDFRef } from "pdf-lib";

export function setText(form, name, value) {
  if (value == null || value === "") return;
  const v = String(value);
  try {
    form.getTextField(name).setText(v);
    return;
  } catch (e) {
    // pdf-lib refuses a value longer than the field's MaxLen. Say so by name:
    // the box otherwise just stays blank on the printed form.
    let tf = null;
    try {
      tf = form.getTextField(name);
    } catch {
      /* not a text field: maybe a dropdown (e.g. the standalone I-9 State field) */
    }
    if (tf) {
      const max = tf.getMaxLength();
      console.warn(`field not set: "${name}" value length ${v.length}, MaxLen ${max ?? "none"} (${e.message})`);
      return;
    }
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

// `on` deliberately has no default. Guards at the call sites read like
// `p.fullTimeStudent && age < 18`, which evaluates to undefined when the key is
// absent from the profile, and a default of `true` turns that missing data into
// a checked attestation. Callers that always mean "check it" pass true.
export function check(form, name, on) {
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
  check(form, name, true);
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
 * Inverse of fmtDate, for reading a filled form back: "06/06/1986" -> "1986-06-06".
 * Anything that is not exactly mm/dd/yyyy returns "" rather than echoing junk
 * into a date input, since a filled PDF is typed by hand and holds anything.
 */
export function isoDate(us) {
  const m = String(us ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

/** Inverse of fmtSsn: "123-45-6789" -> "123456789". The profile stores digits. */
export function ssnDigits(ssn) {
  return String(ssn ?? "").replace(/\D/g, "");
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

/**
 * Give one widget of a multi-widget field its own field. Some template fields
 * are a single field with several widgets (same name, several pages), so
 * writing one value writes every widget. This detaches the widget on
 * `pageIndex` whose parent field is named `parentName` into a standalone text
 * field called `newName`, leaving the other widgets on the original field.
 * Call before doc.getForm(). Returns true when a widget was split off.
 */
export function splitWidgetToOwnField(doc, pageIndex, parentName, newName) {
  const annots = doc.getPage(pageIndex).node.Annots();
  const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const fields = acro?.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (!annots || !fields) return false;
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    const widget = annots.lookupMaybe(i, PDFDict);
    const parent = widget?.lookupMaybe(PDFName.of("Parent"), PDFDict);
    const t = parent?.get(PDFName.of("T"));
    if (!(ref instanceof PDFRef) || !t || t.decodeText?.() !== parentName) continue;
    const kids = parent.lookupMaybe(PDFName.of("Kids"), PDFArray);
    for (let j = 0; kids && j < kids.size(); j++)
      if (kids.get(j) === ref || String(kids.get(j)) === String(ref)) {
        kids.remove(j);
        break;
      }
    widget.delete(PDFName.of("Parent"));
    widget.set(PDFName.of("FT"), PDFName.of("Tx"));
    widget.set(PDFName.of("T"), PDFString.of(newName));
    widget.set(PDFName.of("DA"), PDFString.of("/Helv 0 Tf 0 g"));
    widget.delete(PDFName.of("AP")); // regenerated by updateFieldAppearances
    fields.push(ref);
    return true;
  }
  return false;
}

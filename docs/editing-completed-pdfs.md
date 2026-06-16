# Editing values on an already-completed PDF

This app fills blank templates. Sometimes a packet is already filled and
signed (sitting in the Completed Enrollment Paperwork folder) and one value
needs to change: a pay rate, a date, a corrected typo. Those files were
usually filled with **Adobe Acrobat Fill & Sign**, not this app, and Fill &
Sign does not leave editable form fields behind. This note records how to
make a clean surgical edit when that happens.

Everything here uses local dev-side Python only (the same posture as the rest
of the project: no network, no upload of member data to any service).

## Why these PDFs are awkward

A Fill & Sign PDF looks fillable but is not an AcroForm. The typed values are
baked into nested Form XObjects and the document carries an `/ADBE_FillSignInfo`
key in its root. Practical consequences:

- `pypdf`'s `reader.get_fields()` returns nothing. There are no widgets to set.
- The values still render and still extract as text, but they live inside
  XObjects, so a naive text-position read reports them at the origin (0,0).
- There is no empty field to type into for a value that was left blank (e.g.
  an Emergency Rate box), so a new value has to be drawn on, not "set".

So the edit is: **remove the old drawn text, draw the new text in the same
spot**, without disturbing the table borders around it.

## Tools

| Tool | Role |
| --- | --- |
| `pypdf` | Confirm there are no AcroForm fields; detect `/ADBE_FillSignInfo`. |
| `pdfminer.six` | Read precise device coordinates of every glyph, resolving the nested XObjects automatically. |
| `PyMuPDF` (`fitz`) | Render crops to verify, read border line positions, redact old text, draw new text. |

Install on demand: `pip install pypdf pdfminer.six pymupdf`.

## Coordinate systems (the thing that bites)

- **pdfminer** uses PDF coordinates: origin bottom-left, y increases upward.
- **PyMuPDF** uses image coordinates: origin top-left, y increases downward.
- Convert between them with `y_fitz = page_height - y_pdf` (page height is 792
  for US Letter).

Digits sit *on* the baseline with no descender, so a digit's tight glyph
bottom equals its baseline. That is the y to reuse when drawing a replacement
so it lands exactly where the old value was.

## Procedure

### 1. Confirm it is a Fill & Sign PDF, not a form

```python
import pypdf
r = pypdf.PdfReader(path)
print(r.get_fields())              # None / empty  -> not an AcroForm
print(list(r.trailer["/Root"]))    # look for '/ADBE_FillSignInfo'
```

If `get_fields()` returns real fields, stop: just set the field values with
`pypdf` (the normal app path), no redaction needed.

### 2. Find the exact value and its box

Get glyph coordinates with pdfminer (resolves nested XObjects):

```python
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar
def chars(layout):
    for el in layout:
        if isinstance(el, LTChar) and el.get_text().strip():
            yield round(el.x0,1), round(el.y0,1), round(el.size,1), el.get_text()
        elif hasattr(el, "__iter__"):
            yield from chars(el)
```

Then in `fitz`, `page.search_for("$20")` gives the rect in image coordinates,
and `page.get_drawings()` gives the surrounding table border line segments.
Read the borders so the redaction rectangle can stay just inside them. The
digit baseline often coincides with the box's bottom border, which is exactly
why the next step removes text only.

### 3. Render before you edit

```python
clip = fitz.Rect(x0, 792-y_top, x1, 792-y_bot)
page.get_pixmap(matrix=fitz.Matrix(5,5), clip=clip).save("scratch.png")
```

Open the PNG and confirm which cell holds the value and what the cell
background is. (Header rows are often shaded; data rows are usually white,
which is what makes a blank-background redaction blend in.)

### 4. Redact text only, then draw the new value

The key trick: remove the old glyphs without erasing the table lines.

```python
import fitz
doc  = fitz.open(src)
page = doc[0]

# Remove old text. Generous rect is fine because line art is preserved.
page.add_redact_annot(fitz.Rect(x0, y0, x1, y1), fill=False)
page.apply_redactions(graphics=fitz.PDF_REDACT_LINE_ART_NONE)  # keep borders

# Draw the replacement on the SAME baseline, matching font + size.
page.insert_text((x_left, baseline_y), "$22.50",
                 fontsize=12, fontname="helv", color=(0, 0, 0))

doc.save(dst, garbage=4, deflate=True)
```

`fill=False` plus `PDF_REDACT_LINE_ART_NONE` is what protects the borders:
the redaction deletes the intersecting text but paints nothing and touches no
vector graphics, so the cell lines survive even when the redaction rectangle
overlaps them. Fill & Sign text is Helvetica, so `fontname="helv"` at the
matched point size reproduces the look.

### 5. Verify and clean up

Re-render the edited region and the full page. Check that the new value is
aligned, the old value is gone from the text layer
(`"$20" in page.get_text()` is `False`), and untouched fields still extract.
Delete any scratch PNGs.

## Rules for this folder

- **Never overwrite the original completed file.** Write a new copy. Name it
  with the date of the edit: `<name> rate-form YYYY-MM-DD.pdf`.
- **Match the form's existing date format.** These PPL forms use `M/D/YY`.
- **Do not fabricate signatures.** Only redraw values the user asked for.
- **Watch the domain rules, not just the pixels:**
  - A rate-change form must reach PPL at least 7 days before the pay period
    the new rate should take effect, so a same-day effective date may be
    rejected. Set the effective date forward if needed.
  - If the form is already signed, changing a value after signing means the
    signatures no longer match what was signed. Flag it; the parties may need
    to re-sign and re-date rather than just submit a re-dated file.

## Change log

Real edits involve a real member and attendant: their names, PPL IDs, and pay
rates. This repository is **public**, so do not record actual edits here. Keep
the real log in a file next to the paperwork instead (for example an
`EDIT-LOG.md` in the person's folder, which stays out of version control). The
row below is only a format example, using the project's fictional Jane Doe.

| Date | Source file | Output file | Change |
| --- | --- | --- | --- |
| 2026-01-15 | `JANE rate-form.pdf` | `JANE rate-form 2026-01-15.pdf` | Standard Rate `$20.00` -> `$22.50`; Emergency Rate (blank) -> `$30.00`; effective + both signature dates -> `1/15/26`. |

// Shared fixtures and helpers for the browser UI tests.
//
// Every test gets two guarantees for free (the `guard` fixture is automatic):
// - nothing leaves 127.0.0.1. Any other request is aborted and recorded, and
//   the test fails at teardown. This is the privacy promise, checked in a real
//   browser rather than trusted to the CSP.
// - no console errors or uncaught exceptions, which is also where a CSP
//   violation shows up.
// public/seed.local.json holds real details on the developer's machine, so it is
// answered with a 404 here: tests only ever see the fictional Jane Doe.
import { test as base, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFCheckBox, PDFTextField } from "pdf-lib";

export { expect };

export const test = base.extend({
  guard: [
    async ({ page }, use) => {
      const external = [];
      const errors = [];
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== "127.0.0.1") {
          external.push(url.href);
          return route.abort();
        }
        if (url.pathname.endsWith("/seed.local.json")) return route.fulfill({ status: 404, body: "" });
        return route.continue();
      });
      page.on("console", (m) => {
        // The 404 for the seed file is ours (above), not the app's.
        if (m.type() === "error" && !m.location().url.endsWith("/seed.local.json")) errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      // Start over and backup export ask confirm(); answer yes like a user would.
      page.on("dialog", (d) => d.accept());
      await use({ external, errors });
      expect(external, "requests that tried to leave this computer").toEqual([]);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});

// The fictional attendant and Member the whole suite types in, shared with
// tests/smoke.mjs, plus every value the filled packet must carry for them.
export { PROFILE, EMPLOYER, OPTS, EXPECTED_PACKET } from "../tests/fixtures/complete-packet.mjs";
import { PROFILE, EMPLOYER } from "../tests/fixtures/complete-packet.mjs";

/** The input, select or checkbox bound to a schema key. */
export const field = (page, key) => page.locator(`[data-key="${key}"]`);

/**
 * Enter values the way a person would: type into text boxes, pick from
 * dropdowns, tick checkboxes. Keys are in schema order, so a box that reveals a
 * section (mailing address, direct deposit) is set before that section's fields.
 * Blank values are skipped, since every field starts blank.
 */
export async function fillFields(page, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === "") continue;
    const el = field(page, key);
    const kind = await el.evaluate((e) => (e.tagName === "SELECT" ? "select" : e.type));
    if (kind === "checkbox") await el.setChecked(!!value);
    else if (kind === "select") await el.selectOption(String(value));
    else await el.fill(String(value));
  }
}

export async function openApp(page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Step 1: Their information" })).toBeVisible();
}

/** Enter the Member and employer of record under Your details, then return. */
export async function enterYourDetails(page, values = EMPLOYER) {
  await page.getByRole("button", { name: "⚙ Your details" }).click();
  await fillFields(page, values);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible();
  await page.getByRole("button", { name: "← Back to enrollment" }).click();
}

/** Enter the fixture attendant once, every field of them. */
export async function enterAttendant(page, values = PROFILE) {
  await fillFields(page, values);
}

/**
 * Click Generate and collect every PDF it downloads, keyed by filename, as
 * parsed pdf-lib documents.
 */
export async function generate(page, expectedCount) {
  const downloads = [];
  const onDownload = (d) => downloads.push(d);
  page.on("download", onDownload);
  await page.getByRole("button", { name: "Generate & download" }).click();
  await expect(page.getByText(/^Done\. Files are in your Downloads folder/)).toBeVisible();
  await expect.poll(() => downloads.length).toBe(expectedCount);
  page.off("download", onDownload);
  const files = {};
  for (const d of downloads) {
    const path = await d.path();
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 5).toString(), d.suggestedFilename()).toBe("%PDF-");
    files[d.suggestedFilename()] = { path, doc: await PDFDocument.load(bytes) };
  }
  return files;
}

/** Field values from a filled PDF: text as a string, checkboxes as booleans. */
export function readFields(doc, names) {
  const form = doc.getForm();
  const out = {};
  for (const name of names) {
    const f = form.getFieldMaybe(name);
    if (f instanceof PDFTextField) out[name] = f.getText() ?? "";
    else if (f instanceof PDFCheckBox) out[name] = f.isChecked();
    else out[name] = undefined;
  }
  return out;
}

/** Every non-empty text value in a filled PDF (for forms with opaque field names). */
export function allText(doc) {
  return doc
    .getForm()
    .getFields()
    .filter((f) => f instanceof PDFTextField)
    .map((f) => f.getText())
    .filter(Boolean);
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoAxeViolations(page, label) {
  const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const found = r.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`));
  expect(found, `${label}: accessibility violations`).toEqual([]);
}

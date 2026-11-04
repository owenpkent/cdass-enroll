// The main path: type an attendant in once, generate, and read the PDFs back.
// The attendant, the Member, and every expected packet value come from the
// shared fixture, tests/fixtures/complete-packet.mjs.
import {
  test,
  expect,
  PROFILE,
  OPTS,
  EXPECTED_PACKET,
  field,
  openApp,
  enterYourDetails,
  enterAttendant,
  generate,
  readFields,
  allText,
  documentId,
  pageDraws,
} from "./support.mjs";

const PACKET = "Doe-Jane-CDASS-packet-2026.pdf";
const W4 = "Doe-Jane-W4.pdf";

/** Set the Generate options the fixture was filled with. */
async function setDates(page) {
  await page.getByLabel("Signature date (printed on each form)").fill(OPTS.signatureDate);
  await page.getByLabel("First day of employment (I-9 / W-4)").fill(OPTS.firstDay);
}

test("there is no document scanning: the person is typed in", async ({ page }) => {
  await openApp(page);
  // The only file input on the enrollment page is the optional PDF import.
  const inputs = page.locator('input[type="file"]');
  await expect(inputs).toHaveCount(1);
  await expect(inputs).toHaveAttribute("accept", "application/pdf,.pdf");
  await expect(page.locator('input[accept^="image/"]')).toHaveCount(0);
  // The old scan tiles' captions.
  for (const gone of ["Back of card (most accurate)", "Photo page, straight on", "Front, well lit"]) {
    await expect(page.getByText(gone)).toHaveCount(0);
  }
  await expect(page.getByText(/\bOCR\b|barcode/i)).toHaveCount(0);
});

test("entered once, the details fill every field of the packet", async ({ page }) => {
  await openApp(page);
  await enterYourDetails(page);
  await enterAttendant(page);
  await setDates(page);

  const files = await generate(page, 2);
  expect(Object.keys(files).sort()).toEqual([PACKET, W4]);

  const packet = files[PACKET].doc;
  // Still the full, editable packet: generating never flattens or drops pages.
  expect(packet.getPageCount()).toBe(29);
  // Field for field, the same table the Node smoke test checks.
  expect(readFields(packet, Object.keys(EXPECTED_PACKET))).toEqual(EXPECTED_PACKET);

  // The W-4's field names are opaque XFA paths, so look for the values instead.
  const w4 = allText(files[W4].doc);
  expect(w4).toEqual(expect.arrayContaining(["Jane M", "Doe", "123-45-6789"]));
  expect(w4.join(" ")).toContain("1234 Main St");
  // The W-4 has no Date field: the signature date is drawn on the Step 5 line.
  expect(pageDraws(files[W4].doc, 0, "06/11/2026")).toBe(true);
});

test("every download is its own document, not a copy of the template's identity", async ({ page }) => {
  // Viewers file their own annotations under the PDF's /ID. A shared ID put a
  // signature added in the viewer to one person's W-4 onto every later W-4.
  await openApp(page);
  await enterAttendant(page);
  const first = await generate(page, 2);
  const second = await generate(page, 2);
  for (const name of [PACKET, W4]) {
    const a = documentId(first[name].doc);
    const b = documentId(second[name].doc);
    expect(a, name).not.toBe("");
    expect(a.split("|")[0], name).not.toBe(b.split("|")[0]);
  }
});

test("a rate that is not dollars and cents blocks Generate", async ({ page }) => {
  await openApp(page);
  await enterAttendant(page);
  await field(page, "rateStandardCdass").fill("33.517");
  // The inline complaint shows, and the typed value is never rounded.
  await expect(field(page, "rateStandardCdass")).toHaveValue("33.517");

  let downloaded = false;
  page.on("download", () => (downloaded = true));
  await page.getByRole("button", { name: "Generate & download" }).click();
  await expect(page.locator(".status.err", { hasText: /^Standard rate/ })).toBeVisible();
  expect(downloaded).toBe(false);
});

test("Your details are kept across a restart; the attendant is not", async ({ page }) => {
  await openApp(page);
  await enterYourDetails(page);
  await field(page, "first").fill(PROFILE.first);
  await page.reload();

  await expect(field(page, "first")).toHaveValue("");
  await page.getByRole("button", { name: "⚙ Your details" }).click();
  await expect(field(page, "memberFirst")).toHaveValue("Owen");
  await expect(field(page, "employerLast")).toHaveValue("Kent");
});

test("a packet filled earlier reads back in after Start over", async ({ page }) => {
  await openApp(page);
  await enterYourDetails(page);
  await enterAttendant(page);
  const files = await generate(page, 2);

  await page.getByRole("button", { name: "Keep for now" }).click();
  await page.getByRole("button", { name: "Start over (new person)" }).click();
  await expect(field(page, "last")).toHaveValue("");

  await page.getByText("Optional: start from a packet you already filled").click();
  await page.locator('input[type="file"]').setInputFiles(files[PACKET].path);
  await expect(page.getByText(/^Previous packet: filled \d+ fields/)).toBeVisible();
  for (const key of ["first", "middle", "last", "ssn", "dob", "street", "email", "cellPhone", "routing", "account", "rateStandardCdass"]) {
    await expect(field(page, key), key).toHaveValue(PROFILE[key]);
  }
  await expect(field(page, "relationship")).toHaveValue(PROFILE.relationship);
  await expect(field(page, "allowText")).toHaveValue(PROFILE.allowText);
});

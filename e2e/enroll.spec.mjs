// The main path: type an attendant in once, generate, and read the PDFs back.
import {
  test,
  expect,
  JANE,
  field,
  openApp,
  enterYourDetails,
  enterJane,
  generate,
  readFields,
  allText,
} from "./support.mjs";

const PACKET = "Doe-Jane-CDASS-packet-2026.pdf";
const W4 = "Doe-Jane-W4.pdf";
const PROFILE = JANE;

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

test("entered once, the details fill every form", async ({ page }) => {
  await openApp(page);
  await enterYourDetails(page);
  await enterJane(page);
  await page.getByLabel("First day of employment (I-9 / W-4)").fill("2026-06-15");

  const files = await generate(page, 2);
  expect(Object.keys(files).sort()).toEqual([PACKET, W4]);

  const packet = files[PACKET].doc;
  // Still the full, editable packet: generating never flattens or drops pages.
  expect(packet.getPageCount()).toBe(28);
  const f = readFields(packet, [
    "Member Name: first and last",
    "Attendant Name: first, middle and last",
    "Attendant date of birth",
    "Attendant Social Security Number",
    "Attendant physical address, not PO Box",
    "Attendant email",
    "Bank or money app name",
    "Routing number 1",
    "CDASS Standard Rate",
    "CDASS Emergency Rate",
    "NonRelative",
    "Checking Account",
    "Last Name (Family Name)",
    "List B Document Number 1",
    "List C Document Number 1",
    "CB_1",
    "Last Name First Name and Title of Employer or Authorized Representative",
  ]);
  expect(f).toEqual({
    "Member Name: first and last": "Owen Kent",
    "Attendant Name: first, middle and last": "Jane Marie Doe",
    "Attendant date of birth": "06/06/1986",
    "Attendant Social Security Number": "123-45-6789",
    "Attendant physical address, not PO Box": JANE.street,
    "Attendant email": JANE.email,
    "Bank or money app name": JANE.bankName,
    "Routing number 1": "1",
    "CDASS Standard Rate": "20.00",
    "CDASS Emergency Rate": "45",
    NonRelative: true,
    "Checking Account": true,
    "Last Name (Family Name)": "Doe",
    "List B Document Number 1": JANE.dlNumber,
    "List C Document Number 1": JANE.ssn,
    CB_1: true,
    "Last Name First Name and Title of Employer or Authorized Representative": "Kent, Owen, Employer",
  });

  // The W-4's field names are opaque XFA paths, so look for the values instead.
  const w4 = allText(files[W4].doc);
  expect(w4).toEqual(expect.arrayContaining(["Jane M", "Doe"]));
  expect(w4.join(" ")).toContain("1234 Main St");
});

test("a rate that is not dollars and cents blocks Generate", async ({ page }) => {
  await openApp(page);
  await enterJane(page);
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

test("the signature is never stamped without a fresh tick", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText(/No signature is on file/)).toBeVisible();
  await expect(page.getByLabel("Stamp this signature on the employer signature lines")).toHaveCount(0);
});

test("a packet filled earlier reads back in after Start over", async ({ page }) => {
  await openApp(page);
  await enterYourDetails(page);
  await enterJane(page);
  const files = await generate(page, 2);

  await page.getByRole("button", { name: "Keep for now" }).click();
  await page.getByRole("button", { name: "Start over (new person)" }).click();
  await expect(field(page, "last")).toHaveValue("");

  await page.getByText("Optional: start from a packet you already filled").click();
  await page.locator('input[type="file"]').setInputFiles(files[PACKET].path);
  await expect(page.getByText(/^Previous packet: filled \d+ fields/)).toBeVisible();
  await expect(field(page, "first")).toHaveValue("Jane");
  await expect(field(page, "last")).toHaveValue("Doe");
  // The packet's I-9 copy holds the SSN as bare digits; every filler formats it.
  await expect(field(page, "ssn")).toHaveValue(JANE.ssn.replace(/-/g, ""));
  await expect(field(page, "rateStandardCdass")).toHaveValue("20.00");
});

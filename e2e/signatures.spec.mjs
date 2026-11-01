// Signatures made in the page: typed or drawn, each behind its own consent tick.
import { PDFName } from "pdf-lib";
import { test, expect, field, openApp, enterYourDetails, enterAttendant, generate } from "./support.mjs";

const PACKET = "Doe-Jane-CDASS-packet-2026.pdf";
const W4 = "Doe-Jane-W4.pdf";

/** 1-based pages that drew more images than in `base`. */
function pagesWithNewImages(base, doc) {
  const counts = doc.getPages().map((pg) => pg.node.Resources()?.lookup(PDFName.of("XObject"))?.keys().length ?? 0);
  return counts.map((n, i) => (n > base[i] ? i + 1 : 0)).filter(Boolean);
}
const imageCounts = (doc) => doc.getPages().map((pg) => pg.node.Resources()?.lookup(PDFName.of("XObject"))?.keys().length ?? 0);

const attendant = (page) => page.locator("h3", { hasText: "Attendant signature" }).locator("xpath=following-sibling::*[1]");
const employerSig = (page) => page.locator("h3", { hasText: "Employer signature" }).locator("xpath=following-sibling::*[1]");
const attendantTick = (page) => page.getByLabel("Jane Doe agrees to sign this packet with this signature");
const employerTick = (page) => page.getByLabel("Stamp this signature on the employer signature lines");

test("nothing is signed until a signature is made and ticked", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText(/No employer signature is on file/)).toBeVisible();
  await expect(employerTick(page)).toHaveCount(0);
  await expect(page.getByText(/agrees to sign this packet/)).toHaveCount(0);
});

test("the typed attendant signature follows the name typed in Step 1", async ({ page }) => {
  await openApp(page);
  await field(page, "first").fill("Jane");
  await field(page, "last").fill("Doe");
  await expect(attendant(page).getByLabel("Type the attendant signature")).toHaveValue("Jane Doe");
});

test("a typed attendant signature lands on the attendant lines only after the tick", async ({ page }) => {
  await openApp(page);
  await enterYourDetails(page);
  await enterAttendant(page);
  const unsigned = await generate(page, 2);
  const base = imageCounts(unsigned[PACKET].doc);
  const w4Base = imageCounts(unsigned[W4].doc);

  await attendant(page).getByRole("button", { name: "Use this signature" }).click();
  await expect(page.getByRole("img", { name: "Attendant signature", exact: true })).toBeVisible();
  await expect(attendantTick(page)).not.toBeChecked();

  // Made but not agreed to: nothing is placed.
  const notTicked = await generate(page, 2);
  expect(pagesWithNewImages(base, notTicked[PACKET].doc)).toEqual([]);
  await expect(page.getByText(/attendant's signature was not placed/)).toBeVisible();

  await attendantTick(page).check();
  const signed = await generate(page, 2);
  expect(pagesWithNewImages(base, signed[PACKET].doc)).toEqual([8, 10, 11, 12, 20]);
  expect(pagesWithNewImages(w4Base, signed[W4].doc)).toEqual([1]);
});

test("a drawn employer signature is saved for next time, but its tick is not", async ({ page }) => {
  await openApp(page);
  await enterYourDetails(page);
  await enterAttendant(page);
  const base = imageCounts((await generate(page, 2))[PACKET].doc);

  await employerSig(page).getByRole("button", { name: "Draw", exact: true }).click();
  const pad = page.getByRole("img", { name: "Drawing area for the employer signature" });
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 70);
  await page.mouse.down();
  for (const [dx, dy] of [[80, 30], [140, 60], [200, 20], [280, 70], [360, 40]]) await page.mouse.move(box.x + dx, box.y + dy, { steps: 4 });
  await page.mouse.up();
  await employerSig(page).getByRole("button", { name: "Use this signature" }).click();

  await expect(employerTick(page)).not.toBeChecked();
  await employerTick(page).check();
  const signed = await generate(page, 2);
  expect(pagesWithNewImages(base, signed[PACKET].doc)).toEqual([8, 11, 12, 20]);

  await page.reload();
  await expect(page.getByRole("img", { name: "Employer signature on file", exact: true })).toBeVisible();
  await expect(employerTick(page)).not.toBeChecked();
});

test("Start over drops the attendant signature", async ({ page }) => {
  await openApp(page);
  await enterAttendant(page);
  await attendant(page).getByRole("button", { name: "Use this signature" }).click();
  await attendantTick(page).check();

  await page.getByRole("button", { name: "Start over (new person)" }).click();
  await expect(page.getByRole("img", { name: "Attendant signature", exact: true })).toHaveCount(0);
  await expect(page.getByText(/agrees to sign this packet/)).toHaveCount(0);
});

// axe-core WCAG 2.2 AA scan of each view, and a keyboard-only pass through the
// main controls.
import { test, expect, openApp, enterYourDetails, expectNoAxeViolations } from "./support.mjs";

test("enrollment page has no axe violations", async ({ page }) => {
  await openApp(page);
  await page.getByText("Optional: start from a packet you already filled").click();
  await expectNoAxeViolations(page, "enrollment");
});

test("Your details page has no axe violations", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "⚙ Your details" }).click();
  await expectNoAxeViolations(page, "your details");
});

test("after generating, the page still has no axe violations", async ({ page }) => {
  await openApp(page);
  await enterYourDetails(page);
  await page.getByRole("button", { name: "Generate & download" }).click();
  await expect(page.getByText(/^Done\./)).toBeVisible();
  await expectNoAxeViolations(page, "after generate");
});

test("the import picker is reachable from the keyboard", async ({ page }) => {
  await openApp(page);
  const summary = page.getByText("Optional: start from a packet you already filled");
  await summary.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.locator('input[type="file"]')).toBeFocused();
});

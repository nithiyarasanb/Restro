import { expect, test } from "@playwright/test";
import { guestOrdersAndPays } from "./helpers";

test("NT-2: returning from the provider without paying does not confirm the order", async ({ page }) => {
  await guestOrdersAndPays(page, [{ name: "Veg Spring Rolls" }]);
  await page.getByText("Developer test controls").click();
  await page.getByRole("link", { name: /Return to the restaurant without paying/ }).click();
  await page.waitForURL(/\/order\//);
  await expect(page.getByText("Waiting for payment confirmation")).toBeVisible();
  await expect(page.getByText("Verified by server")).toHaveCount(0);
});

test("a declined payment keeps the order unpaid and lets the guest retry @mobile", async ({ page }) => {
  await guestOrdersAndPays(page, [{ name: "Masala Chai" }]);
  await page.getByRole("button", { name: "Simulate a declined payment" }).click();
  await page.waitForURL(/\/order\//);
  await expect(page.getByText("Payment didn't go through")).toBeVisible();
  await page.getByRole("button", { name: /Try paying again/ }).click();
  await page.waitForURL(/\/pay\/mock\//);
  await page.getByRole("button", { name: /^Pay / }).click();
  await page.waitForURL(/\/order\//);
  await expect(page.getByText("Verified by server")).toBeVisible();
});

test("NT-3: a duplicated provider webhook is accepted once", async ({ page }) => {
  await guestOrdersAndPays(page, [{ name: "Gulab Jamun" }]);
  await page.getByText("Developer test controls").click();
  await page.getByLabel("Deliver the webhook twice (duplicate)").check();
  await page.getByRole("button", { name: /^Pay / }).click();
  await expect(page.getByText(/Delivery 1: HTTP 200 .*"outcome":"PROCESSED"/)).toBeVisible();
  await expect(page.getByText(/Delivery 2: HTTP 200 .*"duplicate":true/)).toBeVisible();
});

test("NT-5: a tampered amount is rejected and the order stays unpaid", async ({ page }) => {
  await guestOrdersAndPays(page, [{ name: "Raita" }]);
  await page.getByText("Developer test controls").click();
  await page.getByLabel(/Report a wrong amount/).check();
  await page.getByRole("button", { name: /^Pay / }).click();
  await expect(page.getByText(/"outcome":"REJECTED"/)).toBeVisible();
  await page.waitForURL(/\/order\//);
  await expect(page.getByText("Verified by server")).toHaveCount(0);
});

test("a revoked QR code shows a friendly error", async ({ page }) => {
  await page.goto("/q/t_DEMO_revoked_example");
  await expect(page.getByRole("heading", { name: "This QR code isn't active" })).toBeVisible();
});

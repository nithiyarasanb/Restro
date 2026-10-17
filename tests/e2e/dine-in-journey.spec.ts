import { expect, test } from "@playwright/test";
import { DEMO, guestOrdersAndPays, signIn } from "./helpers";

// Journey B end to end across three roles and three browser contexts:
// guest → mock provider → verified webhook → kitchen (live) → counter → guest.
test("dine-in QR order flows live from guest to kitchen to front of house @mobile", async ({ browser, baseURL }) => {
  const guestCtx = await browser.newContext();
  const kitchenCtx = await browser.newContext();
  const counterCtx = await browser.newContext();
  await signIn(kitchenCtx, baseURL!, DEMO.kitchen);
  await signIn(counterCtx, baseURL!, DEMO.cashier);

  const kitchen = await kitchenCtx.newPage();
  await kitchen.goto("/kitchen");
  await expect(kitchen.getByRole("status").filter({ hasText: "Live" })).toBeVisible();

  const guest = await guestCtx.newPage();
  await guestOrdersAndPays(guest, [{ name: "Veg Spring Rolls" }, { name: "Chicken 65", choose: "Mild" }]);
  await expect(guest.getByText("MOCK PAYMENT PROVIDER — TEST ONLY")).toBeVisible();
  await guest.getByRole("button", { name: /^Pay / }).click();
  await guest.waitForURL(/\/order\//);
  await expect(guest.getByText("Verified by server")).toBeVisible();
  const orderNumber = (await guest.getByRole("heading", { level: 1 }).textContent())!.replace(/\D/g, "");

  // The ticket appears on the kitchen display without a reload (SSE).
  const card = kitchen.getByRole("listitem", { name: `Order #${orderNumber}` });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole("button", { name: "Accept" }).click();
  await card.getByRole("button", { name: "Start preparing" }).click();
  await card.getByRole("button", { name: "Mark ready" }).click();
  await expect(guest.getByText(/Ready at/)).toBeVisible({ timeout: 10_000 });

  const counter = await counterCtx.newPage();
  await counter.goto("/counter");
  const row = counter.getByRole("listitem", { name: `Order #${orderNumber}` });
  await row.getByRole("button", { name: "Hand over" }).click();
  await expect(row).toBeHidden();

  await expect(guest.getByText("Served").first()).toBeVisible({ timeout: 10_000 });
  await Promise.all([guestCtx.close(), kitchenCtx.close(), counterCtx.close()]);
});

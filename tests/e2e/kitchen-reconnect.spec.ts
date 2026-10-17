import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers";

// NT-7: when the connection drops the kitchen says so, then reloads the true
// state from the server when it returns — including changes made meanwhile.
test("kitchen shows a stale-connection warning and recovers the server state", async ({ browser, baseURL }) => {
  const kitchenCtx = await browser.newContext();
  const ownerCtx = await browser.newContext();
  await signIn(kitchenCtx, baseURL!, DEMO.kitchen);
  await signIn(ownerCtx, baseURL!, DEMO.owner);
  const kitchen = await kitchenCtx.newPage();
  await kitchen.goto("/kitchen");
  const newColumn = kitchen.getByRole("region", { name: /^New/ });
  await expect(newColumn.getByRole("listitem", { name: "Order #1043" })).toBeVisible();

  await kitchenCtx.setOffline(true);
  await expect(kitchen.getByRole("alert").filter({ hasText: /offline|Connection lost/ })).toBeVisible({ timeout: 40_000 });

  // While the kitchen is offline, a manager cancels #1043 from another device.
  const owner = await ownerCtx.newPage();
  const orders = await owner.request.get("/api/v1/orders?q=1043");
  const target = (await orders.json()).items.find((o: { number: number }) => o.number === 1043);
  const res = await owner.request.post(`/api/v1/orders/${target.id}/transitions`, {
    data: { action: "cancel", expectedVersion: target.version, reason: "Guest left" },
    headers: { origin: baseURL! },
  });
  expect(res.status()).toBe(200);

  await kitchenCtx.setOffline(false);
  await expect(kitchen.getByRole("status").filter({ hasText: "Live" })).toBeVisible({ timeout: 30_000 });
  await expect(newColumn.getByRole("listitem", { name: "Order #1043" })).toHaveCount(0, { timeout: 15_000 });
  await Promise.all([kitchenCtx.close(), ownerCtx.close()]);
});

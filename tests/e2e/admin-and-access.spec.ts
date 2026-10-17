import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers";

test("staff sign in through the form and land on their role's home", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO.kitchen);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/kitchen");
});

test("protected pages redirect: anonymous → login, kitchen → kitchen home", async ({ page, context, baseURL }) => {
  await page.goto("/admin/menu");
  await page.waitForURL(/\/login\?next=%2Fadmin/);
  await signIn(context, baseURL!, DEMO.kitchen);
  await page.goto("/admin/payments");
  await page.waitForURL(/\/kitchen\?denied=1/);
});

test("owner marks an item sold out and guests see it immediately", async ({ page, context, baseURL, browser }) => {
  await signIn(context, baseURL!, DEMO.owner);
  await page.goto("/admin/menu");
  const row = page.getByRole("listitem").filter({ hasText: "Garlic Naan" });
  await row.getByRole("switch", { name: "Available" }).uncheck();
  await expect(row.getByRole("switch", { name: "Sold out" })).not.toBeChecked();

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(DEMO.table12);
  await expect(guest.getByRole("listitem").filter({ hasText: "Garlic Naan" }).getByText("Sold out")).toBeVisible();
  await row.getByRole("switch", { name: "Sold out" }).check();
});

test("platform admin onboards a restaurant and gets a single-use owner link", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, DEMO.platform);
  await page.goto("/platform/tenants/new");
  await page.getByLabel("Name").first().fill("Test Dosa House");
  await expect(page.getByLabel("Web address (slug)")).toHaveValue("test-dosa-house");
  await page.getByLabel("Branch name").fill("HSR Layout");
  await page.getByLabel("Owner email").fill("owner@dosa.test");
  await page.getByLabel("Branch address").fill("1 HSR Layout, Bengaluru");
  await page.getByRole("button", { name: /Create tenant/ }).click();
  await expect(page.getByText("Test Dosa House created")).toBeVisible();
  const link = await page.locator("p.font-mono").textContent();
  expect(link).toMatch(/\/invite\//);

  const owner = await (await page.context().browser()!.newContext()).newPage();
  await owner.goto(link!);
  await owner.getByLabel("Your name").fill("Dosa Owner");
  await owner.getByLabel("Choose a password").fill("DosaOwner123");
  await owner.getByRole("button", { name: "Accept invitation" }).click();
  await owner.waitForURL("**/admin");
  await expect(owner.getByText("Test Dosa House").first()).toBeVisible();
});

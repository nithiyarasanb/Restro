import { expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const DEMO = {
  table12: "/q/t_DEMO_main_table_12",
  revokedQr: "/q/t_DEMO_revoked_example",
  password: "Demo@1234",
  owner: "owner@spiceroute.demo",
  kitchen: "kitchen@spiceroute.demo",
  cashier: "cashier@spiceroute.demo",
  platform: "admin@platform.demo",
};

/** Sign in through the real API (sets the HttpOnly cookie on the context). */
export async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const res = await context.request.post(`${baseURL}/api/v1/auth/login`, { data: { email, password: DEMO.password }, headers: { origin: baseURL } });
  expect(res.status()).toBe(200);
}

/** Guest orders from Table 12 and pays with the mock provider. Returns the tracking page. */
export async function guestOrdersAndPays(page: Page, items: Array<{ name: string; choose?: string }>) {
  await page.goto(DEMO.table12);
  for (const item of items) {
    await page.getByRole("button", { name: `Add ${item.name}` }).click();
    if (item.choose) {
      await page.getByLabel(item.choose, { exact: true }).check();
      await page.getByRole("button", { name: /^Add · / }).click();
    }
  }
  await page.getByRole("link", { name: /View cart/ }).click();
  await expect(page.getByText("Final total is calculated and verified by the server.")).toBeVisible();
  await page.getByRole("button", { name: /^Pay / }).click();
  await page.waitForURL(/\/pay\/mock\//);
  return page;
}

export async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) → ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
}

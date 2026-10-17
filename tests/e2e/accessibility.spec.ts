import { test } from "@playwright/test";
import { DEMO, expectNoSeriousA11yViolations, signIn } from "./helpers";

// Automated WCAG 2.2 AA checks (serious/critical) on the main screens.
// Automated scans catch a subset of issues; see docs/04-quality.md for manual checks.
const publicPages = ["/", "/login", DEMO.table12, "/r/spice-route", "/order/0000000c-0000-4000-8000-000000000412?t=demo-track-1042"];
const ownerPages = [
  "/admin",
  "/admin/orders",
  "/admin/menu",
  "/admin/tables",
  "/admin/branches",
  "/admin/staff",
  "/admin/payments",
  "/admin/reports",
  "/admin/settings",
  "/kitchen",
  "/counter",
];

for (const path of publicPages) {
  test(`a11y: ${path} @mobile`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoSeriousA11yViolations(page);
  });
}

for (const path of ownerPages) {
  test(`a11y (owner): ${path}`, async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, DEMO.owner);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoSeriousA11yViolations(page);
  });
}

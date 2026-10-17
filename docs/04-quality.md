# 04 — Quality: tests, accessibility, security

## Test pyramid

| Level | Tool | Where | Runs against |
| --- | --- | --- | --- |
| Unit | Vitest | `tests/unit` | Pure logic: money, pricing, state machine, role matrix, validation, opening hours |
| Component | Vitest + React Testing Library (jsdom) | `tests/unit/components.test.tsx` | Chart a11y and keyboard tooltip, cart store, badges |
| Integration | Vitest | `tests/integration` | Real services and guards against **memory and PostgreSQL** (`npm run test:pg`) |
| HTTP | Vitest | `tests/integration/api-http.test.ts` | Route handlers: cookies, error shape, CSRF, 401/403/413/422, OpenAPI |
| End to end | Playwright | `tests/e2e` | Production build in demo mode: multi-role journey, payment edge cases, reconnect, access control, onboarding |
| Accessibility | Playwright + axe-core | `tests/e2e/accessibility.spec.ts` | WCAG 2.2 A/AA rules; fails on serious or critical issues |
| Load | k6 | `tests/load/menu-and-orders.js` | Menu reads and order creation at pilot peak (targets to agree, BRD §14) |

The integration suites run once per store. That proves the in-memory demo store and PostgreSQL behave identically, including under concurrency: duplicate webhooks, parallel same-key orders and racing transitions.

## Release-blocking negative tests (DG §11)

| # | Test | Covered by |
| --- | --- | --- |
| NT-1 | Tenant A cannot access tenant B menu, orders, payment settings, reports, files or live events | `tenant-isolation.test.ts` (both stores), `api-http.test.ts` |
| NT-2 | A browser redirect alone cannot mark a payment captured | `payments.test.ts`, e2e `payments.spec.ts` |
| NT-3 | A duplicate webhook cannot duplicate an order, payment or ticket | `payments.test.ts` (sequential and concurrent), e2e |
| NT-4 | A failed payment never enters the kitchen queue | `payments.test.ts` |
| NT-5 | Incorrect amount, currency or account is rejected and logged | `payments.test.ts` (3 cases), e2e |
| NT-6 | A stale transition cannot overwrite newer state | `orders.test.ts` (stale and racing) |
| NT-7 | Reconnect restores current server state | e2e `kitchen-reconnect.spec.ts` (offline → change elsewhere → online) |
| NT-8 | A worker cannot view or update unassigned delivery jobs | `delivery.test.ts` |
| NT-9 | A failed refund is not reported as successful | `payments.test.ts` |
| NT-10 | Backup restore documented and tested | Ops procedure in `05-operations.md`. **Must be run on the real infrastructure before production.** |

## Accessibility (target WCAG 2.2 AA)

Automated (axe, every e2e run) on the landing, login, menu, tracking, admin, kitchen and counter screens. Issues the scans found and fixed during the build:

- Brand orange on navy was 3.9:1, so a `brand-300` text tint (5.2:1) was introduced.
- Translucent white text on the orange header was replaced with solid white.
- The kitchen "preparing" pill moved to a darker shade (6.3:1).
- `aria-label` on role-less chart columns was invalid; the chart now uses a labelled group of `role="img"` columns.
- Invalid `<dl>` content on the reports page was fixed.

Built in:

- Skip link, landmarks, one `h1` per page, labelled form controls with `aria-describedby` hints and errors, and `role="alert"` on errors.
- Visible 3 px focus rings.
- Native `<dialog>` (focus trap, Esc to close), `aria-live` toasts and connection status.
- Charts have keyboard-focusable columns with tooltips and a table view.
- `prefers-reduced-motion` is honoured, and touch targets on operational screens are ≥ 48 px.

Manual checks still recommended before the pilot:

- Screen-reader passes (VoiceOver and NVDA) of checkout and the kitchen display.
- 200% zoom and reflow at 320 px.
- Kitchen display legibility at distance on the actual hardware.

## Security review (summary)

| Area | Status |
| --- | --- |
| AuthZ | Role + tenant + branch checks inside every service; out-of-scope access returns 404; role matrix unit-tested; SSE channels authorised with the same guards |
| Sessions | Opaque tokens stored as SHA-256; HTTP-only, SameSite=Lax, Secure in production; 12 h sliding expiry; disabling a member deletes their sessions |
| CSRF | SameSite cookies + Origin check on cookie-authenticated mutations |
| Passwords | bcrypt (cost 12 in production); uniform timing for unknown emails; per-email and per-client rate limits |
| Input | Zod on every body and query; bounded sizes; client prices are ignored and the server reprices |
| Payments | Raw-body HMAC verification, replay window, event-id dedup, amount/currency/account checks, exactly-once ticket (DB unique), no card data handled |
| Files | Content sniffed (PNG/JPEG/WebP), 2 MB cap, random names under the tenant prefix, served only via expiring HMAC-signed URLs, `nosniff` |
| Data | Integer money, DB check constraints, snapshots never rewritten, soft-delete for menu items |
| Secrets | Validated at startup; none committed (`.env*` ignored except `.env.example`) |
| Not yet | MFA for owners and platform admins; shared (Redis or WAF) rate limiting across instances; CSP headers; dependency/container/secret scanning runs in CI only (see `05-operations.md`) |

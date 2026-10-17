# ADR-0003: Opaque server-side sessions

- Status: Accepted (2026-10-17)

## Context
The DG default is a short-lived access token plus a rotating refresh token in an HTTP-only cookie. With Server Components and a single origin, the browser never needs to read the token.

## Decision
- On login, generate 32 random bytes. Store `sha256(token)` in `sessions` and set the raw token in cookie `rp_session` (`HttpOnly; SameSite=Lax; Path=/; Secure` in production).
- 12 h sliding expiry, extended at most once per 10 minutes. A new session is issued on every login (no fixation). Logout deletes the row.
- Mutating `/api/v1` requests with a session cookie must carry a same-origin `Origin` header (CSRF defence in addition to SameSite).
- Passwords are hashed with bcrypt (cost 12 in production, 10 in dev/test). Failed logins are rate-limited per IP+email.

## Consequences
- Sessions are revocable instantly (disable a user, delete their sessions).
- Mobile clients (phase 2) would use the same session token via an `Authorization: Bearer` header. The guard already accepts it.
- MFA for owners/platform admins is **not** implemented yet (BRD: "where feasible"), and is tracked as open question 8.

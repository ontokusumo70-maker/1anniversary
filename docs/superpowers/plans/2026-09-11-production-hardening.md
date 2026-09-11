# Teras Laundry Anniversary Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining production blockers in the audited GitHub source without adding an OTP migration or external library.

**Architecture:** Keep Cloudflare Worker + D1 + Pages/static frontend. Reuse the existing `auth_sessions` table for short-lived OTP challenge state because the locked checklist forbids creating `0003_otp.sql`; authenticated sessions remain bearer-token records and OTP rows are explicitly namespaced and rejected by session authentication.

**Tech Stack:** Cloudflare Workers, D1, R2 binding, vanilla HTML/CSS/JavaScript, Web Crypto API, Node built-ins for tests/load checks. No external libraries.

**Spec:** Master Baseline V5 and Production Checklist supplied in the conversation.

## Global Constraints

- No external libraries.
- Do not create `migrations/0003_otp.sql`.
- D1 remains the source of truth.
- Server-side auth/RBAC is mandatory.
- Reward lifecycle remains MENANG → KLAIM → REDEEM → DIPERGUNAKAN.
- Cashier only scans QR; redeem is server-side and atomic.
- Official assets already present are reused; no asset redesign.
- Do not deploy or alter GitHub/Cloudflare from this work.
- Secrets stay in Cloudflare secrets, never in source code.

---

### Task 1: OTP persistence and production auth
**Files:** modify `worker/auth/otp-store.ts`, `worker/auth/otp.ts`, create `worker/routes/auth.ts`, modify `worker/index.ts`, add `worker/routes/auth.test.ts`.
- [x] Add failing tests for request/verify, expiry, attempt limit, single-use, and session creation.
- [x] Run tests and confirm they fail for the missing route behavior.
- [x] Store OTP challenges in namespaced `auth_sessions` rows with a dedicated `OTP:` session-id/user-id marker; never treat those rows as login sessions.
- [x] Implement role resolution from Cloudflare secrets for staff/owner phone hashes; default other phones to CUSTOMER.
- [x] Implement generic OTP delivery through a configured `OTP_DELIVERY_URL` secret using a JSON POST; never return OTP in production responses.
- [x] Implement `POST /auth/request-otp` and `POST /auth/verify-otp` with policy limits.
- [x] Verify tests pass.

### Task 2: Session and backend hardening
**Files:** modify `worker/auth/session-guard.ts`, `worker/routes/game.ts`, `worker/services/reward.ts`, `worker/routes/claim.ts`, `worker/routes/staff-redeem.ts`.
- [x] Add failing tests for OTP rows being rejected as bearer sessions and reward/claim/redeem idempotency.
- [x] Make play creation rely on deterministic IDs and transaction ownership.
- [x] Make reward allocation retry atomically without exceeding quota and avoid duplicate reward per play.
- [x] Make claim/redeem state transitions conditional and idempotent.
- [x] Ensure audit actor is the authenticated session user.
- [x] Verify focused tests and TypeScript compile.

### Task 3: Production frontend
**Files:** create `src/frontend/index.html`, `src/frontend/styles.css`, `src/frontend/app.js`.
- [x] Add failing static checks for required screens/routes and API calls.
- [x] Implement mobile-first customer flow: phone → OTP → transaction → start → 15-second game → finish → claim → QR.
- [x] Implement staff scan/redeem and owner dashboard views with role gating.
- [x] Use only vanilla browser APIs and existing assets.
- [x] Add API error handling and no-store behavior.
- [x] Verify static checks and browser-script syntax.

### Task 4: Cloudflare/R2 configuration
**Files:** modify `wrangler.toml`, create `src/frontend/config.js` only if required.
- [x] Add non-secret Worker configuration, D1 binding name, R2 binding name, Pages-compatible settings, and ALLOWED_ORIGIN variable without inventing account IDs.
- [x] Keep resource IDs/secrets out of source where Cloudflare permits environment configuration.
- [x] Verify TOML structure with available tooling or a strict parser fallback.

### Task 5: QA and load-test harness
**Files:** create `tests/production-smoke.mjs`, `tests/load-test.mjs`, `tests/README.md`.
- [x] Add deterministic checks for required endpoint behavior and security headers.
- [x] Add a no-dependency concurrent request harness capable of 1,000 logical concurrent requests against a supplied URL.
- [x] Run local/static QA that does not require deployed Cloudflare resources.
- [x] Clearly mark live 1,000-concurrent acceptance as pending until a deployed URL and real D1 are available; do not fake that result.

### Task 6: Final verification and ZIP
**Files:** all changed files.
- [x] Run TypeScript compilation.
- [ ] Run all repository tests that can execute without external services; record pre-existing test defects separately.
- [x] Run static security scans for legacy identity headers, forbidden migration, external dependencies, and secrets.
- [x] Build a flat ZIP with repository root contents and verify no nested repository directory.
- [x] Produce a concise blocker/status report without claiming deployment success.

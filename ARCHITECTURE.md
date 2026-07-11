# Architecture

A technical overview of the AL Jadwal platform for contributors. For setup and a quick
tour, start with the [README](README.md); for the booking domain rules, see
[`BOOKING_LOGIC.md`](BOOKING_LOGIC.md) (local reference).

> This document describes the application architecture. It deliberately omits
> environment-specific values, infrastructure identifiers, and secrets — those live only
> in the deployment environment, never in the repo.

---

## 1. System shape

AL Jadwal is a **Turborepo** monorepo with two deployable apps that share nothing at
runtime except the HTTP API contract:

- **`apps/api`** — a **NestJS** REST API (TypeScript), backed by **PostgreSQL** via
  **Prisma**, with **Redis** for caching, distributed locks, and the rate-limit store.
- **`apps/web`** — a **Next.js** (App Router) frontend (React + TypeScript + Tailwind CSS),
  fully bilingual (English / Arabic, RTL).

Both are containerised and deployed as independent services behind a CDN/edge and a load
balancer. A shared PostgreSQL database is the system of record.

```
Browser ── CDN/edge ── load balancer ─┬─ web  (Next.js SSR + client islands)
                                       └─ api  (NestJS) ── PostgreSQL
                                                        └─ Redis
```

---

## 2. Backend (`apps/api`)

A single NestJS application (`src/main.ts` + `src/app.module.ts`), organised into feature
modules. Every route is **authenticated by default** (a global JWT guard); public routes
opt out explicitly with a `@Public()` decorator.

### Modules

| Module | Responsibility |
|---|---|
| `auth` | Login/register, JWT + refresh-token rotation, Google OAuth, account lockout, password reset, terms acceptance |
| `users` | Customer profile / self-service |
| `catalog` | Public browsing — activities, search, reviews, offers, coupon claiming |
| `vendor` | Vendor-side activity/booking/payout management, availability locks, per-date price overrides |
| `bookings` | Booking create/cancel/status + availability (the core booking domain) |
| `payment` | Payment gateway integration (initiate, callback, server notification) |
| `email` | Transactional email (templates, quota, suppression, unsubscribe, delivery webhook, outbox) |
| `admin` | Back-office (catalog, vendors, coupons, loyalty, payouts, settings) + audit interceptor |
| `common` | Cross-cutting: notifications, push, loyalty, audit + security logging, uploads, scheduled jobs, exception filters, guards, validators, rate-limit config |
| `redis` | Redis client, distributed locks, rate-limit storage, reference/availability caches |
| `prisma` | Database client + connection management |
| `geo` | Geolocation helpers, distance-aware queries |

### Application bootstrap (`main.ts`)

- **Fails fast in production** if required configuration is missing or a secret is weak.
- **Proxy-aware**: configured trust-proxy so the real client IP is resolved behind the CDN
  and load balancer.
- **Helmet** with a strict Content-Security-Policy; explicit CORS allow-list; gzip; body-size caps.
- **Global exception filters** (ordered) that map errors to correct HTTP codes without
  leaking internal details.
- **Global pipes**: input sanitization followed by `ValidationPipe` with
  `whitelist` + `forbidNonWhitelisted` (strict DTOs, unknown fields rejected).
- **Global guards**: real-IP rate-limiting guard, then the JWT auth guard (fail-closed).
- Graceful shutdown within the container's stop grace period.

### Data model (Prisma / PostgreSQL)

UUID primary keys, soft-delete where relevant. The core chain:

**`User` → `Vendor` (1:1) → `Activity` (1:N) → `Booking` → `Payment` (1:1)**

- **`User`** — role (customer / vendor / admin), loyalty balance, lockout fields, terms acceptance.
- **`RefreshToken`** (rotating, hashed, session-tracked), **`SecurityLog`**, **`EmailSuppression`** (hashed).
- **`Vendor`** — business profile, commission, status/trust level.
- **`Activity`** — hourly/daily, per-person/per-unit pricing, units/capacity. **`ActivityBlock`**
  (vendor-managed unavailable interval), **`ActivitySpecialPrice`** (per-date override, frozen onto bookings).
- **`Booking`** — status machine (PENDING → CONFIRMED → COMPLETED/CANCELLED), price/commission/
  coupon/points snapshot, verification + cancellation/refund audit trail, idempotency key.
- **`Payment`** — 1:1 with a booking, gateway references, a booking snapshot for orphan-recovery,
  unique idempotency key.
- **`Coupon` / `ClaimedCoupon`**, **`Review` / `Like`**, **`Category` / `Country` / `City`** (reference data),
  **`PlatformSettings`** (singleton), **`TrendingEvent`**.
- **Loyalty**: **`LoyaltyConfig`** (rates) + **`LoyaltyLedger`** — an append-only ledger of every
  balance change, the source of truth for reconciliation (the balance is never mutated without a ledger row).
- **`Notification`**, **`PushSubscription`**, **`PayoutRequest`**, **`AuditLog`** (append-only, category-based
  retention), **`ReconciliationLog`** (scheduled drift check), **`EmailOutbox`** (transactional outbox).

### Key domain flows

- **Auth** — the JWT access token and a hashed, rotating refresh token are delivered as
  HttpOnly, Secure, SameSite cookies; the SPA never handles raw tokens. Login is timing-safe
  (constant-time compare on every failure branch) and returns a generic message for all
  failure modes to avoid account enumeration. Account lockout after repeated failures. Google
  OAuth merges only with verified accounts. A server-side guard re-checks terms acceptance on
  contract-forming routes.
- **Booking + concurrency** — booking creation acquires a per-slot **distributed lock** (Redis)
  and runs inside a **Serializable** database transaction; a concurrent conflicting write
  surfaces as a `409`. Capacity/overlap is enforced with range predicates plus a sweep-line
  computation for flexible-start slots and per-unit inventory. An idempotency key prevents
  double-submit.
- **Payments** — initiation is idempotent (a retry reuses the same gateway basket). Confirmation
  is driven by a **verified server-to-server notification** — treated as the source of truth and
  processed idempotently — kept deliberately separate from the browser redirect (which is
  informational only). A booking snapshot enables idempotent recovery if a cleanup job removed a
  pending booking before its confirmation arrived. The charged amount is always the
  server-frozen value, never anything supplied by the client or the notification.
- **Loyalty** — points are ledger-backed; earning applies only to the cash portion actually paid
  (redeemed points earn nothing). Refund/reversal paths return previously earned/redeemed points,
  guarded against double-crediting.
- **Email** — a transport with templated messages; a signed delivery webhook drives a hashed
  suppression list checked before every send; booking-confirmation emails are enqueued to a
  **transactional outbox** (outside the money transaction) and drained by a scheduled job with
  backoff.

### Cross-cutting

- **Authorization** — role guard (`@Roles()`) + object-level ownership checks, not just UI gating.
- **Rate limiting** — tiered limits (per-endpoint cost class), env-configurable, keyed on the real
  client IP and backed by Redis so limits are shared across instances.
- **Validation** — strict DTOs everywhere; no raw SQL; explicit `select:` on sensitive tables so
  hashes/tokens never leave the database layer.
- **Audit & logging** — an append-only audit log (PII-free by contract) plus structured logs that
  redact secrets and never record raw IPs, tokens, or request bodies.
- **Secrets & config** — all configuration is environment-driven; production reads secrets from a
  managed secret store, never from the repo. There are no secrets, hostnames, or credentials in
  source control.

---

## 3. Frontend (`apps/web`)

A Next.js App Router application.

### Routing & rendering

- **Public, SEO-relevant** routes are server-rendered (home, explore, activity detail, offers,
  informational pages, blog/guides, and data-driven SEO landing pages).
- **`/admin/*`** and **`/vendor/*`** are role-gated dashboards (client-rendered, guarded).
- The **home page** uses a server-rendered shell that hydrates small client "islands" for the
  interactive pieces, and defers below-the-fold content via a code-split, `ssr:false` dynamic
  import with a matching skeleton — keeping the initial payload small.
- Server pages fetch data server-side and **seed the client cache**, so crawlers get real content
  and the client doesn't re-fetch on hydration.

### Data & state

- **TanStack Query** is the single client data-fetching layer (no ad-hoc `useEffect` fetches);
  keys are plain arrays and mutations invalidate the relevant caches.
- A single Axios instance carries credentials; on a `401` it transparently refreshes the session
  once (queuing concurrent requests) and, if refresh fails, broadcasts a session-expired event.
- **Auth is cookie-based**: the app holds only `user`/`loading` state (tokens live in HttpOnly
  cookies); it resolves the session from the API and clears state on session expiry.

### Internationalisation & RTL

- Language (English / Arabic) is cookie-driven; translation resources are kept structurally
  parallel; a helper resolves bilingual database fields. `<html lang/dir>` is set server-side
  before first paint. Bilingual URL routing is handled in middleware. RTL uses **logical**
  CSS properties throughout.

### UI & styling

- **Tailwind CSS** only (design tokens + a light/dark theme); **Framer Motion** for animation;
  **Lucide** icons; Latin + Arabic web fonts. Shared components include the navbar (overlay/solid
  variants), a portal-based select, activity cards, and a consent banner that gates analytics.
- **Middleware** (edge) sets a per-request CSP nonce (`strict-dynamic`, no `unsafe-inline`), a
  maintenance kill-switch, bilingual routing, and routing-only role redirects (real authorization
  is always enforced by the API).

---

## 4. Delivery & CI/CD

- **Containers** — multi-stage Docker builds, pinned base images, non-root runtime user, health checks.
- **CI** (GitHub Actions) on every PR — type-checking, linting, unit + integration tests,
  Playwright E2E, dependency/secret/SAST scanning, image builds, and a bundle-size budget.
- **Deploy** — on merge to `main`: build images → **image vulnerability scan (fails on
  CRITICAL/HIGH)** → run database migrations → rolling service deploy → post-deploy smoke check.
  Documentation-only changes are excluded from the deploy trigger.
- **Secrets** never live in the repo — CI uses the platform's secret store; the runtime reads from
  a managed secret store.

---

## 5. Testing

- **API**: unit tests + integration tests against a real PostgreSQL (booking transactions and
  race conditions, coupon lifecycle, payout, auth/sessions, availability, catalog, payment
  callbacks).
- **Web**: component unit tests + **Playwright** end-to-end suites (a required merge gate),
  plus i18n-parity checks.

---

## 6. Conventions

- **Branching** — `main` is protected; changes land via PR with green CI (squash-merge).
- **Frontend** — Tailwind only; RTL logical properties; Lucide + Framer Motion; TanStack Query for
  all fetching; skeletons for loading; typed error handling (no `any`).
- **Backend** — strict DTO validation; no raw SQL; explicit `select:` on sensitive queries; tiered
  rate limits from a central config; every filtered/sorted query is indexed.
- **Security** — HttpOnly cookie auth; strict CSP; least privilege; zero PII in logs; no secrets in
  code; server-side image reprocessing on upload. See [`SECURITY.md`](SECURITY.md).

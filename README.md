<div align="center">

# AL Jadwal · الجدول

**A GCC-focused event & experience booking marketplace.**

Discover and book activities, tours, and experiences across the Gulf — yacht cruises,
desert safaris, watersports, stays, and more — connecting customers with local vendors.

Bilingual (English / Arabic, RTL) · Qatar-first, built to expand across the GCC.

</div>

---

## Overview

AL Jadwal is a three-sided marketplace:

- **Customers** browse and book activities, pay online, earn loyalty points, and manage bookings.
- **Vendors** list activities, set availability, pricing, and special-date overrides, manage bookings, and request payouts.
- **Admins** run the back-office — catalog, vendors, coupons, loyalty, payouts, reviews, and platform settings.

The platform supports **hourly** activities (fixed time slots) and **daily** activities
(check-in → check-out ranges), with capacity- and unit-aware conflict handling, coupons,
a loyalty programme, and a full booking → payment → payout lifecycle.

## Tech stack

| Area | Stack |
|---|---|
| **Monorepo** | Turborepo (npm workspaces), Node 22 |
| **Backend** (`apps/api`) | NestJS · TypeScript · Prisma · PostgreSQL · Redis |
| **Frontend** (`apps/web`) | Next.js (App Router) · React · TypeScript · Tailwind CSS |
| **Auth** | JWT in HttpOnly cookies + refresh-token rotation · Google OAuth |
| **Payments** | PAY2M gateway (card + Apple Pay) |
| **Email** | Resend (transactional + webhook + suppression) |
| **i18n** | English / Arabic (RTL), cookie-driven, fully bilingual routing |
| **Infra** | Docker → AWS ECS Fargate, behind Cloudflare · CI/CD via GitHub Actions |

## Monorepo layout

```
jadwal/
├─ apps/
│  ├─ api/          NestJS backend (REST API, Prisma schema, jobs)
│  │  ├─ src/       feature modules (auth, bookings, payment, catalog, vendor, admin, email, …)
│  │  ├─ prisma/    schema + migrations
│  │  └─ test/      unit + integration tests
│  └─ web/          Next.js frontend (App Router)
│     ├─ src/app/   routes (public, auth, /admin, /vendor)
│     ├─ src/components/  shared UI
│     ├─ src/lib/, src/context/  API client, i18n, auth, providers
│     ├─ src/locales/     en.json / ar.json
│     └─ e2e/       Playwright specs
├─ infra/          deployment definitions (ECS task defs, edge config)
├─ .github/        CI/CD workflows
└─ docker-compose.yml
```

## Getting started (local)

**Prerequisites:** Docker + Docker Compose, Node 22, npm.

```bash
# 1. Install workspace dependencies (also generates the Prisma client)
npm install

# 2. Create env files from the template (fill in your own local values)
cp .env.example apps/api/.env      # then edit
cp .env.example apps/web/.env      # then edit

# 3. Start the full stack (Postgres, Redis, API, Web)
npm run docker:up          # → web on :3000, api on :4000

# 4. Run database migrations (from apps/api)
cd apps/api && npx prisma migrate dev
```

Common tasks:

```bash
npm run dev                     # run api + web via turbo
npm run lint                    # lint all workspaces
cd apps/api && npm test         # backend unit tests
cd apps/api && npm run test:int # backend integration tests
cd apps/web && npm run test:e2e # Playwright end-to-end
```

See [`.env.example`](.env.example) for the required environment variables. Secrets are
never committed — they're supplied via your local env files (and a secrets manager in
production).

## Architecture at a glance

> Full technical deep-dive: **[`ARCHITECTURE.md`](ARCHITECTURE.md)**.

- **Backend** — a NestJS application organised into feature modules (auth, bookings,
  payment, catalog, vendor, admin, email, loyalty, notifications). Every route is
  auth-guarded by default, with role- and ownership-based authorization, strict DTO
  validation, tiered rate limiting, and a structured audit log. Prisma models the domain
  (users, vendors, activities, bookings, payments, coupons, loyalty ledger, reviews, …).
- **Frontend** — a Next.js App Router app. Public, SEO-relevant pages are server-rendered;
  interactive views hydrate as client islands. Data fetching goes through TanStack Query;
  auth is cookie-based; the UI is fully bilingual (EN/AR) with RTL support.
- **Bookings** — hourly (fixed time slots) and daily (check-in → check-out) models, with
  capacity- and unit-aware conflict handling and coupon/loyalty integration.
- **Delivery** — containerised services deployed to AWS ECS Fargate behind Cloudflare;
  GitHub Actions builds, scans, migrates, and deploys.

## Testing & CI

- **Unit + integration** tests on the API (Jest), unit tests + **Playwright E2E** on the web app.
- **CI** (GitHub Actions) runs type-checking, linting, tests, dependency/secret/SAST scans,
  image builds, and a bundle-size budget on every PR.
- **Deploys** run automatically on merge to `main` (build → image scan → migrate → deploy → smoke).

## Security

Security practices and the vulnerability-reporting policy are described in
[`SECURITY.md`](SECURITY.md). In short: HttpOnly cookie auth with refresh rotation, strict
input validation, a strict Content-Security-Policy, least-privilege access, no secrets in
the codebase, and automated dependency/secret/SAST scanning in CI.

## License

See [`LICENSE`](LICENSE).

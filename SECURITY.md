# Security Policy

## Supported Versions

Only the `main` branch receives security updates. Older tags are not
patched — pull from `main` to get the latest fixes.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security reports.**

Please report suspected vulnerabilities privately via one of:

- **GitHub Private Vulnerability Reporting** (preferred): use the
  [Report a vulnerability](https://github.com/kashkoool/Jadwal/security/advisories/new)
  button on the Security tab. This opens a private advisory only the
  maintainers can see.
- **Email**: jadwalit@gmail.com — please put `[security]` in the subject.

Include in your report:

- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept)
- The affected component, file, or endpoint if known
- Your name / handle for credit (optional)

## Response Window

- **Acknowledgement**: within 72 hours of receipt
- **Initial assessment** (severity + scope): within 7 days
- **Fix or mitigation**: timeline depends on severity
  - Critical / High: target patch within 14 days
  - Medium: target patch within 30 days
  - Low: bundled into the next regular release

We coordinate disclosure with the reporter before publishing any advisory,
and credit reporters in the release notes unless they prefer to remain
anonymous.

## Scope

In scope:

- Authentication / authorization (JWT handling, session lifecycle, refresh
  rotation, account lockout, OAuth flows)
- Booking / payment integrity (race conditions, double-booking, amount
  tampering, coupon abuse, idempotency)
- Tenant isolation between vendors / customers / admin
- Input handling (XSS, SQL/NoSQL injection, SSRF, path traversal,
  prototype pollution)
- Cryptographic implementation, secret handling, token storage
- Infrastructure (CI/CD, AWS IAM scoping, Secrets Manager usage, Docker
  image hardening)

Out of scope:

- Findings only reproducible against a self-hosted dev environment with
  default `.env` values (those credentials are not real)
- Reports requiring physical access or social engineering of the maintainer
- Denial of service via volumetric traffic (handled at the CDN /
  rate-limit layer)
- Missing best-practice headers on non-production preview deployments

## Defense Architecture — Explicit Trade-offs

Decisions documented here are deliberate. Each one accepts a small,
bounded risk so the security model stays simple and the maintenance cost
stays low. Reporting a finding against any of these is welcome — but the
acceptance below is the starting point for triage, not an oversight.

### CSRF — cookie-only defense, no double-submit tokens

State-changing requests are protected by cookie attributes alone:

- `HttpOnly` — JavaScript can't read the cookie, so XSS can't steal it.
- `Secure` — the cookie is only sent over HTTPS in production
  (gated on `NODE_ENV === 'production'`).
- `SameSite=Strict` — the browser refuses to attach the cookie to any
  request originated from a different site, which kills the classic CSRF
  vector (attacker page POSTs to our endpoint with the victim's cookies).

We do **not** implement double-submit-cookie tokens or per-form CSRF
nonces. The threat model under which the above is sufficient:

- All authenticated endpoints accept the credential **only** via the
  cookie — never via a header or query string an attacker page could
  forge.
- No popup OAuth flow that would require relaxing `SameSite` to `Lax`.
  (Google OAuth uses a full-page redirect, which is `Strict`-compatible.)

If a future change adds a popup OAuth flow or an embed scenario that
forces `SameSite=Lax`, this decision must be revisited — at that point a
double-submit token becomes worth its complexity cost.

### Rate-limit `unknown` IP fallback

The custom `RealIpThrottlerGuard` keys per-IP buckets on
`cf-connecting-ip` (set by Cloudflare) with `req.ip` (resolved via the
`trust proxy` hop count) as fallback. If both are absent, the request
falls into a shared `'unknown'` bucket.

We accept this because the ALB security group is locked to Cloudflare
IPv4 + IPv6 ranges only. Non-Cloudflare traffic is dropped at the load
balancer before it reaches the API, so the `'unknown'` bucket is
effectively unreachable in production. The fallback exists to keep
non-prod environments (local Docker, integration tests, staging without
a CF in front) functional.

### Production hides field-level validation errors

The global `ValidationPipe` runs with `disableErrorMessages: true` in
production. Clients receive a generic `400 Bad Request` instead of the
detailed `["email must be a valid email", "name is too long"]` array.

We accept the UX cost because frontend validators in
`apps/web/src/lib/validation.ts` run pre-send and surface field-specific
errors to the user *before* the API call. Third-party integrators who
hit a 400 with no detail are an accepted trade-off — security >
debugging ergonomics for unknown clients.

### `crossOriginEmbedderPolicy: false`

Helmet's COEP is disabled because it would block the PAY2M checkout
iframe (`pay.pay2m.com`) and the Google OAuth popup. Cross-origin
embeds we don't need are still blocked by `frame-ancestors 'none'` in
the CSP — no page can iframe us.

### Audit-trail completeness — items considered and dismissed

The following were flagged during the 2026-05-22 cross-cutting audit
and verified as **already correctly handled**. Recorded here so the
trail of "considered + accepted" is complete:

- **Disposable-email blocker**: applied to `RegisterDto` and
  `RegisterVendorDto` (the two paths that create accounts).
  Intentionally **not** applied to `ForgotPasswordDto` /
  `ResendVerificationDto` — checking would side-channel whether an
  email is registered, breaking anti-enumeration.
- **`@Throttle` coverage**: every controller endpoint has an explicit
  tier from `throttle-config.ts`. No endpoint falls through to the
  global `short`/`long` fallback in `app.module.ts`.
- **Prisma `statement_timeout`**: set to 15000 ms by default and
  overridable via the `DB_STATEMENT_TIMEOUT_MS` env var. Comfortably
  under the 25 s graceful-shutdown deadline so a long query can't
  outlive a SIGTERM.

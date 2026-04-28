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

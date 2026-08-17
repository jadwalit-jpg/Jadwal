// Sentry MUST be imported first so its instrumentation runs before any HTTP /
// DB libraries are required. No-op when SENTRY_DSN is unset.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { SanitizePipe } from './common/pipes/sanitize.pipe';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import { JsonSyntaxFilter } from './common/filters/json-syntax.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { PrismaService } from './prisma/prisma.service';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import { join } from 'path';
import { json as bodyJson, raw as bodyRaw, urlencoded as bodyUrlencoded } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { envNumber } from './common/env';
import { parseCorsOrigins } from './common/cors-origins';

const REQUIRED_IN_PRODUCTION = [
  'JWT_SECRET',
  'FRONTEND_URL',
  'CORS_ORIGIN',
  'REDIS_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
  'API_URL',
  'APP_URL',
  // CSP_CONNECT_SRC was deliberately removed from this list (and from the
  // task def + SSM) in PR #96 — its sole previous purpose was to surface
  // the ALB private DNS in the public CSP header, which leaked our origin
  // through Cloudflare. The Helmet directive at line 142 now treats it as
  // optional (empty array fallback) — having it in REQUIRED_IN_PRODUCTION
  // would refuse to start every prod task because the secret no longer
  // exists. Do NOT re-add without simultaneously recreating the SSM
  // parameter + adding it back to infra/ecs/api-task.json.
  'PAY2M_MERCHANT_ID',
  'PAY2M_SECURED_KEY',
  // PAY2M_SECRET_WORD must be present AND non-empty in production — the
  // REQUIRED_IN_PRODUCTION check below treats an empty string as missing.
  // An empty secret word makes the callback Response_Key forgeable (see
  // PaymentService.verifyCallbackHash). It must match the secret word set
  // in the PAY2M merchant portal.
  'PAY2M_SECRET_WORD',
  'PAY2M_RETURN_URL',
  'PAY2M_API_URL',
  'STORAGE_DRIVER',
  'S3_BUCKET',
  'S3_REGION',
  'AWS_REGION',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  // RFC 8058 List-Unsubscribe HMAC signing key. Min 32 chars; generate via
  // `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  // and store as SSM SecureString /jadwal/prod/UNSUBSCRIBE_TOKEN_SECRET.
  'UNSUBSCRIBE_TOKEN_SECRET',
  // Resend API key — the email transport (migrated off AWS SES 2026-05-17).
  // EmailService throws at construction if EMAIL_ENABLED=true and this is
  // missing/empty; listing it here surfaces the misconfig at the env-guard
  // step with a clearer message. Store as SSM SecureString
  // /jadwal/prod/RESEND_API_KEY.
  'RESEND_API_KEY',
  // Resend webhook signing secret (whsec_…). Verifies the Svix signature on
  // the bounce/complaint webhook (POST /api/webhooks/resend-events). Without
  // it the controller fail-closes and rejects every event — the suppression
  // feedback loop goes dark, which is a Resend-account-ban risk. Store as
  // SSM SecureString /jadwal/prod/RESEND_WEBHOOK_SECRET.
  'RESEND_WEBHOOK_SECRET',
  // HMAC key for the per-(customer, activity) reviewer pseudonym in
  // GET /catalog/activities/:slug (see CatalogController.reviewerPseudonym).
  // The pseudonym still works without it (degrades to unkeyed SHA-256) but
  // defense against database compromise is reduced — an attacker with leaked
  // customerId + activityId pairs could rebuild every pseudonym without the
  // secret. Once the SSM param + task-def wiring are in place this becomes
  // a fail-fast guard so a future regression can't ship prod without it.
  // Store as SSM SecureString /jadwal/prod/REVIEW_HASH_SECRET.
  'REVIEW_HASH_SECRET',
];

async function bootstrap() {
  // ─── Production env guard ────────────────────────────────────────────────
  // Fails loudly at startup instead of silently using localhost fallbacks.
  if (process.env.NODE_ENV === 'production') {
    // `?.trim()` so a whitespace-only value ("   ") is rejected too, not just
    // missing/empty — a blank PAY2M_SECRET_WORD must not satisfy the guard.
    const missing = REQUIRED_IN_PRODUCTION.filter((k) => !process.env[k]?.trim());
    if (missing.length) {
      console.error(`\n[FATAL] Missing required environment variables:\n  ${missing.join('\n  ')}\n`);
      process.exit(1);
    }

    // Rate limiting must be ON in production.
    //
    // `THROTTLE_ENABLED=false` collapses every tier to 100_000/min (see
    // app.module.ts + throttle-config.ts), i.e. no rate limiting at all —
    // including on /auth/login, OTP send and password-reset. `false` is the
    // documented value for the E2E workflow, so one copied task-def env var
    // (or a mistyped SSM parameter) silently disables platform-wide abuse
    // protection with NO startup signal and nothing failing.
    //
    // The default is already 'true' when unset, so this only rejects an
    // explicit opt-out. Fail loudly rather than boot unprotected: an outage
    // is recoverable in minutes, a silently unthrottled auth endpoint is not.
    const throttleEnabled = process.env.THROTTLE_ENABLED?.trim();
    if (throttleEnabled !== undefined && throttleEnabled !== '' && throttleEnabled !== 'true') {
      console.error(
        `\n[FATAL] THROTTLE_ENABLED is "${throttleEnabled}" in production. Rate limiting would be disabled platform-wide (all tiers become 100000/min). Set it to "true" or remove it.\n`,
      );
      process.exit(1);
    }

    // DB connection — strict in production.
    //
    // We're already inside `if (NODE_ENV === 'production')` (outer block at
    // line 63), so these checks ALWAYS run in prod. Non-prod / dev / test
    // environments use their own validation paths (Prisma's resolver throws
    // if neither RDS_SECRET_ARN nor DATABASE_URL is set when it boots) — no
    // need to duplicate that here.
    //
    // RDS_SECRET_ARN is REQUIRED in prod. Legacy plaintext DATABASE_URL is
    // refused even if set — this prevents a silent regression where someone
    // re-adds DATABASE_URL to the task def and prod starts running on a
    // stale credential bypassing the Secrets Manager auto-rotation path.
    const hasSecretArn = !!process.env.RDS_SECRET_ARN?.trim();
    const hasLegacyUrl = !!process.env.DATABASE_URL?.trim();
    if (!hasSecretArn) {
      console.error('\n[FATAL] Production requires RDS_SECRET_ARN (+ DB_HOST/DB_PORT/DB_NAME). Legacy DATABASE_URL is not accepted in production.\n');
      process.exit(1);
    }
    if (hasLegacyUrl) {
      console.error('\n[FATAL] DATABASE_URL is set in production. Remove it from the task definition — RDS_SECRET_ARN is the only supported path.\n');
      process.exit(1);
    }
    if (hasSecretArn) {
      const dbMissing = ['DB_HOST', 'DB_NAME'].filter((k) => !process.env[k]?.trim());
      if (dbMissing.length) {
        console.error(`\n[FATAL] RDS_SECRET_ARN is set but missing: ${dbMissing.join(', ')}\n`);
        process.exit(1);
      }
    }

    // JWT secret strength check — reject known dev placeholders and short secrets.
    // Only JWT_SECRET is checked because refresh tokens are crypto.randomBytes
    // (not JWTs) and don't use a separate secret.
    const WEAK_SECRETS = ['super_secret_key_change_me_in_prod', 'super_secret_refresh_key_change_me', 'secret', 'changeme'];
    const jwtSecret = process.env.JWT_SECRET || '';
    if (jwtSecret.length < 32 || WEAK_SECRETS.includes(jwtSecret)) {
      console.error('\n[FATAL] JWT_SECRET is too weak for production. Use a random string of at least 64 characters.\n');
      process.exit(1);
    }

    // Storage driver guard — prevent silent fallback to ephemeral container disk.
    // Do NOT echo the current value (defence in depth — env var could contain sensitive data if misused).
    if (process.env.STORAGE_DRIVER !== 's3') {
      console.error('\n[FATAL] STORAGE_DRIVER must be set to "s3" in production. Local disk is ephemeral on ECS.\n');
      process.exit(1);
    }

    // Critical services must be explicitly enabled in production.
    // Silent fallback (logging-only mode) would mean users never receive booking
    // emails or payment confirmations — a severe production failure.
    //
    // SMS (AWS SNS) was removed in PR #264 — the platform no longer sends text
    // messages; OTP runs over email. SMS_ENABLED is therefore no longer a gate
    // here. Leaving it in this list would fail-fast every prod boot, because
    // SMS_ENABLED is no longer injected by the task definition.
    const requiredServices: Array<{ key: string; name: string }> = [
      { key: 'EMAIL_ENABLED', name: 'Email (Resend)' },
      // PAYMENT_ENABLED is intentionally NOT in this "must be true" list. It may
      // be deliberately set to 'false' to PAUSE payments (e.g. during a gateway
      // incident) WITHOUT taking the whole API down — it is validated as an
      // explicit boolean just below, so a missing/garbage value still fails fast.
    ];
    const disabled = requiredServices.filter((s) => process.env[s.key] !== 'true');
    if (disabled.length) {
      console.error(
        `\n[FATAL] The following services must be enabled in production:\n  ${disabled
          .map((s) => `${s.name} (set ${s.key}=true)`)
          .join('\n  ')}\n`,
      );
      process.exit(1);
    }

    // Payment toggle: must be an explicit boolean. 'true' = live; 'false' =
    // intentionally paused (initiate + callback return "Payment service is not
    // available", but the rest of the API keeps running normally). A missing or
    // typo'd value is a misconfiguration and still fails fast.
    const paymentFlag = process.env.PAYMENT_ENABLED;
    if (paymentFlag !== 'true' && paymentFlag !== 'false') {
      console.error(`\n[FATAL] PAYMENT_ENABLED must be 'true' or 'false' (got: ${paymentFlag ?? 'unset'}).\n`);
      process.exit(1);
    }
    if (paymentFlag === 'false') {
      console.warn('\n[BOOT] PAYMENT_ENABLED=false — payments are PAUSED; the rest of the API is running normally.\n');
    }
  }

  // Pino logging via nestjs-pino — wired in app.module.ts LoggerModule.forRoot.
  // `bufferLogs: true` queues Nest's bootstrap logs until we install the
  // pino logger via `app.useLogger(app.get(PinoLogger))`. Levels (info vs
  // debug) are now controlled inside LoggerModule.forRoot based on
  // NODE_ENV — no manual array here.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  // ─── Trust proxy (real client IP) ───────────────────────────────────────
  // Tells Express how many proxy hops sit in front of us so req.ip resolves
  // to the real client IP from X-Forwarded-For instead of the immediate
  // socket address. Behind Cloudflare → ALB → ECS that's 2 hops in prod.
  //
  // Without this, req.ip is the ALB private IP (one bucket for the whole
  // platform — rate limits effectively shared across all users). Combined
  // with RealIpThrottlerGuard's cf-connecting-ip preference, this is
  // defense in depth: throttler reads cf-connecting-ip first, but other
  // code paths that consume req.ip (security logger, audit interceptors)
  // also see the right value.
  //
  // Default 0 so dev / local / test environments (no proxy) behave normally.
  // Production MUST set TRUST_PROXY_HOPS=2 — fail-fast below catches a
  // missing / typo'd value at startup so throttling can't silently revert
  // to the pre-fix shared-bucket behaviour.
  const trustProxyHops = envNumber('TRUST_PROXY_HOPS', 0);
  if (process.env.NODE_ENV === 'production' && trustProxyHops <= 0) {
    console.error('\n[FATAL] TRUST_PROXY_HOPS must be a positive integer in production (set to 2 for Cloudflare → ALB → ECS).\n');
    process.exit(1);
  }
  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops);
  }

  app.setGlobalPrefix('api');

  // ─── Security Headers (Helmet) ──────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          // img-src is tightened: no bare `https:` wildcard. The API only
          // serves its own /uploads in dev + must not render attacker-chosen
          // image hosts (tracking pixels / porn-ad beacons). Production images
          // are served from S3/CloudFront on the web-app origin, not the API.
          imgSrc: ["'self'", 'data:'],
          connectSrc: [
            "'self'",
            ...(process.env.CSP_CONNECT_SRC
              ? process.env.CSP_CONNECT_SRC.split(',').map((s) => s.trim())
              : []),
          ],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", 'https://pay.pay2m.com'],
        },
      },
      // crossOriginEmbedderPolicy disabled: COEP would block the PAY2M
      // checkout iframe (pay.pay2m.com — allowed in `formAction` above).
      // Google OAuth is unaffected: it uses a full-page redirect, not
      // an embed. Real damage is bounded: our own pages never embed
      // third-party scripts or iframes that need postMessage isolation
      // from our origin, and CSP `frame-ancestors 'none'` already blocks
      // anyone from framing us.
      crossOriginEmbedderPolicy: false,
      // HSTS gated on ENABLE_HSTS=true. NODE_ENV=production isn't
      // enough — the local prod-build container still runs over HTTP
      // on localhost, and HSTS poisons WebKit/iOS Safari to auto-
      // upgrade every localhost request to HTTPS (no TLS = SSL connect
      // errors, breaks all CSS/JS chunks). Real prod sets ENABLE_HSTS
      // at the task definition; CloudFront / ALB also add HSTS at the
      // edge regardless.
      hsts:
        process.env.ENABLE_HSTS === 'true'
          ? { maxAge: 63072000, includeSubDomains: true, preload: true }
          : false,
    }),
  );

  // ─── Response compression (gzip/deflate) ────────────────────────────────
  // Big single perf win on list endpoints — typical JSON payloads compress
  // 5-7×. Cuts NAT egress + improves mobile latency. Skip threshold (1 KB)
  // avoids compressing tiny health-check / auth-cookie responses where the
  // CPU cost beats the bandwidth save. Honors Cache-Control: no-transform
  // per RFC 7234 — rare but correct. BREACH/CRIME-safe because we never
  // reflect user-controlled input alongside secrets in JSON bodies (JWTs
  // are HttpOnly cookies, not in the response body). The middleware
  // auto-sets Vary: Accept-Encoding.
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['cache-control']?.includes('no-transform')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // ─── Static /uploads (DEV ONLY — prod enforces STORAGE_DRIVER=s3) ──────
  //
  // This block is UNREACHABLE in production: the startup guard at the top of
  // main.ts rejects STORAGE_DRIVER=local when NODE_ENV=production, so prod
  // ALWAYS uses S3 + CloudFront (which set their own CORP at the CDN layer).
  //
  // The only purpose of this code: during local `docker compose up`, the web
  // app on :3000 needs to load activity / category images that the API serves
  // from :4000/uploads/*. Without an explicit CORP override the browser
  // refuses cross-origin <img> loads with ERR_BLOCKED_BY_RESPONSE.
  //
  // Order matters: this middleware MUST run AFTER Helmet so our setHeader
  // wins against Helmet's default `Cross-Origin-Resource-Policy: same-origin`.
  // The middleware handles BOTH the 200 path (file found, served by static)
  // and the 404 fallthrough path (file missing, handled by global exception
  // filter) — the header is set before either completes the response.
  // Belt-and-suspenders: even if the STORAGE_DRIVER guard above were ever
  // bypassed by a malformed env (e.g. someone set it to "local" in prod),
  // this NODE_ENV check blocks the static handler + cross-origin CORP from
  // ever attaching. Two independent conditions must BOTH misconfigure for
  // prod to accidentally serve local /uploads.
  //
  // Allowlist (NODE_ENV in {development, test}) instead of denylist
  // (NODE_ENV !== production) so a misconfigured `staging` value also
  // refuses to mount the dev-only static handler — and so the security-
  // grep CI rule can stay strict on `if (...!== 'production')`.
  const nodeEnv = process.env.NODE_ENV;
  const isDevOrTest = nodeEnv === 'development' || nodeEnv === 'test';
  if (process.env.STORAGE_DRIVER === 'local' && isDevOrTest) {
    app.use('/uploads', (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    });
    app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });
  }

  // ─── Body size limits (DoS hardening) ──────────────────────────────────
  // Pin JSON + URL-encoded payload caps explicitly. Without this Nest/Express
  // falls back to the body-parser default (100 KB), which is fine in practice
  // but leaves the value implicit; pinning to 100 KB documents the contract
  // and protects every route — including auth endpoints — from oversized
  // payloads being parsed into memory before per-DTO @MaxLength runs.
  // 100 KB comfortably covers every legitimate request: passwords cap at
  // 128 chars, emails at 254, the largest realistic body is an Activity
  // create with a few text fields and image URL refs (well under 50 KB).
  // Image uploads go via S3 presigned URLs, not through this parser.
  //
  // The Resend webhook (POST /api/webhooks/resend-events) is signed by Svix
  // over the EXACT request bytes — it must NOT be JSON-parsed, or the
  // re-serialised body would no longer match the signature. So that one
  // path is parsed as a raw Buffer FIRST; body-parser sets `req._body` once
  // a parser runs, so the JSON parser below then skips it. Every other
  // route falls through to the JSON parser as normal.
  app.use('/api/webhooks/resend-events', bodyRaw({ limit: '100kb', type: 'application/json' }));
  app.use(bodyJson({ limit: '100kb' }));
  app.use(bodyUrlencoded({ limit: '100kb', extended: true }));

  // ─── Cookie Parser ──────────────────────────────────────────────────────
  app.use(cookieParser());

  // ─── CORS ───────────────────────────────────────────────────────────────
  // Production: CORS_ORIGIN is required (enforced by startup guard above).
  // Each entry is URL-validated via `parseCorsOrigins` so a typo'd origin
  // (e.g. "https://jadwal.q" instead of ".qa") fails-fast at boot rather
  // than silently dropping cross-origin requests at runtime — silent drops
  // are invisible on the server side and only visible as a CORS error in
  // the browser's console.
  // maxAge: 24h preflight cache — Chrome/Firefox cap at 86400; higher
  // values are silently truncated. Safari caps at 5 min regardless.
  // optionsSuccessStatus: 204 — explicit no-body response on preflight;
  // some legacy proxies dislike 200 with no body.
  let allowedOrigins: string[];
  try {
    allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGIN ?? '');
  } catch (err) {
    console.error(`\n[FATAL] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    maxAge: 86_400,
    optionsSuccessStatus: 204,
  });

  // ─── App-level request timeout (defense-in-depth) ───────────────────────
  // 60s matches the ALB idle timeout — a request still running by 60s is
  // dead in the water anyway. Killing it here releases the request slot
  // earlier and returns a clean 503 instead of an ALB 504. Headroom for
  // long-but-legit operations (S3 streaming uploads via upload.service.ts,
  // admin export endpoints) sits at 60s; nothing legitimate exceeds it.
  //
  // Keep-alive cleanup (CodeRabbit PR #201): req.setTimeout sets the
  // timeout on the underlying socket and the 'timeout' event listener
  // does NOT auto-clear when the response finishes. On HTTP/1.1
  // keep-alive sockets behind the ALB that means an idle-but-healthy
  // socket would be destroyed 60s after the last response, forcing the
  // ALB to redo the TCP+TLS handshake on the next request. And every
  // request would stack another 'timeout' listener on the same socket.
  // We clear the timeout + remove the listener on res 'finish' and
  // 'close' so the protection only fires on actually-hung requests.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const onTimeout = () => {
      if (!res.headersSent) res.status(503).json({ message: 'Request timeout' });
      req.destroy();
    };
    req.setTimeout(60_000, onTimeout);
    const clear = () => {
      req.setTimeout(0);
      req.removeListener('timeout', onTimeout);
    };
    res.on('finish', clear);
    res.on('close', clear);
    next();
  });

  // ─── Global exception filters ──────────────────────────────────────────
  // Nest routes exceptions to the most specific @Catch filter that matches.
  //   - SyntaxError             → JsonSyntaxFilter (generic 400 — hides parser identity)
  //   - ThrottlerException      → ThrottlerExceptionFilter (custom 429 shape)
  //   - PrismaClientKnownRequestError → PrismaExceptionFilter (maps P2002→409, etc.)
  //   - Everything else         → AllExceptionsFilter (HttpException passthrough + generic 500)
  // PrismaExceptionFilter needs PrismaService so it can trigger an out-of-band
  // refresh on P1000 (auth fail / Secrets Manager rotation). Resolve from the
  // root injector — Nest's `app.get` is the right shape since the filter is
  // registered via `useGlobalFilters` (instance-based, not class-based).
  const prismaService = app.get(PrismaService, { strict: false });
  app.useGlobalFilters(
    new AllExceptionsFilter(),
    new PrismaExceptionFilter(prismaService),
    new ThrottlerExceptionFilter(),
    new JsonSyntaxFilter(),
  );

  // ─── Global Pipes ───────────────────────────────────────────────────────
  app.useGlobalPipes(new SanitizePipe());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // In production, suppress class-validator's detailed field-level error
      // messages so DTO internals don't leak to clients. Dev keeps them for
      // easier debugging. Clients still get a 400 with a generic message.
      disableErrorMessages: process.env.NODE_ENV === 'production',
    }),
  );

  // ─── Graceful shutdown ──────────────────────────────────────────────────
  // ECS Fargate sends SIGTERM, waits 30 s, then sends SIGKILL. ALB target
  // deregistration drains for 30 s by default. Without these hooks a rolling
  // deploy can SIGKILL an API task mid-booking / mid-payment and orphan the
  // in-flight request (no DB cleanup, Redis lock left behind, customer sees
  // 502 from the ALB).
  //
  // enableShutdownHooks() makes Nest:
  //   1. Stop the HTTP server (refuse new connections; existing in-flight
  //      requests keep running until they finish).
  //   2. Fire onModuleDestroy on every provider → PrismaService.$disconnect
  //      (releases the pg pool cleanly) and RedisService.client.quit
  //      (closes the ioredis connection without losing in-flight pipelines).
  //   3. Exit with 0.
  //
  // Belt-and-suspenders deadline: if a single request hangs (e.g. PAY2M
  // gateway delay past its 15 s AbortSignal, or a slow Prisma transaction
  // that beat the new statement_timeout), we MUST exit before ECS sends
  // SIGKILL or the container is killed mid-cleanup. 25 s gives 5 s of margin
  // inside the 30 s ALB / ECS window for the orderly close to win the race.
  app.enableShutdownHooks();

  const SHUTDOWN_DEADLINE_MS = 25_000;
  const armDeadline = (signal: string) => {
    const t = setTimeout(() => {
      console.error(`[FATAL] ${signal} shutdown exceeded ${SHUTDOWN_DEADLINE_MS}ms — forcing exit`);
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    // unref so the timer itself doesn't keep the event loop alive past a
    // clean shutdown — only fires if we're still running at the deadline.
    t.unref();
  };
  process.on('SIGTERM', () => armDeadline('SIGTERM'));
  process.on('SIGINT', () => armDeadline('SIGINT'));

  // envNumber treats undefined AND empty string as "use default" — guards
  // against a stray empty SSM Parameter Store entry that would otherwise
  // pass through `??` and call app.listen("") (random port -> ALB health
  // check fail -> deploy stalls).
  await app.listen(envNumber('PORT', 4000));
}
bootstrap();

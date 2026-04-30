// Sentry MUST be imported first so its instrumentation runs before any HTTP /
// DB libraries are required. No-op when SENTRY_DSN is unset.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SanitizePipe } from './common/pipes/sanitize.pipe';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import { JsonSyntaxFilter } from './common/filters/json-syntax.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { join } from 'path';
import type { Request, Response, NextFunction } from 'express';
import { envNumber } from './common/env';

const REQUIRED_IN_PRODUCTION = [
  'DATABASE_URL',
  'JWT_SECRET',
  'FRONTEND_URL',
  'CORS_ORIGIN',
  'REDIS_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
  'API_URL',
  'APP_URL',
  'CSP_CONNECT_SRC',
  'PAY2M_MERCHANT_ID',
  'PAY2M_SECURED_KEY',
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
];

async function bootstrap() {
  // ─── Production env guard ────────────────────────────────────────────────
  // Fails loudly at startup instead of silently using localhost fallbacks.
  if (process.env.NODE_ENV === 'production') {
    const missing = REQUIRED_IN_PRODUCTION.filter((k) => !process.env[k]);
    if (missing.length) {
      console.error(`\n[FATAL] Missing required environment variables:\n  ${missing.join('\n  ')}\n`);
      process.exit(1);
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
    // Silent fallback (logging-only mode) would mean users never receive booking emails,
    // OTP SMS, or payment confirmations — a severe production failure.
    const requiredServices: Array<{ key: string; name: string }> = [
      { key: 'EMAIL_ENABLED', name: 'Email (AWS SES)' },
      { key: 'SMS_ENABLED', name: 'SMS (AWS SNS)' },
      { key: 'PAYMENT_ENABLED', name: 'Payment (PAY2M)' },
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
  }

  // Suppress debug logs in production — saves CloudWatch costs
  const logLevels: ('log' | 'error' | 'warn' | 'debug' | 'verbose')[] =
    process.env.NODE_ENV === 'production'
      ? ['log', 'error', 'warn']
      : ['log', 'error', 'warn', 'debug', 'verbose'];

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: logLevels });

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
          formAction: ["'self'", 'https://payments.pay2m.com'],
        },
      },
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

  // ─── Cookie Parser ──────────────────────────────────────────────────────
  app.use(cookieParser());

  // ─── CORS ───────────────────────────────────────────────────────────────
  // Production: CORS_ORIGIN is required (enforced by startup guard above).
  const corsOrigin = process.env.CORS_ORIGIN!;
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  // ─── Global exception filters ──────────────────────────────────────────
  // Nest routes exceptions to the most specific @Catch filter that matches.
  //   - SyntaxError             → JsonSyntaxFilter (generic 400 — hides parser identity)
  //   - ThrottlerException      → ThrottlerExceptionFilter (custom 429 shape)
  //   - PrismaClientKnownRequestError → PrismaExceptionFilter (maps P2002→409, etc.)
  //   - Everything else         → AllExceptionsFilter (HttpException passthrough + generic 500)
  app.useGlobalFilters(
    new AllExceptionsFilter(),
    new PrismaExceptionFilter(),
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

  // envNumber treats undefined AND empty string as "use default" — guards
  // against a stray empty SSM Parameter Store entry that would otherwise
  // pass through `??` and call app.listen("") (random port -> ALB health
  // check fail -> deploy stalls).
  await app.listen(envNumber('PORT', 4000));
}
bootstrap();

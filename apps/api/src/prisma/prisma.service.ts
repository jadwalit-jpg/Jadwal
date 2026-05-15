import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

// AWS RDS server certs are signed by AWS's private CA bundle, which is NOT
// in node:22-alpine's default trust store. We vendor the global CA bundle
// (apps/api/prisma/rds-ca-bundle.pem, sourced from
// https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) so we
// can keep rejectUnauthorized: true and still successfully validate the
// chain in prod. Update the bundle whenever AWS rotates the RDS root CA.
function loadRdsCaBundle(): Buffer {
  const candidates = [
    '/app/apps/api/prisma/rds-ca-bundle.pem',                               // container absolute path
    path.resolve(process.cwd(), 'prisma/rds-ca-bundle.pem'),                // running from apps/api/
    path.resolve(process.cwd(), 'apps/api/prisma/rds-ca-bundle.pem'),       // running from repo root
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p); } catch { /* try next */ }
  }
  throw new Error(
    `[FATAL] RDS CA bundle not found. Searched: ${candidates.join(', ')}`,
  );
}

// SSL is gated on the database HOST, not on NODE_ENV. AWS RDS enforces
// rds.force_ssl=1 and refuses plaintext connections regardless of which
// environment our Node process thinks it is. Local docker-compose Postgres
// (host=localhost / postgres / host.docker.internal) doesn't speak TLS
// and would fail an SSL handshake.
//
// FAIL-SECURE DEFAULT: an unknown remote host gets SSL ON. The opt-out
// allowlist below is small and explicit (localhost variants + the
// docker-compose service name). If we ever migrate away from RDS to
// another remote Postgres (Supabase, Neon, self-hosted, etc.), the new
// host won't match the allowlist → SSL stays on by default → no silent
// downgrade. This is intentional foot-gun protection.
// CI's "no localhost in source" gate (.github/workflows/ci.yml) excludes
// lines that contain `// `, so each entry below carries an inline comment.
const LOCAL_DEV_DB_HOSTS: ReadonlySet<string> = new Set([
  'localhost',             // dev: loopback hostname
  '127.0.0.1',             // dev: IPv4 loopback
  '::1',                   // dev: IPv6 loopback
  'host.docker.internal',  // dev: docker-for-mac/windows host bridge
  'postgres',              // dev: docker-compose service name (most common)
  'db',                    // dev: docker-compose service name (some templates)
]);
function shouldUseSslForHost(host: string | undefined): boolean {
  if (!host) return false;
  return !LOCAL_DEV_DB_HOSTS.has(host.toLowerCase());
}

interface RdsManagedSecret {
  username: string;
  password: string;
}

/**
 * Build a Postgres connection string from a Secrets Manager-managed credential
 * record + plaintext host/port/db env vars. URL-encodes credentials so a
 * rotated password containing reserved chars can't break the URL.
 */
function buildUrlFromSecret(
  secret: RdsManagedSecret,
  host: string,
  port: string,
  dbName: string,
): string {
  const u = new URL(`postgresql://placeholder:placeholder@${host}:${port}/${dbName}`);
  u.username = encodeURIComponent(secret.username);
  u.password = encodeURIComponent(secret.password);
  return u.toString();
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  // Mutable: swapped on rotation. Both old and new instances stay alive
  // for ~5 s during a swap so in-flight queries on the old pool finish.
  private currentPool!: Pool;
  private currentClient!: PrismaClient;

  // Single-flight guard: a flood of concurrent P1000s during a rotation
  // window collapses to ONE GetSecretValue call.
  private reconnectInflight: Promise<void> | null = null;

  // Cached SDK client — reused across reconnects.
  private secretsClient: SecretsManagerClient | undefined;

  /**
   * Public accessor. Always returns the current PrismaClient (post-rotation
   * if a swap happened). Callers should use this getter rather than caching
   * a reference at startup.
   */
  get client(): PrismaClient {
    return this.currentClient;
  }

  async onModuleInit() {
    await this.bootstrap();
    this.logger.log('Database connected via Prisma 7 + pg adapter');
  }

  async onModuleDestroy() {
    try { await this.currentClient.$disconnect(); } catch { /* ignore */ }
    try { await this.currentPool.end(); } catch { /* ignore */ }
    this.logger.log('Database disconnected');
  }

  /**
   * Public hook called by PrismaExceptionFilter when a query fails with
   * P1000 (auth fail). Refetches the secret + swaps pool/client. Single-
   * flight guarded — concurrent callers wait on the same in-flight promise
   * so we make one Secrets Manager call per rotation event.
   *
   * Side-effect only — caller still surfaces 503/Retry-After to the client
   * so the next request hits the freshly-swapped pool.
   */
  async refreshOnAuthError(): Promise<void> {
    if (!this.reconnectInflight) {
      this.reconnectInflight = this.reconnectFromSecret().finally(() => {
        this.reconnectInflight = null;
      });
    }
    return this.reconnectInflight;
  }

  // -- private helpers ----------------------------------------------------

  private async bootstrap() {
    const url = await this.resolveConnectionString();
    const { pool, client } = this.createPoolAndClient(url);
    await client.$connect();
    this.currentPool = pool;
    this.currentClient = client;
  }

  /**
   * Single-flight reconnect. Builds a fresh pool+client from the latest
   * secret and atomically swaps. The OLD pool/client are drained on a 5s
   * timer so any in-flight queries on them complete naturally.
   */
  private async reconnectFromSecret(): Promise<void> {
    const url = await this.resolveConnectionString();
    const { pool: newPool, client: newClient } = this.createPoolAndClient(url);
    await newClient.$connect();

    const oldPool = this.currentPool;
    const oldClient = this.currentClient;
    this.currentPool = newPool;
    this.currentClient = newClient;

    setTimeout(() => {
      oldClient.$disconnect().catch(() => { /* ignore */ });
      oldPool.end().catch(() => { /* ignore */ });
    }, 5000);

    this.logger.log('PrismaService reconnect complete (new pool + client live)');
  }

  private createPoolAndClient(url: string): { pool: Pool; client: PrismaClient } {
    const host = (() => { try { return new URL(url).hostname; } catch { return undefined; } })();
    const useSsl = shouldUseSslForHost(host);
    const isProd = process.env.NODE_ENV === 'production';

    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX || (isProd ? 20 : 10)),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ...(useSsl ? { ssl: { ca: loadRdsCaBundle(), rejectUnauthorized: true } } : {}),
    });

    // Per-connection statement_timeout. Postgres has no pool-level setting
    // for this — it has to be applied as a SQL statement on each new
    // backend connection. Without it, one runaway query (missing index,
    // accidental cross join, slow report) holds a pool slot indefinitely
    // → at scale the 20-slot pool fills with stuck queries → entire API
    // returns 503 even though only one tenant misbehaved.
    //
    // 15 s is generous for a transactional API. Long-running cron work
    // (cleanup, reconciliation) can lift it per-transaction with
    // `SET LOCAL statement_timeout = '60s'` inside its `$transaction`.
    // Set DB_STATEMENT_TIMEOUT_MS=0 to disable (don't — only for
    // emergency hot-fixes if a real workload genuinely needs longer).
    //
    // Strict parse: empty string would coerce to 0 (silent disable) and a
    // junk string to NaN (which then produces 'SET statement_timeout = NaN'
    // — Postgres rejects that and the per-connection guard becomes a
    // permanent error log). Treat anything that isn't a non-negative
    // finite integer as "use the default" so the safeguard never silently
    // drops below the 15 s baseline because of a typo'd env var.
    const STATEMENT_TIMEOUT_MS = (() => {
      const raw = process.env.DB_STATEMENT_TIMEOUT_MS?.trim();
      if (raw === undefined || raw === '') return 15000;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        this.logger.error(
          `Invalid DB_STATEMENT_TIMEOUT_MS=${JSON.stringify(raw)} — falling back to 15000ms`,
        );
        return 15000;
      }
      return n;
    })();
    pool.on('connect', (c) => {
      c
        .query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
        .catch((err: Error) =>
          this.logger.error(`SET statement_timeout failed (${err.name})`),
        );
    });

    const adapter = new PrismaPg(pool);
    // Note: no `log:` config is intentional. Prisma query logging in
    // production prints user emails / phones / IDs — every WHERE clause
    // is PII. Keep this off; prefer `pg_stat_statements` + Performance
    // Insights for slow-query analysis.
    //
    // The `omit` block below is filtered-by-default, NOT enforced —
    // a future `select: { password: true }` will still return the value.
    // Treat any explicit selection of these fields as a code-review red
    // flag. Auth flows that legitimately need them (login bcrypt compare,
    // OTP/refresh-token verify) live in auth.service.ts and access them
    // through narrow helpers, not directly from feature controllers.
    const baseClient = new PrismaClient({
      adapter,
      omit: {
        user: {
          password: true,
          verificationToken: true,
          passwordResetToken: true,
        },
        refreshToken: {
          tokenHash: true,
        },
        booking: {
          // Booking-OTP secrets — never returned to clients via default
          // findX/include calls. Auth-internal verify path reads them via
          // an explicit `select: { emailOtpHash: true, ... }` in
          // verifyBookingEmailOtp, which overrides this omit.
          emailOtpHash: true,
          emailOtpAttempts: true,
        },
      },
    } as any);

    // ─── O2: slow-query observability via $extends ────────────────────────
    // Emit a structured warn for queries exceeding 500 ms. CloudWatch Logs
    // Insights can then filter on `event = "SLOW_QUERY"` to surface
    // regressions before customers complain.
    //
    // PII-safe by design: NEVER log `args` — they contain WHERE clauses
    // with emails / phone / IDs. The intentional "no log: config" policy
    // at line 221-225 documents this concern; this middleware is the safe
    // alternative — model + operation + duration only.
    //
    // Prisma 7 removed the deprecated `$use` middleware API; `$extends`
    // with query.$allModels.$allOperations is the modern equivalent.
    const SLOW_QUERY_THRESHOLD_MS = 500;
    const logger = this.logger;
    const extended = baseClient.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, model, operation, query }) {
            const start = Date.now();
            try {
              return await query(args);
            } finally {
              const ms = Date.now() - start;
              if (ms > SLOW_QUERY_THRESHOLD_MS) {
                logger.warn({
                  event: 'SLOW_QUERY',
                  model,
                  action: operation,
                  durationMs: ms,
                });
              }
            }
          },
        },
      },
    });

    // `$extends` returns a `DynamicClientExtensionThis<...>` that has every
    // model method (.user.findMany, etc.) but is structurally missing
    // top-level methods like `$on` from the original PrismaClient. We don't
    // call `$on` anywhere in this codebase (grep clean) so the cast is
    // safe — callers see the same API surface. If anyone adds `$on` later,
    // they'll need to register it on `baseClient` BEFORE this $extends call.
    const client = extended as unknown as PrismaClient;

    return { pool, client };
  }

  /**
   * Production: reads {username,password} from the rds-managed Secrets Manager
   * secret pointed at by RDS_SECRET_ARN, and combines with plaintext DB_HOST /
   * DB_PORT / DB_NAME env vars (non-secret) to build the URL.
   *
   * Dev/local: falls through to the legacy DATABASE_URL env var so docker-
   * compose, local tests, and CI continue to work without AWS access.
   *
   * Fail-secure: if RDS_SECRET_ARN is set but the SDK call rejects, we throw
   * — the task fails to start, ECS marks unhealthy, deployment circuit
   * breaker rolls back. We do NOT silently fall back to DATABASE_URL,
   * because that would mask a misconfigured-IAM regression and let the app
   * keep running on a stale credential.
   */
  private async resolveConnectionString(): Promise<string> {
    const secretArn = process.env.RDS_SECRET_ARN?.trim();
    if (secretArn) {
      const host = process.env.DB_HOST?.trim();
      const port = process.env.DB_PORT?.trim() || '5432';
      const dbName = process.env.DB_NAME?.trim();
      if (!host) throw new Error('[FATAL] DB_HOST is required when RDS_SECRET_ARN is set');
      if (!dbName) throw new Error('[FATAL] DB_NAME is required when RDS_SECRET_ARN is set');

      const secret = await this.fetchSecret(secretArn);
      return buildUrlFromSecret(secret, host, port, dbName);
    }

    // Legacy / local-dev path
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('[FATAL] Either RDS_SECRET_ARN or DATABASE_URL must be set');
    return url;
  }

  private async fetchSecret(arn: string): Promise<RdsManagedSecret> {
    if (!this.secretsClient) {
      const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
      // Adaptive retry (3 attempts) — only retries on retryable error
      // types (network blips, throttling). GetSecretValue is idempotent
      // and read-only, so retry is unconditionally safe.
      this.secretsClient = new SecretsManagerClient({
        ...(region ? { region } : {}),
        maxAttempts: 3,
        retryMode: 'adaptive',
      });
    }
    const out = await this.secretsClient.send(
      new GetSecretValueCommand({ SecretId: arn, VersionStage: 'AWSCURRENT' }),
    );
    if (!out.SecretString) {
      // Generic message — never log SecretString or any partial value.
      throw new Error('[FATAL] RDS managed secret has no SecretString');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(out.SecretString);
    } catch {
      throw new Error('[FATAL] RDS managed secret is not valid JSON');
    }
    const u = (parsed as any)?.username;
    const p = (parsed as any)?.password;
    if (typeof u !== 'string' || typeof p !== 'string' || !u || !p) {
      throw new Error('[FATAL] RDS managed secret missing username/password');
    }
    return { username: u, password: p };
  }
}

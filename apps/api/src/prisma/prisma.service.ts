import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

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
function shouldUseSslForDb(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    // Known local-dev hosts: skip SSL — they don't speak TLS.
    if (LOCAL_DEV_DB_HOSTS.has(host)) return false;
    // Anything else (RDS or any future remote DB) → require SSL.
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  readonly client: PrismaClient;

  constructor() {
    const isProd = process.env.NODE_ENV === 'production';
    const useSsl = shouldUseSslForDb(process.env.DATABASE_URL);
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
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
    const STATEMENT_TIMEOUT_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15000);
    this.pool.on('connect', (client) => {
      // Fire-and-forget: pg's `connect` event handler is sync but
      // client.query returns a promise. Errors here surface on the
      // first user query that lands on this client (which would also
      // fail), so logging only is sufficient.
      client
        .query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
        .catch((err: Error) =>
          this.logger.error(`SET statement_timeout failed (${err.name})`),
        );
    });

    const adapter = new PrismaPg(this.pool);
    this.client = new PrismaClient({
      adapter,
      omit: {
        user: {
          password: true,
          verificationToken: true,
          passwordResetToken: true,
          phoneOtpHash: true,
        },
        refreshToken: {
          tokenHash: true,
        },
      },
    } as any);
  }

  async onModuleInit() {
    await this.client.$connect();
    this.logger.log('Database connected via Prisma 7 + pg adapter');
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
    await this.pool.end();
    this.logger.log('Database disconnected');
  }
}

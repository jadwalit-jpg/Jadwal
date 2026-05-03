/**
 * Shared DB connection helper for prisma/*.ts ops scripts (seed-admin,
 * seed-e2e-*, and any future one-off prod-touching scripts).
 *
 * Mirrors the SSL-gating logic in apps/api/src/prisma/prisma.service.ts so
 * scripts that connect to RDS use the vendored CA bundle and reject
 * un-validated certs, while local docker-compose runs (host=postgres etc.)
 * skip SSL because the local Postgres doesn't speak TLS.
 *
 * Usage:
 *   import { createSeedPrisma } from './_db-helper';
 *   const prisma = createSeedPrisma();
 *   await prisma.$connect();
 *   ... // do work
 *   await prisma.$disconnect();
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// Same allowlist as PrismaService — local-dev-only hosts skip SSL because
// docker-compose Postgres doesn't speak TLS. Anything else (RDS or any
// future remote DB) gets SSL ON by default. This is fail-secure: an
// unknown host gets the safer choice.
const LOCAL_DEV_DB_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'postgres',
  'db',
]);

function shouldUseSslForDb(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    return !LOCAL_DEV_DB_HOSTS.has(host);
  } catch {
    return false;
  }
}

function loadRdsCaBundle(): Buffer {
  const candidates = [
    '/app/apps/api/prisma/rds-ca-bundle.pem',
    path.resolve(__dirname, 'rds-ca-bundle.pem'),
    path.resolve(process.cwd(), 'prisma/rds-ca-bundle.pem'),
    path.resolve(process.cwd(), 'apps/api/prisma/rds-ca-bundle.pem'),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p);
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `[FATAL] RDS CA bundle not found. Searched: ${candidates.join(', ')}`,
  );
}

/**
 * Create a Prisma client wired to the same SSL config as the API runtime.
 * Caller is responsible for `$connect()` and `$disconnect()`.
 */
export function createSeedPrisma(): PrismaClient {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('[FATAL] DATABASE_URL env var is required');
  }
  const useSsl = shouldUseSslForDb(dbUrl);
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { ca: loadRdsCaBundle(), rejectUnauthorized: true } : undefined,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter } as never);
}

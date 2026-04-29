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
    `[FATAL] RDS CA bundle not found in production. Searched: ${candidates.join(', ')}`,
  );
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  readonly client: PrismaClient;

  constructor() {
    const isProd = process.env.NODE_ENV === 'production';
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX || (isProd ? 20 : 10)),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ...(isProd ? { ssl: { ca: loadRdsCaBundle(), rejectUnauthorized: true } } : {}),
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

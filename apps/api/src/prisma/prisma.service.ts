import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

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
      // RDS requires SSL (rds.force_ssl=1 on managed-master setups), but
      // its server cert is signed by an AWS-private CA (rds-ca-rsa2048-g1)
      // which isn't in node:22-alpine's default trust store. Verifying the
      // chain would drop every connection. Setting rejectUnauthorized: false
      // keeps the link encrypted (the wire is still TLS) but skips chain
      // validation. Acceptable here because RDS is in a private subnet only
      // reachable from inside our VPC — a MITM would require the attacker
      // to already be inside the VPC, in which case they have larger holes
      // to exploit. To tighten this later, vendor the AWS RDS global CA
      // bundle into the image and pass `ca: <bundle>` instead.
      ...(isProd ? { ssl: { rejectUnauthorized: false } } : {}),
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

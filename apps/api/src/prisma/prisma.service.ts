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
      ...(isProd ? { ssl: { rejectUnauthorized: true } } : {}),
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

import { Controller, Get, HttpCode, ServiceUnavailableException, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Liveness probe — bypasses the global throttler entirely.
   *
   * ALB target-group probes hit this every 30 s from a small pool of internal
   * AWS IPs. With multi-AZ + cross-zone load balancing the same backend can
   * receive probes from 4–8 distinct ALB nodes; under sustained load + a 15/min
   * per-IP cap that's already tight, and any future bump to the probe interval
   * or task count tips it into 429s — flapping the very tasks the probe exists
   * to protect.
   *
   * Throttling adds zero security here either: the response is a static string
   * with no DB / Redis / network IO, so flooding it doesn't cost the API
   * anything. Best practice is to leave health probes unthrottled.
   *
   * Liveness vs readiness:
   *   - /api/health     → process is alive (this endpoint, no IO)
   *   - /api/health/ready → process can serve traffic (DB + Redis reachable)
   *
   * The ALB target-group health-check path should be /api/health/ready so it
   * only routes traffic to a task once Prisma has $connect()-ed and Redis is
   * reachable. /api/health stays as a deeper liveness signal (process alive,
   * event loop responsive) for orchestration tools that distinguish the two.
   */
  @Get('health')
  @SkipThrottle()
  getHealth(): string {
    return this.appService.getHealth();
  }

  /**
   * Readiness probe — checks Prisma + Redis with a 1 s timeout each.
   *
   * Used by the ALB target group so a freshly-started task does not receive
   * traffic until the pg pool has connected and the Redis client is ready.
   * Without this, the first ~5 s of every rolling deploy serves 5xx because
   * Nest is listening on :4000 but PrismaService.onModuleInit hasn't yet
   * resolved $connect (cold-start latency to RDS over TLS).
   *
   * 503 is the correct status for "alive but cannot serve" — ALB removes the
   * target from rotation; restoring 200 puts it back without a task restart.
   * Throttler is bypassed for the same reason as /health: zero-cost and the
   * probe storm scenario is the same.
   *
   * 1 s per check is intentional. Prisma's default pg pool connect timeout
   * is 5 s and the Redis client retries 3× — letting either run that long
   * here would mean a ready probe taking 15+ s to return, which the ALB
   * interprets as unhealthy. A fast 503 is better than a slow 200.
   */
  @Get('health/ready')
  @SkipThrottle()
  @HttpCode(200)
  async getReady(): Promise<{ status: 'ok'; db: 'up'; redis: 'up' }> {
    const checks = await Promise.allSettled([this.checkDb(), this.checkRedis()]);
    const dbOk = checks[0].status === 'fulfilled';
    const redisOk = checks[1].status === 'fulfilled';

    if (dbOk && redisOk) {
      return { status: 'ok', db: 'up', redis: 'up' };
    }

    // Log only the failure class — never the raw error (Prisma/ioredis errors
    // can include connection strings, query fragments, or AUTH passwords).
    if (!dbOk) {
      const reason = checks[0] as PromiseRejectedResult;
      const kind = reason.reason instanceof Error ? reason.reason.name : 'UnknownError';
      this.logger.warn(`Readiness: DB check failed (${kind})`);
    }
    if (!redisOk) {
      const reason = checks[1] as PromiseRejectedResult;
      const kind = reason.reason instanceof Error ? reason.reason.name : 'UnknownError';
      this.logger.warn(`Readiness: Redis check failed (${kind})`);
    }

    throw new ServiceUnavailableException({
      status: 'degraded',
      db: dbOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
    });
  }

  private async checkDb(): Promise<void> {
    await this.withTimeout(
      this.prisma.client.$queryRawUnsafe('SELECT 1'),
      1000,
      'db-timeout',
    );
  }

  private async checkRedis(): Promise<void> {
    await this.withTimeout(this.redis.getClient().ping(), 1000, 'redis-timeout');
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    });
    return Promise.race([p, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    }) as Promise<T>;
  }
}

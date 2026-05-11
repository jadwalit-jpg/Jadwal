import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { RealIpThrottlerGuard } from './common/guards/real-ip-throttler.guard';
import { APP_GUARD } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { CatalogModule } from './catalog/catalog.module';
import { VendorModule } from './vendor/vendor.module';
import { BookingsModule } from './bookings/bookings.module';
import { GeoModule } from './geo/geo.module';
import { EmailModule } from './email/email.module';
import { SmsModule } from './sms/sms.module';
import { PaymentModule } from './payment/payment.module';
import { CommonModule } from './common/common.module';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

@Module({
  imports: [
    // SentryModule must be first so its global filter / interceptor is
    // registered before any route handlers run. No-op when SENTRY_DSN is unset
    // (see src/instrument.ts).
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    // ─── Structured JSON logging via pino ────────────────────────────────
    // Replaces Nest's default string-based Logger so every log line emits
    // JSON. CloudWatch Logs Insights can then query top-level fields
    // (event, userId, requestId, durationMs) instead of regex-grepping.
    // Production: raw pino JSON → CloudWatch parses natively.
    // Dev: pino-pretty for readable console output.
    // Redact paths defense-in-depth strip secrets even if a careless
    // log() call passes them — existing audit/security loggers already
    // hash sensitive fields, this is the second layer.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-csrf-token"]',
            'password',
            'passwordResetToken',
            'verificationToken',
            'tokenHash',
            '*.password',
            '*.passwordResetToken',
          ],
          remove: true,
        },
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        // Honor any inbound x-request-id (RequestLoggerMiddleware already
        // validates/generates one); falls back to a fresh UUID otherwise.
        // Pino's `genReqId` requires a non-undefined ReqId so we always
        // return a string — never let it default to pino's auto-counter
        // (would desync from our request-id middleware's header).
        genReqId: (req) =>
          (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) ||
          randomUUID(),
      },
    }),
    RedisModule,
    CommonModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (config: ConfigService, redisStorage: RedisThrottlerStorage) => {
        // Rate limiting is ON by default — must be explicitly disabled via THROTTLE_ENABLED=false
        const enabled = config.get('THROTTLE_ENABLED', 'true') === 'true';

        if (!enabled) {
          // In dev: effectively unlimited (100k req/min)
          return { throttlers: [{ name: 'short', ttl: 60000, limit: 100000 }] };
        }

        return {
          storage: redisStorage,
          throttlers: [
            {
              name: 'short',
              ttl: Number(config.get('THROTTLE_SHORT_TTL', '60000')),
              limit: Number(config.get('THROTTLE_SHORT_LIMIT', '20')),
            },
            {
              name: 'long',
              ttl: Number(config.get('THROTTLE_LONG_TTL', '600000')),
              limit: Number(config.get('THROTTLE_LONG_LIMIT', '100')),
            },
            // Public unauthenticated endpoints (availability calendar, etc.)
            // More generous than auth endpoints — GET only, no write operations
            {
              name: 'availability',
              ttl: Number(config.get('THROTTLE_AVAILABILITY_TTL', '60000')),
              limit: Number(config.get('THROTTLE_AVAILABILITY_LIMIT', '30')),
            },
          ],
        };
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AdminModule,
    CatalogModule,
    VendorModule,
    BookingsModule,
    GeoModule,
    EmailModule,
    SmsModule,
    PaymentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Custom throttler that keys on cf-connecting-ip (real client IP) so
    // per-IP rate limits actually fire per user — see real-ip-throttler.guard.ts.
    { provide: APP_GUARD, useClass: RealIpThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Global HTTP logger — runs for every route, including auth and static.
    // Attaches x-request-id and emits one structured JSON log on finish.
    //
    // Path is '*path' (named wildcard), not bare '*'. NestJS 11 upgraded
    // path-to-regexp to v8, which dropped support for unnamed wildcards
    // and now requires every catch-all to bind a parameter name. Bare '*'
    // logs a [LegacyRouteConverter] WARN at startup + auto-converts at
    // runtime; '*path' silences the warning and is forward-compatible.
    consumer.apply(RequestLoggerMiddleware).forRoutes('*path');
  }
}

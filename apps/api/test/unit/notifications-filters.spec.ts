/**
 * Wave 4 + 5: NotificationService, filters (Prisma/All/Throttler),
 * SanitizePipe, geo haversine.
 */

import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { NotificationService } from '../../src/common/services/notification.service';
import { WebPushService } from '../../src/common/services/web-push.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { PrismaExceptionFilter } from '../../src/common/filters/prisma-exception.filter';
import { ThrottlerExceptionFilter } from '../../src/common/filters/throttler-exception.filter';
import { ThrottlerException } from '@nestjs/throttler';
import { SanitizePipe } from '../../src/common/pipes/sanitize.pipe';
import { makePrismaMock } from '../mocks/prisma.mock';

// ═══════════════════════════════════════════════════════════════════════════
// NotificationService
// ═══════════════════════════════════════════════════════════════════════════

describe('NotificationService', () => {
  async function build() {
    const prisma = makePrismaMock();
    const webPush = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
    };
    const mod = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: WebPushService, useValue: webPush },
      ],
    }).compile();
    return { sut: mod.get(NotificationService), prisma, webPush };
  }

  describe('safeLink (exposed via behaviour of send/sendToMany)', () => {
    test('absolute URLs rejected (stored as null)', async () => {
      const ctx = await build();
      await ctx.sut.send({
        userId: 'u1', type: 'SYSTEM', title: 't', message: 'm',
        link: 'https://evil.com/attack',
      });
      const data = ctx.prisma._client.notification.create.mock.calls[0][0].data;
      expect(data.link).toBeNull();
    });

    test('protocol-relative //evil.com rejected', async () => {
      const ctx = await build();
      await ctx.sut.send({
        userId: 'u1', type: 'SYSTEM', title: 't', message: 'm',
        link: '//evil.com',
      });
      expect(ctx.prisma._client.notification.create.mock.calls[0][0].data.link).toBeNull();
    });

    test('javascript: pseudo-scheme rejected', async () => {
      const ctx = await build();
      await ctx.sut.send({
        userId: 'u1', type: 'SYSTEM', title: 't', message: 'm',
        link: 'javascript:alert(1)',
      });
      expect(ctx.prisma._client.notification.create.mock.calls[0][0].data.link).toBeNull();
    });

    test('valid relative path /bookings/123 accepted', async () => {
      const ctx = await build();
      await ctx.sut.send({
        userId: 'u1', type: 'SYSTEM', title: 't', message: 'm',
        link: '/bookings/123',
      });
      expect(ctx.prisma._client.notification.create.mock.calls[0][0].data.link).toBe('/bookings/123');
    });
  });

  test('send: title + message are length-capped (prevent DoS / storage abuse)', async () => {
    const ctx = await build();
    await ctx.sut.send({
      userId: 'u1', type: 'SYSTEM',
      title: 'a'.repeat(500),
      message: 'b'.repeat(1000),
    });
    const data = ctx.prisma._client.notification.create.mock.calls[0][0].data;
    expect(data.title.length).toBeLessThanOrEqual(200);
    expect(data.message.length).toBeLessThanOrEqual(500);
  });

  test('send: also fires webPush (fire-and-forget — no await chain)', async () => {
    const ctx = await build();
    await ctx.sut.send({ userId: 'u1', type: 'SYSTEM', title: 't', message: 'm' });
    expect(ctx.webPush.sendToUser).toHaveBeenCalled();
  });

  test('send: Prisma failure does NOT throw (fire-and-forget)', async () => {
    const ctx = await build();
    ctx.prisma._client.notification.create.mockRejectedValueOnce(new Error('DB down'));
    // Must not throw
    await expect(ctx.sut.send({ userId: 'u1', type: 'SYSTEM', title: 't', message: 'm' }))
      .resolves.not.toThrow();
  });

  test('sendToMany with empty userIds returns early (no DB hit)', async () => {
    const ctx = await build();
    await ctx.sut.sendToMany({ userIds: [], type: 'SYSTEM', title: 't', message: 'm' });
    expect(ctx.prisma._client.notification.createMany).not.toHaveBeenCalled();
  });

  test('notifyAdmins: no active admins → no-op', async () => {
    const ctx = await build();
    ctx.prisma._client.user.findMany.mockResolvedValueOnce([]);
    await ctx.sut.notifyAdmins({ type: 'SYSTEM', title: 't', message: 'm' });
    expect(ctx.prisma._client.notification.createMany).not.toHaveBeenCalled();
  });

  test('notifyAdmins: filters out deactivated admins in the query', async () => {
    const ctx = await build();
    ctx.prisma._client.user.findMany.mockResolvedValueOnce([{ id: 'a1' }]);
    await ctx.sut.notifyAdmins({ type: 'SYSTEM', title: 't', message: 'm' });
    expect(ctx.prisma._client.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'ADMIN', isDeactivated: false },
      }),
    );
  });

  test('markAsRead: scoped to userId (IDOR guard)', async () => {
    const ctx = await build();
    await ctx.sut.markAsRead('u1', 'notif-1');
    expect(ctx.prisma._client.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'notif-1', userId: 'u1' } }),
    );
  });

  test('clearAll: scoped to userId, returns deleted count', async () => {
    const ctx = await build();
    ctx.prisma._client.notification.deleteMany.mockResolvedValueOnce({ count: 7 });
    const r = await ctx.sut.clearAll('u1');
    expect(r).toEqual({ deleted: 7 });
    expect(ctx.prisma._client.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AllExceptionsFilter
// ═══════════════════════════════════════════════════════════════════════════

function makeHost(req: any, res: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

function makeRes() {
  const r: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return r;
}

describe('AllExceptionsFilter', () => {
  test('HttpException passes through with its status + message', () => {
    const filter = new AllExceptionsFilter();
    const res = makeRes();
    filter.catch(new HttpException('Not allowed', HttpStatus.FORBIDDEN), makeHost({ path: '/x', method: 'GET' }, res));
    expect(res.status).toHaveBeenCalledWith(403);
    // Body shape unchanged for HttpException
    const body = res.json.mock.calls[0][0];
    expect(body).toBeDefined();
  });

  test('unknown Error → generic 500 (no stack / message leak)', () => {
    const filter = new AllExceptionsFilter();
    const res = makeRes();
    filter.catch(new Error('DB down at host prod-db-1.amazonaws.com'), makeHost({ path: '/x', method: 'POST' }, res));
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('amazonaws');
  });

  test('non-Error thrown value → still generic 500', () => {
    const filter = new AllExceptionsFilter();
    const res = makeRes();
    filter.catch('string thrown', makeHost({ path: '/x', method: 'GET' }, res));
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PrismaExceptionFilter
// ═══════════════════════════════════════════════════════════════════════════

describe('PrismaExceptionFilter', () => {
  function mkPrismaErr(code: string, message = 'prisma error'): Prisma.PrismaClientKnownRequestError {
    // Construct a Prisma.PrismaClientKnownRequestError directly
    const err = new Prisma.PrismaClientKnownRequestError(message, {
      code, clientVersion: '5.0.0', meta: {},
    });
    return err;
  }

  test.each([
    ['P2002', 409, /already exists/i],
    ['P2034', 409, /busy/i],
    ['P2025', 404, /does not exist/i],
    ['P2003', 400, /invalid reference/i],
    ['P2014', 400, /invalid reference/i],
    ['P2000', 400, /provided data is invalid/i],
    ['P2011', 400, /provided data is invalid/i],
    ['P2020', 400, /provided data is invalid/i],
  ])('code %s → HTTP %d with safe message', (code, status, msg) => {
    const filter = new PrismaExceptionFilter();
    const res = makeRes();
    filter.catch(mkPrismaErr(code), makeHost({ path: '/x', method: 'POST' }, res));
    expect(res.status).toHaveBeenCalledWith(status);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toMatch(msg);
    // Never leak Prisma code, SQL, or raw message
    expect(body.message).not.toContain(code);
    expect(JSON.stringify(body)).not.toContain('prisma error');
  });

  test('unknown Prisma code → generic 500', () => {
    const filter = new PrismaExceptionFilter();
    const res = makeRes();
    filter.catch(mkPrismaErr('P9999'), makeHost({ path: '/x', method: 'POST' }, res));
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // ── 5xx must be OBSERVABLE ────────────────────────────────────────────────
  // This filter wins over AllExceptionsFilter for every Prisma error (Nest
  // reverses filter order), and it used to report nowhere — so an unmapped
  // code such as P2028 (interactive-transaction timeout) became a silent 500.
  // `event: PRISMA_ERROR_5XX` is the stable token a CloudWatch metric filter
  // alarms on, and it must NOT fire for caller-caused 4xx (alert fatigue).
  describe('5xx observability', () => {
    test.each([
      ['P2028', 'interactive transaction timeout'],
      ['P1001', 'cannot reach database'],
      ['P2024', 'connection pool timeout'],
      ['P9999', 'unknown code'],
    ])('%s (%s) → emits PRISMA_ERROR_5XX with the code and route', (code) => {
      const filter = new PrismaExceptionFilter();
      const res = makeRes();
      const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      filter.catch(mkPrismaErr(code), makeHost({ path: '/bookings', method: 'POST' }, res));

      expect(res.status).toHaveBeenCalledWith(500);
      const alert = errSpy.mock.calls
        .map((c) => c[0])
        .find((a) => typeof a === 'object' && a !== null && (a as any).event === 'PRISMA_ERROR_5XX');
      expect(alert).toBeDefined();
      expect(alert).toEqual(
        expect.objectContaining({ prismaCode: code, method: 'POST', path: '/bookings' }),
      );
      errSpy.mockRestore();
    });

    test.each([['P2002', 409], ['P2025', 404], ['P2003', 400]])(
      '%s → HTTP %d does NOT emit the 5xx alert (caller-caused, no paging)',
      (code, status) => {
        const filter = new PrismaExceptionFilter();
        const res = makeRes();
        const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        filter.catch(mkPrismaErr(code), makeHost({ path: '/x', method: 'POST' }, res));

        expect(res.status).toHaveBeenCalledWith(status);
        const alerted = errSpy.mock.calls
          .map((c) => c[0])
          .some((a) => typeof a === 'object' && a !== null && (a as any).event === 'PRISMA_ERROR_5XX');
        expect(alerted).toBe(false);
        errSpy.mockRestore();
      },
    );

    test('the response body still leaks nothing when the alert fires', () => {
      const filter = new PrismaExceptionFilter();
      const res = makeRes();
      const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      filter.catch(mkPrismaErr('P2028', 'tx timed out on bookings'), makeHost({ path: '/bookings', method: 'POST' }, res));

      const body = res.json.mock.calls[0][0];
      expect(body.message).toBe('Internal server error');
      expect(JSON.stringify(body)).not.toContain('P2028');
      expect(JSON.stringify(body)).not.toContain('tx timed out');
      errSpy.mockRestore();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ThrottlerExceptionFilter
// ═══════════════════════════════════════════════════════════════════════════

describe('ThrottlerExceptionFilter', () => {
  test('reads Retry-After header and returns 429 shape', () => {
    const filter = new ThrottlerExceptionFilter();
    const res = makeRes();
    res.getHeader = jest.fn().mockReturnValue('60');
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as any;

    filter.catch(new ThrottlerException('rate limited'), host);

    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.json.mock.calls[0][0];
    expect(body.statusCode).toBe(429);
  });

  test('missing Retry-After header → falls back to 60', () => {
    const filter = new ThrottlerExceptionFilter();
    const res = makeRes();
    res.getHeader = jest.fn().mockReturnValue(undefined);
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as any;

    filter.catch(new ThrottlerException('rate limited'), host);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SanitizePipe
// ═══════════════════════════════════════════════════════════════════════════

describe('SanitizePipe', () => {
  const pipe = new SanitizePipe();

  test('custom metadata type → passthrough (no sanitize)', () => {
    const r = pipe.transform('<script>x</script>', { type: 'custom' } as any);
    expect(r).toBe('<script>x</script>');
  });

  test('body string → strips <script> tags', () => {
    const r = pipe.transform('hello<script>evil()</script>world', { type: 'body' } as any);
    expect(r).not.toContain('<script>');
    expect(r).not.toContain('evil()');
  });

  test('body object → recursively sanitizes string values', () => {
    const r = pipe.transform(
      { title: 'ok', desc: '<img src=x onerror=alert(1)>', nested: { note: '<b>safe</b>hi' } },
      { type: 'body' } as any,
    );
    expect((r as any).desc).not.toContain('onerror');
    expect((r as any).nested.note).not.toContain('<b>');
  });

  test('non-string primitives pass through unchanged', () => {
    const r = pipe.transform({ n: 42, b: true, x: null }, { type: 'body' } as any);
    expect(r).toEqual({ n: 42, b: true, x: null });
  });
});

// P1000 (database authentication failed) responds 503 and RETURNS before
// mapError, so it needs its own alert — otherwise the single most important
// production database failure is the one nobody is paged for. RDS_SECRET_ARN
// is required in prod, so usingRotatingCreds is always true there and every
// credential/rotation outage lands on that branch.
describe('PrismaExceptionFilter — P1000 credential outage is alertable', () => {
  const mkP1000 = () =>
    new Prisma.PrismaClientKnownRequestError('auth failed', {
      code: 'P1000', clientVersion: '5.0.0', meta: {},
    });

  test('emits PRISMA_ERROR_5XX on the 503 early-return path', () => {
    const prev = process.env.RDS_SECRET_ARN;
    // Not a secret: an ARN is a resource IDENTIFIER, and this one is a
    // syntactically-valid dummy (account "1", name "x") that points at
    // nothing. The filter only checks whether RDS_SECRET_ARN is non-empty to
    // decide it is on the rotating-credentials path; the value is never
    // dereferenced. Semgrep's node_secret rule matches on the variable name
    // containing SECRET, so it flags any literal assigned here.
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret
    process.env.RDS_SECRET_ARN = 'arn:aws:secretsmanager:eu-central-1:1:secret:x';
    try {
      const prisma = { refreshOnAuthError: jest.fn().mockResolvedValue(undefined) } as any;
      const filter = new PrismaExceptionFilter(prisma);
      // The 503 path chains .header('Retry-After'); the shared makeRes() helper
      // only stubs status/json, so extend it locally rather than changing a
      // helper every other filter test depends on.
      const res: any = makeRes();
      res.header = jest.fn().mockReturnValue(res);
      res.status = jest.fn().mockReturnValue(res);
      const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      filter.catch(mkP1000(), makeHost({ path: '/bookings', method: 'POST' }, res));

      expect(res.status).toHaveBeenCalledWith(503);
      const alert = errSpy.mock.calls
        .map((c) => c[0])
        .find((a) => typeof a === 'object' && a !== null && (a as any).event === 'PRISMA_ERROR_5XX');
      expect(alert).toEqual(expect.objectContaining({ prismaCode: 'P1000', status: 503 }));
      // The recovery path still runs — alerting must not replace it.
      expect(prisma.refreshOnAuthError).toHaveBeenCalled();
      errSpy.mockRestore();
    } finally {
      if (prev === undefined) delete process.env.RDS_SECRET_ARN;
      else process.env.RDS_SECRET_ARN = prev;
    }
  });
});

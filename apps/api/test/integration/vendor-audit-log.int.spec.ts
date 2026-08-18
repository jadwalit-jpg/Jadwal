/**
 * VendorAuditInterceptor — parallel to admin-log.int.spec.ts.
 *
 * Confirms the vendor-scoped interceptor writes rows with actorType=VENDOR
 * and applies the same 18-key redaction. Prevents drift between the two
 * near-identical sanitisation functions.
 */

import { getTestContext } from './_setup';
import { VendorAuditInterceptor } from '../../src/vendor/interceptors/vendor-audit.interceptor';
import { firstValueFrom, of, throwError } from 'rxjs';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeInterceptor() {
  return new VendorAuditInterceptor({ client: ctx.prisma } as any);
}

function makeCtx(req: any) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

async function runOk(i: VendorAuditInterceptor, req: any, result: any = { ok: true }) {
  await firstValueFrom(i.intercept(makeCtx(req), { handle: () => of(result) }));
  await new Promise(r => setTimeout(r, 100));
}

async function runErr(i: VendorAuditInterceptor, req: any, err: Error) {
  try { await firstValueFrom(i.intercept(makeCtx(req), { handle: () => throwError(() => err) })); } catch { /* expected */ }
  await new Promise(r => setTimeout(r, 100));
}

/**
 * The interceptor writes the audit row FIRE-AND-FORGET — it does not await the
 * insert, so the request returns before the row exists. Reading straight after a
 * fixed sleep is a race: on a loaded CI runner 100ms is not always enough, and
 * the suite fails intermittently (this is the flake that was reported).
 *
 * Poll for the row instead of guessing at a duration. Fast when the write has
 * already landed (the normal case), patient when the runner is busy.
 *
 * NOTE: the sleeps in runOk/runErr above are deliberately KEPT — the negative
 * tests ("GET/HEAD/OPTIONS write nothing") assert an EMPTY table, and they need
 * a settle window or they would pass vacuously by reading too early.
 */
async function waitForAuditRow(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await ctx.prisma.auditLog.findFirst();
    if (row) return row;
    if (Date.now() > deadline) {
      throw new Error(`audit row never landed within ${timeoutMs}ms (fire-and-forget write lost?)`);
    }
    await new Promise(r => setTimeout(r, 25));
  }
}

/** Same race, but for a test that expects N rows — wait for all N to land. */
async function waitForAuditRows(n: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await ctx.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    if (rows.length >= n) return rows;
    if (Date.now() > deadline) {
      throw new Error(`only ${rows.length}/${n} audit rows landed within ${timeoutMs}ms`);
    }
    await new Promise(r => setTimeout(r, 25));
  }
}

describe('VendorAuditInterceptor', () => {
  test('POST write → audit row with actorType=VENDOR', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/vendor/activities' },
      url: '/vendor/activities',
      body: { titleEn: 'New activity' },
      user: {
        id: 'vuser-1', fullName: 'Vendor User',
        vendor: { businessNameEn: 'Biz Co' },
      },
      params: {},
    });

    const row = await waitForAuditRow();
    expect(row.actorType).toBe('VENDOR');
    expect(row.actorId).toBe('vuser-1');
    expect(row.entity).toBe('Activity');
  });

  test('GET/HEAD/OPTIONS write nothing', async () => {
    const i = makeInterceptor();
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      await runOk(i, {
        method, route: { path: '/vendor/activities' }, url: '/vendor/activities',
        body: {}, user: { id: 'v', fullName: 'V' }, params: {},
      });
    }
    expect(await ctx.prisma.auditLog.count()).toBe(0);
  });

  test.each([
    'password', 'token', 'refreshToken', 'secret', 'apiKey',
    'email', 'phone', 'fullName', 'cardNumber', 'iban', 'otp',
  ])('sensitive key "%s" redacted', async (key) => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'PATCH',
      route: { path: '/vendor/settings' },
      url: '/vendor/settings',
      body: { [key]: 'secret-value-xyz' },
      user: { id: 'v', fullName: 'V' },
      params: {},
    });
    const row = await waitForAuditRow();
    expect(row.details).toContain('[REDACTED]');
    expect(row.details).not.toContain('secret-value-xyz');
  });

  test('entityId falls back to activitySlug param when :id is missing', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'PATCH',
      route: { path: '/vendor/activities/:activitySlug' },
      url: '/vendor/activities/desert-safari',
      body: { status: 'INACTIVE' },
      user: { id: 'v', fullName: 'V' },
      params: { activitySlug: 'desert-safari' },
    });
    const row = await waitForAuditRow();
    expect(row.entityId).toBe('desert-safari');
  });

  test('failure row prefixed with "FAILED:" and body still sanitized', async () => {
    const i = makeInterceptor();
    await runErr(i, {
      method: 'PATCH',
      route: { path: '/vendor/settings' },
      url: '/vendor/settings',
      body: { password: 'leakme!' },
      user: { id: 'v', fullName: 'V' },
      params: {},
    }, new Error('Validation failed: missing field'));

    const row = await waitForAuditRow();
    expect(row.details).toMatch(/^FAILED:/);
    expect(row.details).not.toContain('leakme!');
    expect(row.details).toContain('[REDACTED]');
  });

  test('actorName falls back to businessNameEn, then fullName, then short id', async () => {
    const i = makeInterceptor();
    // vendor.businessNameEn takes precedence
    await runOk(i, {
      method: 'POST', route: { path: '/vendor/activities' }, url: '/vendor/activities',
      body: {},
      user: {
        id: 'v1', fullName: 'Ignore This',
        vendor: { businessNameEn: 'Business Primary' },
      },
      params: {},
    });
    // Fall back to fullName when no vendor.businessNameEn
    await runOk(i, {
      method: 'POST', route: { path: '/vendor/activities' }, url: '/vendor/activities',
      body: {},
      user: { id: 'v2', fullName: 'Alice Vendor' },
      params: {},
    });
    // Fall back to short id when neither
    await runOk(i, {
      method: 'POST', route: { path: '/vendor/activities' }, url: '/vendor/activities',
      body: {},
      user: { id: 'abcdef1234567890' },
      params: {},
    });

    const rows = await waitForAuditRows(3);
    expect(rows).toHaveLength(3);
    expect(rows[0].actorName).toBe('Business Primary');
    expect(rows[1].actorName).toBe('Alice Vendor');
    expect(rows[2].actorName).toMatch(/user:abcdef/);
  });

  test('details capped at 1000 chars', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST', route: { path: '/vendor/x' }, url: '/vendor/x',
      body: { big: 'x'.repeat(5_000) },
      user: { id: 'v', fullName: 'V' },
      params: {},
    });
    const row = await waitForAuditRow();
    expect(row.details!.length).toBeLessThanOrEqual(1000);
  });
});

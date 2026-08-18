/**
 * AdminAuditInterceptor — persistence + redaction against a real Postgres.
 *
 * We don't spin up HTTP. We invoke `intercept()` directly with a fake
 * ExecutionContext + CallHandler so we can assert exactly what lands in the
 * audit_logs table:
 *
 *   - Every POST / PATCH / DELETE writes one row with the right
 *     actorType + action + entity + entityId + details
 *   - GET / HEAD / OPTIONS write NOTHING (no audit spam on reads)
 *   - sanitizeBody() redacts the 18 sensitive keys before persisting
 *   - Image keys collapse to "[image]" / "[N images]"
 *   - base64 data URIs collapse to "[base64 image]"
 *   - Handler failure also writes a row, prefixed with "FAILED: <err> | ..."
 *   - details are capped at 1000 chars
 *   - Unknown route falls back to METHOD_PATH_FORMAT action
 *   - No req.user → interceptor silently skips (no audit row)
 */

import { getTestContext } from './_setup';
import { AdminAuditInterceptor } from '../../src/admin/interceptors/audit.interceptor';
import { firstValueFrom, of, throwError } from 'rxjs';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeInterceptor() {
  const prismaSvc = { client: ctx.prisma } as any;
  return new AdminAuditInterceptor(prismaSvc);
}

/** Minimal ExecutionContext that satisfies the interceptor's needs. */
function makeCtx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

/** Drive the interceptor's RxJS pipeline for a successful handler. */
async function runOk(interceptor: AdminAuditInterceptor, req: any, result: any = { ok: true }) {
  const obs = interceptor.intercept(makeCtx(req), { handle: () => of(result) });
  await firstValueFrom(obs);
  // The audit write is fire-and-forget inside the tap — give it a tick.
  // NOTE: tests that EXPECT a row must use waitForAuditRow() rather than relying
  // on this sleep (see below).
  await new Promise(r => setTimeout(r, 100));
}

/**
 * The interceptor writes the audit row fire-and-forget (deliberately — it must
 * not block the HTTP response). Tests used to `sleep(100)` and then immediately
 * `findFirstOrThrow()`, which is a race: on a loaded CI runner the insert takes
 * longer than 100ms, the row is not there yet, and Prisma throws
 * "No record was found for a query". That is exactly the flake we kept seeing on
 * `VendorAuditInterceptor -> sensitive key "password" redacted`.
 *
 * Poll for the row instead of guessing a timeout. Condition-based waiting is
 * both faster (returns as soon as it lands) and immune to runner load.
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

/** Drive the interceptor's RxJS pipeline for a failing handler. */
async function runErr(interceptor: AdminAuditInterceptor, req: any, err: Error) {
  const obs = interceptor.intercept(makeCtx(req), { handle: () => throwError(() => err) });
  try { await firstValueFrom(obs); } catch { /* expected */ }
  await new Promise(r => setTimeout(r, 100));
}

// ═══════════════════════════════════════════════════════════════════════════
// Write-method filtering
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminAuditInterceptor — HTTP method filtering', () => {
  test('POST writes an audit row', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/settings/countries' },
      url: '/admin/settings/countries',
      body: { nameEn: 'Oman' },
      user: { id: 'admin-1', fullName: 'Alice Admin' },
      params: {},
    });

    // The interceptor writes the audit row FIRE-AND-FORGET, so a direct findMany
    // here races the write (intermittent "Received length: 0"). Poll until it
    // lands, THEN read the set — the length-1 assertion still catches extras.
    await waitForAuditRow();
    const rows = await ctx.prisma.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe('ADMIN');
    expect(rows[0].actorId).toBe('admin-1');
    expect(rows[0].actorName).toBe('Alice Admin');
    expect(rows[0].action).toBe('CREATE_COUNTRY');
    expect(rows[0].entity).toBe('Country');
  });

  test('PATCH writes an audit row', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'PATCH',
      route: { path: '/admin/vendors/:id/status' },
      url: '/admin/vendors/vendor-1/status',
      body: { status: 'SUSPENDED' },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: { id: 'vendor-1' },
    });

    const row = await waitForAuditRow();
    expect(row.action).toBe('UPDATE_VENDOR_STATUS');
    expect(row.entity).toBe('Vendor');
    expect(row.entityId).toBe('vendor-1');
  });

  test('DELETE writes an audit row', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'DELETE',
      route: { path: '/admin/vendors/:id' },
      url: '/admin/vendors/vendor-1',
      body: {},
      user: { id: 'admin-1', fullName: 'Alice' },
      params: { id: 'vendor-1' },
    });

    const row = await waitForAuditRow();
    expect(row.action).toBe('DELETE_VENDOR');
    expect(row.entityId).toBe('vendor-1');
  });

  test('GET / HEAD / OPTIONS write nothing', async () => {
    const i = makeInterceptor();
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      await runOk(i, {
        method,
        route: { path: '/admin/vendors' },
        url: '/admin/vendors',
        body: {},
        user: { id: 'admin-1', fullName: 'Alice' },
        params: {},
      });
    }
    expect(await ctx.prisma.auditLog.count()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Redaction — sensitive keys
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminAuditInterceptor — redactKeys', () => {
  test.each([
    'password', 'currentPassword', 'newPassword', 'confirmPassword',
    'token', 'refreshToken', 'accessToken', 'secret', 'apiKey',
    'cardNumber', 'bankAccount', 'bankDetails', 'iban', 'otp', 'code',
  ])('key "%s" is replaced with [REDACTED]', async (key) => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'PATCH',
      route: { path: '/admin/profile/password' },
      url: '/admin/profile/password',
      body: { [key]: 'super-secret-value-xyz' },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    });

    const row = await waitForAuditRow();
    expect(row.details).toContain('[REDACTED]');
    expect(row.details).not.toContain('super-secret-value-xyz');
  });

  test.each(['email', 'phone', 'fullName'])('PII key "%s" is redacted (PII isolation)', async (key) => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/whatever' },
      url: '/admin/whatever',
      body: { [key]: 'customer@example.com' },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    });

    const row = await waitForAuditRow();
    expect(row.details).not.toContain('customer@example.com');
    expect(row.details).toContain('[REDACTED]');
  });

  test('non-sensitive keys pass through unchanged', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/settings/countries' },
      url: '/admin/settings/countries',
      body: { nameEn: 'Oman', isoCode: 'OM', status: 'ACTIVE' },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    });

    const row = await waitForAuditRow();
    expect(row.details).toContain('Oman');
    expect(row.details).toContain('OM');
    expect(row.details).toContain('ACTIVE');
  });

  test('mixed sensitive + safe body — sensitive keys replaced, safe keys kept', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/weird' },
      url: '/admin/weird',
      body: {
        nameEn: 'Oman',
        password: 'hunter2',
        apiKey: 'sk-live-ABC',
        status: 'ACTIVE',
      },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    });

    const row = await waitForAuditRow();
    expect(row.details).toContain('Oman');
    expect(row.details).toContain('ACTIVE');
    expect(row.details).not.toContain('hunter2');
    expect(row.details).not.toContain('sk-live-ABC');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Image handling
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminAuditInterceptor — image collapse', () => {
  test('scalar image key collapses to "[image]"', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/upload' },
      url: '/admin/upload',
      body: { coverImage: 'https://cdn.jadwal.app/big.jpg' },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    });

    const row = await waitForAuditRow();
    expect(row.details).toContain('[image]');
    expect(row.details).not.toContain('cdn.jadwal.app');
  });

  test('gallery array collapses to "[N images]"', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/upload' },
      url: '/admin/upload',
      body: { gallery: ['a.jpg', 'b.jpg', 'c.jpg'] },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    });

    const row = await waitForAuditRow();
    expect(row.details).toContain('[3 images]');
    expect(row.details).not.toContain('a.jpg');
  });

  test('base64 data URI value collapses to "[base64 image]"', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/whatever' },
      url: '/admin/whatever',
      body: { logo: 'data:image/png;base64,iVBORw0KGgo' },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    });

    const row = await waitForAuditRow();
    expect(row.details).toContain('[base64 image]');
    expect(row.details).not.toContain('iVBORw0KGgo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Failure logging
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminAuditInterceptor — failure still writes an audit row', () => {
  test('handler throws → row written with "FAILED:" prefix in details', async () => {
    const i = makeInterceptor();
    await runErr(i, {
      method: 'POST',
      route: { path: '/admin/settings/countries' },
      url: '/admin/settings/countries',
      body: { nameEn: 'Oman' },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    }, new Error('Country already exists'));

    const row = await waitForAuditRow();
    expect(row.details).toMatch(/^FAILED: Country already exists \|/);
    expect(row.details).toContain('Oman');
  });

  test('handler error + redacted body → PII still sanitized in FAILED row', async () => {
    const i = makeInterceptor();
    await runErr(i, {
      method: 'PATCH',
      route: { path: '/admin/profile/password' },
      url: '/admin/profile/password',
      body: { currentPassword: 'oldpass!', newPassword: 'newpass!' },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    }, new Error('Current password is incorrect'));

    const row = await waitForAuditRow();
    expect(row.details).toContain('FAILED:');
    expect(row.details).toContain('[REDACTED]');
    expect(row.details).not.toContain('oldpass!');
    expect(row.details).not.toContain('newpass!');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminAuditInterceptor — edge cases', () => {
  test('no req.user → no audit row (guard runs before interceptor fires)', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/x' },
      url: '/admin/x',
      body: { x: 1 },
      user: undefined, // guard rejected
      params: {},
    });
    expect(await ctx.prisma.auditLog.count()).toBe(0);
  });

  test('details is capped at 1000 chars', async () => {
    const i = makeInterceptor();
    const huge = 'x'.repeat(5_000);
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/x' },
      url: '/admin/x',
      body: { big: huge },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    });
    const row = await waitForAuditRow();
    expect(row.details!.length).toBeLessThanOrEqual(1000);
  });

  test('unknown route → fallback action name is METHOD_PATH_UPPER', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/weird/new-endpoint' },
      url: '/admin/weird/new-endpoint',
      body: { x: 1 },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: {},
    });
    const row = await waitForAuditRow();
    expect(row.action).toMatch(/^POST_/);
    expect(row.action).toContain('WEIRD');
  });

  test('actorName falls back to "user:<shortId>" when fullName is missing', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'POST',
      route: { path: '/admin/x' },
      url: '/admin/x',
      body: {},
      user: { id: 'abcdef1234567890' },
      params: {},
    });
    const row = await waitForAuditRow();
    expect(row.actorName).toBe('user:abcdef12');
  });

  test('entityId from req.params.id lands in the row', async () => {
    const i = makeInterceptor();
    await runOk(i, {
      method: 'PATCH',
      route: { path: '/admin/coupons/:id/status' },
      url: '/admin/coupons/abc-123/status',
      body: { status: 'APPROVED' },
      user: { id: 'admin-1', fullName: 'Alice' },
      params: { id: 'abc-123' },
    });
    const row = await waitForAuditRow();
    expect(row.entityId).toBe('abc-123');
    expect(row.entity).toBe('Coupon');
    expect(row.action).toBe('UPDATE_COUPON_STATUS');
  });
});

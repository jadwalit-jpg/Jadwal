/**
 * RealIpThrottlerGuard — verifies the throttler keys on the real client IP,
 * not the connecting socket. Without this guard, every request behind
 * Cloudflare → ALB shares a single per-IP bucket and rate limiting is
 * effectively a single global counter.
 */

import { RealIpThrottlerGuard } from '../../src/common/guards/real-ip-throttler.guard';

// getTracker is protected — expose it for the test only.
class TestableGuard extends RealIpThrottlerGuard {
  public exposeGetTracker(req: any): Promise<string> {
    return (this as any).getTracker(req);
  }
}

function makeGuard(): TestableGuard {
  // RealIpThrottlerGuard's constructor takes (storage, reflector, options) —
  // none of which getTracker uses. Cast through any so the test stays focused
  // on the resolution logic.
  return new TestableGuard(
    /* options */    {} as any,
    /* storage */    {} as any,
    /* reflector */  {} as any,
  );
}

describe('RealIpThrottlerGuard.getTracker', () => {
  test('uses cf-connecting-ip header when present (real client IP behind Cloudflare)', async () => {
    const guard = makeGuard();
    const req = {
      headers: { 'cf-connecting-ip': '203.0.113.42' },
      ip: '10.0.0.5', // ALB private IP — must NOT be used
    };
    expect(await guard.exposeGetTracker(req)).toBe('203.0.113.42');
  });

  test('falls back to req.ip when cf-connecting-ip missing (local dev / direct connection)', async () => {
    const guard = makeGuard();
    const req = { headers: {}, ip: '127.0.0.1' };
    expect(await guard.exposeGetTracker(req)).toBe('127.0.0.1');
  });

  test('ignores empty cf-connecting-ip and falls back', async () => {
    const guard = makeGuard();
    const req = { headers: { 'cf-connecting-ip': '' }, ip: '127.0.0.1' };
    expect(await guard.exposeGetTracker(req)).toBe('127.0.0.1');
  });

  test('trims whitespace from cf-connecting-ip (same client = same bucket)', async () => {
    const guard = makeGuard();
    // A pretty-printing logging proxy or similar misconfiguration could
    // introduce stray whitespace. Without trimming, '203.0.113.42' and
    // ' 203.0.113.42 ' would land in different rate-limit buckets — same
    // attacker effectively gets 2× the limit.
    const reqA = { headers: { 'cf-connecting-ip': '203.0.113.42' }, ip: '10.0.0.5' };
    const reqB = { headers: { 'cf-connecting-ip': '  203.0.113.42  ' }, ip: '10.0.0.5' };
    const reqC = { headers: { 'cf-connecting-ip': '\t203.0.113.42\n' }, ip: '10.0.0.5' };
    const a = await guard.exposeGetTracker(reqA);
    const b = await guard.exposeGetTracker(reqB);
    const c = await guard.exposeGetTracker(reqC);
    expect(a).toBe('203.0.113.42');
    expect(b).toBe('203.0.113.42');
    expect(c).toBe('203.0.113.42');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test('falls back to req.ip when cf-connecting-ip is whitespace-only', async () => {
    const guard = makeGuard();
    const req = { headers: { 'cf-connecting-ip': '   ' }, ip: '127.0.0.1' };
    expect(await guard.exposeGetTracker(req)).toBe('127.0.0.1');
  });

  test('ignores non-string cf-connecting-ip (defence against header injection)', async () => {
    const guard = makeGuard();
    // Express normally normalises but a misbehaving middleware could leave
    // an array — we accept only strings to avoid using `.split()` on the
    // wrong type and crashing the whole guard.
    const req = {
      headers: { 'cf-connecting-ip': ['203.0.113.42', '203.0.113.99'] },
      ip: '127.0.0.1',
    };
    expect(await guard.exposeGetTracker(req)).toBe('127.0.0.1');
  });

  test("returns 'unknown' when neither header nor req.ip is set", async () => {
    const guard = makeGuard();
    expect(await guard.exposeGetTracker({ headers: {} })).toBe('unknown');
  });
});

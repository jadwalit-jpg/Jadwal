/**
 * Unit tests for RealIpThrottlerGuard.getTracker().
 *
 * getTracker is the keystone of every per-IP rate limit in the system —
 * if its IP-resolution priority drifts, the entire throttler quietly
 * collapses (e.g. behind Cloudflare → ALB everything ends up bucketed
 * on the ALB private IP and limits become a single shared counter).
 *
 * The method is `protected async`. We bypass the parent ThrottlerGuard
 * constructor entirely via Object.create(prototype) and call the method
 * directly — it's pure (no `this`-state beyond the prototype itself),
 * so this is a faithful invocation without dragging in
 * @nestjs/throttler dependencies.
 */

import { RealIpThrottlerGuard } from '../../src/common/guards/real-ip-throttler.guard';
import type { Request } from 'express';

// Construct a guard instance without invoking the parent ThrottlerGuard
// constructor (which expects options/storage/reflector). We only exercise
// getTracker, which doesn't touch any of those.
const guard = Object.create(RealIpThrottlerGuard.prototype) as RealIpThrottlerGuard;

// Type-laundered call into the protected method.
const getTracker = (req: Partial<Request>): Promise<string> =>
  (guard as unknown as { getTracker: (r: unknown) => Promise<string> }).getTracker(req);

function makeReq(headers: Record<string, unknown>, ip?: string): Partial<Request> {
  return { headers: headers as Request['headers'], ip };
}

describe('RealIpThrottlerGuard.getTracker', () => {
  it('returns cf-connecting-ip when present (the production hot path)', async () => {
    const req = makeReq({ 'cf-connecting-ip': '203.0.113.42' }, '10.0.0.1');
    await expect(getTracker(req)).resolves.toBe('203.0.113.42');
  });

  it('trims whitespace on cf-connecting-ip so identical IPs do not split buckets', async () => {
    // A logging proxy that pretty-prints headers could otherwise turn one
    // attacker into two throttle buckets, halving the effective limit.
    const req = makeReq({ 'cf-connecting-ip': '  203.0.113.42  ' }, '10.0.0.1');
    await expect(getTracker(req)).resolves.toBe('203.0.113.42');
  });

  it('falls back to req.ip when cf-connecting-ip is empty after trimming', async () => {
    // Defends against a forwarder that injects an empty cf-connecting-ip
    // header — without this fallback, the trimmed-empty string would
    // become the throttle key and lump every such request together.
    const req = makeReq({ 'cf-connecting-ip': '   ' }, '198.51.100.7');
    await expect(getTracker(req)).resolves.toBe('198.51.100.7');
  });

  it('falls back to req.ip when cf-connecting-ip header is missing', async () => {
    // Local-dev path (no Cloudflare in front) or any non-CF caller.
    const req = makeReq({}, '198.51.100.7');
    await expect(getTracker(req)).resolves.toBe('198.51.100.7');
  });

  it('falls back to req.ip when cf-connecting-ip is an array (multi-value header)', async () => {
    // Express may parse a duplicated header as string[]. The typeof check
    // rejects non-strings — we MUST NOT key on the raw value (would either
    // throw or stringify a comma-joined value that varies per request).
    const req = makeReq(
      { 'cf-connecting-ip': ['203.0.113.42', '203.0.113.99'] },
      '198.51.100.7',
    );
    await expect(getTracker(req)).resolves.toBe('198.51.100.7');
  });

  it('returns "unknown" only when both cf-connecting-ip and req.ip are absent', async () => {
    // Last-resort key. Lumping unknowns together under-throttles a
    // connection we couldn't identify rather than over-throttling real
    // users — the right trade-off (see guard's own JSDoc).
    const req = makeReq({}, undefined);
    await expect(getTracker(req)).resolves.toBe('unknown');
  });

  it('prefers cf-connecting-ip over req.ip when both are present', async () => {
    // req.ip behind a properly configured trust-proxy may already be the
    // real client IP, but cf-connecting-ip is the source of truth at the
    // edge of our trust boundary.
    const req = makeReq({ 'cf-connecting-ip': '203.0.113.42' }, '203.0.113.99');
    await expect(getTracker(req)).resolves.toBe('203.0.113.42');
  });
});

/**
 * EmailQuotaService.tryConsumePlatformDaily — platform-wide cost-runaway gate.
 *
 * Covers:
 *   - First send seeds the counter + sets a 24h TTL (atomic INCR semantics)
 *   - Subsequent sends within the 24h window increment without re-TTL
 *   - Cap exceeded → returns false + WARN
 *   - Limit configurable via EMAIL_QUOTA_PLATFORM_PER_DAY env override
 *   - Limit <= 0 disables the gate (returns true for tests / dev)
 *   - Redis error → fail-OPEN (return true), never blocks legit sends
 *     because of an infrastructure blip
 */

import { EmailQuotaService } from '../../src/email/email-quota.service';

function makeRedis() {
  const incr = jest.fn();
  const expire = jest.fn().mockResolvedValue(1);
  return {
    getClient: () => ({ incr, expire }),
    _incr: incr,
    _expire: expire,
  };
}

function makeConfig(overrides: Record<string, string> = {}) {
  return {
    get: (k: string, fallback?: string) => (k in overrides ? overrides[k] : fallback),
  };
}

function makeSut(redis = makeRedis(), config = makeConfig()) {
  const sut = new EmailQuotaService(redis as any, config as any);
  return { sut, redis };
}

describe('EmailQuotaService.tryConsumePlatformDaily', () => {
  test('first send: INCR returns 1 → set 24h TTL, allow', async () => {
    const { sut, redis } = makeSut();
    redis._incr.mockResolvedValueOnce(1);
    expect(await sut.tryConsumePlatformDaily()).toBe(true);
    expect(redis._incr).toHaveBeenCalledWith('email_quota_platform_total');
    expect(redis._expire).toHaveBeenCalledWith('email_quota_platform_total', 86400);
  });

  test('subsequent send within window: INCR returns >1 → no re-TTL, allow', async () => {
    const { sut, redis } = makeSut();
    redis._incr.mockResolvedValueOnce(42);
    expect(await sut.tryConsumePlatformDaily()).toBe(true);
    expect(redis._expire).not.toHaveBeenCalled();
  });

  test('cap exceeded (count > default 5000) → returns false', async () => {
    const { sut, redis } = makeSut();
    redis._incr.mockResolvedValueOnce(5001);
    expect(await sut.tryConsumePlatformDaily()).toBe(false);
  });

  test('exactly at cap (count === limit) → still allows the limit-th send', async () => {
    const { sut, redis } = makeSut();
    redis._incr.mockResolvedValueOnce(5000);
    expect(await sut.tryConsumePlatformDaily()).toBe(true);
  });

  test('env override EMAIL_QUOTA_PLATFORM_PER_DAY=10 → blocks 11th call', async () => {
    const { sut, redis } = makeSut(makeRedis(), makeConfig({ EMAIL_QUOTA_PLATFORM_PER_DAY: '10' }));
    redis._incr.mockResolvedValueOnce(11);
    expect(await sut.tryConsumePlatformDaily()).toBe(false);
  });

  test('env override to 0 → cap disabled, always allows', async () => {
    const { sut, redis } = makeSut(makeRedis(), makeConfig({ EMAIL_QUOTA_PLATFORM_PER_DAY: '0' }));
    expect(await sut.tryConsumePlatformDaily()).toBe(true);
    expect(redis._incr).not.toHaveBeenCalled();
  });

  test('Redis error → fail OPEN (true), never locks platform out on infra blip', async () => {
    const { sut, redis } = makeSut();
    redis._incr.mockRejectedValueOnce(new Error('connection reset'));
    expect(await sut.tryConsumePlatformDaily()).toBe(true);
  });
});

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { RedisService } from '../redis/redis.service';

/**
 * Per-account email-send budget (cost & abuse control).
 *
 * Why this exists on TOP of the per-IP @Throttle(STRICT) on auth endpoints:
 *
 *   Per-IP throttling caps the request RATE (3/min). It does NOT cap the
 *   total cost a single email address can incur over a day. An attacker
 *   waiting 20 seconds between forgot-password calls can stay under the
 *   throttle for hours — burning thousands of SES sends to a victim's
 *   inbox (mailbomb) or to non-existent recipients (SES bounce-rate damage,
 *   sender-reputation hit, real $$$).
 *
 * What this does:
 *
 *   Per-account daily counter in Redis. Once the count exceeds the
 *   configured cap, further sends for that recipient are silently dropped
 *   for the rest of the 24-hour window. The endpoint still returns its
 *   normal anti-enumeration success response, so the attacker can't tell
 *   when the cap kicked in (otherwise they'd just rotate to the next email).
 *
 * Per-(IP + account) angle:
 *
 *   This service indexes by recipient email — that's the (account) side.
 *   The per-IP @Throttle decorator on the controller still handles the (IP)
 *   side. Combined, you get per-(IP + account) protection without a
 *   second guard layer.
 *
 * Failure mode:
 *
 *   If Redis is unreachable, we fail OPEN (allow the send). Reason: a
 *   broken Redis shouldn't lock legitimate users out of password recovery.
 *   The per-IP throttle still applies, and the SES per-account quota
 *   acts as a hard ceiling. We log Redis errors but don't surface them.
 */
@Injectable()
export class EmailQuotaService {
  private readonly logger = new Logger(EmailQuotaService.name);

  // Per-type daily caps. Tuned for a real user's worst-case legitimate
  // usage in a single day, with comfortable margin:
  //   - reset:        forgot password 5x (typo, lost, retry) → 5/day
  //   - verification: signup + 4 resends → 5/day
  //   - notification: max once per real password change → 3/day
  //
  // Override per-environment via `EMAIL_QUOTA_<TYPE>_PER_DAY` env vars.
  private readonly defaults: Record<EmailQuotaType, number> = {
    reset: 5,
    verification: 5,
    'change-notification': 3,
  };

  // Progressive cooldown between successive sends to the same recipient,
  // indexed by the count *after* this send (i.e. cooldownAfterSendMs[2] is
  // the wait required between the 2nd and 3rd send). This stops the
  // "wait 3 min × N" abuse pattern where an attacker cycles through the
  // per-IP @Throttle(3/min) all day. Legit users almost never hit this:
  //   - Typo retry: 1 min cooldown (immediate-ish)
  //   - Lost-mail retry: 5 min cooldown (still tolerable)
  //   - Beyond that: hours, which is the abuse range.
  // First send (count=1) has no cooldown; the array is 1-indexed via the
  // `count` value returned by INCR.
  private readonly cooldownAfterSendMs: number[] = [
    0,                  // unused (counts start at 1)
    60 * 1000,          // after 1st send, wait 1 min before 2nd
    5 * 60 * 1000,      // after 2nd send, wait 5 min before 3rd
    15 * 60 * 1000,     // after 3rd send, wait 15 min before 4th
    60 * 60 * 1000,     // after 4th send, wait 60 min before 5th
  ];

  constructor(
    private redis: RedisService,
    private config: ConfigService,
  ) {}

  /**
   * Two-layer check: progressive cooldown since last send, then atomic
   * daily-counter increment. Returns true if the send is within both
   * budgets. On overage we fail closed (no email goes out). On Redis
   * outage we fail open (legitimate user must not be locked out of
   * password recovery by infra).
   */
  async tryConsume(email: string, type: EmailQuotaType): Promise<boolean> {
    const limit = this.getLimit(type);
    if (limit <= 0) return true; // 0 means "disabled" — useful for tests

    const counterKey = this.makeKey(email, type);
    const lastSentKey = this.makeLastSentKey(email, type);

    try {
      const client = this.redis.getClient();

      // ─── Layer 1: progressive cooldown ──────────────────────────────
      // Look up the timestamp of the previous send and the current count.
      // If we're inside the cooldown window for the current count, drop
      // this send without bumping the counter (so legit users don't lose
      // budget when they hit cooldown by accident).
      const [lastSentRaw, prevCountRaw] = await client.mget(lastSentKey, counterKey);
      const lastSent = lastSentRaw ? Number(lastSentRaw) : 0;
      const prevCount = prevCountRaw ? Number(prevCountRaw) : 0;

      if (lastSent > 0 && prevCount > 0 && prevCount < this.cooldownAfterSendMs.length) {
        const requiredWait = this.cooldownAfterSendMs[prevCount];
        const elapsed = Date.now() - lastSent;
        if (elapsed < requiredWait) {
          this.logger.warn(
            `email-quota cooldown blocked type=${type} hash=${this.hashEmail(email).slice(0, 8)} elapsed=${elapsed}ms required=${requiredWait}ms count=${prevCount}`,
          );
          return false;
        }
      }

      // ─── Layer 2: daily counter ─────────────────────────────────────
      // INCR is atomic. EXPIRE on first hit pins the 24h window from the
      // first send, not from the most recent one — so an attacker can't
      // perpetually extend the window by bumping the counter.
      const count = await client.incr(counterKey);
      if (count === 1) {
        await client.expire(counterKey, 24 * 60 * 60);
      }

      if (count > limit) {
        this.logger.warn(
          `email-quota exceeded type=${type} hash=${this.hashEmail(email).slice(0, 8)} count=${count} limit=${limit}`,
        );
        return false;
      }

      // Stamp the timestamp AFTER both checks pass. TTL pinned to the same
      // 24h window so it doesn't outlive the counter.
      await client.set(lastSentKey, String(Date.now()), 'EX', 24 * 60 * 60);

      return true;
    } catch (err) {
      // Fail OPEN — Redis blip should never lock a real user out of
      // recovering their account. Per-IP throttle + SES quota still apply.
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(`email-quota redis check failed (${kind}) — allowing send`);
      return true;
    }
  }

  private getLimit(type: EmailQuotaType): number {
    const envKey = `EMAIL_QUOTA_${type.replace('-', '_').toUpperCase()}_PER_DAY`;
    const fromEnv = this.config.get<string>(envKey);
    if (fromEnv && !Number.isNaN(Number(fromEnv))) return Number(fromEnv);
    return this.defaults[type];
  }

  // We hash the email so Redis (and any log spill) never carries the raw
  // recipient address. Lower-cased + trimmed first to make `User@x.com` and
  // `user@x.com` collide on the same counter.
  private hashEmail(email: string): string {
    return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  }

  private makeKey(email: string, type: EmailQuotaType): string {
    return `email_quota:${type}:${this.hashEmail(email)}`;
  }

  private makeLastSentKey(email: string, type: EmailQuotaType): string {
    return `email_quota_ts:${type}:${this.hashEmail(email)}`;
  }

  /**
   * Per-IP daily cap on email TRIGGERS — closes the "per-(IP + account)"
   * gap noted in the auth audit. Without this, a single IP could pivot
   * through many victim emails at full per-IP throttle (3/min) and burn
   * thousands of SES sends per day even with the per-account cap of 5.
   *
   * Default cap is 50 sends/IP/day across ALL types, generous enough for
   * a busy office or NAT'd household but tight enough to make a cycling
   * attack uneconomical. Override via `EMAIL_QUOTA_PER_IP_PER_DAY`.
   *
   * Returns true if the IP is within budget. Fails open on Redis error.
   */
  async tryConsumePerIp(ip: string | undefined): Promise<boolean> {
    if (!ip) return true; // Can't enforce without an IP — don't block.
    const limit = Number(this.config.get('EMAIL_QUOTA_PER_IP_PER_DAY', '50'));
    if (limit <= 0) return true; // disabled

    const key = `email_quota_ip:${this.hashEmail(ip)}`;
    try {
      const client = this.redis.getClient();
      const count = await client.incr(key);
      if (count === 1) {
        await client.expire(key, 24 * 60 * 60);
      }
      if (count > limit) {
        this.logger.warn(
          `email-quota per-IP exceeded ipHash=${this.hashEmail(ip).slice(0, 8)} count=${count} limit=${limit}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(`email-quota per-IP redis check failed (${kind}) — allowing send`);
      return true;
    }
  }

  /**
   * Platform-wide daily send circuit breaker. A SINGLE counter across all
   * users / templates / IPs — the absolute ceiling on outbound volume per
   * 24h. Designed as a cost-runaway gate: even if every other quota fails
   * in a way that lets traffic through, this caps total spend at a known
   * amount.
   *
   * Why this matters:
   *   AWS SES production-access quotas typically start at 50K/day and
   *   ramp up. Without an in-app cap, a code bug or unusual traffic
   *   pattern could spend the full AWS budget before anyone notices —
   *   at $0.10/1K emails that's $5/day at 50K, much higher at higher
   *   tiers. This counter is the hard ceiling that bounds runaway spend.
   *
   *   Default 5,000/day is comfortably above legitimate steady-state for
   *   a launch-phase platform; override via `EMAIL_QUOTA_PLATFORM_PER_DAY`
   *   without a code change as you scale.
   *
   * Semantics:
   *   - INCR-then-check is atomic, no race. First call sets a 24h TTL
   *     so the counter rolls over without manual intervention.
   *   - Returns true if the send is within budget. Fails OPEN on Redis
   *     error (the per-recipient + per-IP caps are still active and
   *     bound the worst case during an outage).
   *   - Cap exceeded → returns false. Caller (EmailService.send) treats
   *     this identically to a suppressed recipient: returns success-shaped
   *     so anti-enumeration is preserved on /forgot-password etc.
   */
  async tryConsumePlatformDaily(): Promise<boolean> {
    const limit = Number(this.config.get('EMAIL_QUOTA_PLATFORM_PER_DAY', '5000'));
    if (limit <= 0) return true; // disabled — useful for tests / dev

    const key = 'email_quota_platform_total';
    try {
      const client = this.redis.getClient();
      const count = await client.incr(key);
      if (count === 1) {
        await client.expire(key, 24 * 60 * 60);
      }
      if (count > limit) {
        // WARN level — operators should treat sustained breach as an
        // incident (either real growth past the cap, or an abuse spike).
        this.logger.warn(
          `email-quota PLATFORM-WIDE cap exceeded count=${count} limit=${limit} — blocking remaining sends for the 24h window`,
        );
        return false;
      }
      return true;
    } catch (err) {
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(
        `email-quota platform-daily redis check failed (${kind}) — allowing send`,
      );
      return true;
    }
  }
}

export type EmailQuotaType = 'reset' | 'verification' | 'change-notification';

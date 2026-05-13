import { CircuitBreaker, CircuitBreakerOpenError, withTimeout } from '../../src/common/utils/circuit-breaker';

describe('CircuitBreaker', () => {
  it('passes through calls and stays CLOSED on success', async () => {
    const cb = new CircuitBreaker({ name: 't', failureThreshold: 3, openTimeoutMs: 1000 });
    expect(cb.getState()).toBe('CLOSED');
    await expect(cb.run(async () => 42)).resolves.toBe(42);
    await expect(cb.run(async () => 'ok')).resolves.toBe('ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens after `failureThreshold` consecutive failures', async () => {
    const cb = new CircuitBreaker({ name: 't', failureThreshold: 3, openTimeoutMs: 1000 });
    const boom = async () => { throw new Error('upstream broken'); };
    await expect(cb.run(boom)).rejects.toThrow('upstream broken');
    await expect(cb.run(boom)).rejects.toThrow('upstream broken');
    expect(cb.getState()).toBe('CLOSED');
    await expect(cb.run(boom)).rejects.toThrow('upstream broken');
    expect(cb.getState()).toBe('OPEN');
  });

  it('OPEN → fails fast with CircuitBreakerOpenError; fn is NOT called', async () => {
    const cb = new CircuitBreaker({ name: 't', failureThreshold: 1, openTimeoutMs: 5000 });
    await expect(cb.run(async () => { throw new Error('nope'); })).rejects.toThrow('nope');
    expect(cb.getState()).toBe('OPEN');

    const spy = jest.fn(async () => 'should not run');
    await expect(cb.run(spy)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('OPEN → HALF_OPEN after openTimeoutMs; success closes the breaker', async () => {
    const cb = new CircuitBreaker({ name: 't', failureThreshold: 1, openTimeoutMs: 50 });
    await expect(cb.run(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    await new Promise((r) => setTimeout(r, 60)); // wait past openTimeoutMs

    await expect(cb.run(async () => 'recovered')).resolves.toBe('recovered');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('HALF_OPEN → failure re-opens the breaker (new cooldown)', async () => {
    const cb = new CircuitBreaker({ name: 't', failureThreshold: 1, openTimeoutMs: 50 });
    await expect(cb.run(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    await new Promise((r) => setTimeout(r, 60));

    // Probe call fails — state should snap back to OPEN
    await expect(cb.run(async () => { throw new Error('still broken'); })).rejects.toThrow('still broken');
    expect(cb.getState()).toBe('OPEN');

    // And the new cooldown means immediate next call gets CircuitBreakerOpenError
    await expect(cb.run(async () => 'unreachable')).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });

  it('disabled: true → no state changes, always passes through (kill switch)', async () => {
    const onStateChange = jest.fn();
    const cb = new CircuitBreaker({ name: 't', failureThreshold: 1, openTimeoutMs: 1000, disabled: true, onStateChange });
    await expect(cb.run(async () => { throw new Error('a'); })).rejects.toThrow('a');
    await expect(cb.run(async () => { throw new Error('b'); })).rejects.toThrow('b');
    await expect(cb.run(async () => { throw new Error('c'); })).rejects.toThrow('c');
    // disabled means no state machine touched
    expect(cb.getState()).toBe('CLOSED');
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('onStateChange fires on transitions with correct from/to/count', async () => {
    const events: Array<{ from: string; to: string; count: number }> = [];
    const cb = new CircuitBreaker({
      name: 't',
      failureThreshold: 2,
      openTimeoutMs: 50,
      onStateChange: (e) => events.push({ from: e.from, to: e.to, count: e.consecutiveFailures }),
    });
    await expect(cb.run(async () => { throw new Error('1'); })).rejects.toThrow();
    expect(events).toEqual([]); // 1 failure, not at threshold yet
    await expect(cb.run(async () => { throw new Error('2'); })).rejects.toThrow();
    expect(events).toEqual([{ from: 'CLOSED', to: 'OPEN', count: 2 }]);

    await new Promise((r) => setTimeout(r, 60));
    await expect(cb.run(async () => 'good')).resolves.toBe('good');
    expect(events).toEqual([
      { from: 'CLOSED', to: 'OPEN', count: 2 },
      { from: 'OPEN', to: 'HALF_OPEN', count: 2 },
      { from: 'HALF_OPEN', to: 'CLOSED', count: 0 },
    ]);
  });

  it('a single success in CLOSED resets the consecutive-failure counter', async () => {
    const cb = new CircuitBreaker({ name: 't', failureThreshold: 3, openTimeoutMs: 1000 });
    await expect(cb.run(async () => { throw new Error('a'); })).rejects.toThrow();
    await expect(cb.run(async () => { throw new Error('b'); })).rejects.toThrow();
    expect(cb.getState()).toBe('CLOSED'); // 2 failures, not yet at threshold

    await expect(cb.run(async () => 'reset')).resolves.toBe('reset');
    // Counter is back to 0 — need 3 *more* consecutive failures to open
    await expect(cb.run(async () => { throw new Error('a'); })).rejects.toThrow();
    await expect(cb.run(async () => { throw new Error('b'); })).rejects.toThrow();
    expect(cb.getState()).toBe('CLOSED');
  });

  describe('constructor validation', () => {
    it('throws on NaN failureThreshold (typical env-parse footgun)', () => {
      expect(() => new CircuitBreaker({ name: 't', failureThreshold: Number('not-a-number') })).toThrow(
        /failureThreshold must be a positive integer/,
      );
    });

    it('throws on zero or negative failureThreshold', () => {
      expect(() => new CircuitBreaker({ name: 't', failureThreshold: 0 })).toThrow(/positive integer/);
      expect(() => new CircuitBreaker({ name: 't', failureThreshold: -5 })).toThrow(/positive integer/);
    });

    it('throws on non-integer failureThreshold (silent disable hazard)', () => {
      expect(() => new CircuitBreaker({ name: 't', failureThreshold: 2.5 })).toThrow(/positive integer/);
    });

    it('throws on NaN or negative openTimeoutMs', () => {
      expect(() => new CircuitBreaker({ name: 't', openTimeoutMs: Number.NaN })).toThrow(
        /openTimeoutMs must be a non-negative finite number/,
      );
      expect(() => new CircuitBreaker({ name: 't', openTimeoutMs: -1 })).toThrow(/non-negative/);
      expect(() => new CircuitBreaker({ name: 't', openTimeoutMs: Number.POSITIVE_INFINITY })).toThrow(/finite/);
    });

    it('accepts the defaults (no opts beyond name) and works correctly', async () => {
      const cb = new CircuitBreaker({ name: 't' });
      await expect(cb.run(async () => 'ok')).resolves.toBe('ok');
    });
  });

  describe('HALF_OPEN single-probe invariant', () => {
    it('only the first concurrent caller probes; the rest fail-fast', async () => {
      const cb = new CircuitBreaker({ name: 't', failureThreshold: 1, openTimeoutMs: 30 });
      await expect(cb.run(async () => { throw new Error('initial'); })).rejects.toThrow();
      expect(cb.getState()).toBe('OPEN');

      // Wait past the cooldown
      await new Promise((r) => setTimeout(r, 40));

      // Three concurrent callers — only one should reach `fn`, the other two
      // should get CircuitBreakerOpenError immediately.
      const calls = jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return 'probe-ok';
      });

      const results = await Promise.allSettled([cb.run(calls), cb.run(calls), cb.run(calls)]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      // Exactly one probe ran and succeeded; the other two were rejected fast.
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(2);
      expect(calls).toHaveBeenCalledTimes(1);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(CircuitBreakerOpenError);
      }
      // After the successful probe completes, breaker should be CLOSED again.
      expect(cb.getState()).toBe('CLOSED');
    });

    it('releases the probe slot when the probe fails (re-opens cleanly)', async () => {
      const cb = new CircuitBreaker({ name: 't', failureThreshold: 1, openTimeoutMs: 30 });
      await expect(cb.run(async () => { throw new Error('initial'); })).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 40));

      // Probe fails — state goes back to OPEN, slot is released so the NEXT
      // cooldown lets a new probe through.
      await expect(cb.run(async () => { throw new Error('still broken'); })).rejects.toThrow('still broken');
      expect(cb.getState()).toBe('OPEN');

      // Wait past second cooldown
      await new Promise((r) => setTimeout(r, 40));
      await expect(cb.run(async () => 'now-fixed')).resolves.toBe('now-fixed');
      expect(cb.getState()).toBe('CLOSED');
    });
  });
});

describe('withTimeout', () => {
  it('resolves with the fn result when it returns in time', async () => {
    const result = await withTimeout(async () => 'fast', 1000);
    expect(result).toBe('fast');
  });

  it('passes an AbortSignal that gets aborted on timeout', async () => {
    let captured: AbortSignal | undefined;
    const slow = (signal: AbortSignal) => new Promise<string>((resolve, reject) => {
      captured = signal;
      // Resolve when aborted, so we observe the abort happened
      signal.addEventListener('abort', () => reject(new Error('abort observed')));
      // Otherwise resolve too late
      setTimeout(() => resolve('never reaches'), 1000);
    });
    await expect(withTimeout(slow, 30)).rejects.toThrow('abort observed');
    expect(captured?.aborted).toBe(true);
  });

  it('clears the timeout when fn resolves first (no orphaned timer)', async () => {
    // If this leaks, the jest worker would not exit cleanly. We just assert the call returns.
    await expect(withTimeout(async () => 'x', 5_000)).resolves.toBe('x');
  });
});

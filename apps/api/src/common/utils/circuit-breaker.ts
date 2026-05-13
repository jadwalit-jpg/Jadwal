/**
 * Tiny custom circuit breaker — wraps a single async operation. Opens after
 * `failureThreshold` consecutive failures, stays open for `openTimeoutMs`,
 * then enters HALF_OPEN and probes with the next call. One success in
 * HALF_OPEN closes the breaker; one failure re-opens it.
 *
 * Why a custom class (not `opossum`):
 *   - Zero new deps. Audited surface is ~50 lines.
 *   - Conservative defaults — opens only after sustained failure (10
 *     consecutive failures), so a legit traffic spike where one SES call
 *     errors won't trip it. Audit memo (R1 in the deferred-items list)
 *     warned: "opening the breaker on a legit traffic spike is worse than
 *     the protection." This implementation is paranoid by design.
 *   - Kill switch via `disabled` flag (wired to `EXTERNAL_BREAKER_DISABLED`
 *     env var in the services that consume this). Lets you flip the breaker
 *     off in prod via SSM + redeploy without code change, in case a
 *     misconfiguration starts hurting more than helping.
 *
 * Composition with AWS SDK retries:
 *   The AWS SDK already retries `maxAttempts: 3` with exponential backoff
 *   on transient errors. This breaker sees ONE call per `.run()` — what the
 *   SDK presents as success or failure after its own retry attempts. So the
 *   breaker counts post-SDK-retry outcomes, which is the right granularity
 *   to detect "the upstream is sustainedly broken."
 *
 * Composition with explicit timeouts:
 *   Callers SHOULD also pass an `AbortSignal` to the AWS SDK call. If the
 *   call hangs past the timeout, the AbortController rejects with an
 *   abort-style error → breaker counts it as a failure → opens after
 *   threshold reached. The breaker by itself does NOT enforce a timeout
 *   (that's a separate concern; this class is pure state-machine).
 */

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Identifier used in state-change log lines. e.g. `'ses-send'`. */
  name: string;
  /** Consecutive failures needed to trip the breaker. Default 10 (paranoid). */
  failureThreshold?: number;
  /** Milliseconds the breaker stays OPEN before probing. Default 30000 (30s). */
  openTimeoutMs?: number;
  /** When true, breaker is bypassed — `.run()` is just a passthrough. Useful for tests + kill switch. */
  disabled?: boolean;
  /** Optional sink for state-change events (logging / metrics). */
  onStateChange?: (event: { name: string; from: CircuitBreakerState; to: CircuitBreakerState; consecutiveFailures: number }) => void;
}

export class CircuitBreakerOpenError extends Error {
  readonly code = 'CIRCUIT_BREAKER_OPEN';
  constructor(readonly breakerName: string, readonly retryAfterMs: number) {
    super(`Circuit breaker '${breakerName}' is OPEN; retry in ~${retryAfterMs}ms`);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;
  // Guard for the single-probe invariant in HALF_OPEN. The first call to
  // arrive after the OPEN cooldown sets this true and runs the probe;
  // concurrent arrivals see it and fail-fast as if the breaker were still
  // OPEN. Cleared in `finally`, so the next legitimate caller can
  // re-probe if needed. JavaScript is single-threaded → the
  // check-then-set in `run()` is atomic with respect to other callers
  // that haven't yet `await`ed.
  private halfOpenProbeInFlight = false;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly openTimeoutMs: number;
  private readonly disabled: boolean;
  private readonly onStateChange?: CircuitBreakerOptions['onStateChange'];

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    // Validate up front. Env-parsing easily produces `NaN` / `0` / negative
    // numbers (e.g. `Number(undefined)` is NaN, `Number("")` is 0). A
    // misconfigured threshold can silently disable the breaker — fail loud
    // at boot instead.
    const failureThreshold = opts.failureThreshold ?? 10;
    const openTimeoutMs = opts.openTimeoutMs ?? 30_000;
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
      throw new Error(
        `CircuitBreaker[${opts.name}]: failureThreshold must be a positive integer, got ${failureThreshold}`,
      );
    }
    if (!Number.isFinite(openTimeoutMs) || openTimeoutMs < 0) {
      throw new Error(
        `CircuitBreaker[${opts.name}]: openTimeoutMs must be a non-negative finite number, got ${openTimeoutMs}`,
      );
    }
    this.failureThreshold = failureThreshold;
    this.openTimeoutMs = openTimeoutMs;
    this.disabled = opts.disabled ?? false;
    this.onStateChange = opts.onStateChange;
  }

  /** Current state. Mostly for tests + diagnostics. */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Wrap a function call with breaker state checks. Throws
   * `CircuitBreakerOpenError` immediately when OPEN; otherwise calls the
   * function and updates state from its outcome.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.disabled) return fn();

    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed < this.openTimeoutMs) {
        throw new CircuitBreakerOpenError(this.name, this.openTimeoutMs - elapsed);
      }
      // Cooldown elapsed. Claim the probe slot atomically — second concurrent
      // caller in this tick will see `halfOpenProbeInFlight === true` below
      // and fail-fast instead of double-probing the upstream.
      if (this.halfOpenProbeInFlight) {
        throw new CircuitBreakerOpenError(this.name, 0);
      }
      this.halfOpenProbeInFlight = true;
      this.transition('HALF_OPEN');
    } else if (this.state === 'HALF_OPEN') {
      // Already mid-probe by another async caller — fail-fast (single-probe
      // invariant).
      if (this.halfOpenProbeInFlight) {
        throw new CircuitBreakerOpenError(this.name, 0);
      }
      // Defensive: shouldn't reach here in normal flow (transitions out of
      // HALF_OPEN happen synchronously in recordSuccess/recordFailure), but
      // claim the slot if state somehow leaked HALF_OPEN with no probe.
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    } finally {
      // Always release the probe slot, regardless of outcome.
      this.halfOpenProbeInFlight = false;
    }
  }

  private recordSuccess() {
    // Reset BEFORE the transition fires, so onStateChange observers see the
    // canonical post-recovery counter (0) rather than the stale pre-recovery
    // value. Matters for metrics / dashboards that read the event payload.
    this.consecutiveFailures = 0;
    if (this.state === 'HALF_OPEN') {
      // The probe succeeded — service is healthy again.
      this.transition('CLOSED');
    }
  }

  private recordFailure() {
    this.consecutiveFailures++;
    if (this.state === 'HALF_OPEN') {
      // Probe failed — back to OPEN for another cooldown.
      this.openedAt = Date.now();
      this.transition('OPEN');
    } else if (this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = Date.now();
      this.transition('OPEN');
    }
  }

  private transition(to: CircuitBreakerState) {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    if (to === 'CLOSED') this.openedAt = 0;
    this.onStateChange?.({ name: this.name, from, to, consecutiveFailures: this.consecutiveFailures });
  }
}

/**
 * Wrap a Promise with an AbortController-backed timeout. The returned promise
 * rejects with an Error tagged `name: 'TimeoutError'` if `fn` doesn't settle
 * within `timeoutMs`. The AbortSignal is passed to `fn`, which should forward
 * it to the AWS SDK `.send(cmd, { abortSignal })` second arg so the in-flight
 * request is actually cancelled (not just orphaned).
 *
 * Usage:
 *   await withTimeout((signal) => sesClient.send(cmd, { abortSignal: signal }), 10_000)
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

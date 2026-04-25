import {
  bookingStatusLabel,
  paymentStatusLabel,
  payoutStatusLabel,
  vendorStatusLabel,
  payoutRequestStatusLabel,
} from '@/lib/status-labels';
import type { TFunction } from 'i18next';

// A minimal stand-in for the real i18next TFunction. Every helper we test
// calls t(key, { defaultValue }) — we record what was requested so we can
// assert the correct key shape AND verify the fallback path.
function makeT(overrides: Record<string, string> = {}): TFunction {
  const fn = ((key: string, opts?: { defaultValue?: string }) => {
    if (overrides[key] !== undefined) return overrides[key];
    return opts?.defaultValue ?? key;
  }) as unknown as TFunction;
  return fn;
}

describe('status-labels', () => {
  describe('bookingStatusLabel', () => {
    it('looks up `status.booking.<s>` and returns the translation', () => {
      const t = makeT({ 'status.booking.PENDING': 'Pending' });
      expect(bookingStatusLabel(t, 'PENDING')).toBe('Pending');
    });

    it.each(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const)(
      'builds the namespaced key correctly for %s',
      (status) => {
        const spy = jest.fn((k: string, opts: any) => opts?.defaultValue ?? k);
        bookingStatusLabel(spy as any, status);
        expect(spy).toHaveBeenCalledWith(`status.booking.${status}`, {
          defaultValue: status,
        });
      },
    );

    it('falls back to the raw enum value when the key is missing (never blank)', () => {
      const t = makeT(); // no overrides
      expect(bookingStatusLabel(t, 'PENDING')).toBe('PENDING');
    });

    it('accepts unknown strings from the backend without crashing', () => {
      const t = makeT();
      // If a future backend enum value leaks through, we surface it raw —
      // ugly, but never blank. QA sees it, parity test catches the missing key.
      expect(bookingStatusLabel(t, 'WEIRD_FUTURE_STATUS')).toBe('WEIRD_FUTURE_STATUS');
    });
  });

  describe('paymentStatusLabel', () => {
    it.each([
      'PENDING', 'SUCCESS', 'REFUND_PENDING', 'REFUNDED', 'REJECTED', 'FAILED',
    ] as const)('builds the key for %s', (s) => {
      const spy = jest.fn((k: string, opts: any) => opts?.defaultValue ?? k);
      paymentStatusLabel(spy as any, s);
      expect(spy).toHaveBeenCalledWith(`status.payment.${s}`, { defaultValue: s });
    });

    it('returns translated label when present', () => {
      const t = makeT({ 'status.payment.REFUNDED': 'Refunded' });
      expect(paymentStatusLabel(t, 'REFUNDED')).toBe('Refunded');
    });
  });

  describe('payoutStatusLabel', () => {
    it.each(['UNPAID', 'PAID'] as const)('builds the key for %s', (s) => {
      const spy = jest.fn((k: string, opts: any) => opts?.defaultValue ?? k);
      payoutStatusLabel(spy as any, s);
      expect(spy).toHaveBeenCalledWith(`status.payout.${s}`, { defaultValue: s });
    });
  });

  describe('vendorStatusLabel', () => {
    it.each(['PENDING', 'ACTIVE', 'SUSPENDED'] as const)('builds the key for %s', (s) => {
      const spy = jest.fn((k: string, opts: any) => opts?.defaultValue ?? k);
      vendorStatusLabel(spy as any, s);
      expect(spy).toHaveBeenCalledWith(`status.vendor.${s}`, { defaultValue: s });
    });

    it('falls back to raw value on missing key', () => {
      const t = makeT();
      expect(vendorStatusLabel(t, 'SUSPENDED')).toBe('SUSPENDED');
    });
  });

  describe('payoutRequestStatusLabel', () => {
    it.each(['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'] as const)(
      'builds the key for %s',
      (s) => {
        const spy = jest.fn((k: string, opts: any) => opts?.defaultValue ?? k);
        payoutRequestStatusLabel(spy as any, s);
        expect(spy).toHaveBeenCalledWith(`status.payoutRequest.${s}`, {
          defaultValue: s,
        });
      },
    );
  });

  it('uses distinct namespaces so booking.PENDING never collides with vendor.PENDING', () => {
    const t = makeT({
      'status.booking.PENDING': 'Awaiting payment',
      'status.vendor.PENDING': 'Awaiting admin approval',
      'status.payoutRequest.PENDING': 'Queued',
    });
    expect(bookingStatusLabel(t, 'PENDING')).toBe('Awaiting payment');
    expect(vendorStatusLabel(t, 'PENDING')).toBe('Awaiting admin approval');
    expect(payoutRequestStatusLabel(t, 'PENDING')).toBe('Queued');
  });
});

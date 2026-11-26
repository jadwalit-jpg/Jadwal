/**
 * Gateway-rescue rules: when the customer page says "being confirmed with
 * your bank" (and hides Pay / Cancel), and when the admin page offers
 * "Mark as paid".
 */
import { canMarkPaymentPaid, gatewayReportLabel, hasGatewayReport, isAwaitingBankConfirmation } from '../../src/lib/booking-gateway';

const base = { status: 'PENDING', method: 'PAY2M', gatewayBasketId: 'JDWL-abc-123' };

describe('hasGatewayReport / isAwaitingBankConfirmation', () => {
  it('is true for a held NAPS success or an unverified success callback, while not SUCCESS', () => {
    expect(hasGatewayReport({ ...base, napsHeldAt: '2026-11-22T07:12:00Z' })).toBe(true);
    expect(hasGatewayReport({ ...base, unverifiedCallbackAt: '2026-11-22T07:12:00Z', unverifiedCallbackErrCode: '000' })).toBe(true);
    expect(hasGatewayReport({ ...base, status: 'FAILED', unverifiedCallbackAt: '2026-11-22T07:12:00Z' })).toBe(true);
    expect(hasGatewayReport({ ...base })).toBe(false);
    expect(hasGatewayReport({ ...base, status: 'SUCCESS', napsHeldAt: '2026-11-22T07:12:00Z' })).toBe(false);
    expect(hasGatewayReport(null)).toBe(false);
  });

  it('the customer banner shows only while the booking is still PENDING', () => {
    const payment = { ...base, unverifiedCallbackAt: '2026-11-22T07:12:00Z' };
    expect(isAwaitingBankConfirmation({ status: 'PENDING', payment })).toBe(true);
    expect(isAwaitingBankConfirmation({ status: 'CANCELLED', payment })).toBe(false);
    expect(isAwaitingBankConfirmation({ status: 'CONFIRMED', payment: { ...payment, status: 'SUCCESS' } })).toBe(false);
    expect(isAwaitingBankConfirmation({ status: 'PENDING', payment: { ...base } })).toBe(false);
    expect(isAwaitingBankConfirmation(undefined)).toBe(false);
  });
});

describe('canMarkPaymentPaid', () => {
  it('needs a PAY2M payment with a basket, PENDING or FAILED, on a PENDING or CANCELLED booking', () => {
    expect(canMarkPaymentPaid({ status: 'PENDING', payment: { ...base } })).toBe(true);
    expect(canMarkPaymentPaid({ status: 'CANCELLED', payment: { ...base, status: 'FAILED' } })).toBe(true);
    expect(canMarkPaymentPaid({ status: 'CONFIRMED', payment: { ...base } })).toBe(false);
    expect(canMarkPaymentPaid({ status: 'PENDING', payment: { ...base, status: 'SUCCESS' } })).toBe(false);
    expect(canMarkPaymentPaid({ status: 'PENDING', payment: { ...base, status: 'REFUND_PENDING' } })).toBe(false);
    expect(canMarkPaymentPaid({ status: 'PENDING', payment: { ...base, gatewayBasketId: null } })).toBe(false);
    expect(canMarkPaymentPaid({ status: 'PENDING', payment: { ...base, method: 'WANASA_POINTS' } })).toBe(false);
    expect(canMarkPaymentPaid({ status: 'PENDING', payment: null })).toBe(false);
  });
});

describe('gatewayReportLabel', () => {
  it('names the hold or the unverified callback, nothing otherwise', () => {
    expect(gatewayReportLabel({ ...base, napsHeldAt: '2026-11-22T07:12:00Z' })).toBe('Paid at gateway · awaiting confirmation');
    expect(gatewayReportLabel({ ...base, unverifiedCallbackAt: '2026-11-22T07:12:00Z', unverifiedCallbackErrCode: '000' })).toBe('Gateway reported success (code 000) · not verified');
    expect(gatewayReportLabel({ ...base, unverifiedCallbackAt: '2026-11-22T07:12:00Z' })).toBe('Gateway reported success · not verified');
    expect(gatewayReportLabel({ ...base })).toBeNull();
    expect(gatewayReportLabel({ ...base, status: 'SUCCESS', napsHeldAt: 'x' })).toBeNull();
  });
});

/**
 * Gateway-rescue rules shared by the customer booking page and the admin
 * bookings page. The API stamps a payment when PAY2M reported it but the site
 * could not confirm it: `napsHeldAt` (a verified debit-card success held for
 * the bank's confirmation) or `unverifiedCallbackAt` (a success-looking
 * callback whose signature did not verify). Either way the money may have
 * been taken, so the customer must not pay again and an admin can confirm the
 * payment by hand ("Mark as paid").
 */

export interface GatewayPaymentMarks {
  status: string;
  method?: string | null;
  napsHeldAt?: string | null;
  unverifiedCallbackAt?: string | null;
  unverifiedCallbackErrCode?: string | null;
  gatewayBasketId?: string | null;
  manualConfirmedAt?: string | null;
}

/** The gateway reported this payment and the site has not confirmed it yet. */
export function hasGatewayReport(payment: GatewayPaymentMarks | null | undefined): boolean {
  if (!payment || payment.status === 'SUCCESS') return false;
  return Boolean(payment.napsHeldAt || payment.unverifiedCallbackAt);
}

/**
 * Customer page: show "payment received, being confirmed with your bank" and
 * hide Pay / Cancel. Only while the booking is still PENDING — a cancelled
 * booking is the customer's own decision and shows as cancelled.
 */
export function isAwaitingBankConfirmation(
  booking: { status: string; payment?: GatewayPaymentMarks | null } | null | undefined,
): boolean {
  return !!booking && booking.status === 'PENDING' && hasGatewayReport(booking.payment);
}

/**
 * Admin page: "Mark as paid" is offered for a PAY2M payment that reached the
 * gateway (has a basket) and is still PENDING or FAILED, on a booking that is
 * PENDING or CANCELLED. The server re-checks everything; this only decides
 * whether to show the button.
 */
export function canMarkPaymentPaid(
  booking: { status: string; payment?: GatewayPaymentMarks | null } | null | undefined,
): boolean {
  if (!booking?.payment) return false;
  const p = booking.payment;
  if (p.method !== 'PAY2M' || !p.gatewayBasketId) return false;
  if (p.status !== 'PENDING' && p.status !== 'FAILED') return false;
  return booking.status === 'PENDING' || booking.status === 'CANCELLED';
}

/** Short admin label for the gateway report, or null when there is none. */
export function gatewayReportLabel(payment: GatewayPaymentMarks | null | undefined): string | null {
  if (!hasGatewayReport(payment)) return null;
  if (payment!.napsHeldAt) return 'Paid at gateway · awaiting confirmation';
  const code = payment!.unverifiedCallbackErrCode ? ` (code ${payment!.unverifiedCallbackErrCode})` : '';
  return `Gateway reported success${code} · not verified`;
}

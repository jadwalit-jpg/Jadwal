/**
 * Security-safe diagnostic record for an inbound PAY2M IPN (Instant Payment
 * Notification — the server-to-server POST PAY2M sends after a transaction).
 *
 * Phase 1 of the NAPS-via-IPN fix only OBSERVES the IPN: it does not change any
 * accept/confirm/reject decision. To plan Phase 2 (a source-IP allow-list so we
 * can trust the IPN on the NAPS rail, where the hash is unverifiable) we need
 * two things from a real IPN — PAY2M's server source IP, and the exact set of
 * fields it sends. This builder captures exactly that, and nothing else.
 *
 * ⚠ SECURITY — whitelist only. Every returned field is non-sensitive
 * operational metadata. The `Response_Key` is DELIBERATELY never included:
 * its value, combined with the otherwise-known inputs (merchant id, basket id,
 * amount, err code), is an offline brute-force oracle for PAY2M_SECRET_WORD.
 * We surface field NAMES (not secret — they reveal structure) but copy only
 * the whitelisted field VALUES below. Unknown fields contribute their NAME to
 * `fieldsPresent` and nothing more.
 */
export interface IpnDiagnostics {
  event: 'PAY2M_IPN_RECEIVED';
  sourceIp: string;
  contentType: string;
  basketId: string;
  errCode: string;
  transactionId: string | null;
  orderDate: string | null;
  paymentName: string | null;
  /** Field NAMES present in the IPN body (values intentionally excluded). */
  fieldsPresent: string[];
}

/** Coerce an unknown form-field value to a trimmed string, or null. */
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

export function buildIpnDiagnostics(
  body: Record<string, unknown>,
  sourceIp: string,
  contentType: string,
): IpnDiagnostics {
  const safe = body ?? {};
  return {
    event: 'PAY2M_IPN_RECEIVED',
    sourceIp,
    contentType,
    basketId: str(safe.basket_id) ?? '',
    errCode: str(safe.err_code) ?? '',
    transactionId: str(safe.transaction_id),
    orderDate: str(safe.order_date),
    paymentName: str(safe.PaymentName),
    fieldsPresent: Object.keys(safe).sort(),
  };
}

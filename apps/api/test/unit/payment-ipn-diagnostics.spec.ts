/**
 * Security unit tests for the PAY2M IPN diagnostic builder.
 *
 * The IPN diagnostic exists so we can learn PAY2M's server source IP and the
 * IPN's field structure (needed to plan the source-IP allow-list). It MUST
 * NEVER leak the `Response_Key` — that value, combined with the otherwise
 * known inputs (merchant id, basket id, amount, err code), is an offline
 * brute-force oracle for PAY2M_SECRET_WORD. These tests pin that invariant.
 */

import { buildIpnDiagnostics } from '../../src/payment/ipn-diagnostics';

const RESPONSE_KEY = 'a'.repeat(64); // 64 hex — the secret-adjacent value

const FULL_IPN_BODY = {
  err_code: '000',
  basket_id: 'JDWL-549e0f09-233',
  transaction_id: 'TXN-9873474567',
  order_date: '2026-06-19 23:35:00',
  Response_Key: RESPONSE_KEY,
  PaymentName: 'NAPS',
  // An unexpected extra field PAY2M might add — names are fine to surface,
  // values of unknown fields must NOT be copied into the diagnostic.
  Some_Unknown_Secret: 'do-not-leak-this-value',
};

describe('buildIpnDiagnostics — never leaks the Response_Key', () => {
  it('omits the Response_Key value from the serialized payload', () => {
    const diag = buildIpnDiagnostics(FULL_IPN_BODY, '203.0.113.7', 'multipart/form-data');
    expect(JSON.stringify(diag)).not.toContain(RESPONSE_KEY);
  });

  it('does not expose a Response_Key property (any casing)', () => {
    const diag = buildIpnDiagnostics(FULL_IPN_BODY, '203.0.113.7', 'multipart/form-data');
    const keys = Object.keys(diag).map((k) => k.toLowerCase());
    expect(keys).not.toContain('response_key');
    expect(keys).not.toContain('responsekey');
  });

  it('never copies the VALUE of any non-whitelisted field', () => {
    const diag = buildIpnDiagnostics(FULL_IPN_BODY, '203.0.113.7', 'multipart/form-data');
    expect(JSON.stringify(diag)).not.toContain('do-not-leak-this-value');
  });
});

describe('buildIpnDiagnostics — surfaces the safe fields we need for Phase 2', () => {
  it('captures source IP, content type, basket and err code', () => {
    const diag = buildIpnDiagnostics(FULL_IPN_BODY, '203.0.113.7', 'multipart/form-data; boundary=xyz');
    expect(diag.event).toBe('PAY2M_IPN_RECEIVED');
    expect(diag.sourceIp).toBe('203.0.113.7');
    expect(diag.contentType).toBe('multipart/form-data; boundary=xyz');
    expect(diag.basketId).toBe('JDWL-549e0f09-233');
    expect(diag.errCode).toBe('000');
    expect(diag.transactionId).toBe('TXN-9873474567');
  });

  it('lists the field NAMES present (names are not sensitive; values are)', () => {
    const diag = buildIpnDiagnostics(FULL_IPN_BODY, '203.0.113.7', 'multipart/form-data');
    // The presence of the name tells us the IPN structure; the value is gone.
    expect(diag.fieldsPresent).toEqual(expect.arrayContaining(['Response_Key', 'err_code', 'basket_id']));
  });

  it('tolerates a sparse body without throwing', () => {
    const diag = buildIpnDiagnostics({ basket_id: 'JDWL-000000000000' }, '', '');
    expect(diag.basketId).toBe('JDWL-000000000000');
    expect(diag.errCode).toBe('');
    expect(diag.transactionId).toBeNull();
  });
});

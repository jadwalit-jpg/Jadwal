/**
 * The offline Response_Key probe (scripts/pay2m-hash-probe.ts) must recognise
 * the recipes the site already knows and the plausible variants PAY2M could
 * have moved to, and must stay silent on a key that matches nothing.
 */
import * as crypto from 'crypto';
import { amountVariants, errCodeVariants, probeCandidates, probeRecipes } from '../../src/payment/hash-recipes';

const BASE = { merchantId: 'M123', basketId: 'JDWL-eb5e0b36-90b', secretWord: 'sw', amount: '1200.00', errCode: '000' };
const sha = (tail: string) => crypto.createHash('sha256').update(`${BASE.merchantId}${BASE.basketId}${BASE.secretWord}${tail}`).digest('hex');

describe('pay2m hash probe', () => {
  it('amount and code variants cover the renderings PAY2M has used', () => {
    expect(amountVariants('1200.00')).toEqual(expect.arrayContaining(['1200.00', '1200', '1200.0', '1200.000', '1,200', '1,200.00']));
    expect(amountVariants('1.00')).toEqual(expect.arrayContaining(['1.00', '1', '1.0']));
    expect(errCodeVariants('000')).toEqual(expect.arrayContaining(['000', '00', '0000', '001', '0']));
  });

  it('finds the card recipe (amount+err, two decimals, "00")', () => {
    const matches = probeRecipes({ ...BASE, responseKey: sha('1200.0000') });
    expect(matches.map((m) => m.label)).toContain('amount+err amount="1200.00" err="00"');
  });

  it('finds the June NAPS recipe (err+integer amount, "00")', () => {
    const matches = probeRecipes({ ...BASE, responseKey: sha('001200') });
    expect(matches.map((m) => m.label)).toContain('err+amount err="00" amount="1200"');
  });

  it('finds candidates the live verifier does not try: "0000", one decimal, no amount, txn appended', () => {
    expect(probeRecipes({ ...BASE, responseKey: sha('00001200') }).map((m) => m.label)).toContain('err+amount err="0000" amount="1200"');
    expect(probeRecipes({ ...BASE, responseKey: sha('1200.0000') }).map((m) => m.label)).toContain('amount+err amount="1200.0" err="000"');
    expect(probeRecipes({ ...BASE, responseKey: sha('0000') }).map((m) => m.label)).toContain('err only err="0000"');
    const withTxn = probeRecipes({ ...BASE, transactionId: 'TXN9', responseKey: sha('1200.0000TXN9') });
    expect(withTxn.map((m) => m.label)).toContain('amount+err amount="1200.00" err="00" +txn');
  });

  it('returns nothing for a key that matches no candidate, or a malformed key', () => {
    expect(probeRecipes({ ...BASE, responseKey: 'a'.repeat(64) })).toEqual([]);
    expect(probeRecipes({ ...BASE, responseKey: 'not-hex' })).toEqual([]);
    expect(probeCandidates(BASE).length).toBeGreaterThan(50);
    expect(probeCandidates(BASE).length).toBeLessThan(2000);
  });
});

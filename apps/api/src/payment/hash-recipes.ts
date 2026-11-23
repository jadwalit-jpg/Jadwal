/**
 * Offline probe for PAY2M's callback Response_Key.
 *
 * The live verifier (PaymentService.resolveSignedErrCode) tries a fixed set of
 * recipes. When PAY2M changes how it signs a rail (the debit-card/NAPS callbacks
 * of Oct–Nov 2026 fail every recipe the site knows), the fastest way to find
 * the new recipe is to take ONE real callback (its basket, amount, err_code and
 * Response_Key) plus the merchant id and secret word, and try a much wider set
 * of candidates offline. This module is that candidate set; it is pure (no I/O)
 * and never logs anything. The script in scripts/pay2m-hash-probe.ts drives it.
 *
 * Every candidate keeps the known prefix: merchant_id + basket_id + secret word.
 * What varies is the tail: the amount rendering, the success-code spelling, the
 * order of the two, whether the amount is present at all (the IPN-style hash
 * has none), and whether the transaction id or order date is appended.
 */
import * as crypto from 'crypto';

export interface ProbeInput {
  merchantId: string;
  basketId: string;
  secretWord: string;
  /** The amount the site hashed with (payment.amount, e.g. "1200.00"). */
  amount: string;
  /** The err_code field as received in the callback. */
  errCode: string;
  /** The Response_Key as received (64 hex chars). */
  responseKey: string;
  transactionId?: string;
  orderDate?: string;
}

export interface ProbeCandidate {
  /** Human-readable recipe, e.g. `err+amount err="0000" amount="1200"`. */
  label: string;
  tail: string;
}

export interface ProbeMatch extends ProbeCandidate {
  /** SHA256(merchant + basket + secret + tail), lower-case hex. */
  digest: string;
}

/** The amount renderings PAY2M might sign: as sent, integer, 1–3 decimals, thousands separators. */
export function amountVariants(amount: string): string[] {
  const out = new Set<string>([amount.trim()]);
  const n = Number(amount);
  if (Number.isFinite(n)) {
    out.add(n.toString());
    out.add(n.toFixed(0));
    out.add(n.toFixed(1));
    out.add(n.toFixed(2));
    out.add(n.toFixed(3));
    out.add(n.toLocaleString('en-US'));
    out.add(n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  return Array.from(out);
}

/** The success-code spellings PAY2M uses across its rails and the IPN, plus the received code. */
export function errCodeVariants(received: string): string[] {
  return Array.from(new Set([received.trim(), '00', '000', '0000', '0', '001']));
}

/** Every tail candidate for one callback. Bounded: a few hundred at most. */
export function probeCandidates(input: Omit<ProbeInput, 'responseKey'>): ProbeCandidate[] {
  const amounts = amountVariants(input.amount);
  const errs = errCodeVariants(input.errCode);
  const extras: Array<{ label: string; value: string }> = [{ label: '', value: '' }];
  if (input.transactionId) extras.push({ label: ' +txn', value: input.transactionId.trim() });
  if (input.orderDate) extras.push({ label: ' +orderDate', value: input.orderDate.trim() });
  if (input.transactionId && input.orderDate) {
    extras.push({ label: ' +txn+orderDate', value: `${input.transactionId.trim()}${input.orderDate.trim()}` });
  }

  const base: ProbeCandidate[] = [];
  for (const err of errs) {
    base.push({ label: `err only err="${err}"`, tail: err });
    for (const amt of amounts) {
      base.push({ label: `amount+err amount="${amt}" err="${err}"`, tail: `${amt}${err}` });
      base.push({ label: `err+amount err="${err}" amount="${amt}"`, tail: `${err}${amt}` });
    }
  }
  for (const amt of amounts) {
    base.push({ label: `amount only amount="${amt}"`, tail: amt });
  }

  const out: ProbeCandidate[] = [];
  const seen = new Set<string>();
  for (const extra of extras) {
    for (const c of base) {
      for (const [where, tail] of [
        ['', `${c.tail}${extra.value}`],
        [' (before)', `${extra.value}${c.tail}`],
      ] as Array<[string, string]>) {
        if (extra.value === '' && where !== '') continue;
        // Two readings of one string (e.g. "1200.00"+"00" and "1200.0"+"000")
        // are both reported: the developer decides which one PAY2M means.
        const label = `${c.label}${extra.label}${where}`;
        if (seen.has(label)) continue;
        seen.add(label);
        out.push({ label, tail });
      }
    }
  }
  return out;
}

export function digestFor(input: Pick<ProbeInput, 'merchantId' | 'basketId' | 'secretWord'>, tail: string): string {
  return crypto.createHash('sha256').update(`${input.merchantId}${input.basketId}${input.secretWord}${tail}`).digest('hex');
}

/** Every candidate whose digest equals the received Response_Key. */
export function probeRecipes(input: ProbeInput): ProbeMatch[] {
  const target = input.responseKey.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(target)) return [];
  const matches: ProbeMatch[] = [];
  for (const c of probeCandidates(input)) {
    const digest = digestFor(input, c.tail);
    if (digest === target) matches.push({ ...c, digest });
  }
  return matches;
}

/**
 * PAY2M Response_Key probe — find which recipe signed a real callback.
 *
 * Why: debit-card (NAPS) callbacks fail the site's hash check since autumn
 * 2026 (PAYMENT_HASH_MISMATCH with err_code 000/001 while PAY2M shows the
 * payment as successful). The site never logs the Response_Key, but the
 * browser callback is a GET, so the ALB / Cloudflare access logs hold the full
 * query string. Take ONE such callback and run this script locally with the
 * merchant id and the secret word from SSM (/jadwal/prod/PAY2M_MERCHANT_ID and
 * /jadwal/prod/PAY2M_SECRET_WORD). It prints every recipe that reproduces the
 * key, or "no match" with the number of candidates tried.
 *
 * Usage (from apps/api; the secret is read from the environment, never from
 * the command line, so it stays out of the shell history):
 *
 *   PAY2M_SECRET_WORD='…' npx ts-node scripts/pay2m-hash-probe.ts \
 *     --merchant 12345 --basket JDWL-828368c5-463 --amount 1.00 \
 *     --err 000 --key <64-hex Response_Key> [--txn <transaction_id>] [--order-date <order_date>]
 *
 * Nothing is sent anywhere and nothing is written; the output names recipes
 * only, never the secret or the key.
 */
import { probeCandidates, probeRecipes } from '../src/payment/hash-recipes';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  const merchantId = arg('merchant');
  const basketId = arg('basket');
  const amount = arg('amount');
  const errCode = arg('err');
  const responseKey = arg('key');
  const secretWord = process.env.PAY2M_SECRET_WORD;
  if (!merchantId || !basketId || !amount || !errCode || !responseKey || !secretWord) {
    console.error('Missing input. Required: --merchant --basket --amount --err --key, and PAY2M_SECRET_WORD in the environment.');
    return 2;
  }
  const input = {
    merchantId, basketId, secretWord, amount, errCode, responseKey,
    transactionId: arg('txn'),
    orderDate: arg('order-date'),
  };
  const tried = probeCandidates(input).length;
  const matches = probeRecipes(input);
  if (matches.length === 0) {
    console.log(`no match (${tried} candidates tried). The recipe uses something not in the candidate set: ask PAY2M for the current formula.`);
    return 1;
  }
  console.log(`${matches.length} match(es) out of ${tried} candidates:`);
  for (const m of matches) console.log(`  ${m.label}`);
  return 0;
}

process.exitCode = main();

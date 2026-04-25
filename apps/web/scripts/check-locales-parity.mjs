#!/usr/bin/env node
/**
 * Fails (exit 1) if en.json and ar.json diverge in key shape.
 *
 * Run locally:   node apps/web/scripts/check-locales-parity.mjs
 * Run in CI:     npm run check:i18n  (add to apps/web/package.json scripts)
 *
 * Catches the "forgot to add the Arabic string for the new feature" mistake
 * at PR time instead of after deploy when an Arabic customer sees the raw
 * key ("vendor.booking.toast.confirmed") instead of a real label.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '..', 'src', 'locales');

function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of flatten(v, path)) out.add(nested);
    } else {
      out.add(path);
    }
  }
  return out;
}

const en = JSON.parse(readFileSync(join(LOCALES_DIR, 'en.json'), 'utf8'));
const ar = JSON.parse(readFileSync(join(LOCALES_DIR, 'ar.json'), 'utf8'));

const enKeys = flatten(en);
const arKeys = flatten(ar);

const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));
const missingInEn = [...arKeys].filter((k) => !enKeys.has(k));

if (missingInAr.length === 0 && missingInEn.length === 0) {
  console.log(`✓ locales parity: ${enKeys.size} keys, en.json and ar.json match.`);
  process.exit(0);
}

if (missingInAr.length > 0) {
  console.error(`\n✗ ${missingInAr.length} key(s) missing from ar.json:`);
  for (const k of missingInAr.slice(0, 50)) console.error(`  - ${k}`);
  if (missingInAr.length > 50) console.error(`  ...and ${missingInAr.length - 50} more`);
}

if (missingInEn.length > 0) {
  console.error(`\n✗ ${missingInEn.length} key(s) missing from en.json:`);
  for (const k of missingInEn.slice(0, 50)) console.error(`  - ${k}`);
  if (missingInEn.length > 50) console.error(`  ...and ${missingInEn.length - 50} more`);
}

process.exit(1);

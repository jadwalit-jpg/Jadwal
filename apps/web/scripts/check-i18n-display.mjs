#!/usr/bin/env node
/**
 * Heuristic scanner for i18n "dynamic content" gaps in apps/web.
 *
 * Catches the same kind of bug as earnings/page.tsx:414 — a JSX expression
 * that renders `record.titleEn` (or any other *En bilingual field) directly
 * to the page, instead of going through `localized(record, 'title')`. When
 * the UI is set to Arabic the user keeps seeing English data names.
 *
 * Bilingual schema fields scanned:
 *   - titleEn / titleAr
 *   - nameEn / nameAr
 *   - descriptionEn / descriptionAr
 *   - businessNameEn / businessNameAr
 *
 * The scanner is a heuristic — it flags every read of `.titleEn` / `.nameEn`
 * etc., then drops lines that look like form bindings, object-literal keys,
 * validation lookups, and other non-display reads. The remainder are likely
 * UI display sites that should use `localized()`.
 *
 * Usage:
 *   node scripts/check-i18n-display.mjs            # full repo
 *   node scripts/check-i18n-display.mjs --strict   # exit 1 if any flagged
 *   node scripts/check-i18n-display.mjs --json     # machine output
 *
 * Wire as `npm run check:i18n-display`.
 */

import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const ROOT = join(process.cwd(), 'src');
const FIELDS = ['title', 'name', 'description', 'businessName'];
// Capture .titleEn and .titleAr — we surface BOTH because a hardcoded titleAr
// is just as wrong (English locale shows Arabic). localized() picks correctly.
const FIELD_RE = new RegExp(
  `\\.(?:${FIELDS.map((f) => `${f}En|${f}Ar`).join('|')})\\b`,
);

// Lines that match the field pattern but are NOT display sites.
// Each predicate runs against the full line; if any matches, the line is dropped.
const NOT_DISPLAY = [
  // Form-state binding: `value={form.titleEn}`, `value={data.titleAr}`.
  /\bvalue\s*=\s*\{[^}]*\.(?:title|name|description|businessName)(?:En|Ar)\b/,
  // updateField('titleEn', ...) / setForm({ titleEn: ... }) / DTO key.
  /\b(?:updateField|setForm|setField|setData)\s*\(\s*['"](?:title|name|description|businessName)(?:En|Ar)['"]/,
  // Object-literal key in an API payload: `titleEn:` (followed by colon).
  /(?:^|[\s,{])(?:title|name|description|businessName)(?:En|Ar)\s*:/,
  // sanitize(form.titleEn), sanitizeObject({ titleEn })
  /\bsanitize(?:Object)?\s*\([^)]*\.(?:title|name|description|businessName)(?:En|Ar)\b/,
  // form.titleEn.trim() / .length — validation reads, not display.
  /\.(?:title|name|description|businessName)(?:En|Ar)\s*\.\s*(?:trim|length|toLowerCase|toUpperCase|charAt|slice|replace|match)/,
  // Validator branches: `if (!form.titleEn.trim())` / `errs.titleEn = ...` /
  // `fieldErrors.businessNameEn` — error-state lookups, not data display.
  /\b(?:errs|errors|validation|fieldErrors|formErrors)\??\.(?:title|name|description|businessName)(?:En|Ar)\b/,
  // String literal references: 'titleEn', "titleAr" — typically keys.
  /['"`](?:title|name|description|businessName)(?:En|Ar)['"`]/,
  // i18n key paths inside t('a.b.titleEn') — the field is just the tail of
  // a translation-key string, not a property read.
  /\bt\s*\(\s*['"`][^'"`]*\.(?:title|name|description|businessName)(?:En|Ar)\b/,
  // slugify(form.titleEn)
  /\bslugify\s*\([^)]*\.(?:title|name|description|businessName)(?:En|Ar)\b/,
  // TypeScript: `interface X { titleEn: string }` / type lines
  /^\s*(?:interface|type|export\s+(?:interface|type))\b/,
  // Comments / JSDoc.
  /^\s*(?:\/\/|\/\*|\*)/,
  // Variable declaration that just stores the field (used downstream): `const titleEn = ...`
  /^\s*(?:const|let|var)\s+(?:title|name|description|businessName)(?:En|Ar)\b/,
  // `localized(...)` already in the line — already correct.
  /\blocalized\s*\(/,
];

// Patterns that strongly suggest a JSX display read — increase confidence.
const LIKELY_DISPLAY = [
  // JSX text-expression: `>{x.titleEn}<` or inside `>{ ... titleEn ... }`
  /\{\s*[^{}]*\.(?:title|name|description|businessName)(?:En|Ar)\b[^{}]*\}/,
  // alt= / title= / aria-label= / label= / placeholder= attribute reading the field
  /\b(?:alt|title|aria-label|label|placeholder)\s*=\s*\{[^}]*\.(?:title|name|description|businessName)(?:En|Ar)\b/,
  // Template literal in alt= etc.: alt={`${activity.titleEn} ${i}`}
  /[`'"]\s*\$\{[^}]*\.(?:title|name|description|businessName)(?:En|Ar)\b[^}]*\}/,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      walk(full, out);
    } else if (/\.(tsx|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function classify(line) {
  if (NOT_DISPLAY.some((re) => re.test(line))) return 'skip';
  if (LIKELY_DISPLAY.some((re) => re.test(line))) return 'high';
  return 'maybe';
}

function actorFor(file) {
  const r = relative(ROOT, file).split(sep).join('/');
  if (r.startsWith('app/admin/')) return 'admin';
  if (r.startsWith('app/vendor/')) return 'vendor';
  if (r.startsWith('app/')) return 'customer';
  if (r.startsWith('components/')) return 'shared';
  return 'other';
}

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const asJson = args.has('--json');

const files = walk(ROOT);
const findings = [];

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!FIELD_RE.test(line)) continue;
    const verdict = classify(line);
    if (verdict === 'skip') continue;
    findings.push({
      file: relative(process.cwd(), f).split(sep).join('/'),
      line: i + 1,
      actor: actorFor(f),
      confidence: verdict, // 'high' or 'maybe'
      snippet: line.trim().slice(0, 200),
    });
  }
}

const high = findings.filter((f) => f.confidence === 'high');
const maybe = findings.filter((f) => f.confidence === 'maybe');

if (asJson) {
  console.log(JSON.stringify({ high, maybe, total: findings.length }, null, 2));
} else {
  if (high.length > 0) {
    console.log(`\nHIGH-confidence i18n display gaps (${high.length}) — likely need localized():\n`);
    for (const r of high) {
      console.log(`  [${r.actor}] ${r.file}:${r.line}`);
      console.log(`    ${r.snippet}`);
    }
  }
  if (maybe.length > 0) {
    console.log(`\nLOW-confidence reads (${maybe.length}) — review manually, most are non-display:\n`);
    for (const r of maybe.slice(0, 25)) {
      console.log(`  [${r.actor}] ${r.file}:${r.line}`);
      console.log(`    ${r.snippet}`);
    }
    if (maybe.length > 25) console.log(`  ... and ${maybe.length - 25} more`);
  }
  if (findings.length === 0) {
    console.log('✓ No bilingual-field reads outside form bindings detected.');
  } else {
    console.log(
      `\nSummary: ${high.length} high-confidence + ${maybe.length} low-confidence reads.`,
    );
  }
}

if (strict && high.length > 0) {
  process.exit(1);
}

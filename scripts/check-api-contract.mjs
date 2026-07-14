#!/usr/bin/env node
/**
 * Frontend ↔ Backend API contract check.
 *
 * WHY THIS EXISTS
 * ---------------
 * In July 2026 the admin "Edit Activity" page uploaded cover images to
 * `/upload/image` — an endpoint that never existed. Every admin cover upload
 * 404'd into a catch block and surfaced as "Upload failed", so an admin could
 * NEVER change an activity's cover image. It shipped to production and sat
 * there, because nothing in the pipeline could catch it:
 *
 *   - TypeScript : the URL is just a string. TS has no idea what routes exist.
 *   - ESLint     : same.
 *   - Unit/integration tests : they test the API in isolation, and never assert
 *                  that the FRONTEND calls the right URL.
 *   - E2E        : only covers flows that have specs; nothing clicked that button.
 *
 * The frontend→backend contract was simply unverified. This script verifies it:
 * every API call the web app makes must resolve to a route the API actually
 * exposes, with the same HTTP method. A mismatch fails the build.
 *
 * It is a static check — fast, no infra, no server needed.
 *
 * WHAT IT DOES *NOT* PROVE (be honest about the limits):
 *   - Authorization: a route can exist but reject your role (403).
 *   - Payload shape: a route can exist but reject the body (400 / DTO mismatch).
 *   - Runtime behaviour: that the endpoint actually does the right thing.
 * Those need E2E / integration coverage. This closes the "route doesn't exist"
 * hole only — which is exactly the hole that bit us.
 */

import fs from 'node:fs';
import path from 'node:path';

const API_SRC = 'apps/api/src';
const WEB_SRC = 'apps/web/src';
const HTTP_METHODS = ['Get', 'Post', 'Patch', 'Put', 'Delete'];

/* ─── helpers ──────────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '_archive', '.next', 'dist'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Read a string/template literal starting at `i` (which must point at a quote).
 * Template interpolations `${...}` — including ones containing NESTED template
 * literals and braces — collapse to `*`. Returns null if it isn't a literal
 * (i.e. the URL is built from a variable), so the caller can flag it.
 */
function readLiteral(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  i++;
  let out = '';
  while (i < src.length) {
    const c = src[i];
    if (q === '`' && c === '$' && src[i + 1] === '{') {
      let braces = 1;
      i += 2;
      while (i < src.length && braces > 0) {
        if (src[i] === '{') braces++;
        else if (src[i] === '}') braces--;
        if (braces > 0) i++;
      }
      i++; // step past the closing }
      out += '*';
      continue;
    }
    if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
    if (c === q) return out;
    out += c;
    i++;
  }
  return null;
}

const clean = (p) => (p.split('?')[0].replace(/\/+$/, '') || '/');
const segs = (p) => p.split('/').filter(Boolean);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function segMatch(fe, be) {
  if (be === '*' || fe === '*') return true;          // :param  or  ${var}
  if (fe.includes('*')) return new RegExp('^' + fe.split('*').map(esc).join('.*') + '$').test(be);
  return fe === be;
}

function pathMatch(fe, be) {
  const a = segs(fe), b = segs(be);
  return a.length === b.length && a.every((s, i) => segMatch(s, b[i]));
}

/* ─── 1. every route the API actually exposes ──────────────────────────── */

const routes = [];
for (const file of walk(API_SRC)) {
  if (!file.endsWith('.controller.ts')) continue;
  const src = fs.readFileSync(file, 'utf8');
  const ctrl = src.match(/@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*[),]/);
  const base = ctrl?.[1] ?? '';
  const re = new RegExp(`@(${HTTP_METHODS.join('|')})\\(\\s*(?:['"\`]([^'"\`]*)['"\`])?\\s*\\)`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const full = clean('/' + [base, m[2] || ''].filter(Boolean).join('/').replace(/\/+/g, '/'));
    routes.push({ method: m[1].toUpperCase(), path: full.replace(/:[A-Za-z0-9_]+/g, '*') });
  }
}

/* ─── 2. every API call the frontend makes ─────────────────────────────── */

const calls = [];
const dynamic = [];  // URL built from a variable — cannot be statically verified

for (const file of walk(WEB_SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(WEB_SRC, file).replace(/\\/g, '/');

  // a) api.get|post|patch|put|delete( ... )   — baseURL already ends in /api
  const apiRe = /\bapi\s*\.\s*(get|post|patch|put|delete)\s*\(/g;
  let m;
  while ((m = apiRe.exec(src))) {
    const lit = readLiteral(src, m.index + m[0].length);
    const line = src.slice(0, m.index).split('\n').length;
    if (lit === null) { dynamic.push({ file: rel, line, kind: `api.${m[1]}` }); continue; }
    if (!lit.startsWith('/')) continue;                       // absolute/other
    calls.push({ method: m[1].toUpperCase(), path: clean(lit), file: rel, line });
  }

  // b) raw fetch( ... ) — SSR paths that bypass the api client
  const fetchRe = /(?<![.\w])fetch\s*\(/g;
  while ((m = fetchRe.exec(src))) {
    const lit = readLiteral(src, m.index + m[0].length);
    if (lit === null) continue;                               // dynamic fetch, skip
    if (/^https?:\/\//i.test(lit)) continue;                  // external (e.g. OpenStreetMap)
    const line = src.slice(0, m.index).split('\n').length;
    let p = lit;
    if (p.startsWith('*')) p = '/' + segs(p).slice(1).join('/');  // `${base}/x` -> /x
    if (p.startsWith('/api/')) p = p.slice(4);                    // global /api prefix
    if (!p.startsWith('/')) continue;
    // fetch() defaults to GET; look ahead for an explicit method
    const after = src.slice(m.index, m.index + 400);
    const mm = after.match(/method\s*:\s*['"`](GET|POST|PATCH|PUT|DELETE)['"`]/i);
    calls.push({ method: (mm?.[1] || 'GET').toUpperCase(), path: clean(p), file: rel, line });
  }
}

/* ─── 3. compare ───────────────────────────────────────────────────────── */

const broken = calls.filter(
  (c) => !routes.some((r) => r.method === c.method && pathMatch(c.path, r.path)),
);

console.log('══════ API CONTRACT CHECK ══════');
console.log(`backend routes exposed : ${routes.length}`);
console.log(`frontend API calls     : ${calls.length}`);
console.log(`  ✓ resolve to a route : ${calls.length - broken.length}`);
console.log(`  ✗ NO matching route  : ${broken.length}`);
if (dynamic.length) {
  console.log(`\n⚠  ${dynamic.length} call(s) build the URL from a variable and cannot be statically checked:`);
  for (const d of dynamic) console.log(`     ${d.file}:${d.line}  (${d.kind})`);
}

if (broken.length) {
  console.error('\n❌ These frontend calls hit an endpoint that DOES NOT EXIST — they will 404 at runtime:\n');
  for (const b of broken) {
    console.error(`   ${b.method.padEnd(6)} ${b.path}`);
    console.error(`          ${b.file}:${b.line}`);
  }
  console.error('\n   Fix the URL, or add the missing route to the API.');
  console.error('   (This is the check that would have caught the /upload/image cover-image bug.)\n');
  process.exit(1);
}

console.log('\n✅ every frontend API call resolves to a real backend route');

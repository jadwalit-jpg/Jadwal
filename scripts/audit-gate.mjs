#!/usr/bin/env node
/**
 * Production dependency audit gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * The gate used to be a bare `npm audit --omit=dev --audit-level=high`. That
 * fails on EVERY high advisory, including ones with no upstream fix available.
 * The result was a merge gate that could not be satisfied by any amount of
 * work, so it blocked unrelated PRs (including security fixes) indefinitely —
 * which pushes a team toward either not shipping at all or blanket-overriding
 * branch protection. Both are worse than the vulnerability.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * Fails on any high/critical advisory in production dependencies that is NOT
 * explicitly allowlisted in `.audit-allowlist.json`. So:
 *   - a NEWLY introduced vulnerability still blocks the merge (the property we
 *     actually want from this gate), and
 *   - a known-unfixable-upstream advisory does not hold the whole repo hostage.
 *
 * The allowlist is keyed by GHSA advisory id, never by package name, so a
 * different future advisory in the same package is still caught. Every entry
 * carries a mandatory `reviewBy` date and an EXPIRED entry FAILS the gate, so
 * exceptions cannot quietly become permanent.
 *
 * Usage:  node scripts/audit-gate.mjs <workspace-dir> [<workspace-dir>...]
 *   e.g.  node scripts/audit-gate.mjs apps/api apps/web
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKING = new Set(['high', 'critical']);

const workspaces = process.argv.slice(2);
if (workspaces.length === 0) {
  console.error('usage: node scripts/audit-gate.mjs <workspace-dir> [...]');
  process.exit(2);
}

// ── allowlist ──────────────────────────────────────────────────────────────
const allowPath = resolve(REPO_ROOT, '.audit-allowlist.json');
let allow = [];
try {
  allow = JSON.parse(readFileSync(allowPath, 'utf8')).allow ?? [];
} catch (err) {
  console.error(`FATAL: cannot read ${allowPath}: ${err.message}`);
  process.exit(2);
}

// Fail closed on a malformed entry rather than silently ignoring a vuln.
const today = new Date().toISOString().slice(0, 10);
const allowById = new Map();
const expired = [];
for (const entry of allow) {
  if (!entry.id || !entry.reason || !entry.reviewBy) {
    console.error(`FATAL: allowlist entry missing id/reason/reviewBy: ${JSON.stringify(entry)}`);
    process.exit(2);
  }
  allowById.set(entry.id, entry);
  if (entry.reviewBy < today) expired.push(entry);
}

/** Collect every advisory (GHSA id) reachable from a vulnerability entry. */
function advisoryClosure(name, vulns, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const node = vulns[name];
  if (!node) return [];
  const found = [];
  for (const via of node.via ?? []) {
    if (typeof via === 'object') {
      // Only advisories that are THEMSELVES high/critical need a waiver. A
      // moderate advisory can sit inside a high package's dependency closure;
      // demanding a waiver for it would be confusing and over-strict, since
      // this gate's threshold is high/critical by definition.
      if (!BLOCKING.has(via.severity)) continue;
      // e.g. https://github.com/advisories/GHSA-xxxx-xxxx-xxxx
      const ghsa = /GHSA-[a-z0-9-]+/i.exec(via.url ?? '')?.[0];
      found.push({ id: ghsa ?? `source-${via.source}`, package: via.name ?? name, title: via.title });
    } else if (typeof via === 'string') {
      found.push(...advisoryClosure(via, vulns, seen));
    }
  }
  return found;
}

let failures = 0;
const seenAllowIds = new Set();

for (const ws of workspaces) {
  const cwd = resolve(REPO_ROOT, ws);
  let report;
  try {
    // npm audit exits non-zero when vulns exist; capture stdout regardless.
    // Windows cannot spawn npm (a .cmd shim) without a shell — it fails with
    // EINVAL. `shell` is therefore required on win32. This is safe here because
    // every argument below is a hardcoded constant: no user- or env-controlled
    // value is ever interpolated into the command line. CI runs on Linux and
    // takes the no-shell path.
    const isWindows = process.platform === 'win32';
    const out = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: isWindows,
    });
    report = JSON.parse(out);
  } catch (err) {
    const stdout = err.stdout?.toString?.() ?? '';
    try {
      report = JSON.parse(stdout);
    } catch {
      console.error(`\n[${ws}] FATAL: could not run/parse npm audit.`);
      console.error(stdout.slice(0, 2000) || err.message);
      failures++;
      continue;
    }
  }

  const vulns = report.vulnerabilities ?? {};
  const blocked = [];
  const waived = [];

  for (const [name, node] of Object.entries(vulns)) {
    if (!BLOCKING.has(node.severity)) continue;
    const advisories = advisoryClosure(name, vulns);
    // Unknown-shaped entry: treat as blocking rather than guessing.
    if (advisories.length === 0) {
      blocked.push({ name, severity: node.severity, ids: ['(no advisory id resolved)'] });
      continue;
    }
    const notAllowed = advisories.filter((a) => !allowById.has(a.id));
    if (notAllowed.length > 0) {
      blocked.push({ name, severity: node.severity, ids: [...new Set(notAllowed.map((a) => a.id))] });
    } else {
      for (const a of advisories) seenAllowIds.add(a.id);
      waived.push({ name, severity: node.severity, ids: [...new Set(advisories.map((a) => a.id))] });
    }
  }

  const m = report.metadata?.vulnerabilities ?? {};
  console.log(`\n=== ${ws} — production dependencies ===`);
  console.log(`    totals: critical=${m.critical ?? 0} high=${m.high ?? 0} moderate=${m.moderate ?? 0} low=${m.low ?? 0}`);

  if (waived.length) {
    console.log(`    waived by .audit-allowlist.json (${waived.length}):`);
    for (const w of waived) console.log(`      - ${w.name} (${w.severity}) [${w.ids.join(', ')}]`);
  }
  if (blocked.length) {
    failures++;
    console.log(`    ❌ BLOCKING (${blocked.length}) — not in the allowlist:`);
    for (const b of blocked) console.log(`      - ${b.name} (${b.severity}) [${b.ids.join(', ')}]`);
  } else {
    console.log('    ✅ no blocking high/critical advisories');
  }
}

// ── allowlist hygiene ──────────────────────────────────────────────────────
if (expired.length) {
  failures++;
  console.log(`\n❌ ${expired.length} allowlist entry/entries are PAST their reviewBy date (re-review required):`);
  for (const e of expired) console.log(`      - ${e.id} (${e.package}) reviewBy=${e.reviewBy}`);
}

const stale = [...allowById.keys()].filter((id) => !seenAllowIds.has(id));
if (stale.length) {
  // A warning, not a failure: a stale entry is safe, just untidy.
  console.log(`\n⚠️  ${stale.length} allowlist entry/entries no longer match any advisory — likely fixed upstream, please remove:`);
  for (const id of stale) console.log(`      - ${id} (${allowById.get(id).package})`);
}

if (failures > 0) {
  console.log('\nGate FAILED. Fix the advisory, or — only if there is genuinely no upstream');
  console.log('fix — add a reviewed entry (id + reason + reviewBy) to .audit-allowlist.json.');
  process.exit(1);
}
console.log('\nGate PASSED.');

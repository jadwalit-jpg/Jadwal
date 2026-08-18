#!/usr/bin/env node
/**
 * Fail the build if the dependency tree contains more than one copy of React.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two copies of React in one tree is catastrophic and near-invisible: the
 * component renders against one React while the hooks dispatcher lives in the
 * other, so every hook resolves against a null dispatcher and the whole app
 * dies with `Cannot read properties of null (reading 'useState')`.
 *
 * It bit us for real. The root package.json carried an `overrides` entry
 * pinning react/react-dom to 19.0.0 — left over from the initial commit — long
 * after apps/web moved to ^19.2.6. 19.0.0 does not satisfy ^19.2.6, so a
 * resolver that honours the override cannot satisfy both and nests a second
 * React under apps/web/node_modules. Our local npm silently reconciled it, so
 * `main` looked healthy; Dependabot's npm honoured it, so EVERY Dependabot PR
 * that regenerated the lockfile shipped a duplicate React and turned the whole
 * web suite red. That backlog sat broken for months.
 *
 * The override is removed. This guard is here so it can never come back
 * silently — from an override, a bad hoist, a phantom peer dep, or anything
 * else. It reads the lockfile (not node_modules), so it is deterministic and
 * needs no install.
 */
import { readFileSync } from 'node:fs';

const PKGS = ['react', 'react-dom'];
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

const found = {};
for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  const m = /(?:^|\/)node_modules\/(react|react-dom)$/.exec(path);
  if (!m) continue;
  (found[m[1]] ??= []).push({ path, version: meta.version });
}

let bad = false;
for (const pkg of PKGS) {
  const copies = found[pkg] ?? [];
  if (copies.length <= 1) {
    console.log(`✓ ${pkg}: 1 copy (${copies[0]?.version ?? 'none'})`);
    continue;
  }
  bad = true;
  console.error(`\n✗ ${pkg}: ${copies.length} COPIES in the tree —`);
  for (const c of copies) console.error(`    ${c.path}  @${c.version}`);
}

if (bad) {
  console.error(
    '\nA duplicate React breaks every hook at runtime and in tests:\n' +
      "  TypeError: Cannot read properties of null (reading 'useState')\n\n" +
      'Usual cause: an `overrides` entry pinning a react version that does NOT\n' +
      "satisfy what apps/web declares, so the resolver can't satisfy both and\n" +
      'nests a second copy. Make the versions agree, or drop the override.\n',
  );
  process.exit(1);
}

console.log('\nSingle React in the tree — OK.');

/**
 * Contract — the web image's non-root runtime user can write exactly the two
 * places Next.js writes at runtime, and nothing else, WITHOUT a second image
 * layer.
 *
 * WHY A TEST THAT READS THE DOCKERFILE
 * ------------------------------------
 * The runner stage drops to `USER jadwal`. If nothing hands that user its cache
 * folders, every ISR / prerender / image-optimizer write fails with EACCES.
 * Production logged thousands of those lines a day while every request still
 * returned 200, so nothing visible fails and only a test can pin it.
 *
 * Three ways to get this wrong, all of which happened or nearly did:
 *   1. Hand the whole tree to `jadwal` (COPY --chown): a compromised process can
 *      then rewrite server.js and its own bundle.
 *   2. Fix ownership with `RUN chown -R` in the runner: the files are rewritten
 *      into a second layer and the PR fails the image-waste budget
 *      (.dive-ci highestUserWastedPercent 7%; measured 8.5%).
 *   3. Forget that the builder ends in WORKDIR /app/apps/web, so relative paths
 *      in a new stage point at the wrong place.
 * So the ownership is prepared in a stage that never ships (`runtime-writable`)
 * and the runner copies the result in one layer, keeping everything else
 * root-owned.
 *
 * Measured on the real image: cache + server/app owned by uid 1001, server.js
 * and .next/static owned by root and unwritable by `jadwal`, 0 EACCES across a
 * mixed request set, dive efficiency 97.4% / waste 5.5%.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const DOCKERFILE = join(__dirname, '../../Dockerfile');
const BASE = '/app/apps/web/.next/standalone/apps/web/.next';
const WRITABLE = [`${BASE}/cache`, `${BASE}/server/app`];
const BACKSLASH = String.fromCharCode(92);

/** Instructions of one named stage, with line continuations folded. */
function stage(src: string, name: string): string[] {
  const chunks = src.split(/^FROM\s+/m).slice(1);
  const chunk = chunks.find((c) => new RegExp('\\sAS\\s+' + name + '\\b', 'i').test(c.split('\n')[0]));
  expect(chunk).toBeDefined();
  const out: string[] = [];
  let acc = '';
  for (const raw of chunk!.split(/\r?\n/)) {
    const l = raw.trim();
    if (!acc && (!l || l.startsWith('#'))) continue;
    if (l.endsWith(BACKSLASH)) {
      acc += l.slice(0, -1) + ' ';
      continue;
    }
    out.push((acc + l).trim());
    acc = '';
  }
  return out;
}

/** Every `chown ...` in a line, as { recursive, owner, target }. */
function chowns(line: string) {
  const out: Array<{ recursive: boolean; owner: string; target: string }> = [];
  for (const m of line.matchAll(/chown\s+((?:-\w+\s+)*)(\S+)\s+(\S+)/g)) {
    out.push({ recursive: /-\w*R/.test(m[1]), owner: m[2], target: m[3] });
  }
  return out;
}

describe('web Dockerfile — runtime-writable paths', () => {
  const src = readFileSync(DOCKERFILE, 'utf8');
  const prep = stage(src, 'runtime-writable');
  const runner = stage(src, 'runner');
  const prepRuns = prep.filter((l) => /^RUN\b/.test(l));
  const grants = prepRuns.flatMap((r) => chowns(r));
  // Every file-adding instruction, with or without --from: a plain `COPY --chown=... . /app`
  // from the build context must not be able to slip past the count and ownership checks.
  const runnerCopies = runner.filter((l) => /^(COPY|ADD)\b/.test(l));

  it('the runner drops to the non-root jadwal user (why ownership matters)', () => {
    expect(runner.some((l) => /^USER\s+jadwal\s*$/.test(l))).toBe(true);
  });

  it('the prep stage builds on the builder (so it sees the standalone output)', () => {
    expect(prep[0]).toMatch(/^builder\s+AS\s+runtime-writable\b/i);
  });

  it('the uid used in the prep stage equals the uid of the runner user', () => {
    const adduser = runner.find((l) => /adduser\b/.test(l));
    expect(adduser).toBeDefined();
    const uid = adduser!.match(/--uid\s+(\d+)/)![1];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(g.owner).toBe(`${uid}:${uid}`);
  });

  it.each(WRITABLE)('hands %s to the runtime user', (path) => {
    expect(grants.some((g) => g.target === path)).toBe(true);
  });

  it('creates .next/cache (the standalone output does not ship it)', () => {
    expect(prepRuns.some((r) => r.includes(`mkdir -p ${BASE}/cache`))).toBe(true);
  });

  it('never hands anything ELSE to the runtime user (no /app, server.js, static)', () => {
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(WRITABLE).toContain(g.target);
  });

  it('uses ABSOLUTE paths (the builder ends in WORKDIR /app/apps/web)', () => {
    for (const g of grants) expect(g.target.startsWith('/')).toBe(true);
  });

  it('the runner adds exactly three trees (COPY or ADD) and none uses --chown', () => {
    // If this count changes, the assertions below no longer cover every copy.
    expect(runnerCopies).toHaveLength(3);
    for (const c of runnerCopies) expect(c).not.toMatch(/--chown/);
  });

  it('the standalone tree comes from the prep stage; public and static from the builder', () => {
    const from = (needle: string) => runnerCopies.find((c) => c.includes(needle))!;
    expect(from('.next/standalone')).toMatch(/--from=runtime-writable\b/);
    expect(from('/public')).toMatch(/--from=builder\b/);
    expect(from('.next/static')).toMatch(/--from=builder\b/);
  });

  it('the runner has no RUN chown / mkdir (no second layer, no image-waste failure)', () => {
    const before = runner.slice(0, runner.findIndex((l) => /^USER\s+/.test(l)));
    const offending = before.filter((l) => /^RUN\b.*\b(chown|chmod)\b/.test(l) && !/addgroup|adduser/.test(l));
    expect(offending).toEqual([]);
  });
});

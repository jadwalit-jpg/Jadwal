/**
 * Contract — the web image's non-root runtime user can write exactly the two
 * places Next.js writes at runtime, and nothing else.
 *
 * WHY A TEST THAT READS THE DOCKERFILE
 * ------------------------------------
 * The runner stage copies the standalone build in as root and then drops to
 * `USER jadwal`. If nothing hands `jadwal` its cache folders, every ISR /
 * prerender / image-optimizer write fails with EACCES. Production logged
 * thousands of those lines a day while every request still returned 200, so
 * nothing visible fails and only a test can pin it.
 *
 * The opposite mistake is just as real: chown-ing the whole tree to `jadwal`
 * lets a compromised process rewrite server.js and its own bundle. So the app
 * code must stay root-owned and ONLY these two paths may be handed over
 * (found by diffing the filesystem while serving pages, the image optimizer
 * and the sitemap):
 *   apps/web/.next/cache       image optimizer + fetch/ISR data cache
 *   apps/web/.next/server/app  prerendered html/rsc rewritten by revalidation
 *
 * Measured with the real image: without the RUN, `mkdir .next/cache` fails with
 * EACCES; with it, the same requests log nothing, the cache is written, and
 * server.js / .next/static remain unwritable by `jadwal`.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const DOCKERFILE = join(__dirname, '../../Dockerfile');
const WRITABLE = ['apps/web/.next/cache', 'apps/web/.next/server/app'];
const BACKSLASH = String.fromCharCode(92);

/** Instructions of the final (runner) stage, with line continuations folded. */
function runnerInstructions(src: string): string[] {
  const stages = src.split(/^FROM\s+/m).slice(1);
  const runner = stages.find((s) => /\sAS\s+runner\b/i.test(s.split('\n')[0]));
  expect(runner).toBeDefined();
  const out: string[] = [];
  let acc = '';
  for (const raw of runner!.split(/\r?\n/)) {
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

/** Every `chown ...` in a RUN line, as { owner, target }. */
function chowns(line: string) {
  const out: Array<{ owner: string; target: string }> = [];
  for (const m of line.matchAll(/chown\s+((?:-\w+\s+)*)(\S+)\s+(\S+)/g)) {
    out.push({ owner: m[2], target: m[3] });
  }
  return out;
}

describe('web Dockerfile — runner stage ownership', () => {
  const lines = runnerInstructions(readFileSync(DOCKERFILE, 'utf8'));
  const userIdx = lines.findIndex((l) => /^USER\s+/.test(l));
  const runs = lines.slice(0, userIdx).filter((l) => /^RUN\b/.test(l));
  const grants = runs.flatMap((r) => chowns(r));
  const appCopies = lines.filter((l) => /^COPY\s+--from=builder\b/.test(l));

  it('drops to the non-root jadwal user (the reason ownership matters)', () => {
    expect(userIdx).toBeGreaterThan(-1);
    expect(lines[userIdx]).toMatch(/^USER\s+jadwal\s*$/);
  });

  it('copies exactly the three app trees: public, standalone, static', () => {
    // If this count changes, the "stays root-owned" assertion below no longer
    // covers every copy and must be revisited rather than quietly passing.
    expect(appCopies).toHaveLength(3);
  });

  it.each([0, 1, 2])('app COPY #%i stays ROOT-owned (no --chown)', (i) => {
    expect(appCopies[i]).not.toMatch(/--chown/);
  });

  it.each(WRITABLE)('hands %s to jadwal before USER jadwal', (path) => {
    const mine = grants.filter((g) => g.target === path);
    expect(mine.length).toBeGreaterThan(0);
    for (const g of mine) expect(g.owner).toMatch(/^jadwal(:jadwal)?$/);
  });

  it('creates .next/cache (the standalone output does not ship it)', () => {
    expect(runs.some((r) => /mkdir\s+-p\s+apps\/web\/\.next\/cache\b/.test(r))).toBe(true);
  });

  it('never hands anything ELSE to jadwal (no /app, server.js, static, public)', () => {
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(WRITABLE).toContain(g.target);
  });
});

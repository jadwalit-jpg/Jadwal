/**
 * Contract — the web image must let its non-root runtime user write the Next.js
 * cache.
 *
 * WHY A TEST THAT READS THE DOCKERFILE
 * ------------------------------------
 * The runner stage copies the standalone build in as root and then drops to
 * `USER jadwal`. Without `--chown` on those COPY lines, `.next` stays root-owned
 * and Next.js cannot create `.next/cache`, so every ISR / prerender / image
 * optimizer write fails with EACCES. Production logged thousands of those lines
 * a day while every request still returned 200 — nothing visible failed, which
 * is exactly why a test must pin it.
 *
 * Measured: building the image without --chown and running it as `jadwal`
 * logged `EACCES: permission denied, mkdir '/app/apps/web/.next/cache'`; with
 * --chown the same requests logged nothing and the image cache was written.
 *
 * Why not `RUN chown -R`: it rewrites every file into a new layer and inflates
 * the image (docker-size-budget.yml). `COPY --chown` is free.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const DOCKERFILE = join(__dirname, '../../Dockerfile');

/** Instructions of the final (runner) stage, with `\` continuations folded. */
function runnerInstructions(src: string): string[] {
  const stages = src.split(/^FROM\s+/m).slice(1);
  const runner = stages.find((s) => /\sAS\s+runner\b/i.test(s.split('\n')[0]));
  expect(runner).toBeDefined();
  return runner!
    .replace(/\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

describe('web Dockerfile — runner stage can write its own cache', () => {
  const src = readFileSync(DOCKERFILE, 'utf8');
  const lines = runnerInstructions(src);
  const user = lines.find((l) => /^USER\s+/.test(l));
  const appCopies = lines.filter((l) => /^COPY\s+--from=builder\b/.test(l));

  it('drops to the non-root jadwal user (the reason ownership matters)', () => {
    expect(user).toMatch(/^USER\s+jadwal\s*$/);
  });

  it('copies exactly the three app trees: public, standalone, static', () => {
    // If this count changes, the ownership assertion below no longer covers
    // every copy and must be revisited rather than quietly passing.
    expect(appCopies).toHaveLength(3);
  });

  it.each([0, 1, 2])('app COPY #%i carries --chown=jadwal:jadwal', (i) => {
    expect(appCopies[i]).toMatch(/--chown=jadwal:jadwal\b/);
  });

  it('does not fall back to a layer-duplicating `RUN chown -R`', () => {
    expect(lines.some((l) => /^RUN\b.*\bchown\s+-R\b/.test(l))).toBe(false);
  });
});

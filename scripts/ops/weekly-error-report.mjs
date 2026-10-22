#!/usr/bin/env node
/**
 * Weekly production error report (read-only).
 *
 * Asks CloudWatch Logs Insights for every error-level / 5xx / DB-auth / EACCES
 * line of the API (and web) in the last N days, then groups them by "what
 * broke" and "which route" so a human can read it in one minute.
 *
 * USAGE (needs AWS CLI logged in with logs:StartQuery/GetQueryResults):
 *   node scripts/ops/weekly-error-report.mjs          # last 7 days
 *   node scripts/ops/weekly-error-report.mjs 2        # last 2 days
 *
 * HOW TO READ IT
 *   - P1000 lines: DB password rotation, 1-2 requests is normal and self-heals.
 *   - A route with many 500s: a crash on input we should have rejected (400)
 *     or a real bug. Open the route, reproduce with curl, fix.
 *   - Anything new vs last week deserves five minutes.
 * Cost: Logs Insights bills per GB scanned (~$0.005/GB); a week is cents.
 */
import { execFileSync } from 'node:child_process';

const days = Number(process.argv[2] || 7);
const REGION = process.env.AWS_REGION || 'eu-central-1';
const GROUPS = ['/ecs/jadwal-api', '/ecs/jadwal-web'];
const QUERY =
  'fields @timestamp, @message | filter @message like /"level":50/ or @message like /"statusCode":5/ or @message like /P1000/ or @message like /EACCES/ | sort @timestamp desc | limit 1000';

const aws = (...args) =>
  execFileSync('aws', [...args, '--region', REGION, '--output', 'json'], { encoding: 'utf8', maxBuffer: 64e6 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const group of GROUPS) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;
  const { queryId } = JSON.parse(
    aws('logs', 'start-query', '--log-group-name', group, '--start-time', String(start), '--end-time', String(end), '--query-string', QUERY),
  );
  let res;
  for (let i = 0; i < 60; i++) {
    res = JSON.parse(aws('logs', 'get-query-results', '--query-id', queryId));
    if (!['Running', 'Scheduled'].includes(res.status)) break;
    await sleep(2000);
  }
  if (res.status !== 'Complete') {
    throw new Error(`${group}: query ended as ${res.status}, refusing to report partial results - retry`);
  }
  const rows = res.results.map((r) => Object.fromEntries(r.map((x) => [x.field, x.value])));
  console.log(`\n=== ${group}: ${rows.length} error lines in the last ${days} day(s) (${res.status}) ===`);
  if (rows.length === 1000) console.log('(capped at 1000 - narrow the window)');

  const groups = new Map();
  for (const r of rows) {
    const m = r['@message'];
    const what =
      (m.match(/PRISMA_ERROR_5XX/) && `DB ${m.match(/"prismaCode":"(\w+)"/)?.[1] ?? ''}`) ||
      m.match(/\u2192 (\d{3}) \(([A-Za-z]+)/)?.slice(1).join(' ') ||
      m.match(/(Failed to [A-Za-z ]{3,40})/)?.[1] ||
      m.match(/"(?:msg|message)":"([^"]{0,70})/)?.[1] ||
      'other';
    const route = (m.match(/"(?:url|path)":"([^"?]*)/)?.[1] ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id');
    const key = `${what}  ${route}`;
    const g = groups.get(key) ?? { n: 0, last: '' };
    g.n++;
    if (r['@timestamp'] > g.last) g.last = r['@timestamp'];
    groups.set(key, g);
  }
  for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
    console.log(`${String(g.n).padStart(4)}x  ${k}   (last ${g.last.slice(0, 16)} UTC)`);
  }
}

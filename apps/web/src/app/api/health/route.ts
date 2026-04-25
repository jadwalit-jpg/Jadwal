/**
 * Web health endpoint for ALB / ECS target-group probes.
 *
 * Returns a static JSON body without touching the database, Redis, or the
 * API backend, so the probe response stays under 10ms even during cold
 * start. The homepage (`/`) does server-side rendering with DB queries and
 * can easily take 300ms+ — that's fine for real users but too slow for a
 * liveness check running every 5-10s.
 *
 * Use `/api/health` for the ALB liveness probe on the web target group.
 */

export const dynamic = 'force-static';

export function GET() {
  return new Response('{"status":"ok"}', {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

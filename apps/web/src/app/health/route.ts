import { NextResponse } from 'next/server';

// Liveness probe for the web container. Returns 'ok' as plain text with no
// SSR, no DB, no upstream API call. ALB target groups + Docker HEALTHCHECK
// hit this every 30 s — the previous setup probed `/` which paid the cost
// of a full home-page render on every probe and could flap during cold-
// start. Route handlers compile to a flat function, so this resolves in
// microseconds.
export const dynamic = 'force-static';
export const revalidate = false;

export function GET() {
  return new NextResponse('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

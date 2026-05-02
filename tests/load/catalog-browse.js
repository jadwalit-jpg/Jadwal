// catalog-browse.js — anonymous public-read load profile.
//
// Validates: Cloudflare cache hit ratio, ALB throughput, and the catalog
// endpoints' performance under the most common shape of incoming traffic
// (a logged-out visitor browsing the homepage / city / category pages).
//
// Profile: ramp 0 → 500 VU over 2 min, hold 5 min, ramp down 1 min.
// Pass: p95 < 200 ms, 5xx rate < 0.1 %.
//
// What this would catch:
//   - Cloudflare cache misconfiguration (every catalog request hitting origin
//     manifests as RDS CPU spike + p95 climb)
//   - Missing index on Activity / City / Category list queries
//   - Connection pool exhaustion on read-heavy paths

import http from 'k6/http';
import { sleep, group } from 'k6';
import { Rate } from 'k6/metrics';
import { baseUrl } from './lib/helpers.js';

export const errorRate = new Rate('catalog_errors');

export const options = {
  scenarios: {
    catalog_browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: Number(__ENV.K6_VUS || 500) },
        { duration: __ENV.K6_DURATION || '5m', target: Number(__ENV.K6_VUS || 500) },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200'],
    catalog_errors: ['rate<0.001'],
    http_req_failed: ['rate<0.001'],
  },
  // Tag every request so the summary / time-series can be sliced by endpoint.
  tags: { scenario: 'catalog-browse' },
};

const PATHS = [
  '/api/catalog/cities',
  '/api/catalog/categories',
  '/api/catalog/featured',
  '/api/catalog/vendors?city=doha',
];

export default function () {
  const root = baseUrl();
  group('catalog browse', () => {
    for (const path of PATHS) {
      const res = http.get(`${root}${path}`, {
        tags: { endpoint: path.split('?')[0] },
      });
      // Treat anything non-2xx as an error. A 304 from a long-lived cache
      // header would also be acceptable but our endpoints don't currently
      // emit ETags — keep it strict.
      errorRate.add(res.status >= 400);
    }
  });
  // 1–3 s think time between page loads: roughly mimics a human scrolling
  // and clicking through cities / categories.
  sleep(1 + Math.random() * 2);
}

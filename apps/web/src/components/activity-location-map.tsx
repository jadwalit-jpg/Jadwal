'use client';

// Leaflet CSS lives next to the only components that render a Leaflet
// map (this one + map-picker-modal.tsx). Pulling it in here means the
// ~14 KB of map styles are downloaded only when this component is
// mounted — not on every catalog / homepage / vendor page that never
// touches a map.
import 'leaflet/dist/leaflet.css';

import { useEffect, useRef } from 'react';

interface ActivityLocationMapProps {
  lat: number;
  lng: number;
  /** Default 15 — gives ~250m visible across the viewport, good for "this is the venue" pin */
  zoom?: number;
  /** Pixels — default 220 to match the legacy iframe height */
  height?: number;
  /** Accessibility — overrides the default lat/lng-derived label */
  ariaLabel?: string;
}

/**
 * Read-only Leaflet map showing a single marker at the activity location.
 *
 * Background:
 *   The previous implementation was an `<iframe src="https://maps.google.com
 *   /maps?q=...&output=embed">`. Google deprecated that URL pattern and the
 *   server now sends `X-Frame-Options: SAMEORIGIN`, blocking all third-party
 *   embedding. Replacing with Leaflet + OpenStreetMap tiles avoids both the
 *   X-Frame-Options issue and the API-key + billing setup that Google's
 *   modern Maps Embed API would require.
 *
 * The project already runs Leaflet + OSM tiles in map-picker-modal.tsx and
 * the vendor location editor; this component reuses the same dependency
 * chain (no new packages, no new CSP allowlist entries — `*.tile.open
 * streetmap.org` and `unpkg.com` are already in `img-src` per middleware.ts).
 *
 * UX choices:
 *   - `scrollWheelZoom: false` so scrolling down the activity page doesn't
 *     accidentally zoom the map (a common annoyance with embedded maps).
 *   - Zoom buttons stay on so curious users can still explore.
 *   - Drag-to-pan works normally.
 *   - The default Leaflet attribution control renders OSM credit in the
 *     bottom-right (a TOS requirement when using their tiles).
 */
export default function ActivityLocationMap({
  lat,
  lng,
  zoom = 15,
  height = 220,
  ariaLabel,
}: ActivityLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    // Dynamic import — Leaflet pokes `window` on first import, so static
    // import would break SSR even on a 'use client' page.
    import('leaflet').then((Lmod) => {
      if (cancelled || !container || mapInstanceRef.current) return;
      const L = (Lmod as unknown as { default?: typeof Lmod }).default ?? Lmod;

      // Default marker icon paths break under Webpack bundling. Point them
      // at unpkg-hosted PNGs — same fix as map-picker-modal.tsx.
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(container, {
        center: [lat, lng],
        zoom,
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      L.marker([lat, lng]).addTo(map);

      mapInstanceRef.current = map;
    });

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
    };
  }, [lat, lng, zoom]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%' }}
      role="img"
      aria-label={
        ariaLabel ?? `Map showing location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`
      }
    />
  );
}

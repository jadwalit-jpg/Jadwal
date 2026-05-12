'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

interface GeoCountry {
  id: string;
  nameEn: string;
  nameAr: string;
  isoCode: string;
  currencyCode: string;
}

interface GeoCity {
  id: string;
  nameEn: string;
  nameAr: string;
}

interface UserLocation {
  lat: number;
  lng: number;
}

interface GeoState {
  country: GeoCountry | null;
  city: GeoCity | null;
  /** 'detecting' | 'ip' | 'manual' | 'fallback' */
  source: string;
  isDetecting: boolean;
  setCountry: (country: GeoCountry) => void;
  setCity: (city: GeoCity | null) => void;
  /** Precise browser location — null until user grants permission */
  location: UserLocation | null;
  /** 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' */
  locationStatus: string;
  /** Request browser geolocation permission. Only call on user action (button click). */
  requestLocation: () => void;
}

const GeoContext = createContext<GeoState>({
  country: null,
  city: null,
  source: 'detecting',
  isDetecting: true,
  setCountry: () => {},
  setCity: () => {},
  location: null,
  locationStatus: 'idle',
  requestLocation: () => {},
});

// localStorage key + TTL for the IP-derived country/city (and any manual pick).
// IP geo barely changes, but we still re-validate against /geo/detect in the
// background on every load — the cache is only used to paint the right
// "Near You — <city>" label + fire the country-scoped catalog queries
// immediately on a refresh instead of after a Frankfurt round-trip. NOT used
// for the precise GPS coords — those stay in sessionStorage (jadwal_location),
// session-scoped, set only via an explicit button press.
const GEO_CACHE_KEY = 'jadwal_geo';
const GEO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — older than this → re-detect fresh
// If the cached value is younger than this, trust it and DON'T re-fire
// /geo/detect on load — so a plain refresh makes zero geo requests. Older →
// re-validate in the background (catches travel / VPN / ISP changes).
const GEO_REVALIDATE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

type CachedGeo = { country: GeoCountry | null; city: GeoCity | null; source: string; ts: number };

function readGeoCache(): CachedGeo | null {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedGeo;
    if (!parsed || typeof parsed.ts !== 'number' || Date.now() - parsed.ts > GEO_CACHE_TTL_MS) return null;
    if (!parsed.country?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeGeoCache(country: GeoCountry | null, city: GeoCity | null, source: string) {
  try {
    if (!country?.id) return;
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ country, city, source, ts: Date.now() } satisfies CachedGeo));
  } catch {
    /* quota / private mode — non-fatal, we just re-detect next time */
  }
}

export function GeoProvider({ children }: { children: React.ReactNode }) {
  const [country, setCountryState] = useState<GeoCountry | null>(null);
  const [city, setCityState] = useState<GeoCity | null>(null);
  const [source, setSource] = useState('detecting');

  // Browser geolocation state — always start with null/idle for SSR, restore after mount
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState('idle');

  // True once we have *any* country — a cached one counts. Drives `isDetecting`
  // so the homepage skeletons clear / the country-scoped queries fire the
  // moment we have something, not only after the /geo/detect round-trip.
  const [hasGeo, setHasGeo] = useState(false);
  // `geoChecked` flips true once the restore effect below has run — so render 1
  // (before we've looked at the cache) still counts as "detecting". `revalidate`
  // gates the /geo/detect query: it only fires when there's no cache, the cache
  // is stale (> GEO_REVALIDATE_AFTER_MS), or a manual override is absent — so a
  // plain refresh with a fresh cache makes ZERO /geo/detect requests.
  const [geoChecked, setGeoChecked] = useState(false);
  const [revalidate, setRevalidate] = useState(false);

  // Live mirrors of `source` / `country` so the effects + callbacks below can
  // read the current value without taking them as effect deps (which would
  // re-run the merge effect on every change, risking a re-apply of geoData
  // after a manual pick) and without doing side effects inside a setState
  // updater (React may call updaters more than once).
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const countryRef = useRef(country);
  countryRef.current = country;

  // Restore from storage after mount to avoid SSR hydration mismatch.
  useEffect(() => {
    // Precise GPS coords — session-scoped (cleared on tab close), only ever set
    // via an explicit user button press.
    try {
      const saved = sessionStorage.getItem('jadwal_location');
      if (saved) {
        setLocation(JSON.parse(saved));
        setLocationStatus('granted');
      }
    } catch { /* ignore */ }

    // IP-derived (or previously manual) country/city — persisted, conditionally
    // re-validated below. Paint it immediately so /home doesn't wait on /geo/detect.
    const cached = readGeoCache();
    if (cached?.country) {
      const restoredSource = cached.source === 'manual' ? 'manual' : 'ip';
      setCountryState(cached.country);
      setCityState(cached.city ?? null);
      setSource(restoredSource);
      // Set the refs now — effects run in declaration order, so this lands
      // before the merge effect below in the same commit, ensuring a restored
      // manual pick isn't clobbered if /geo/detect happened to be warm on mount.
      sourceRef.current = restoredSource;
      countryRef.current = cached.country;
      setHasGeo(true);
      // Re-validate only if the cached value is getting old. A fresh cache → skip
      // the /geo/detect round-trip entirely (a plain refresh = no geo request).
      // A manual pick is never auto-revalidated (the user chose it deliberately).
      if (restoredSource !== 'manual' && Date.now() - cached.ts >= GEO_REVALIDATE_AFTER_MS) {
        setRevalidate(true);
      }
    } else {
      // No usable cache → must detect.
      setRevalidate(true);
    }
    setGeoChecked(true);
  }, []);

  // /geo/detect — only fires when the restore effect decided it's needed
  // (`revalidate`): no cache, a stale cache, or first-ever visit. With a fresh
  // cache this query never fires, so a refresh costs zero geo requests. When it
  // does fire, it confirms / corrects the painted value (travel, VPN, …).
  const { data: geoData, isLoading } = useQuery<{
    country: GeoCountry | null;
    city: GeoCity | null;
    source: string;
  }>({
    queryKey: ['geo-detect'],
    queryFn: () => api.get('/geo/detect').then(r => r.data),
    staleTime: 30 * 60 * 1000,
    retry: 1,
    enabled: revalidate,
  });

  useEffect(() => {
    if (!geoData) return;
    if (sourceRef.current === 'manual') return; // never clobber an explicit pick
    if (geoData.country) {
      const changed =
        geoData.country.id !== country?.id ||
        (geoData.city?.id ?? null) !== (city?.id ?? null);
      if (changed) {
        setCountryState(geoData.country);
        setCityState(geoData.city ?? null);
      }
      setSource(geoData.source);
      writeGeoCache(geoData.country, geoData.city ?? null, geoData.source);
    } else {
      setSource(geoData.source);
    }
    setHasGeo(true);
  }, [geoData, country?.id, city?.id]);

  const setCountry = useCallback((c: GeoCountry) => {
    setCountryState(c);
    setCityState(null);
    setSource('manual');
    setHasGeo(true);
    countryRef.current = c;
    sourceRef.current = 'manual';
    writeGeoCache(c, null, 'manual');
  }, []);

  const setCity = useCallback((c: GeoCity | null) => {
    setCityState(c);
    setSource('manual');
    // Plain side effect using the country ref — not inside a setState updater
    // (those must be pure / may run more than once).
    writeGeoCache(countryRef.current, c, 'manual');
  }, []);

  /**
   * Request precise browser location.
   * Only called on explicit user action (button click) — never automatically.
   * Coordinates stay in memory + sessionStorage only — never logged, never
   * persisted to localStorage or the DB.
   */
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus('unavailable');
      return;
    }

    setLocationStatus('requesting');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocation(loc);
        setLocationStatus('granted');
        try { sessionStorage.setItem('jadwal_location', JSON.stringify(loc)); } catch { /* quota exceeded */ }
      },
      (err) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        setLocationStatus(err.code === 1 ? 'denied' : 'unavailable');
      },
      {
        enableHighAccuracy: false, // Low accuracy is fine for activity search (city-level)
        timeout: 10000,            // 10s timeout
        maximumAge: 5 * 60 * 1000, // Cache position for 5 minutes
      },
    );
  }, []);

  const value = useMemo(() => ({
    country,
    city,
    source,
    // "detecting" until the restore effect has run, and after that only while a
    // (needed) /geo/detect call is still in flight with nothing painted yet.
    // With a fresh cache this is false almost immediately and stays false.
    isDetecting: !geoChecked || (isLoading && !hasGeo),
    setCountry,
    setCity,
    location,
    locationStatus,
    requestLocation,
  }), [country, city, source, geoChecked, isLoading, hasGeo, setCountry, setCity, location, locationStatus, requestLocation]);

  return <GeoContext.Provider value={value}>{children}</GeoContext.Provider>;
}

export function useGeo() {
  return useContext(GeoContext);
}

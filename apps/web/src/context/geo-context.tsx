'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
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

export function GeoProvider({ children }: { children: React.ReactNode }) {
  const [country, setCountryState] = useState<GeoCountry | null>(null);
  const [city, setCityState] = useState<GeoCity | null>(null);
  const [source, setSource] = useState('detecting');

  // Browser geolocation state — always start with null/idle for SSR, restore after mount
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState('idle');

  // Restore from sessionStorage after mount to avoid SSR hydration mismatch
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('jadwal_location');
      if (saved) {
        setLocation(JSON.parse(saved));
        setLocationStatus('granted');
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-detect country/city via IP on first load
  const { data: geoData, isLoading } = useQuery<{
    country: GeoCountry | null;
    city: GeoCity | null;
    source: string;
  }>({
    queryKey: ['geo-detect'],
    queryFn: () => api.get('/geo/detect').then(r => r.data),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (geoData && source === 'detecting') {
      if (geoData.country) setCountryState(geoData.country);
      if (geoData.city) setCityState(geoData.city);
      setSource(geoData.source);
    }
  }, [geoData, source]);

  const setCountry = useCallback((c: GeoCountry) => {
    setCountryState(c);
    setCityState(null);
    setSource('manual');
  }, []);

  const setCity = useCallback((c: GeoCity | null) => {
    setCityState(c);
    setSource('manual');
  }, []);

  /**
   * Request precise browser location.
   * Only called on explicit user action (button click) — never automatically.
   * Coordinates stay in memory only — never logged, never stored in DB.
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
    isDetecting: isLoading && source === 'detecting',
    setCountry,
    setCity,
    location,
    locationStatus,
    requestLocation,
  }), [country, city, source, isLoading, setCountry, setCity, location, locationStatus, requestLocation]);

  return <GeoContext.Provider value={value}>{children}</GeoContext.Provider>;
}

export function useGeo() {
  return useContext(GeoContext);
}

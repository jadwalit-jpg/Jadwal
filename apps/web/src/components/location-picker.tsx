'use client';

import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { MapPin, Loader2, CheckCircle2, Link, Map } from 'lucide-react';

const MapPickerModal = lazy(() => import('./map-picker-modal'));

interface LocationResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface LocationValue {
  address: string;
  lat: number;
  lng: number;
}

interface LocationPickerProps {
  value: LocationValue;
  onChange: (val: LocationValue) => void;
  error?: string;
  placeholder?: string;
}

// ─── Parsers ─────────────────────────────────────────────────

/** "25.695055, 50.989407" or "25.695055,50.989407" */
function parseCoords(input: string): { lat: number; lng: number } | null {
  const m = input.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Extract coords from any google.com/maps URL */
function parseGoogleMapsUrl(input: string): { lat: number; lng: number } | null {
  if (!input.includes('google.com/maps')) return null;

  // Try @lat,lng,zoom (most reliable — map viewport center)
  const atMatch = input.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };

  // Try /place/lat,lng or path segment like /25.123,51.456/
  const pathMatch = input.match(/\/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (pathMatch) return { lat: parseFloat(pathMatch[1]), lng: parseFloat(pathMatch[2]) };

  // Try data=...!3d<lat>!4d<lng>
  const dataLat = input.match(/!3d(-?\d+\.\d+)/);
  const dataLng = input.match(/!4d(-?\d+\.\d+)/);
  if (dataLat && dataLng) return { lat: parseFloat(dataLat[1]), lng: parseFloat(dataLng[1]) };

  return null;
}

const inputCls = 'w-full ps-10 pe-10 py-2.5 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 transition-colors truncate';

export function LocationPicker({ value, onChange, error, placeholder }: LocationPickerProps) {
  const [query, setQuery] = useState(value.address || '');
  const [suggestions, setSuggestions] = useState<LocationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(!!value.lat && !!value.lng);
  const [hint, setHint] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Prefill from external value (edit page)
  useEffect(() => {
    if (value.address && value.address !== query) {
      setQuery(value.address);
      setConfirmed(!!value.lat && !!value.lng);
    }
  }, [value.address]);

  const searchNominatim = useCallback(async (q: string) => {
    if (q.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data: LocationResult[] = await res.json();
      setSuggestions(data);
      setOpen(data.length > 0);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    setConfirmed(false);
    setHint('');
    setSuggestions([]);
    setOpen(false);

    // 1. Raw coordinates
    const coords = parseCoords(val);
    if (coords) {
      onChange({ address: val, lat: coords.lat, lng: coords.lng });
      setConfirmed(true);
      setHint(`Coordinates detected: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`);
      return;
    }

    // 2. Google Maps URL
    const gmCoords = parseGoogleMapsUrl(val);
    if (gmCoords) {
      onChange({ address: `${gmCoords.lat}, ${gmCoords.lng}`, lat: gmCoords.lat, lng: gmCoords.lng });
      setQuery(`${gmCoords.lat}, ${gmCoords.lng}`);
      setConfirmed(true);
      setHint(`Extracted from Google Maps: ${gmCoords.lat.toFixed(6)}, ${gmCoords.lng.toFixed(6)}`);
      return;
    }

    // 3. Address search (debounced)
    onChange({ address: val, lat: 0, lng: 0 });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchNominatim(val), 400);
  };

  const handleSelect = (result: LocationResult) => {
    const address = result.display_name;
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    setQuery(address);
    setConfirmed(true);
    setOpen(false);
    setSuggestions([]);
    setHint('');
    onChange({ address, lat, lng });
  };

  const handleMapConfirm = (lat: number, lng: number, address: string) => {
    setQuery(address);
    setConfirmed(true);
    setHint(`Pin placed: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    setOpen(false);
    setSuggestions([]);
    onChange({ address, lat, lng });
    setMapOpen(false);
  };

  const isUrl = query.includes('google.com/maps');

  return (
    <>
      <div ref={containerRef} className="relative">
        <div className="relative">
          {isUrl
            ? <Link className="absolute inset-s-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            : <MapPin className={`absolute inset-s-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none ${confirmed ? 'text-teal-500' : 'text-gray-400'}`} />
          }
          <input
            type="text"
            value={query}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder={placeholder ?? 'Paste coordinates, Google Maps link, or type an address…'}
            autoComplete="off"
            className={`${inputCls} ${error ? 'border-red-400 focus:ring-red-400/30' : ''}`}
          />
          {loading && <Loader2 className="absolute inset-e-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />}
          {confirmed && !loading && <CheckCircle2 className="absolute inset-e-3 top-1/2 -translate-y-1/2 h-4 w-4 text-teal-500" />}
        </div>

        {/* Helper text + Pick on Map button */}
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-xs text-gray-400 dark:text-slate-500">
            {hint
              ? <span className="text-teal-600 dark:text-teal-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3 inline" /> {hint}</span>
              : 'Paste coordinates, a Google Maps link, or type an address'
            }
          </p>
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
          >
            <Map className="h-3.5 w-3.5" />
            Pick on Map
          </button>
        </div>

        {/* Suggestions dropdown */}
        {open && suggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(s)}
                className="w-full text-start px-4 py-3 text-sm text-gray-800 dark:text-slate-200 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors flex items-start gap-2 border-b border-gray-50 dark:border-slate-800 last:border-0"
              >
                <MapPin className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                <span className="line-clamp-2">{s.display_name}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>

      {/* Map Picker Modal — dynamically loaded */}
      {mapOpen && (
        <Suspense fallback={null}>
          <MapPickerModal
            initialLat={value.lat || undefined}
            initialLng={value.lng || undefined}
            onConfirm={handleMapConfirm}
            onClose={() => setMapOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

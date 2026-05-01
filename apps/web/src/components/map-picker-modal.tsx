'use client';

// Leaflet CSS lives next to the only component that renders a leaflet
// map. Pulling it in here (instead of globals.css) means the ~14 KB of
// map styles are downloaded only when this modal is mounted — not on
// every homepage / catalog page that never touches a map.
import 'leaflet/dist/leaflet.css';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, CheckCircle2, X } from 'lucide-react';

interface MapPickerModalProps {
  initialLat?: number;
  initialLng?: number;
  onConfirm: (lat: number, lng: number, address: string) => void;
  onClose: () => void;
}

// Default center: Qatar
const DEFAULT_LAT = 25.2854;
const DEFAULT_LNG = 51.531;

export default function MapPickerModal({ initialLat, initialLng, onConfirm, onClose }: MapPickerModalProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [selected, setSelected] = useState<{ lat: number; lng: number } | null>(
    initialLat && initialLng ? { lat: initialLat, lng: initialLng } : null
  );
  const [address, setAddress] = useState('');
  const [resolving, setResolving] = useState(false);

  // Reverse geocode using Nominatim
  const reverseGeocode = async (lat: number, lng: number) => {
    setResolving(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      setAddress(data.display_name ?? `${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    } catch {
      setAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;

    // Dynamically load Leaflet (avoids SSR issues)
    import('leaflet').then((L) => {
      if (cancelled || !mapRef.current || mapInstanceRef.current) return;
      // Fix default marker icon paths (Webpack bundles break them)
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const centerLat = initialLat || DEFAULT_LAT;
      const centerLng = initialLng || DEFAULT_LNG;
      const zoom = initialLat ? 15 : 11;

      const map = L.map(mapRef.current!, { zoomControl: true }).setView([centerLat, centerLng], zoom);
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      // Place initial marker if coords exist
      if (initialLat && initialLng) {
        const marker = L.marker([initialLat, initialLng], { draggable: true }).addTo(map);
        markerRef.current = marker;
        reverseGeocode(initialLat, initialLng);

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          setSelected({ lat: pos.lat, lng: pos.lng });
          reverseGeocode(pos.lat, pos.lng);
        });
      }

      // Click to drop pin
      map.on('click', (e: any) => {
        const { lat, lng } = e.latlng;

        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
          markerRef.current = marker;
          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            setSelected({ lat: pos.lat, lng: pos.lng });
            reverseGeocode(pos.lat, pos.lng);
          });
        }

        setSelected({ lat, lng });
        reverseGeocode(lat, lng);
      });
    });

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  const handleConfirm = () => {
    if (!selected) return;
    onConfirm(selected.lat, selected.lng, address || `${selected.lat.toFixed(6)}, ${selected.lng.toFixed(6)}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Pick Location on Map</h3>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Click anywhere to drop a pin, or drag the pin to adjust</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Map */}
        <div
          ref={mapRef}
          className="w-full"
          style={{ height: '400px' }}
        />

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/80">
          {selected ? (
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2 min-w-0">
                {resolving
                  ? <Loader2 className="h-4 w-4 text-teal-500 animate-spin mt-0.5 shrink-0" />
                  : <CheckCircle2 className="h-4 w-4 text-teal-500 mt-0.5 shrink-0" />
                }
                <div className="min-w-0">
                  <p className="text-xs text-teal-600 dark:text-teal-400 font-medium">
                    {selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}
                  </p>
                  {address && (
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">{address}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={resolving}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <MapPin className="h-4 w-4" />
                Confirm Location
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-1">
              Click anywhere on the map to select a location
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

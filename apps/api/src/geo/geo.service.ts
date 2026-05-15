import { Injectable, Logger } from '@nestjs/common';
import * as geoip from 'geoip-lite';
import { PrismaService } from '../prisma/prisma.service';

/** Haversine distance in km between two lat/lng points */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(private prisma: PrismaService) {}

  async detectLocation(ip: string) {
    // 1. IP lookup (local MaxMind DB — no network call)
    const geo = geoip.lookup(ip);

    // Two distinct cases:
    //   - geo.country present → real public IP, country detected (e.g. 'DE')
    //   - geo.country absent  → private/localhost/unmappable IP — dev or NAT
    // Only the second case earns the QA fallback (so dev environments keep
    // showing Qatar context). For real geo, if the country isn't in our DB
    // we return null country — the homepage will show empty state instead
    // of silently mis-attributing the visitor to Qatar.
    const detectedIso = geo?.country?.toUpperCase() ?? null;
    const ipLat = geo?.ll?.[0] ?? null;
    const ipLng = geo?.ll?.[1] ?? null;

    // Never log full IP (PII) or precise coordinates
    this.logger.debug(`Geo detect → country=${detectedIso ?? 'unknown'}`);

    // 2. Match to our country. Case-insensitive so a data-entry typo in the
    // admin form (e.g. row stored as "de" instead of "DE") doesn't break
    // detection. DTO-level @Transform on country create / update is the
    // belt-and-suspenders fix for new rows; this is the defence for legacy.
    const lookupIso = detectedIso ?? 'QA'; // private/localhost → Qatar dev fallback
    const country = await this.prisma.client.country.findFirst({
      where: {
        isoCode: { equals: lookupIso, mode: 'insensitive' },
        status: 'ACTIVE',
      },
      select: { id: true, nameEn: true, nameAr: true, isoCode: true, currencyCode: true },
    });

    // No silent Qatar fallback for unsupported countries. If we detected
    // a real public-IP country and it isn't in our ACTIVE country list,
    // return null so the frontend can either prompt for manual selection
    // or render an empty "we're not in your country yet" state. Silently
    // attributing a German visitor to Qatar produces wrong content (the
    // canonical bug this method used to ship with).
    if (!country) {
      return {
        country: null,
        city: null,
        // 'unsupported' = real geo, country not in our DB (Germany before we operate there)
        // 'unknown'     = couldn't detect geo at all AND no Qatar row in DB (rare dev edge case)
        source: detectedIso ? 'unsupported' : 'unknown',
      };
    }

    // 3. Find nearest city in the matched country
    const cities = await this.prisma.client.city.findMany({
      where: { countryId: country.id },
      select: { id: true, nameEn: true, nameAr: true, lat: true, lng: true },
    });

    let nearestCity = cities[0] ?? null; // default to first city

    if (ipLat !== null && ipLng !== null && cities.length > 1) {
      let minDist = Infinity;
      for (const city of cities) {
        if (city.lat == null || city.lng == null) continue;
        const dist = haversineKm(ipLat, ipLng, city.lat, city.lng);
        if (dist < minDist) {
          minDist = dist;
          nearestCity = city;
        }
      }
    }

    return {
      country,
      city: nearestCity ? { id: nearestCity.id, nameEn: nearestCity.nameEn, nameAr: nearestCity.nameAr } : null,
      // 'ip'       = real geo matched a country in our DB
      // 'fallback' = no geo (private/localhost IP) but the dev-fallback Qatar row was found
      source: detectedIso ? 'ip' : 'fallback',
    };
  }
}

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

    // Default to Qatar if IP is private/localhost or not found
    const isoCode = geo?.country ?? 'QA';
    const ipLat = geo?.ll?.[0] ?? null;
    const ipLng = geo?.ll?.[1] ?? null;

    // Never log full IP (PII) or precise coordinates
    this.logger.debug(`Geo detect → country=${isoCode}`);

    // 2. Match to our country
    const country = await this.prisma.client.country.findFirst({
      where: { isoCode, status: 'ACTIVE' },
      select: { id: true, nameEn: true, nameAr: true, isoCode: true, currencyCode: true },
    });

    // Fallback: if country not in our DB (e.g. user from India), default to Qatar
    const fallbackCountry = country ?? await this.prisma.client.country.findFirst({
      where: { isoCode: 'QA', status: 'ACTIVE' },
      select: { id: true, nameEn: true, nameAr: true, isoCode: true, currencyCode: true },
    });

    if (!fallbackCountry) {
      return { country: null, city: null, source: 'none' };
    }

    // 3. Find nearest city in the matched country
    const cities = await this.prisma.client.city.findMany({
      where: { countryId: fallbackCountry.id },
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
      country: fallbackCountry,
      city: nearestCity ? { id: nearestCity.id, nameEn: nearestCity.nameEn, nameAr: nearestCity.nameAr } : null,
      source: country ? 'ip' : 'fallback',
    };
  }
}

import { Controller, Get, Header, Param, Query, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceDataCacheService } from '../redis/reference-data-cache.service';
import { RATE_LIMIT_VENDOR } from '../common/throttle-config';

/**
 * Cache-Control values for public catalog GETs (Stream D, perf sprint).
 *
 *   public          — Cloudflare may cache (no auth needed).
 *   s-maxage=N      — CF edge cache for N seconds (origin sees fewer hits).
 *   stale-while-revalidate=M — CF serves stale up to M seconds after expiry
 *                              while it asynchronously refreshes from origin.
 *                              No cache-miss latency for the user during the
 *                              SWR window — the perceived TTFB is the cache
 *                              hit, not the origin round-trip.
 *
 * Tier choice driven by data volatility, not request volume:
 *
 *   STATIC_LONG  (1 h + 24 h SWR)  — reference data that changes ~yearly.
 *                                    Countries, categories, cities, platform
 *                                    settings.
 *   LIVE_SHORT   (5 m + 1 h SWR)   — content that admins edit, but stale-up-to-5
 *                                    -minutes is acceptable for browse paths.
 *                                    Trending, activity detail.
 *   LISTING      (2 m + 10 m SWR)  — catalog listing that includes
 *                                    inventory/availability — fresher.
 *
 * Admin mutations that need instant invalidation can call CF cache-purge
 * via the API token if precise freshness ever matters; for the launch we
 * accept up to 1 h staleness on reference data.
 */
const CACHE_STATIC_LONG = 'public, s-maxage=3600, stale-while-revalidate=86400';
const CACHE_LIVE_SHORT  = 'public, s-maxage=300,  stale-while-revalidate=3600';
const CACHE_LISTING     = 'public, s-maxage=120,  stale-while-revalidate=600';

/**
 * Catalog — public, unauthenticated endpoints.
 * Serves the customer-facing browse experience:
 * countries, categories, cities, trending events, activity listing, activity detail.
 *
 * Base URL: /catalog
 */
@Controller('catalog')
export class CatalogController {
  constructor(
    private prisma: PrismaService,
    private refCache: ReferenceDataCacheService,
  ) {}

  // C1: origin-side cache for slow-changing reference data. CDN handles
  // edge caching; this prevents thundering-herd Postgres hits on every CDN
  // refresh / cache miss. Pattern mirrors AvailabilityCacheService.
  // Cache-aside: on miss → DB → set cache → return. Cache failure is
  // fail-open (logs, falls through to DB).

  @Get('countries')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_STATIC_LONG)
  async getCountries() {
    const cached = await this.refCache.get<unknown[]>('countries', 'active');
    if (cached) return cached;
    const data = await this.prisma.client.country.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, nameEn: true, nameAr: true, isoCode: true, currencyCode: true, defaultTimezone: true },
      orderBy: { nameEn: 'asc' },
    });
    await this.refCache.set('countries', 'active', data);
    return data;
  }

  @Get('categories')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_STATIC_LONG)
  async getCategories() {
    const cached = await this.refCache.get<unknown[]>('categories', 'roots');
    if (cached) return cached;
    const data = await this.prisma.client.category.findMany({
      where: { parentId: null },
      select: {
        id: true, nameEn: true, nameAr: true, slug: true, image: true,
        _count: { select: { activities: true } },
        children: { select: { id: true, nameEn: true, nameAr: true, slug: true } },
      },
      orderBy: { nameEn: 'asc' },
    });
    await this.refCache.set('categories', 'roots', data);
    return data;
  }

  @Get('cities')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_STATIC_LONG)
  async getAllCities() {
    const cached = await this.refCache.get<unknown[]>('cities', 'all');
    if (cached) return cached;
    const data = await this.prisma.client.city.findMany({
      select: { id: true, nameEn: true, nameAr: true, lat: true, lng: true, countryId: true },
      orderBy: { nameEn: 'asc' },
    });
    await this.refCache.set('cities', 'all', data);
    return data;
  }

  @Get('cities/:countryId')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_STATIC_LONG)
  async getCitiesByCountry(@Param('countryId') countryId: string) {
    // UUIDs contain dashes which are allowed by KEY_PART_RE; if the param
    // shape is unsafe the cache no-ops and we just hit the DB. So this is
    // safe to call with any string — bad inputs fall through cleanly.
    const cached = await this.refCache.get<unknown[]>('cities', `country-${countryId}`);
    if (cached) return cached;
    const data = await this.prisma.client.city.findMany({
      where: { countryId },
      select: { id: true, nameEn: true, nameAr: true, lat: true, lng: true },
      orderBy: { nameEn: 'asc' },
    });
    await this.refCache.set('cities', `country-${countryId}`, data);
    return data;
  }

  @Get('trending')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_LIVE_SHORT)
  getTrending(@Query('countryId') countryId?: string) {
    // Return events for the given country + global events (countryId = null)
    const where: any = { isActive: true };
    if (countryId) {
      where.OR = [{ countryId }, { countryId: null }];
    }
    return this.prisma.client.trendingEvent.findMany({
      where,
      select: {
        id: true, titleEn: true, titleAr: true,
        description: true, descriptionAr: true,
        image: true, eventDate: true, countryId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Activity listing — only ACTIVE activities from ACTIVE vendors.
   * Suspended / pending vendors' activities are automatically excluded.
   *
   * Rate-limited to RATE_LIMIT_VENDOR (60/min per IP). This is the single
   * heaviest read in the app (complex JOIN, ratings aggregate, availability
   * sweep-line). A higher tier would invite DoS; a lower tier would throttle
   * legitimate catalog browsing.
   */
  @Get('activities')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_LISTING)
  async getActivities(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('countryId') countryId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('category') categorySlug?: string,
    @Query('cityId') cityId?: string,
    @Query('search') search?: string,
    @Query('featured') featured?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('minPrice') minPriceRaw?: string,
    @Query('maxPrice') maxPriceRaw?: string,
    @Query('bookingType') bookingType?: string,
  ) {
    const take = Math.min(Number(limit) || 20, 20);
    const skip = ((Number(page) || 1) - 1) * take;

    const where: any = {
      status: 'ACTIVE',
      // §B9 — exclude soft-deleted activities AND activities whose vendor
      // was soft-deleted. Without this filter, a deleted vendor's old
      // activities would still appear in public listings even though
      // the vendor row is gone for any practical purpose.
      deletedAt: null,
      vendor: { status: 'ACTIVE', deletedAt: null },
    };
    if (countryId) where.countryId = countryId;
    if (categoryId) {
      // Look up whether the selected category is a parent or child
      const cat = await this.prisma.client.category.findUnique({
        where: { id: categoryId },
        select: { parentId: true, children: { select: { id: true } } },
      });
      if (cat?.parentId) {
        // Child category selected — match activities explicitly tagged with this subcategory,
        // OR activities tagged with just the parent category (no subcategory set)
        where.AND = [...(where.AND ?? []), {
          OR: [
            { categoryId },
            { subCategoryId: categoryId },
            { categoryId: cat.parentId, subCategoryId: null },
          ],
        }];
      } else if (cat?.children?.length) {
        // Parent category selected — match activities under this parent or any of its children
        const childIds = cat.children.map((c: { id: string }) => c.id);
        where.AND = [...(where.AND ?? []), {
          OR: [
            { categoryId },
            { subCategoryId: { in: childIds } },
          ],
        }];
      } else {
        // Leaf category or not found — direct match
        where.AND = [...(where.AND ?? []), { OR: [{ categoryId }, { subCategoryId: categoryId }] }];
      }
    } else if (categorySlug) {
      // Slug filter: match parent category directly, or activities whose category's parent has this slug
      where.AND = [...(where.AND ?? []), { OR: [{ category: { slug: categorySlug } }, { category: { parent: { slug: categorySlug } } }] }];
    }
    if (cityId) where.cityId = cityId;
    if (featured === 'true') where.isFeatured = true;
    if (search) {
      where.AND = [...(where.AND ?? []), { OR: [
        { titleEn: { contains: search, mode: 'insensitive' } },
        { titleAr: { contains: search, mode: 'insensitive' } },
      ] }];
    }

    // Price range filters
    const minPrice = minPriceRaw ? parseFloat(minPriceRaw) : NaN;
    const maxPrice = maxPriceRaw ? parseFloat(maxPriceRaw) : NaN;
    if (!isNaN(minPrice) && minPrice >= 0) {
      where.pricePerPerson = { ...(where.pricePerPerson ?? {}), gte: minPrice };
    }
    if (!isNaN(maxPrice) && maxPrice >= 0) {
      where.pricePerPerson = { ...(where.pricePerPerson ?? {}), lte: maxPrice };
    }

    // Booking type filter
    if (bookingType && (bookingType === 'HOURLY' || bookingType === 'DAILY')) {
      where.bookingType = bookingType;
    }

    const [rawData, total] = await Promise.all([
      this.prisma.client.activity.findMany({
        where,
        select: {
          id: true, titleEn: true, titleAr: true, slug: true,
          pricePerPerson: true, capacity: true, locationAddress: true,
          locationLat: true, locationLng: true,
          coverImage: true, gallery: true, durationValue: true, bookingType: true, isFeatured: true,
          pricingModel: true, checkInTime: true, checkOutTime: true,
          hasUnits: true, unitCount: true, unitCapacity: true,
          category: { select: { nameEn: true, nameAr: true, slug: true } },
          city: { select: { nameEn: true, nameAr: true } },
          country: { select: { nameEn: true, currencyCode: true, defaultTimezone: true } },
          vendor: { select: { businessNameEn: true, businessNameAr: true, slug: true } },
          _count: { select: { reviews: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.client.activity.count({ where }),
    ]);

    // ── Rating aggregate: avg + count per activity on the page ──
    // Batched groupBy — one round-trip regardless of page size. No schema change.
    const activityIdsForRatings = rawData.map((a) => a.id);
    const ratingMap = new Map<string, { avg: number; count: number }>();
    if (activityIdsForRatings.length > 0) {
      const ratings = await this.prisma.client.review.groupBy({
        by: ['activityId'],
        where: { activityId: { in: activityIdsForRatings } },
        _avg: { rating: true },
        _count: { rating: true },
      });
      for (const r of ratings) {
        ratingMap.set(r.activityId, {
          avg: r._avg.rating ?? 0,
          count: r._count.rating ?? 0,
        });
      }
    }

    // ── Availability: count booked guests for today per activity ──
    //
    // For HOURLY activities with flex-start slots, the same booking can appear
    // in multiple overlapping windows — a naive groupBy(_sum guests) over the
    // whole day over-counts and fires false scarcity in catalog cards. We fetch
    // today's bookings and compute, per activity:
    //   HOURLY → peak concurrent guests across the day (sweep-line)
    //   DAILY  → total guests occupying inventory today (flat sum)
    const activityIds = rawData.map((a) => a.id);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const bookedMap = new Map<string, number>();
    if (activityIds.length > 0) {
      const todayBookings = await this.prisma.client.booking.findMany({
        where: {
          activityId: { in: activityIds },
          status: { in: ['PENDING', 'CONFIRMED'] },
          startDatetime: { lte: todayEnd },
          endDatetime: { gte: todayStart },
        },
        select: { activityId: true, startDatetime: true, endDatetime: true, guests: true },
        // DoS cap for the whole catalog-page aggregate (all activities combined).
        // Realistic page-size upper bound: 100 activities × 50 bookings/day = 5k.
        take: Number(process.env.AVAILABILITY_MAX_CATALOG_BOOKINGS || 10000),
      });
      const typeById = new Map(rawData.map((a) => [a.id, a.bookingType]));
      const byActivity = new Map<string, typeof todayBookings>();
      for (const b of todayBookings) {
        const arr = byActivity.get(b.activityId) ?? [];
        arr.push(b); byActivity.set(b.activityId, arr);
      }
      for (const [aid, rows] of byActivity) {
        if (typeById.get(aid) === 'HOURLY') {
          // Sweep-line peak concurrent across today — same algorithm as
          // bookings.service.ts maxConcurrentInWindow. Inlined here to avoid
          // importing service internals into a controller.
          const events: Array<{ t: number; d: number; isStart: number }> = [];
          for (const b of rows) {
            const s = b.startDatetime > todayStart ? b.startDatetime : todayStart;
            const e = b.endDatetime < todayEnd ? b.endDatetime : todayEnd;
            if (s.getTime() >= e.getTime()) continue;
            events.push({ t: s.getTime(), d: b.guests, isStart: 1 });
            events.push({ t: e.getTime(), d: -b.guests, isStart: 0 });
          }
          events.sort((a, b) => (a.t - b.t) || (a.isStart - b.isStart));
          let cur = 0, peak = 0;
          for (const ev of events) { cur += ev.d; if (cur > peak) peak = cur; }
          bookedMap.set(aid, peak);
        } else {
          bookedMap.set(aid, rows.reduce((s, r) => s + r.guests, 0));
        }
      }
    }

    // If lat/lng provided, compute distance and sort by proximity
    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;

    let data: any[] = rawData.map((a) => {
      const rating = ratingMap.get(a.id);
      return {
        ...a,
        bookedToday: bookedMap.get(a.id) ?? 0,
        avgRating: rating ? Math.round(rating.avg * 10) / 10 : null,
        reviewCount: rating?.count ?? a._count?.reviews ?? 0,
      };
    });

    if (userLat !== null && userLng !== null && !isNaN(userLat) && !isNaN(userLng)) {
      data = data.map((a) => {
        const R = 6371;
        const dLat = ((a.locationLat - userLat) * Math.PI) / 180;
        const dLng = ((a.locationLng - userLng) * Math.PI) / 180;
        const x =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((userLat * Math.PI) / 180) *
            Math.cos((a.locationLat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        const distanceKm = R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
        return { ...a, distanceKm: Math.round(distanceKm * 10) / 10 };
      }).sort((a, b) => a.distanceKm - b.distanceKm);
    }

    return { data, total, page: Number(page), limit: take, totalPages: Math.ceil(total / take) };
  }

  /** Related activities — "You might also like" section */
  @Get('activities/:slug/related')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_LIVE_SHORT)
  async getRelatedActivities(
    @Param('slug') slug: string,
    @Query('limit') limitParam = '4',
  ) {
    const limit = Math.min(Math.max(Number(limitParam) || 4, 1), 8);

    // §B9 — soft-deleted activities have their slug rewritten to
    // `deleted-<id>`, so a public lookup by the original slug is a
    // 404. The findFirst+deletedAt filter below is defence in depth
    // against any future code path that might somehow bypass the
    // slug rename.
    const current = await this.prisma.client.activity.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, categoryId: true, subCategoryId: true, countryId: true },
    });

    if (!current) throw new NotFoundException('Activity not found');

    return this.prisma.client.activity.findMany({
      where: {
        id: { not: current.id },
        status: 'ACTIVE',
        deletedAt: null,
        vendor: { status: 'ACTIVE', deletedAt: null },
        OR: [
          { categoryId: current.categoryId },
          ...(current.subCategoryId ? [{ subCategoryId: current.subCategoryId }] : []),
        ],
      },
      select: {
        id: true,
        titleEn: true,
        titleAr: true,
        slug: true,
        coverImage: true,
        pricePerPerson: true,
        pricingModel: true,
        bookingType: true,
        durationValue: true,
        isFeatured: true,
        category: { select: { nameEn: true, nameAr: true } },
        city: { select: { nameEn: true, nameAr: true } },
        country: { select: { nameEn: true, nameAr: true, currencyCode: true } },
        _count: { select: { reviews: true } },
      },
      orderBy: [
        { isFeatured: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
    });
  }

  /** Single activity detail page — includes reviews, units summary, vendor info */
  @Get('activities/:slug')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_LIVE_SHORT)
  async getActivityBySlug(@Param('slug') slug: string) {
    // §B9 — soft-deleted activities have slugs rewritten to
    // `deleted-<id>`, so the original public slug returns 404 here.
    // findFirst lets us re-assert the deletedAt filter as belt-and-braces.
    const activity = await this.prisma.client.activity.findFirst({
      where: { slug, deletedAt: null },
      include: {
        category: { select: { nameEn: true, nameAr: true } },
        city: { select: { nameEn: true, nameAr: true } },
        country: { select: { nameEn: true, nameAr: true, currencyCode: true, defaultTimezone: true, serviceFeeFixed: true } },
        vendor: { select: { businessNameEn: true, businessNameAr: true, slug: true, status: true } },
        reviews: {
          include: { customer: { select: { fullName: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: { select: { reviews: true, bookings: true, likes: true } },
      },
    });

    if (!activity || activity.status !== 'ACTIVE' || activity.vendor.status !== 'ACTIVE') {
      throw new NotFoundException('Activity not found');
    }

    const { status: _vs, ...vendorPublic } = activity.vendor;
    const { status: _as, ...rest } = activity;

    // Privacy: truncate reviewer names to first name + last initial
    const safeReviews = rest.reviews.map((r: any) => {
      const name = r.customer?.fullName || '';
      const parts = name.trim().split(/\s+/);
      const displayName = parts.length > 1
        ? `${parts[0]} ${parts[parts.length - 1][0]}.`
        : parts[0] || 'Anonymous';
      return { ...r, customer: { displayName } };
    });

    return { ...rest, reviews: safeReviews, vendor: vendorPublic };
  }

  // ─── Platform Info (public) ────────────────────────────────
  @Get('platform-info')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_STATIC_LONG)
  async getPlatformInfo() {
    const cached = await this.refCache.get<unknown>('platform-info', 'default');
    if (cached) return cached;
    const settings = await this.prisma.client.platformSettings.findUnique({
      where: { id: 'default' },
      select: {
        platformName: true,
        supportEmail: true,
        supportPhone: true,
        aboutText: true,
      },
    });
    const data = settings ?? { platformName: 'Jadwal', supportEmail: null, supportPhone: null, aboutText: null };
    await this.refCache.set('platform-info', 'default', data);
    return data;
  }
}

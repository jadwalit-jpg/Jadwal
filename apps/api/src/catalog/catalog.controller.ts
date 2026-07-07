import { Controller, Get, Header, Param, Query, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceDataCacheService } from '../redis/reference-data-cache.service';
import { RATE_LIMIT_VENDOR } from '../common/throttle-config';
import { nowInTimezone } from '../common/validators/timezone';

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
@Public()
export class CatalogController {
  /**
   * Secret used to HMAC-derive per-(customer, activity) reviewer pseudonyms.
   * Required non-empty in production (see REQUIRED_IN_PRODUCTION in main.ts).
   * In dev / test it defaults to empty — the HMAC still works (just with a
   * zero-byte key), and the threat model only changes if the database is
   * also compromised (in which case the secret is what stops the attacker
   * from reconstructing pseudonyms from leaked customerId + activityId
   * pairs). Empty key in dev keeps the local stack functional without
   * forcing every contributor to mint a 32-byte secret.
   */
  private readonly reviewHashSecret: string;

  constructor(
    private prisma: PrismaService,
    private refCache: ReferenceDataCacheService,
    config: ConfigService,
  ) {
    this.reviewHashSecret = (config.get<string>('REVIEW_HASH_SECRET', '') ?? '').trim();
  }

  /**
   * Generate a stable, non-reversible reviewer pseudonym for a given
   * (customerId, activityId) pair. Same customer reviewing two different
   * activities gets two DIFFERENT pseudonyms — this is the privacy
   * guarantee: an attacker can't link reviews back to a single customer
   * across activities.
   *
   * Returns `Reviewer #abc123` (6 hex chars = 24 bits of entropy = ~16M
   * possible values per activity — collision rate on a single activity's
   * reviews is negligible, and any collision between activities is fine
   * because it doesn't reveal identity).
   *
   * If REVIEW_HASH_SECRET is empty (dev only — main.ts requires it in prod),
   * HMAC degrades to an unkeyed SHA-256 of the input. Even then the customer
   * is identified only via the (private) customerId; the public API never
   * exposes that ID, so the secret is defense-in-depth against DB compromise.
   */
  private reviewerPseudonym(customerId: string, activityId: string): string {
    const code = crypto
      .createHmac('sha256', this.reviewHashSecret)
      .update(`${customerId}:${activityId}`)
      .digest('hex')
      .slice(0, 6);
    return `Reviewer #${code}`;
  }

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
      where: { status: 'ACTIVE', deletedAt: null },
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
        image: true, eventDate: true, eventEndDate: true, countryId: true,
      },
      orderBy: { createdAt: 'desc' },
      // Defensive cap — trendingEvent is admin-curated (homepage banners,
      // realistically a handful of rows), but a bulk insert mistake must
      // not make this @Public(), edge-cached endpoint return an unbounded
      // payload. 100 is far above any real curated count.
      take: 100,
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
  /**
   * Bulk slug export for the dynamic XML sitemap (apps/web/src/app/sitemap.ts).
   * Returns ALL publicly-visible activity slugs + root category slugs with
   * their updatedAt timestamps. Unlike the paginated /activities listing
   * (capped at 20), this is unbounded-but-ceilinged at Google's 50k-URLs-per-
   * sitemap limit so crawlers get a complete URL set. Public, edge-cached,
   * select-only (slug + updatedAt — no PII). Same visibility filter as the
   * public listing so a pending/rejected/soft-deleted activity is never
   * exposed.
   */
  @Get('sitemap-urls')
  @Throttle(RATE_LIMIT_VENDOR)
  @Header('Cache-Control', CACHE_LIVE_SHORT)
  async getSitemapUrls() {
    // Google's hard limit is 50,000 URLs per sitemap file. The frontend
    // (apps/web/src/app/sitemap.ts) appends the 7 static routes + one URL per
    // root category on top of these activities, so cap the activities query
    // below 50k to leave headroom; the frontend ALSO hard-caps the assembled
    // total as a final guarantee. (Past ~50k activities the right move is a
    // sitemap index via Next.js generateSitemaps — post-launch follow-up.)
    const SITEMAP_MAX = 49000;
    const [activities, categories] = await Promise.all([
      this.prisma.client.activity.findMany({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          vendor: { status: 'ACTIVE', deletedAt: null },
        },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: SITEMAP_MAX,
      }),
      this.prisma.client.category.findMany({
        where: { parentId: null },
        select: { slug: true, updatedAt: true },
        orderBy: { nameEn: 'asc' },
      }),
    ]);
    return { activities, categories };
  }

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
          coverImage: true, coverBlur: true, gallery: true, durationValue: true, bookingType: true, isFeatured: true,
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
    // start/endDatetime are local-wall-clock tagged-UTC, and this list can mix
    // activities from different countries, so "today" is per-activity (its own
    // timezone's calendar day), NOT a single server-UTC day. We fetch a widened
    // ±1-day window (covers any tz offset), then clip per activity to ITS local
    // day below. bookedToday is a display-only scarcity hint; the authoritative
    // capacity check in createBooking is separate and exact.
    const fetchStart = new Date(); fetchStart.setUTCHours(0, 0, 0, 0); fetchStart.setUTCDate(fetchStart.getUTCDate() - 1);
    const fetchEnd = new Date(); fetchEnd.setUTCHours(23, 59, 59, 999); fetchEnd.setUTCDate(fetchEnd.getUTCDate() + 1);

    const bookedMap = new Map<string, number>();
    if (activityIds.length > 0) {
      const todayBookings = await this.prisma.client.booking.findMany({
        where: {
          activityId: { in: activityIds },
          status: { in: ['PENDING', 'CONFIRMED'] },
          startDatetime: { lte: fetchEnd },
          endDatetime: { gte: fetchStart },
        },
        select: { activityId: true, startDatetime: true, endDatetime: true, guests: true },
        // DoS cap for the whole catalog-page aggregate (all activities combined).
        // ±1-day window → realistic upper bound ~100 activities × 3 days.
        take: Number(process.env.AVAILABILITY_MAX_CATALOG_BOOKINGS || 10000),
      });
      const typeById = new Map(rawData.map((a) => [a.id, a.bookingType]));
      const tzById = new Map(rawData.map((a) => [a.id, a.country?.defaultTimezone ?? 'UTC']));
      const byActivity = new Map<string, typeof todayBookings>();
      for (const b of todayBookings) {
        const arr = byActivity.get(b.activityId) ?? [];
        arr.push(b); byActivity.set(b.activityId, arr);
      }
      for (const [aid, rows] of byActivity) {
        // This activity's OWN local-today window (tagged-UTC frame). nowInTimezone
        // gives "now" as the activity's wall-clock; its calendar date bounds today.
        const localNow = nowInTimezone(tzById.get(aid) ?? 'UTC');
        const dayStart = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), 0, 0, 0, 0));
        const dayEnd = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), 23, 59, 59, 999));
        if (typeById.get(aid) === 'HOURLY') {
          // Sweep-line peak concurrent across the activity's local today — same
          // algorithm as bookings.service.ts maxConcurrentInWindow. Inlined here
          // to avoid importing service internals into a controller.
          const events: Array<{ t: number; d: number; isStart: number }> = [];
          for (const b of rows) {
            const s = b.startDatetime > dayStart ? b.startDatetime : dayStart;
            const e = b.endDatetime < dayEnd ? b.endDatetime : dayEnd;
            if (s.getTime() >= e.getTime()) continue;
            events.push({ t: s.getTime(), d: b.guests, isStart: 1 });
            events.push({ t: e.getTime(), d: -b.guests, isStart: 0 });
          }
          events.sort((a, b) => (a.t - b.t) || (a.isStart - b.isStart));
          let cur = 0, peak = 0;
          for (const ev of events) { cur += ev.d; if (cur > peak) peak = cur; }
          bookedMap.set(aid, peak);
        } else {
          // DAILY: sum guests of rows overlapping THIS activity's local today
          // (the widened fetch can include neighbouring days — clip them out).
          bookedMap.set(
            aid,
            rows
              .filter((r) => r.startDatetime <= dayEnd && r.endDatetime >= dayStart)
              .reduce((s, r) => s + r.guests, 0),
          );
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
        coverBlur: true,
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
          // customerId pulled so we can derive a per-(customer,activity) HMAC
          // pseudonym. fullName intentionally NOT selected — the pseudonym
          // replaces it entirely so the customer's real name never leaves
          // the API server.
          select: {
            id: true,
            rating: true,
            text: true,
            vendorReply: true,
            createdAt: true,
            customerId: true,
          },
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

    // Privacy: replace each review's customer with a per-(customer, activity)
    // HMAC pseudonym. Same customer reviewing two different activities
    // produces two DIFFERENT pseudonyms — defeats the previous
    // `"First L."` truncation pattern that let attackers link the same
    // customer's reviews across activities. customerId never leaves
    // this method.
    const safeReviews = rest.reviews.map((r) => {
      const { customerId, ...reviewFields } = r;
      return {
        ...reviewFields,
        customer: { displayName: this.reviewerPseudonym(customerId, activity.id) },
      };
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
    const data = settings ?? { platformName: "AL Jadwal", supportEmail: null, supportPhone: null, aboutText: null };
    await this.refCache.set('platform-info', 'default', data);
    return data;
  }
}

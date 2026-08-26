/**
 * Real, bookable activity picks for an SEO guide page.
 *
 * This is what turns a pillar page from an essay into a shopfront: the guide
 * argues that Qatar is worth visiting, and these cards are the things you can
 * actually book while you're convinced.
 *
 * Extracted from `app/blog/[slug]/page.tsx` so the selection rules (round-robin,
 * de-dupe, cap) are unit-testable without rendering an async Server Component.
 */

import type { ActivityCardActivity } from '@/components/ui';
import { fetchActivities, type PublicActivityCard } from '@/lib/seo-fetch';
import type { SeoLanding } from '@/lib/seo-landings';

/** How many activities to pull per related landing before de-duping. */
export const PICKS_PER_LANDING = 4;
/** Cards rendered in the guide's picks block (3 rows of 2 at sm+). */
export const MAX_PICKS = 6;

export function toCard(a: PublicActivityCard): ActivityCardActivity {
  return {
    id: a.id,
    slug: a.slug,
    titleEn: a.titleEn,
    titleAr: a.titleAr,
    pricePerPerson: Number.isFinite(Number(a.pricePerPerson)) ? Number(a.pricePerPerson) : 0,
    country: a.country?.currencyCode ? { currencyCode: a.country.currencyCode } : null,
    city: a.city ?? null,
    vendor: a.vendor ?? null,
    coverImage: a.coverImage,
    avgRating: a.avgRating ?? null,
    reviewCount: a.reviewCount ?? 0,
    bookingType: a.bookingType,
  };
}

/**
 * Pick up to MAX_PICKS activities for a guide, drawn from the landing pages it
 * already links to.
 *
 * Deriving the picks from `relatedLandings` rather than a new hand-maintained
 * list means the cards can never drift off-topic (those slugs ARE the guide's
 * topic) and there is no second registry to keep in sync as inventory changes.
 *
 * Round-robin, not concatenate: a guide related to three landings should show
 * all three topics, not four cards from whichever landing happened to sort
 * first. `fetchActivities` swallows its own failures and returns an empty list,
 * so a dead API degrades this block to nothing instead of 500-ing the article.
 */
export async function guidePicks(landings: SeoLanding[]): Promise<ActivityCardActivity[]> {
  if (landings.length === 0) return [];

  const results = await Promise.all(
    landings.map((l) => fetchActivities({ ...l.filter, limit: PICKS_PER_LANDING })),
  );

  const seen = new Set<string>();
  const out: ActivityCardActivity[] = [];
  for (let i = 0; i < PICKS_PER_LANDING && out.length < MAX_PICKS; i++) {
    for (const r of results) {
      const a = r.data[i];
      // Landings overlap (a dhow cruise is both "water activities" and "boat
      // tour"), so the same id can arrive from two fetches — de-dupe or React
      // warns on duplicate keys and the visitor sees the same card twice.
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(toCard(a));
      if (out.length >= MAX_PICKS) break;
    }
  }
  return out;
}

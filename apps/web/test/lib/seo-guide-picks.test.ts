/**
 * The guide picks decide which real, bookable activities appear on a pillar
 * page — and every failure mode here is SILENT. A broken round-robin still
 * renders six perfectly valid cards, they're just all from one category; a
 * broken de-dupe renders the same activity twice; a broken cap renders twenty.
 * Nothing throws, nothing 500s, and the page looks fine in a screenshot. So
 * these assert the selection RULES, not that cards render.
 */

const fetchActivities = jest.fn();

// Mocked with a factory so the real module (which does `import 'server-only'`)
// never executes — that import throws outside a React Server Component.
jest.mock('@/lib/seo-fetch', () => ({
  fetchActivities: (...args: unknown[]) => fetchActivities(...args),
}));

import { guidePicks, MAX_PICKS, PICKS_PER_LANDING } from '@/lib/seo-guide-picks';
import type { SeoLanding } from '@/lib/seo-landings';

/** Minimal landing stub — only `filter` is read by guidePicks. */
function landing(slug: string, category: string): SeoLanding {
  return { slug, filter: { category } } as unknown as SeoLanding;
}

/** Minimal activity rows; `id` is what de-dupe keys on. */
function rows(...ids: string[]) {
  return {
    total: ids.length,
    data: ids.map((id) => ({
      id,
      slug: `slug-${id}`,
      titleEn: `Activity ${id}`,
      titleAr: null,
      pricePerPerson: '250',
      coverImage: null,
      bookingType: 'HOURLY' as const,
    })),
  };
}

beforeEach(() => fetchActivities.mockReset());

describe('guidePicks — selection rules', () => {
  it('round-robins across landings so every topic the guide covers is represented', async () => {
    // The bug this catches: concatenating instead of interleaving. With a cap
    // of 6 and 4 per landing, concatenation would return a1,a2,a3,a4,b1,b2 —
    // and the third topic would never appear at all.
    fetchActivities
      .mockResolvedValueOnce(rows('a1', 'a2', 'a3', 'a4'))
      .mockResolvedValueOnce(rows('b1', 'b2', 'b3', 'b4'))
      .mockResolvedValueOnce(rows('c1', 'c2', 'c3', 'c4'));

    const picks = await guidePicks([
      landing('desert', 'outdoor'),
      landing('water', 'water'),
      landing('resorts', 'resorts'),
    ]);

    expect(picks.map((p) => p.id)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2', 'c2']);
  });

  it('de-dupes an activity that matches two overlapping landings', async () => {
    // A dhow cruise is legitimately both "water activities" and "boat tour".
    // Without de-duping, React warns on duplicate keys and the visitor sees
    // the same card twice.
    fetchActivities
      .mockResolvedValueOnce(rows('shared', 'a2'))
      .mockResolvedValueOnce(rows('shared', 'b2'));

    const picks = await guidePicks([landing('water', 'water'), landing('boat', 'boat')]);

    expect(picks.map((p) => p.id)).toEqual(['shared', 'a2', 'b2']);
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length);
  });

  it('never returns more than MAX_PICKS even when every landing is full', async () => {
    fetchActivities.mockResolvedValue(rows('x1', 'x2', 'x3', 'x4'));
    // Distinct ids per call, so the cap is what limits the result, not de-dupe.
    let n = 0;
    fetchActivities.mockImplementation(async () => {
      n += 1;
      return rows(`${n}a`, `${n}b`, `${n}c`, `${n}d`);
    });

    const picks = await guidePicks(
      Array.from({ length: 5 }, (_, i) => landing(`l${i}`, `c${i}`)),
    );

    expect(picks).toHaveLength(MAX_PICKS);
  });

  it('asks each landing for PICKS_PER_LANDING rows, carrying that landing filter', async () => {
    fetchActivities.mockResolvedValue(rows('a1'));

    await guidePicks([landing('desert', 'outdoor-adventure')]);

    expect(fetchActivities).toHaveBeenCalledWith({
      category: 'outdoor-adventure',
      limit: PICKS_PER_LANDING,
    });
  });
});

describe('guidePicks — degrading instead of breaking the article', () => {
  it('returns nothing, and does not fetch, when the guide has no launched landings', async () => {
    const picks = await guidePicks([]);

    expect(picks).toEqual([]);
    expect(fetchActivities).not.toHaveBeenCalled();
  });

  it('returns nothing when the API is down (fetchActivities degrades to empty)', async () => {
    // seo-fetch swallows timeouts/non-2xx and returns an empty list, so the
    // guide must render its prose with no picks block rather than 500.
    fetchActivities.mockResolvedValue({ data: [], total: 0 });

    expect(await guidePicks([landing('desert', 'outdoor')])).toEqual([]);
  });

  it('skips a landing that returned nothing without dropping the others', async () => {
    // An empty middle result must not short-circuit the round-robin — the
    // guide should still show the topics that DO have inventory.
    fetchActivities
      .mockResolvedValueOnce(rows('a1', 'a2'))
      .mockResolvedValueOnce({ data: [], total: 0 })
      .mockResolvedValueOnce(rows('c1'));

    const picks = await guidePicks([
      landing('a', 'a'),
      landing('empty', 'empty'),
      landing('c', 'c'),
    ]);

    expect(picks.map((p) => p.id)).toEqual(['a1', 'c1', 'a2']);
  });
});

describe('guidePicks — card mapping', () => {
  it('coerces the API string price to a number so the card can format it', async () => {
    // The catalog returns Prisma Decimals as strings; ActivityCard formats a
    // number. Skipping the coercion renders "QAR NaN".
    fetchActivities.mockResolvedValue(rows('a1'));

    const [pick] = await guidePicks([landing('a', 'a')]);

    expect(pick.pricePerPerson).toBe(250);
  });

  it('falls back to 0 rather than NaN when the price is missing or unparseable', async () => {
    fetchActivities.mockResolvedValue({
      total: 1,
      data: [{ id: 'a1', slug: 's', titleEn: 'T', pricePerPerson: null, coverImage: null, bookingType: 'HOURLY' }],
    });

    const [pick] = await guidePicks([landing('a', 'a')]);

    expect(pick.pricePerPerson).toBe(0);
    expect(Number.isNaN(pick.pricePerPerson)).toBe(false);
  });
});

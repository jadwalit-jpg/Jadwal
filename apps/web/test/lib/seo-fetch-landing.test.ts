/**
 * fetchActivitiesForLanding decides which listings appear on an SEO landing
 * page (and in the blog guide picks drawn from it). Its failure modes are
 * silent: a wrong id renders an empty grid, a missing de-dupe shows the same
 * trip twice, and a fallback to the broad category re-adds the city tours to
 * the desert-safari ad page. These pin the rules.
 */

// The real module starts with `import 'server-only'`, which throws outside a
// React Server Component. Stub it (virtual: the package is resolved by Next).
jest.mock('server-only', () => ({}), { virtual: true });

import { fetchActivitiesForLanding, fetchCategorySlugIds } from '@/lib/seo-fetch';

const CATEGORIES = [
  {
    id: 'cat-leisure',
    slug: 'leisure-fun',
    children: [
      { id: 'sub-desert', slug: 'desert-camp' },
      { id: 'sub-tour', slug: 'tour-trip' },
      { id: 'sub-camping', slug: 'camping' },
    ],
  },
  { id: 'cat-water', slug: 'water-activities', children: [] },
];

function row(id: string) {
  return { id, slug: `slug-${id}`, titleEn: id, titleAr: id, pricePerPerson: '100', coverImage: null, bookingType: 'DAILY' };
}

const BY_CATEGORY_ID: Record<string, ReturnType<typeof row>[]> = {
  'sub-desert': [row('safari-8h'), row('overnight'), row('shared')],
  'sub-camping': [row('al-rehlah'), row('shared')], // 'shared' overlaps on purpose
  'sub-tour': [row('city-tour')],
};

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  process.env.INTERNAL_API_URL = 'http://api.test/api';
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/catalog/categories')) {
      return { ok: true, json: async () => CATEGORIES } as Response;
    }
    const u = new URL(url);
    const id = u.searchParams.get('categoryId');
    const data = id ? BY_CATEGORY_ID[id] ?? [] : [row('from-plain-filter')];
    return { ok: true, json: async () => ({ data, total: data.length }) } as Response;
  }) as unknown as typeof fetch;
});

afterAll(() => {
  delete process.env.INTERNAL_API_URL;
});

describe('fetchCategorySlugIds', () => {
  it('maps parent AND child slugs to ids', async () => {
    const ids = await fetchCategorySlugIds();
    expect(ids.get('leisure-fun')).toBe('cat-leisure');
    expect(ids.get('desert-camp')).toBe('sub-desert');
    expect(ids.get('camping')).toBe('sub-camping');
  });

  it('returns an empty map when the API fails', async () => {
    global.fetch = jest.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect((await fetchCategorySlugIds()).size).toBe(0);
  });
});

describe('fetchActivitiesForLanding — sub-category landings', () => {
  it('queries each sub-category by id and never the broad parent category', async () => {
    const { data } = await fetchActivitiesForLanding({ subCategories: ['desert-camp', 'camping'] }, 12);

    expect(data.map((a) => a.id)).toEqual(['safari-8h', 'overnight', 'shared', 'al-rehlah']);
    expect(data.map((a) => a.id)).not.toContain('city-tour');
    const listCalls = calls.filter((c) => c.includes('/catalog/activities'));
    expect(listCalls).toHaveLength(2);
    expect(listCalls.some((c) => c.includes('category=leisure-fun'))).toBe(false);
  });

  it('de-dupes a listing returned by two sub-categories', async () => {
    const { data } = await fetchActivitiesForLanding({ subCategories: ['desert-camp', 'camping'] }, 12);
    expect(data.filter((a) => a.id === 'shared')).toHaveLength(1);
  });

  it('caps the merged result at the limit', async () => {
    const { data } = await fetchActivitiesForLanding({ subCategories: ['desert-camp', 'camping'] }, 2);
    expect(data).toHaveLength(2);
  });

  it('renders the empty state (not the broad category) when no slug resolves', async () => {
    const { data, total } = await fetchActivitiesForLanding({ subCategories: ['does-not-exist'] }, 12);
    expect(data).toEqual([]);
    expect(total).toBe(0);
    expect(calls.filter((c) => c.includes('/catalog/activities'))).toHaveLength(0);
  });
});

describe('fetchActivitiesForLanding — plain landings are unchanged', () => {
  it('passes a category / search filter straight through to the list endpoint', async () => {
    const { data } = await fetchActivitiesForLanding({ search: 'yacht' }, 12);
    expect(data.map((a) => a.id)).toEqual(['from-plain-filter']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('search=yacht');
    expect(calls[0]).toContain('limit=12');
  });
});

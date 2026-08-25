/**
 * The home page was the LAST public route still serving English metadata on
 * its Arabic URL. Its body content, canonical and hreflang were all correct,
 * so nothing looked broken — Google simply read an English title and
 * description for `/ar`, which quietly undercuts the whole bilingual effort.
 *
 * That is a silent failure with no runtime symptom, which is exactly the kind
 * that comes back. These tests pin it.
 */
import type { Metadata } from 'next';

const mockLang = jest.fn<Promise<'en' | 'ar'>, []>();
jest.mock('@/lib/lang-cookie.server', () => ({
  readLangServer: () => mockLang(),
}));

// The page module pulls in the whole hero tree; none of it is needed to read
// generateMetadata. One island imports '@/lib/api', which THROWS at module load
// when NEXT_PUBLIC_API_URL is unset — a deliberate fail-fast so a production
// build can never silently point at localhost. jest.mock is hoisted above the
// page import, so stubbing it here keeps that guard intact in real builds.
jest.mock('@/lib/api', () => ({ API_BASE: 'http://test.local/api', apiFetch: jest.fn() }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/footer', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/navbar', () => ({ __esModule: true, default: () => null }));

import { generateMetadata } from '@/app/page';

const ARABIC = /[\u0600-\u06FF]/;

async function meta(lang: 'en' | 'ar'): Promise<Metadata> {
  mockLang.mockResolvedValue(lang);
  return generateMetadata();
}

describe('home metadata is locale-aware', () => {
  test('Arabic gets Arabic title AND description', async () => {
    const m = await meta('ar');
    expect(String(m.title)).toMatch(ARABIC);
    expect(String(m.description)).toMatch(ARABIC);
  });

  test('English is unchanged', async () => {
    const m = await meta('en');
    expect(m.title).toBe('AL Jadwal — Book Activities & Experiences in Qatar & the GCC');
    expect(String(m.description)).not.toMatch(ARABIC);
  });

  test('the two languages do NOT share a title — the actual bug', async () => {
    expect(String((await meta('ar')).title)).not.toBe(String((await meta('en')).title));
  });
});

describe('home metadata stays within SERP limits', () => {
  // Google truncates around 60 chars of title and 160 of description; under
  // ~120 wastes the slot. Arabic is denser per character, so it may sit lower.
  test.each([
    ['en', 60],
    ['ar', 60],
  ])('%s title fits in %d chars', async (lang, max) => {
    expect(String((await meta(lang as 'en' | 'ar')).title).length).toBeLessThanOrEqual(max);
  });

  test.each([['en'], ['ar']])('%s description is 120-160 chars', async (lang) => {
    const len = String((await meta(lang as 'en' | 'ar')).description).length;
    expect(len).toBeGreaterThanOrEqual(120);
    expect(len).toBeLessThanOrEqual(160);
  });
});

describe('home canonical + hreflang per language', () => {
  test('English canonical is /, Arabic canonical is /ar', async () => {
    expect((await meta('en')).alternates?.canonical).toBe('/');
    expect((await meta('ar')).alternates?.canonical).toBe('/ar');
  });

  test('both languages advertise the SAME twin pair', async () => {
    // A mismatch here is how a bilingual site ends up with Google treating the
    // two versions as duplicates instead of alternates.
    const expected = { en: '/', ar: '/ar', 'x-default': '/' };
    expect((await meta('en')).alternates?.languages).toEqual(expected);
    expect((await meta('ar')).alternates?.languages).toEqual(expected);
  });
});

describe('social cards follow the language too', () => {
  test('og:locale flips and declares the alternate', async () => {
    const ar = await meta('ar');
    const en = await meta('en');
    expect(ar.openGraph).toMatchObject({ locale: 'ar_QA', alternateLocale: 'en_US' });
    expect(en.openGraph).toMatchObject({ locale: 'en_US', alternateLocale: 'ar_QA' });
  });

  test('og + twitter titles are Arabic on /ar', async () => {
    const m = await meta('ar');
    expect(String(m.openGraph?.title)).toMatch(ARABIC);
    expect(String(m.twitter?.title)).toMatch(ARABIC);
  });

  test('the landscape OG image survives in both languages', async () => {
    // Next REPLACES openGraph rather than deep-merging, so a careless edit here
    // silently reverts link previews to the square icon.
    for (const lang of ['en', 'ar'] as const) {
      const imgs = (await meta(lang)).openGraph?.images as Array<{ url: string; width: number }>;
      expect(imgs?.[0]).toMatchObject({ url: '/images/login-bg.webp', width: 1920 });
    }
  });
});

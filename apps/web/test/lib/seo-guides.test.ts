import { SEO_GUIDES, getGuide, allGuideSlugs, publishedGuides, tr } from '@/lib/seo-guides';
import { getLanding } from '@/lib/seo-landings';

describe('seo-guides config integrity', () => {
  test('every slug is unique + valid lowercase-hyphen', () => {
    const slugs = allGuideSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  test('every related landing resolves to a LAUNCHED landing (no dead funnel links)', () => {
    for (const g of SEO_GUIDES) {
      for (const slug of g.relatedLandings) {
        const l = getLanding(slug);
        expect(l).toBeDefined();
        expect(l!.launched).toBe(true);
      }
    }
  });

  test('published guides have bilingual title/description/intro + at least one section', () => {
    for (const g of publishedGuides()) {
      for (const lang of ['en', 'ar'] as const) {
        expect(tr(g.title, lang)).toBeTruthy();
        expect(tr(g.description, lang)).toBeTruthy();
        expect(tr(g.intro, lang)).toBeTruthy();
      }
      expect(g.sections.length).toBeGreaterThanOrEqual(1);
      for (const s of g.sections) {
        expect(tr(s.heading, 'en')).toBeTruthy();
        expect(s.body.length).toBeGreaterThanOrEqual(1);
        for (const p of s.body) {
          expect(tr(p, 'en')).toBeTruthy();
          expect(tr(p, 'ar')).toBeTruthy();
        }
      }
    }
  });

  test('published guide meta descriptions are SEO-length (EN)', () => {
    for (const g of publishedGuides()) {
      expect(g.description.en.length).toBeGreaterThanOrEqual(80);
      expect(g.description.en.length).toBeLessThanOrEqual(175);
    }
  });

  test('getGuide round-trips', () => {
    for (const s of allGuideSlugs()) expect(getGuide(s)?.slug).toBe(s);
    expect(getGuide('does-not-exist')).toBeUndefined();
  });
});

/**
 * WCAG 2.5.3 "Label in Name" for the navbar country picker.
 *
 * The desktop pill shows the country name ("Qatar" / "قطر") but used to carry a
 * bare aria-label="Country", so the accessible name did NOT contain the visible
 * text. Voice-control users who say the name they can see cannot target the
 * button. axe-core 4.14 flags this as `label-content-name-mismatch` on every
 * page (the navbar is global), which also made the a11y E2E suite fail the
 * moment axe was bumped.
 *
 * This asserts the same rule axe applies: the accessible name must include the
 * visible text. It is a unit test on purpose - the E2E a11y spec only catches
 * this once axe is new enough to know the rule.
 */

import { render, screen } from '@testing-library/react';

let language = 'en';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      (opts && opts.defaultValue) || key,
    i18n: { get language() { return language; } },
  }),
}));

let geoCountry: { id: string; nameEn: string; nameAr: string; isoCode: string; currencyCode: string } | null;
jest.mock('@/context/geo-context', () => ({
  useGeo: () => ({ country: geoCountry, setCountry: jest.fn(), source: 'manual' }),
}));

jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [] }),
}));

import { CountryPicker } from '@/components/country-picker';

const QATAR = { id: 'c1', nameEn: 'Qatar', nameAr: 'قطر', isoCode: 'QA', currencyCode: 'QAR' };

function pill() {
  render(<CountryPicker variant="desktop" />);
  return screen.getByRole('button', { expanded: false });
}

/** The visible text of the pill: text nodes only (icons are aria-hidden SVGs). */
function visibleText(el: HTMLElement) {
  return (el.textContent ?? '').trim();
}

describe('<CountryPicker /> desktop pill — accessible name contains the visible text', () => {
  beforeEach(() => {
    language = 'en';
    geoCountry = QATAR;
  });

  it('English: name includes the visible country name', () => {
    const el = pill();
    expect(visibleText(el)).toBe('Qatar');
    expect(el.getAttribute('aria-label')).toContain('Qatar');
  });

  it('Arabic: name includes the visible Arabic country name', () => {
    language = 'ar';
    const el = pill();
    expect(visibleText(el)).toBe('قطر');
    expect(el.getAttribute('aria-label')).toContain('قطر');
  });

  it('still tells assistive tech what the control is (keeps the "Country" word)', () => {
    expect(pill().getAttribute('aria-label')).toMatch(/^Country/);
  });

  it('no country resolved yet: falls back to the plain label, no dangling colon', () => {
    geoCountry = null;
    const el = pill();
    expect(el.getAttribute('aria-label')).toBe('Country');
  });

  it('is the property axe tests: for EVERY supported country the name contains the visible text', () => {
    for (const c of [
      QATAR,
      { id: 'c2', nameEn: 'Saudi Arabia', nameAr: 'السعودية', isoCode: 'SA', currencyCode: 'SAR' },
      { id: 'c3', nameEn: 'United Arab Emirates', nameAr: 'الإمارات', isoCode: 'AE', currencyCode: 'AED' },
    ]) {
      for (const lang of ['en', 'ar']) {
        language = lang;
        geoCountry = c;
        const { unmount } = render(<CountryPicker variant="desktop" />);
        const el = screen.getByRole('button', { expanded: false });
        const shown = visibleText(el);
        expect(shown.length).toBeGreaterThan(0);
        expect(el.getAttribute('aria-label')).toContain(shown);
        unmount();
      }
    }
  });
});

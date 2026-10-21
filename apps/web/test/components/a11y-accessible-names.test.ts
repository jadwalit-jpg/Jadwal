/**
 * Accessible names found by running axe-core 4.14 against the LIVE site
 * (2026-10-22). Each one is a real WCAG failure that the CI a11y spec did not
 * catch (its local data has no pagination, and its axe was too old to know the
 * rule), so they are pinned here at the source:
 *
 *   - login + register logo link: aria-label "AL Jadwal" hid the visible
 *     "AL Jadwal الجدول"            (label-content-name-mismatch, WCAG 2.5.3)
 *   - navbar language pill on /ar: visible "EN", aria-label "Switch to English"
 *                                   (label-content-name-mismatch)
 *   - /explore previous/next page: icon-only buttons with NO accessible name
 *                                   (button-name, axe "critical")
 *   - nav.country had no translation key at all, so the Arabic site announced
 *     the English word "Country".
 *
 * Source-contract style on purpose (like booking-calendar-wiring.test.ts):
 * rendering explore-client drags in routing, react-query, geo and i18n for a
 * one-attribute check.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '../../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const json = (rel: string) => JSON.parse(read(rel));

/** The opening `<button ...>` tag that contains `needle`. */
function buttonTagContaining(src: string, needle: string): string {
  const at = src.indexOf(needle);
  expect(at).toBeGreaterThan(-1);
  const start = src.lastIndexOf('<button', at);
  const end = src.indexOf('>', src.indexOf('className', at));
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, end + 1);
}

describe('locale keys behind the accessible names exist in BOTH languages', () => {
  const en = json('locales/en.json');
  const ar = json('locales/ar.json');

  it.each([
    ['nav', 'country'],
    ['common', 'previousPage'],
    ['common', 'nextPage'],
  ])('%s.%s is a non-empty string in en and ar', (group, key) => {
    expect(typeof en[group][key]).toBe('string');
    expect(en[group][key].trim().length).toBeGreaterThan(0);
    expect(typeof ar[group][key]).toBe('string');
    expect(ar[group][key].trim().length).toBeGreaterThan(0);
  });

  it('the Arabic values are actually Arabic, not a copy of the English', () => {
    for (const [g, k] of [['nav', 'country'], ['common', 'previousPage'], ['common', 'nextPage']]) {
      expect(ar[g][k]).not.toBe(en[g][k]);
      expect(ar[g][k]).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('/explore pagination: icon-only buttons carry an accessible name', () => {
  const src = read('app/explore/_components/explore-client.tsx');

  it('the "previous page" button has aria-label from common.previousPage', () => {
    const tag = buttonTagContaining(src, 'setPage(p => Math.max(1, p - 1))');
    expect(tag).toMatch(/aria-label=\{t\('common\.previousPage'/);
  });

  it('the "next page" button has aria-label from common.nextPage', () => {
    const tag = buttonTagContaining(src, 'setPage(p => Math.min(totalPages, p + 1))');
    expect(tag).toMatch(/aria-label=\{t\('common\.nextPage'/);
  });
});

describe('login + register logo link: accessible name contains the visible text', () => {
  it.each(['app/login/login-form.tsx', 'app/register/register-form.tsx'])('%s', (file) => {
    const src = read(file);
    const link = src.slice(src.indexOf('aria-label="AL Jadwal'), src.indexOf('</Link>', src.indexOf('aria-label="AL Jadwal')));
    const label = /aria-label="([^"]*)"/.exec(link)![1];
    const visible = link.slice(link.lastIndexOf('>') + 1).trim();
    expect(visible).toContain('AL Jadwal');
    expect(label).toContain(visible);
  });
});

describe('navbar language pill: the visible "EN" is inside the accessible name', () => {
  it('on the Arabic page the aria-label starts with the visible text', () => {
    const src = read('components/navbar.tsx');
    // The pill is the only button wired as onClick={toggleLanguage} (the mobile
    // row wraps it in a closure) and its visible text is the 'EN' / 'ع' span.
    expect(src).toContain("isAr ? 'EN' : 'ع'");
    const tag = buttonTagContaining(src, 'onClick={toggleLanguage}').replace(/\s+/g, ' ');
    expect(tag).toContain("isAr ? 'EN: Switch to English'");
  });
});

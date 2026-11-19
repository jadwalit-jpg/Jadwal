/**
 * The guest-count strings pick the right plural form: "1 guest" in English,
 * and the Arabic forms for one, two, 3–10, 11–99 and 100+. They are used in
 * the price breakdown add-on line, the base price line, the customer's booking
 * page and the whole-group switch hint.
 */
import i18next from 'i18next';
import en from '@/locales/en.json';
import ar from '@/locales/ar.json';

function fixedT(lng: 'en' | 'ar') {
  const inst = i18next.createInstance();
  inst.init({ lng, resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false }, initImmediate: false });
  return inst.t.bind(inst);
}

describe('booking.guestsCount', () => {
  it('English: singular for one guest, plural otherwise', () => {
    const t = fixedT('en');
    expect(t('booking.guestsCount', { count: 1 })).toBe('1 guest');
    expect(t('booking.guestsCount', { count: 2 })).toBe('2 guests');
    expect(t('booking.guestsCount', { count: 6 })).toBe('6 guests');
  });

  it('Arabic: one, two, few, many and other forms', () => {
    const t = fixedT('ar');
    expect(t('booking.guestsCount', { count: 1 })).toBe('ضيف واحد');
    expect(t('booking.guestsCount', { count: 2 })).toBe('ضيفان');
    expect(t('booking.guestsCount', { count: 3 })).toBe('3 ضيوف');
    expect(t('booking.guestsCount', { count: 10 })).toBe('10 ضيوف');
    expect(t('booking.guestsCount', { count: 11 })).toBe('11 ضيفًا');
    expect(t('booking.guestsCount', { count: 100 })).toBe('100 ضيف');
  });
});

describe('booking.addonWholeGroupHint', () => {
  it('English: "× 1 guest" for a solo guest, "× 3 guests" otherwise', () => {
    const t = fixedT('en');
    expect(t('booking.addonWholeGroupHint', { count: 1, total: '100', currency: 'QAR' })).toBe('× 1 guest · +QAR 100');
    expect(t('booking.addonWholeGroupHint', { count: 3, total: '300', currency: 'QAR' })).toBe('× 3 guests · +QAR 300');
  });

  it('Arabic: the right form for one, two and several guests', () => {
    const t = fixedT('ar');
    expect(t('booking.addonWholeGroupHint', { count: 1, total: '100', currency: 'ر.ق' })).toBe('× ضيف واحد · +100 ر.ق');
    expect(t('booking.addonWholeGroupHint', { count: 2, total: '200', currency: 'ر.ق' })).toBe('× ضيفان · +200 ر.ق');
    expect(t('booking.addonWholeGroupHint', { count: 3, total: '300', currency: 'ر.ق' })).toBe('× 3 ضيوف · +300 ر.ق');
  });
});

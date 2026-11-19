/**
 * Add-on maths shared by the booking page and the listing page, and the
 * sessionStorage hand-over between them.
 */
import {
  bookingPrefillKey, extraMode, extrasBreakdown, normalizeSelection, paidExtrasOf, saveBookingPrefill, selectionToPayload,
  type ExtraService,
} from '../../src/lib/booking-extras';

const VIP: ExtraService = { name: 'VIP cabin', nameAr: 'كابينة VIP', price: 100, perPerson: true, wholeGroup: true };
const LUNCH: ExtraService = { name: 'Lunch box', price: 50, perPerson: true };
const PHOTO: ExtraService = { name: 'Photographer', price: 200 };
const FREE: ExtraService = { name: 'Water', price: 0 };
const ALL = [VIP, LUNCH, PHOTO, FREE];

describe('extraMode / paidExtrasOf', () => {
  it('classifies the three kinds and drops inclusions', () => {
    expect(extraMode(VIP)).toBe('wholeGroup');
    expect(extraMode(LUNCH)).toBe('perPerson');
    expect(extraMode(PHOTO)).toBe('perBooking');
    expect(extraMode({ name: 'x', price: 10, wholeGroup: true })).toBe('perBooking'); // flag without perPerson is ignored
    expect(paidExtrasOf(ALL).map((s) => s.name)).toEqual(['VIP cabin', 'Lunch box', 'Photographer']);
    expect(paidExtrasOf(null)).toEqual([]);
  });
});

describe('normalizeSelection', () => {
  it('a whole-group add-on follows the guest count, per person is clamped, per booking is 1, unknown names drop', () => {
    const sel = new Map([['VIP cabin', 1], ['Lunch box', 9], ['Photographer', 4], ['Helicopter', 1], ['Water', 1]]);
    expect([...normalizeSelection(ALL, sel, 3)]).toEqual([['VIP cabin', 3], ['Lunch box', 3], ['Photographer', 1]]);
    expect([...normalizeSelection(ALL, sel, 1)]).toEqual([['VIP cabin', 1], ['Lunch box', 1], ['Photographer', 1]]);
  });
  it('returns the same map when nothing changes (safe inside a React effect)', () => {
    const sel = new Map([['VIP cabin', 3], ['Lunch box', 2]]);
    expect(normalizeSelection(ALL, sel, 3)).toBe(sel);
    expect(normalizeSelection(ALL, sel, 2)).not.toBe(sel);
  });
  it('an unselected add-on stays unselected', () => {
    expect(normalizeSelection(ALL, new Map(), 5).size).toBe(0);
    expect(normalizeSelection(ALL, new Map([['VIP cabin', 0]]), 5).size).toBe(0);
  });
});

describe('extrasBreakdown', () => {
  it('one line per chosen add-on and the sum; whole group uses the real guest count', () => {
    const { lines, total } = extrasBreakdown(ALL, new Map([['VIP cabin', 1], ['Lunch box', 2], ['Photographer', 1]]), 3);
    expect(lines.map((l) => [l.svc.name, l.mode, l.unitPrice, l.qty, l.total])).toEqual([
      ['VIP cabin', 'wholeGroup', 100, 3, 300],
      ['Lunch box', 'perPerson', 50, 2, 100],
      ['Photographer', 'perBooking', 200, 1, 200],
    ]);
    expect(total).toBe(600);
  });
  it('a solo guest: the add-on once (the minimum charged for the base price does not apply to add-ons)', () => {
    const { lines, total } = extrasBreakdown([VIP], new Map([['VIP cabin', 1]]), 1);
    expect(lines[0].qty).toBe(1);
    expect(total).toBe(100);
  });
  it('keeps cents exact', () => {
    const { total } = extrasBreakdown([{ name: 'Tea', price: 0.1, perPerson: true, wholeGroup: true }], new Map([['Tea', 1]]), 3);
    expect(total).toBe(0.3);
  });
  it('nothing chosen → no lines, 0', () => {
    expect(extrasBreakdown(ALL, new Map(), 4)).toEqual({ lines: [], total: 0 });
  });
});

describe('selectionToPayload', () => {
  it('names once each with their quantities; nothing chosen → no fields', () => {
    expect(selectionToPayload(new Map([['VIP cabin', 3], ['Photographer', 1]]))).toEqual({
      selectedExtras: ['VIP cabin', 'Photographer'], selectedExtrasQty: { 'VIP cabin': 3, Photographer: 1 },
    });
    expect(selectionToPayload(new Map([['x', 0]]))).toEqual({});
  });
});

describe('saveBookingPrefill (listing page → booking page)', () => {
  beforeEach(() => sessionStorage.clear());
  it('writes guests and the chosen add-ons under the key the booking page restores, keeping other saved fields', () => {
    sessionStorage.setItem(bookingPrefillKey('camp'), JSON.stringify({ couponInput: 'SAVE10' }));
    saveBookingPrefill('camp', { guests: 3, selectedExtras: new Map([['VIP cabin', 3]]) });
    expect(JSON.parse(sessionStorage.getItem('book:camp:formState')!)).toEqual({ couponInput: 'SAVE10', guests: 3, selectedExtras: [['VIP cabin', 3]] });
  });
  it('survives a broken existing value and a throwing storage', () => {
    sessionStorage.setItem(bookingPrefillKey('camp'), '{not json');
    expect(() => saveBookingPrefill('camp', { guests: 2, selectedExtras: new Map() })).not.toThrow();
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => saveBookingPrefill('camp', { guests: 2, selectedExtras: new Map() })).not.toThrow();
    spy.mockRestore();
  });
});

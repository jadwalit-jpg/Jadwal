/**
 * The "whole group" flag on a per-person add-on: accepted by the vendor and
 * admin listing DTOs (and rejected when it is not a boolean), and shown in the
 * booking confirmation email as its own row, in English and Arabic.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateActivityDto, ExtraServiceItem } from '../../src/vendor/dto/create-activity.dto';
import { UpdateActivityDto as AdminUpdateActivityDto } from '../../src/admin/dto/update-activity.dto';
import { UpdateActivityDto as VendorUpdateActivityDto } from '../../src/vendor/dto/update-activity.dto';
import { bookingConfirmationTemplate } from '../../src/email/templates/booking-confirmation';

async function errorsFor(cls: new () => object, body: Record<string, unknown>): Promise<string[]> {
  const errs = await validate(plainToInstance(cls, body) as object, { whitelist: true, forbidNonWhitelisted: true });
  const flat = (e: any, prefix = ''): string[] => [
    ...(e.constraints ? [prefix + e.property] : []),
    ...((e.children ?? []) as any[]).flatMap((c) => flat(c, `${prefix}${e.property}.`)),
  ];
  return errs.flatMap((e) => flat(e));
}

const VIP = { name: 'VIP cabin', nameAr: 'كابينة VIP', price: 100, perPerson: true, wholeGroup: true };

describe('ExtraServiceItem.wholeGroup', () => {
  test('a boolean is accepted; a string is rejected; missing is fine', async () => {
    expect(await errorsFor(ExtraServiceItem, VIP)).toEqual([]);
    expect(await errorsFor(ExtraServiceItem, { ...VIP, wholeGroup: false })).toEqual([]);
    expect(await errorsFor(ExtraServiceItem, { name: 'Lunch', price: 50, perPerson: true })).toEqual([]);
    expect(await errorsFor(ExtraServiceItem, { ...VIP, wholeGroup: 'yes' })).toEqual(['wholeGroup']);
  });

  test.each([
    ['vendor update', VendorUpdateActivityDto],
    ['admin update', AdminUpdateActivityDto],
  ])('%s DTO: extraServices with the flag validates, a non-boolean flag is rejected', async (_n, cls) => {
    expect(await errorsFor(cls, { extraServices: [VIP] })).toEqual([]);
    const bad = await errorsFor(cls, { extraServices: [{ ...VIP, wholeGroup: 1 }] });
    expect(bad.some((p) => p.endsWith('wholeGroup'))).toBe(true);
  });

  test('vendor create DTO accepts it inside extraServices', async () => {
    const errs = await errorsFor(CreateActivityDto, { extraServices: [VIP] });
    expect(errs.some((p) => p.includes('extraServices'))).toBe(false); // other required fields fail, not this one
  });
});

describe('booking confirmation email: add-ons row', () => {
  const base = { customerName: 'Sara', activityTitle: 'Desert Safari', date: '2030-01-01', guests: 3, totalAmount: '1050', currency: 'QAR', bookingId: 'JDWL-1' };
  const addons = [{ name: 'VIP cabin', nameAr: 'كابينة VIP', qty: 3, total: '300.00' }, { name: 'Photographer', qty: 1, total: '200.00' }];

  test('EN: one line per add-on with quantity and cost, in the html and the text version', () => {
    const en = bookingConfirmationTemplate({ ...base, addons }, 'EN');
    expect(en.html).toContain('Add-ons');
    expect(en.html).toContain('VIP cabin × 3 — QAR 300.00');
    expect(en.html).toContain('Photographer × 1 — QAR 200.00');
    expect(en.text).toContain('Add-ons: VIP cabin × 3 — QAR 300.00; Photographer × 1 — QAR 200.00');
  });

  test('AR: the Arabic name when the add-on has one', () => {
    const ar = bookingConfirmationTemplate({ ...base, addons }, 'AR');
    expect(ar.html).toContain('الإضافات');
    expect(ar.html).toContain('كابينة VIP × 3 — QAR 300.00');
    expect(ar.html).toContain('Photographer × 1 — QAR 200.00'); // no Arabic name: English stays
  });

  test('no add-ons: no row, as before', () => {
    const en = bookingConfirmationTemplate(base, 'EN');
    expect(en.html).not.toContain('Add-ons');
    expect(en.text).not.toContain('Add-ons');
  });
});

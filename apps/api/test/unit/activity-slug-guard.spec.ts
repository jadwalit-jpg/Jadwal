/**
 * Activity slug must follow the SAME contract as the vendor slug: lowercase
 * a-z/0-9/hyphen only, and not a reserved system word (admin, api, login, …).
 * Guards every activity create/update path — vendor + admin. Fails if the
 * @Matches or @IsNotReservedSlug guard is dropped from ANY of the three DTOs.
 */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateActivityDto } from '../../src/vendor/dto/create-activity.dto';
import { UpdateActivityDto } from '../../src/vendor/dto/update-activity.dto';
import { UpdateActivityDto as AdminUpdateActivityDto } from '../../src/admin/dto/update-activity.dto';

// vendor UpdateActivityDto is deliberately ABSENT here: it no longer declares a
// `slug` field at all, so there is nothing for these format/reserved-word rules
// to run against. Its (stronger) contract is asserted in its own block below.
const DTOS: [string, new () => Record<string, unknown>][] = [
  ['vendor CreateActivityDto', CreateActivityDto as never],
  ['admin UpdateActivityDto', AdminUpdateActivityDto as never],
];

async function slugErrors(Ctor: new () => Record<string, unknown>, value: string) {
  const dto = new Ctor();
  dto.slug = value;
  const errs = await validate(dto as object);
  return errs.filter((e) => e.property === 'slug');
}

describe('activity slug — format + reserved-word guard (all DTOs)', () => {
  describe.each(DTOS)('%s', (_name, Ctor) => {
    it.each(['desert-safari', 'yacht-cruise-2', 'q-houseboat'])('accepts a normal slug %j', async (v) => {
      expect(await slugErrors(Ctor, v)).toHaveLength(0);
    });

    it.each(['admin', 'api', 'login', 'register', 'vendor', 'dashboard', 'checkout', 'users'])(
      'rejects reserved word %j',
      async (v) => { expect((await slugErrors(Ctor, v)).length).toBeGreaterThan(0); },
    );

    it.each(['Desert Safari', 'UPPER', 'café-tour', 'a_b', 'a/b', 'admin ', ''])(
      'rejects bad-format %j',
      async (v) => { expect((await slugErrors(Ctor, v)).length).toBeGreaterThan(0); },
    );
  });
});

describe('vendor UpdateActivityDto — slug is not editable at all', () => {
  /**
   * A slug is a permanent public URL. Vendors may rename an activity freely,
   * but changing its address breaks every existing link (bookmark, shared
   * link, Google's index entry) and nothing records the old one.
   *
   * The enforcement is the ABSENCE of the property: the app's ValidationPipe
   * runs with forbidNonWhitelisted, so a vendor POSTing `slug` is rejected
   * rather than silently ignored. Admins keep an editable slug as the escape
   * hatch for the handful generated wrong before slugify was fixed.
   */
  it('does not declare a slug property', () => {
    expect(Object.prototype.hasOwnProperty.call(new UpdateActivityDto(), 'slug')).toBe(false);
    expect('slug' in new UpdateActivityDto()).toBe(false);
  });

  it('admin CAN still set a slug — the correction path stays open', async () => {
    const dto = new AdminUpdateActivityDto() as unknown as Record<string, unknown>;
    dto.slug = 'public-al-safliya-island-water-sports';
    const errs = (await validate(dto as object)).filter((e) => e.property === 'slug');
    expect(errs).toHaveLength(0);
  });
});

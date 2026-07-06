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

const DTOS: [string, new () => Record<string, unknown>][] = [
  ['vendor CreateActivityDto', CreateActivityDto as never],
  ['vendor UpdateActivityDto', UpdateActivityDto as never],
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

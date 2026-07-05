/**
 * Activity check-in/out times MUST align to the 30-min booking-slot grid (:00
 * or :30) on every create/update path — vendor + admin. An off-grid time (e.g.
 * 08:15) makes computeSlots emit off-grid slots, and the booking DTO's :00/:30
 * slot regex then rejects all of them → the activity is silently unbookable.
 * These tests fail if the @Matches guard is dropped from ANY of the three DTOs.
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

async function fieldErrors(Ctor: new () => Record<string, unknown>, field: string, value: string) {
  const dto = new Ctor();
  dto[field] = value;
  const errs = await validate(dto as object);
  return errs.filter((e) => e.property === field);
}

describe('activity check-in/out times align to the 30-min slot grid', () => {
  describe.each(DTOS)('%s', (_name, Ctor) => {
    it.each(['09:00', '09:30', '00:00', '23:30', '14:00', '14:30'])('accepts on-grid %s', async (v) => {
      expect(await fieldErrors(Ctor, 'checkInTime', v)).toHaveLength(0);
      expect(await fieldErrors(Ctor, 'checkOutTime', v)).toHaveLength(0);
    });

    it.each(['08:15', '08:45', '09:05', '10:20', '9:00', '24:00', '18:60', 'xx:yy'])(
      'rejects off-grid / invalid %s',
      async (v) => {
        expect((await fieldErrors(Ctor, 'checkInTime', v)).length).toBeGreaterThan(0);
        expect((await fieldErrors(Ctor, 'checkOutTime', v)).length).toBeGreaterThan(0);
      },
    );
  });
});
